// Picked sprites survive reloads, and a picture that can't show repairs itself.
import { expect, openPokemonList, rankItems, SPRITE_PNG, test } from './fixtures';

const IDS = [1, 4, 7, 25, 6, 150, 94, 130, 143];

async function brokenTiles(page: import('@playwright/test').Page) {
    return page.evaluate((ids) => {
        const { tileById, state } = window.__app.state;
        return ids.filter((id) => {
            const img = tileById.get(id)?.querySelector('img');
            return !img?.complete || img.naturalWidth === 0 || !state.picks[id];
        });
    }, IDS);
}

test('picks survive a reload', async ({ page }) => {
    await openPokemonList(page);
    await rankItems(page, IDS);
    await page.evaluate(async (ids) => {
        for (const id of ids) await window.__app.sprites.pickSprite(id, `other/official-artwork/${id}.png`, { quiet: true });
        window.__app.persist.saveNow();
    }, IDS);
    await expect.poll(() => brokenTiles(page)).toEqual([]);
    await page.reload();
    await page.waitForFunction(() => window.__app?.state.state.tiers.some((t: { items: number[] }) => t.items.length));
    await expect.poll(() => brokenTiles(page)).toEqual([]);
});

test('an error page from a mirror is never saved as a sprite', async ({ page }) => {
    // the first mirror answers "200 OK" with a web page instead of a picture
    await page.route(/raw\.githubusercontent\.com\/.*official-artwork\/94\.png/, (r) =>
        r.fulfill({ body: '<html>Too many requests</html>', contentType: 'text/html', headers: { 'access-control-allow-origin': '*' } }),
    );
    await openPokemonList(page);
    await rankItems(page, [94]);
    await page.evaluate(() => window.__app.sprites.pickSprite(94, 'other/official-artwork/94.png', { quiet: true }));
    const savedType = await page.evaluate(async () => {
        const blob: Blob = window.__app.state.spriteBlobs.get(94);
        return Array.from(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
    });
    expect(savedType).toEqual([...SPRITE_PNG.subarray(0, 4)]); // PNG signature, from the next mirror
});

test('a broken sprite saved by an older version repairs itself', async ({ page }) => {
    await openPokemonList(page);
    await rankItems(page, [143]);
    await page.evaluate(async () => {
        const junk = new Blob(['<html>error</html>'], { type: 'image/png' });
        await window.__app.sprites.setPick(143, junk, { path: 'other/official-artwork/143.png', ck: 1 });
        window.__app.persist.saveNow();
    });
    await expect.poll(() => page.evaluate(() => window.__app.state.tileById.get(143).querySelector('img').naturalWidth)).toBeGreaterThan(0);
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.tileById.get(143));
    await expect.poll(() => page.evaluate(() => window.__app.state.tileById.get(143).querySelector('img').naturalWidth)).toBeGreaterThan(0);
});
