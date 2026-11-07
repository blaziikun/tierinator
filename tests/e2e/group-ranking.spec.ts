// Combine rankings: two people's share links (and list files) become one group list, then the results window.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openPokemonList, openSite, rankItems, test } from './fixtures';

/** Makes a list of your own with these tiers of item names, and returns its share link. */
async function rankedListLink(page: Page, title: string, tiers: Record<string, string[]>): Promise<string> {
    return page.evaluate(
        async ({ title, tiers }) => {
            const app = window.__app;
            await app.lists.createList('custom', title);
            const ids: Record<string, number> = {};
            for (const names of Object.values(tiers)) for (const name of names) ids[name] = await app.ownItems.addItem({ name });
            const colours = ['#65e3f9', '#a2e49f', '#fbdf46', '#995f25', '#d60003'];
            app.state.state.tiers = Object.entries(tiers).map(([label, names], index) => ({
                id: 'tier' + index,
                label,
                subtitle: '',
                color: colours[index % colours.length],
                items: names.map((name) => ids[name]),
            }));
            app.board.renderTiers();
            app.persist.saveNow();
            return (await app.share.makeShareLink()).link as string;
        },
        { title, tiers },
    );
}

/** Each tier of the open list: its label and the names in it, in order. */
const tiersByName = (page: Page) =>
    page.evaluate(() =>
        window.__app.state.state.tiers.map((tier: { label: string; items: number[] }) => [
            tier.label,
            tier.items.map((id) => window.__app.items.entryById.get(id).name),
        ]),
    );

/** The names in the window's list of rankings. */
const names = (page: Page) =>
    page.locator('#grppeople input').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

async function seriousProblems(page: Page, only: string): Promise<string[]> {
    const { violations } = await new AxeBuilder({ page }).include(only).withTags(['wcag2a', 'wcag2aa']).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

/** Two people ranked the same snacks, the second with other spellings and one snack more. */
async function twoSnackLinks(page: Page): Promise<[string, string]> {
    await openSite(page);
    await page.click('#startempty');
    const first = await rankedListLink(page, 'Snacks', { S: ['Crisps', 'Olives'], A: ['Toast'], B: [], C: ['Popcorn'], D: [] });
    const second = await rankedListLink(page, 'Snacks', { S: ['Toast'], A: ['crisps '], B: ['POPCORN'], C: [], D: ['Olivés', 'Nachos'] });
    return [first, second];
}

async function openCombineWindow(page: Page): Promise<void> {
    await page.click('#listbtn');
    await page.click('#lgroup');
    await expect(page.locator('#grpm')).toBeVisible();
}

test('two share links become the group’s list, and the results say who agreed', async ({ page, errors }) => {
    const [first, second] = await twoSnackLinks(page);
    await openCombineWindow(page);
    await expect(page.locator('#grpgo')).toBeDisabled();
    await expect(page.locator('#grppeople')).toContainText('None yet');

    // a whole link, a bare "#l=…" part, and something that isn't a link
    await page.fill('#grplinks', [first, 'not-a-link', second.slice(second.indexOf('#'))].join('\n'));
    await page.click('#grpaddlinks');
    await expect(page.locator('#grppeople .grpperson')).toHaveCount(2);
    await expect(page.locator('#grpmsg')).toContainText("“not-a-link” isn't a share link");
    await expect(page.locator('#grplinks')).toHaveValue('not-a-link');
    // both lists are called "Snacks", so the title tells nobody apart
    await expect.poll(() => names(page)).toEqual(['Person 1', 'Person 2']);
    await expect(page.locator('#grppeople .grpperson').first()).toContainText('“Snacks”, 4 items ranked, from a link');

    // the same link again is turned away
    await page.fill('#grplinks', first);
    await page.click('#grpaddlinks');
    await expect(page.locator('#grpmsg')).toContainText('already added');
    await expect(page.locator('#grppeople .grpperson')).toHaveCount(2);

    await page.locator('#grppeople input').first().fill('Sam');
    await page.locator('#grppeople input').first().press('Tab');
    await expect(page.locator('#grppeople [data-remove]').first()).toHaveAttribute('aria-label', 'Remove Sam');
    expect(await seriousProblems(page, '#grpm')).toEqual([]);

    await expect(page.locator('#grpgo')).toHaveText('Combine 2 rankings');
    await page.click('#grpgo');
    await expect(page.locator('#grpres')).toBeVisible();
    await expect(page.locator('#grpm')).toBeHidden();
    await expect(page.locator('#grpdone')).toBeFocused();

    // Crisps and Toast: one S, one A, so halfway, which goes up. Olives: S and D, so B. Popcorn: C and B, halfway, so B.
    // Nachos: only the second person ranked it, D. Names are spelt as the first list did.
    expect(await tiersByName(page)).toEqual([
        ['S', ['Crisps', 'Toast']],
        ['A', []],
        ['B', ['Olives', 'Popcorn']],
        ['C', []],
        ['D', ['Nachos']],
    ]);
    const lists = await page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name));
    expect(lists).toContain('Snacks (group)');
    expect(await page.evaluate(() => window.__app.state.currentListMeta().name)).toBe('Snacks (group)');
    // text tiles for every item (links can't carry uploaded pictures)
    await expect
        .poll(() =>
            page.evaluate(() =>
                window.__app.state.state.ownItems.every((item: { id: number }) => window.__app.state.state.picks[item.id]?.text),
            ),
        )
        .toBe(true);

    const results = page.locator('#grpresbody');
    await expect(results).toContainText('2 rankings combined into a new list of 5 items; 1 of them only some people ranked');
    await expect(results).toContainText('Closest to the group: Sam, on average 0.9 tiers away.');
    const disagreed = page.locator('#grpresbody table', { hasText: 'Most disagreed on' });
    await expect(disagreed.locator('tbody tr').first()).toContainText(/Olives\s*B\s*2 of 2\s*2 tiers/);
    const agreed = page.locator('#grpresbody table', { hasText: 'Most agreed on' });
    await expect(agreed.locator('tbody th')).toHaveText(['Crisps', 'Toast']);
    await expect(disagreed.locator('tbody th')).toHaveText(['Olives', 'Popcorn']);
    const people = page.locator('#grpresbody table', { hasText: 'How close each person was' });
    await expect(people.locator('tbody th')).toHaveText(['Sam', 'Person 2']);
    expect(await seriousProblems(page, '#grpres')).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.locator('#grpres')).toBeHidden();
    expect(errors).toEqual([]);
});

test('list files and your own list; files that aren’t rankings say what to do instead', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await rankedListLink(page, 'My planets', { Great: ['Mars', 'Saturn'], Fine: ['Venus'], Meh: ['Pluto'] });
    const friend = {
        app: 'tierlist',
        v: 10,
        kind: 'custom',
        listName: 'Planets',
        items: [
            { id: 2000000, name: 'mars' },
            { id: 2000001, name: 'Venus' },
            { id: 2000002, name: 'Plúto' },
        ],
        nextId: 2000003,
        tiers: [
            { id: 'a', label: 'Great', sub: '', color: '#65e3f9', text: '', items: [2000002] },
            { id: 'b', label: 'Fine', sub: '', color: '#a2e49f', text: '', items: [2000001] },
            { id: 'c', label: 'Meh', sub: '', color: '#fbdf46', text: '', items: [2000000] },
        ],
    };
    const file = (name: string, content: unknown) => ({
        name,
        mimeType: 'application/json',
        buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)),
    });

    await openCombineWindow(page);
    await page.click('#grpmine');
    await expect(page.locator('#grpmine')).toBeDisabled();
    await page
        .locator('#grpinp')
        .setInputFiles([
            file('friend.json', friend),
            file('everything.json', { app: 'tierlist', type: 'backup', v: 1, lists: [] }),
            file('notes.json', 'not json at all'),
            file('alignment.json', { ...friend, lay: 'chart' }),
            file('empty.json', { ...friend, tiers: [] }),
        ]);
    await expect(page.locator('#grppeople .grpperson')).toHaveCount(2);
    const message = page.locator('#grpmsg');
    await expect(message).toContainText('“everything.json” is a backup of many lists. Ask for just the one list');
    await expect(message).toContainText("“notes.json” isn't a list file");
    await expect(message).toContainText('“alignment.json” is a chart, not a ranking');
    await expect(message).toContainText('“empty.json” has nothing in its tiers yet');
    await expect.poll(() => names(page)).toEqual(['You', 'Planets']);
    await expect(page.locator('#grppeople .grpperson').nth(1)).toContainText('from friend.json');

    // removing one: focus stays in the window, and the button can't combine one ranking
    await page.locator('#grppeople [data-remove]').nth(1).click();
    await expect(page.locator('#grppeople .grpperson')).toHaveCount(1);
    await expect(page.locator('#grpgo')).toBeDisabled();
    await expect(page.locator('#grppeople [data-remove]')).toBeFocused();
    await page.locator('#grpinp').setInputFiles([file('friend.json', friend)]);
    await expect(page.locator('#grppeople .grpperson')).toHaveCount(2);

    await page.click('#grpgo');
    await expect(page.locator('#grpres')).toBeVisible();
    // the tiers both lists share. Mars and Pluto swapped places (Great and Meh), so both end up in the middle with
    // Venus; Saturn was only mine. Names are spelt as the first list (mine) did.
    expect(await tiersByName(page)).toEqual([
        ['Great', ['Saturn']],
        ['Fine', ['Mars', 'Pluto', 'Venus']],
        ['Meh', []],
    ]);
    expect(await page.evaluate(() => window.__app.state.currentListMeta().name)).toBe('My planets (group)');
    await expect(page.locator('#grpresbody')).toContainText('Closest to the group: You');
    await page.click('#grpdone');
    await expect(page.locator('#grpres')).toBeHidden();
    expect(errors).toEqual([]);
});

test('Pokémon lists are matched by Pokémon, and the group list is a Pokémon list', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [25, 6, 94]); // SS, S, A
    const first = await page.evaluate(async () => (await window.__app.share.makeShareLink()).link);
    await page.evaluate(() => window.__app.lists.createList('pokemon', 'Second opinion'));
    await page.waitForFunction(() => window.__app.state.currentListMeta()?.name === 'Second opinion');
    await rankItems(page, [94, 25]); // SS, S
    const second = await page.evaluate(async () => (await window.__app.share.makeShareLink()).link);

    await openCombineWindow(page);
    await page.fill('#grplinks', `${first}\n${second}`);
    await page.click('#grpaddlinks');
    await expect(page.locator('#grppeople .grpperson')).toHaveCount(2);
    await page.click('#grpgo');
    await expect(page.locator('#grpres')).toBeVisible();
    expect(await page.evaluate(() => window.__app.state.state.kind)).toBe('pokemon');
    // Pikachu: SS and S, halfway, so SS. Gengar: A and SS, so S, ahead of Charizard (also S, but one vote)
    const tiers = await page.evaluate(() => window.__app.state.state.tiers.slice(0, 3).map((tier: { items: number[] }) => tier.items));
    expect(tiers).toEqual([[25], [94, 6], []]);
    await expect(page.locator('#grpresbody')).toContainText('Pikachu');
    expect(errors).toEqual([]);
});

test('keyboard: Escape closes the window and focus goes back to the list menu’s button', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await openCombineWindow(page);
    await page.focus('#grpx');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#grpcancel')).toBeFocused(); // Combine is disabled, so Close is last
    await page.keyboard.press('Tab');
    await expect(page.locator('#grpx')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#grpm')).toBeHidden();
    await expect(page.locator('#listbtn')).toBeFocused();
    expect(errors).toEqual([]);
});
