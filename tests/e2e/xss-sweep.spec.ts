// Every text field the app has, filled with every attack in tests/e2e/injection.ts, and every window opened on
// the result: no script runs, no attacker element is made, nothing is blocked (the app on its own trips nothing).
// Outside sites are local stand-ins; any other address is refused, so nothing here reaches the internet.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, openSite, rankItems, SPRITE_PNG, test } from './fixtures';
import { ATTACKS, expectNothingInjected, watchForInjection } from './injection';
import { serveMockWiki } from './mock-wiki';

const KNOWN_HOSTS =
    /^https:\/\/(fonts\.(googleapis|gstatic)\.com|raw\.githubusercontent\.com|cdn\.jsdelivr\.net|en\.wikipedia\.org|upload\.wikimedia\.org|mockugan\.fandom\.com|static\.wikia\.nocookie\.net|pictures\.example)\//;

/** Watches for injection, and refuses every outside address that has no stand-in. */
async function sealedOff(context: BrowserContext): Promise<string[]> {
    const { probeRequests } = await watchForInjection(context);
    await context.route(/^https?:\/\//, (route) => {
        const address = route.request().url();
        return address.startsWith('http://127.0.0.1') || KNOWN_HOSTS.test(address) ? route.fallback() : route.abort();
    });
    return probeRequests;
}

/** Types each attack into a field, pressing Enter after each if that's how the field is used. */
async function typeEach(page: Page, field: string, { enter = false } = {}): Promise<void> {
    for (const attack of ATTACKS) {
        await page.fill(field, attack);
        if (enter) await page.press(field, 'Enter');
    }
}

/** An empty list of your own whose items are named after the attacks. */
async function listOfAttacks(page: Page): Promise<number[]> {
    await openSite(page);
    await page.click('#startempty');
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="txt"]');
    await page.fill('#addtxt', ATTACKS.join('\n'));
    await page.click('#addtxtgo');
    await expect(page.locator('#pgrid .pi')).toHaveCount(ATTACKS.length);
    await page.keyboard.press('Escape');
    return page.evaluate(() => window.__app.state.state.ownItems.map((item: { id: number }) => item.id));
}

/** Opens a tab of Add items, opening the window first if adding closed it. */
async function addTab(page: Page, tab: string): Promise<void> {
    if (!(await page.locator('#addm').evaluate((window) => window.classList.contains('show')))) await page.click('#addbtn');
    await page.click(`#addtabs [data-t="${tab}"]`);
}

/** Closes whatever is open, as a person would: Escape once per window (one can open over another). */
async function closeWindows(page: Page): Promise<void> {
    await expect(async () => {
        await page.keyboard.press('Escape');
        expect(await page.locator('.modal.show').count()).toBe(0);
    }).toPass({ intervals: [200, 400, 800] });
}

test('every field of a list, and every window opened on it', async ({ page, context, errors }) => {
    test.slow();
    const probeRequests = await sealedOff(context);
    const ids = await listOfAttacks(page);

    // searching and finding
    await typeEach(page, '#psearch', { enter: true });
    await page.fill('#psearch', '');
    // with the pool hidden (Pool ▾ → Hidden), Find looks in the tiers
    await page.click('#poolplacebtn');
    await page.click('#poolmenu [data-choice="hidden"]');
    await page.click('#findfab');
    await typeEach(page, '#findin', { enter: true });
    await page.keyboard.press('Escape');
    await page.click('#poolplacebtn');
    await page.click('#poolmenu [data-choice="side"]');

    // the list's name
    await page.click('#listbtn');
    await typeEach(page, '#lname', { enter: true });
    await page.keyboard.press('Escape');

    // every tier's label and subtitle
    const tiers = await page.locator('#tsec .tlbl').count();
    for (let index = 0; index < tiers; index++) {
        await page.locator('#tsec .tlbl').nth(index).click();
        await page.fill('#edlbl', ATTACKS[index % ATTACKS.length]!);
        await page.fill('#edsub', ATTACKS[(index + 1) % ATTACKS.length]!);
        await page.click('#edsave');
    }

    // the item editor: name, note, tags, a picture link, a new variant's name
    await page.click(`#pgrid .pi[data-id="${ids[0]}"]`, { button: 'right' });
    await expect(page.locator('#ied')).toHaveClass(/show/);
    await typeEach(page, '#iedname', { enter: true });
    await typeEach(page, '#iednote');
    for (const attack of ATTACKS) {
        await page.fill('#iedtagin', attack);
        await page.press('#iedtagin', 'Enter');
    }
    await typeEach(page, '#iedurl', { enter: true });
    await page.click('#iednewvar');
    await page.fill('#cinp', ATTACKS[0]!);
    await page.click('#cok');
    await page.click('#ieddone');

    // tagging a selection
    await page.click(`#pgrid .pi[data-id="${ids[1]}"]`);
    await page.click('#seltag');
    for (const attack of ATTACKS) {
        await page.fill('#tagpopin', attack);
        await page.press('#tagpopin', 'Enter');
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // variants, the studio's search
    await page.click('#varbtn');
    await typeEach(page, '#varq');
    await page.keyboard.press('Escape');
    await page.click('#tab-studio');
    await typeEach(page, '#stq');
    // the search filters a list of your own (it once threw instead): only the items named like the last attack
    const named = await page.evaluate(
        (query) => window.__app.state.state.ownItems.filter((item: { name: string }) => item.name.toLowerCase().includes(query)).length,
        ATTACKS.at(-1)!.toLowerCase(),
    );
    expect(named).toBeLessThan(ATTACKS.length);
    await expect(page.locator('#strows .sr')).toHaveCount(named);
    await page.fill('#stq', '');
    await page.click('#tab-tier');

    // Style: the site's name and a saved theme's name
    await page.click('#stylebtn');
    await typeEach(page, '#ap-name');
    await page.click('#thsave');
    await page.fill('#thnamein', ATTACKS[1]!);
    await page.click('#thnameok');
    await page.click('#apdone');

    // four in the top tier (enough to sort head to head), two left in the pool (for quick rank), the rest spread out;
    // then every window that shows names, labels or notes
    await page.evaluate(() => {
        const { state } = window.__app.state;
        const all = state.ownItems.map((item: { id: number }) => item.id);
        state.tiers.forEach((tier: { items: number[] }) => {
            tier.items = [];
        });
        state.tiers[0].items.push(...all.slice(0, 4));
        all.slice(4, -2).forEach((id: number, index: number) => {
            state.tiers[1 + (index % (state.tiers.length - 1))].items.push(id);
        });
        window.__app.board.renderTiers(); // redrawn, not just re-placed: a tier's sort button counts its items
        window.__app.persist.saveNow();
    });
    await page.locator('#tsec .pi').first().hover();
    await expect(page.locator('#tip')).toBeVisible();

    await page.click('#statsbtn');
    await expect(page.locator('#statsm')).toHaveClass(/show/);
    await closeWindows(page);
    await page.click('#qrbtn');
    await expect(page.locator('#qr')).toHaveClass(/show/);
    await closeWindows(page);
    await page.locator('#tsec .tctrl button[title^="Sort this tier"]:not([disabled])').first().click();
    await expect(page.locator('#h2h')).toHaveClass(/show/);
    await closeWindows(page);
    await page.click('#filebtn');
    await page.click('#expbtn');
    await page.check('#expnotes');
    await page.keyboard.press('Escape');
    await page.click('#filebtn');
    await page.click('#aboutbtn');
    await page.click('#aboutcredits');
    await expect(page.locator('#pclist')).toBeVisible();
    await closeWindows(page);
    await page.click('#listbtn');
    await page.click('#lstream'); // the top bar's Stream mode button is hidden until turned on in Style
    await expect(page.locator('#streamm')).toBeVisible(); // loaded on first use, and it sets its options as it opens
    await page.check('#streamnames');
    await page.click('#streamgo');
    await expect(page.locator('#stream')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#stream')).toBeHidden();
    await page.click('#keysbtn');
    await closeWindows(page);

    await expectNothingInjected(page, probeRequests);
    expect(errors).toEqual([]);
});

test('adding items: web search, picture links, a wiki and a pack from a wiki', async ({ page, context, errors }) => {
    test.slow();
    const probeRequests = await sealedOff(context);
    await serveMockWiki(context);
    // Wikipedia's search answers with attacks for titles and descriptions, and a javascript: picture
    await page.route(/en\.wikipedia\.org\/w\/api\.php.*generator=/, (route) =>
        route.fulfill({
            headers: { 'access-control-allow-origin': '*' },
            json: {
                query: {
                    pages: Object.fromEntries(
                        ATTACKS.map((attack, index) => [
                            String(index + 1),
                            {
                                title: attack,
                                index: index + 1,
                                description: ATTACKS[(index + 1) % ATTACKS.length],
                                thumbnail: { source: index % 2 ? `https://pictures.example/${index}.png` : 'javascript:__xssRan=1' },
                            },
                        ]),
                    ),
                },
            },
        }),
    );
    await page.route('https://pictures.example/**', (route) =>
        route.fulfill({ body: SPRITE_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }),
    );
    await listOfAttacks(page);

    await addTab(page, 'web');
    await page.selectOption('#websrc', 'wiki');
    await typeEach(page, '#webq', { enter: true });
    await expect(page.locator('#webres .vc')).toHaveCount(ATTACKS.length / 2);
    await page.click('#weball');
    await page.click('#webadd');

    await addTab(page, 'url');
    await page.fill(
        '#addurl',
        ATTACKS.map((attack, index) => `${attack} | ${index % 2 ? 'https://pictures.example/a.png' : attack}`).join('\n'),
    );
    await page.click('#addurlgo');

    await addTab(page, 'wiki');
    await page.fill('#wkurl', 'mockugan');
    await page.click('#wkgo');
    await page.click('#wkcats .chip[data-load="Bakugan"]');
    await expect(page.locator('#wkres .vc')).toHaveCount(18);
    await typeEach(page, '#wkq');
    await typeEach(page, '#wkurl', { enter: true });
    await page.click('#wkpack');

    await expect(page.locator('#pbm')).toHaveClass(/show/);
    await typeEach(page, '#pbwiki');
    await typeEach(page, '#pbex');
    await page.click('#pbfind');
    await closeWindows(page);

    await expectNothingInjected(page, probeRequests);
    expect(errors).toEqual([]);
});

test('Combine rankings, the template gallery and a shared list, all with markup in them', async ({
    page,
    browser,
    context,
    errors,
}, testInfo) => {
    test.slow();
    const probeRequests = await sealedOff(context);
    const ids = await listOfAttacks(page);
    await rankItems(page, ids);
    const { link } = await page.evaluate(() => window.__app.share.makeShareLink());

    await page.click('#listbtn');
    await page.click('#lgroup');
    await expect(page.locator('#grpm')).toBeVisible();
    await page.fill('#grplinks', [...ATTACKS, link].join('\n'));
    await page.click('#grpaddlinks');
    // pasted text is split at spaces, and each piece that isn't a link is named, as text
    await expect(page.locator('#grpmsg')).toContainText(`“${ATTACKS[1]}” isn't a share link`);
    await page.click('#grpmine');
    for (const attack of ATTACKS.slice(0, 2)) {
        await page.locator('#grppeople input').first().fill(attack);
        await page.locator('#grppeople input').first().press('Tab');
    }
    await page.click('#grpgo');
    await expect(page.locator('#grpres')).toBeVisible();
    await expect(page.locator('#grpresbody')).toContainText(ATTACKS[1]!);
    await page.keyboard.press('Escape');

    await page.click('#listbtn');
    await page.click('#ltpl');
    await expect(page.locator('#tplm')).toBeVisible();
    await typeEach(page, '#tplq');
    await page.keyboard.press('Escape');

    // someone else opens the shared list, keeps it, and looks at it every way
    const { baseURL, viewport } = testInfo.project.use;
    const friend = await browser.newContext({ baseURL, viewport });
    const friendProbes = await sealedOff(friend);
    await friend.addInitScript(() => localStorage.setItem('pt_tips', '1'));
    const visitor = await friend.newPage();
    await visitor.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(visitor.locator('#sharebar')).toBeVisible();
    await visitor.click('#sharekeep');
    await expect(visitor.locator('#sharebar')).toBeHidden();
    await visitor.click('#statsbtn');
    await expect(visitor.locator('#statsm')).toHaveClass(/show/);
    await visitor.keyboard.press('Escape');
    await expectNothingInjected(visitor, friendProbes);
    await friend.close();

    await expectNothingInjected(page, probeRequests);
    expect(errors).toEqual([]);
});
