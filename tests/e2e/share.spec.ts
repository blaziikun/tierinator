// The start screen, share links (preview → keep or close), and the About window.
import type { Page } from '@playwright/test';
import { expect, openPokemonList, openSite, rankItems, SPRITE_PNG, test } from './fixtures';

const listNames = (page: Page) => page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name));
const tierItems = (page: Page) => page.evaluate(() => window.__app.state.state.tiers.map((tier: { items: number[] }) => tier.items));

test('a first visit gets the start screen; "Pokémon" makes a Pokémon list and the screen goes', async ({ page, errors }) => {
    await openSite(page);
    await expect(page.locator('#start')).toBeVisible();
    await page.click('#startpk');
    await page.waitForFunction(() => window.__app.state.state.kind === 'pokemon' && !!window.__app.data.pokedex.pack);
    await expect(page.locator('#start')).toBeHidden();
    expect(await listNames(page)).toEqual(['My Pokémon tier list']);
    expect(errors).toEqual([]);
});

test('"Start with an empty list" just closes the start screen, and About opens and closes', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await expect(page.locator('#start')).toBeHidden();
    await page.click('#filebtn');
    await page.click('#aboutbtn');
    await expect(page.locator('#aboutm')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#aboutm')).toBeHidden();
    expect(errors).toEqual([]);
});

test('a share link opens as a preview; "Keep a copy" makes it a list and drops the empty start', async ({
    page,
    browser,
    errors,
}, testInfo) => {
    await openPokemonList(page);
    await rankItems(page, [25, 6, 94]);
    await page.evaluate(() => {
        window.__app.state.currentListMeta().name = 'Starters and friends';
        window.__app.state.saveListIndex();
    });
    const { link } = await page.evaluate(() => window.__app.share.makeShareLink());
    expect(link).toMatch(/\/#l=[A-Za-z0-9_-]+$/);

    // someone else, who has never visited
    const { baseURL, viewport } = testInfo.project.use;
    const friend = await browser.newContext({ baseURL, viewport });
    await friend.addInitScript(() => localStorage.setItem('pt_tips', '1'));
    const visitor = await friend.newPage();
    await visitor.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(visitor.locator('#sharebar')).toBeVisible();
    await expect(visitor.locator('#start')).toBeHidden();
    await visitor.waitForFunction(() => window.__app?.state.state.kind === 'pokemon');
    expect(await tierItems(visitor)).toEqual(await tierItems(page));

    await visitor.click('#sharekeep');
    await expect(visitor.locator('#sharebar')).toBeHidden();
    await expect.poll(() => listNames(visitor)).toEqual(['Starters and friends']);
    expect(new URL(visitor.url()).hash).toBe('');
    await visitor.reload();
    await visitor.waitForFunction(() => window.__app?.state.state.kind === 'pokemon');
    expect(await tierItems(visitor)).toEqual(await tierItems(page));
    await friend.close();
    expect(errors).toEqual([]);
});

test('closing a shared list throws it away; a broken or hostile link changes nothing', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [1, 4, 7]);
    const { link } = await page.evaluate(() => window.__app.share.makeShareLink());
    const mine = await listNames(page);

    await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.locator('#sharebar')).toBeVisible();
    expect(await listNames(page)).toHaveLength(mine.length + 1);
    await page.click('#shareclose');
    await expect(page.locator('#sharebar')).toBeHidden();
    await expect.poll(() => listNames(page)).toEqual(mine);

    await page.goto('/#l=bm90LWEtcmVhbC1saXN0');
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
    await expect(page.locator('#toast')).toContainText('broken');
    expect(await listNames(page)).toEqual(mine);

    // a link made by hand with a booby-trapped name: it's shown as text, nothing runs
    const hostile = await page.evaluate(() =>
        window.__app.linkData.packForLink({
            listName: '<img src=x onerror="document.title=1">',
            kind: 'custom',
            tiers: [{ label: '<b>x</b>', items: [] }],
        }),
    );
    await page.goto('/#l=' + hostile);
    await expect(page.locator('#sharebar')).toBeVisible();
    await expect(page).toHaveTitle(/Tierinator/);
    expect(errors).toEqual([]);
});

test('pictures from unknown sites in a link wait for a click, so the link can’t tell anyone it was opened', async ({ page, errors }) => {
    const asked: string[] = [];
    await page.context().route(/^https:\/\/(tracker\.example|upload\.wikimedia\.org)\//, (route) => {
        asked.push(new URL(route.request().url()).hostname);
        return route.fulfill({ body: SPRITE_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } });
    });
    await openSite(page);
    const link = await page.evaluate(() =>
        window.__app.linkData.packForLink({
            listName: 'Pictures from around the web',
            kind: 'custom',
            items: [
                { id: 2000000, name: 'Tracked' },
                { id: 2000001, name: 'Wikipedia' },
            ],
            nextId: 2000002,
            tiers: [{ label: 'S', color: '#ff7f7f', items: [2000000, 2000001] }],
            picks: { 2000000: { path: 'https://tracker.example/p.png' }, 2000001: { path: 'https://upload.wikimedia.org/w.png' } },
        }),
    );
    await page.goto('/#l=' + link);
    await expect(page.locator('#sharepics')).toHaveText('Show pictures from tracker.example');
    await expect.poll(() => asked).toContain('upload.wikimedia.org');
    expect(asked).not.toContain('tracker.example');

    await page.click('#sharepics');
    await expect(page.locator('#sharepics')).toBeHidden();
    await expect.poll(() => asked).toContain('tracker.example');
    await expect(page.locator('#sharebar')).toBeVisible();
    expect(errors).toEqual([]);
});
