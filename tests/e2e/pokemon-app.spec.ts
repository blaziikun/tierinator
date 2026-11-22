// Pokémon lists and PokeRank: new ones are made here, and a Pokémon list can be copied there in a link.

import { brand } from '../../src/brand';
import { expect, openPokemonList, openSite, rankItems, test } from './fixtures';

/** Copy to PokeRank is on once src/brand.ts names the Pokémon app (it's off until that site is live). */
const copyOn = 'pokemonApp' in brand;

test.beforeEach(async ({ page }) => {
    await page.context().route('https://pokerank.sayel.dev/**', (route) => route.fulfill({ body: 'PokeRank', contentType: 'text/plain' }));
});

test('New Pokémon list in the list menu makes one here, and only it offers Copy to PokeRank', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await page.click('#listbtn');
    await expect(page.locator('#lmove')).toBeHidden(); // not a Pokémon list
    await page.click('#lnewpk');
    await page.waitForFunction(() => window.__app.state.state.kind === 'pokemon', null, { timeout: 20_000 });
    // the empty starting list made way for it, as it does for any new list
    expect(await page.evaluate(() => window.__app.state.session.lists.map((list: { kind: string }) => list.kind))).toEqual(['pokemon']);
    await page.click('#listbtn');
    await expect(page.locator('#lmove')).toBeVisible({ visible: copyOn });
    expect(errors).toEqual([]);
});

test('a Pokémon list here works as always, and Copy to PokeRank opens all of it there in a link', async ({ page, errors }) => {
    test.skip(!copyOn, 'Copy to PokeRank is off until the Pokémon app is live (src/brand.ts)');
    await openPokemonList(page);
    await rankItems(page, [25, 6, 94]);
    await page.evaluate(() => {
        window.__app.state.currentListMeta().name = 'My favourites';
        window.__app.state.saveListIndex();
    });
    await page.click('#listbtn');
    await expect(page.locator('#lmove')).toBeVisible();
    await expect(page.locator('#lmove')).toHaveText('Copy to PokeRank…');
    await page.click('#lmove');
    await expect(page.locator('#cmsg')).toContainText('Open “My favourites” in PokeRank?');
    const opened = page.waitForEvent('popup');
    await page.locator('#cok').click();
    const link = (await opened).url();
    expect(link).toMatch(/^https:\/\/pokerank\.sayel\.dev\/#l=[A-Za-z0-9_-]+$/);
    const moved = await page.evaluate((link) => window.__app.share.listInLink(link), link);
    expect(moved).toMatchObject({ kind: 'pokemon', listName: 'My favourites', movedFrom: 'Tierinator' });
    expect((moved as { tiers: { items: number[] }[] }).tiers.flatMap((tier) => tier.items).sort((a, b) => a - b)).toEqual([6, 25, 94]);
    // and it stays here
    expect(await page.evaluate(() => window.__app.state.currentListMeta().name)).toBe('My favourites');
    expect(errors).toEqual([]);
});

test('a move link opened here is an ordinary shared list: only the app it was made for says where it came from', async ({
    page,
    errors,
}) => {
    // PokeRank names the apps it takes lists from (movesFrom); Tierinator names none, so the name is ignored
    await openPokemonList(page);
    await rankItems(page, [25, 6]);
    const { link } = await page.evaluate(() => window.__app.pokemonApp.moveLink());
    const hash = new URL(link, 'https://example.invalid').hash; // a full address once the Pokémon app is named
    await page.goto('about:blank'); // a new page load, as following the link would be
    await page.goto('/' + hash);
    await page.waitForFunction(() => !!window.__app?.state.currentListMeta()?.preview);
    await expect(page.locator('#sharetext')).toContainText("You're looking at a shared list");
    await expect(page.locator('#sharekeep')).toHaveText('Keep a copy');
    await page.click('#sharekeep');
    await expect(page.locator('#sharebar')).toBeHidden();
    expect(errors).toEqual([]);
});
