// Pictures don't pile up: blob: addresses are freed when items go or another list opens,
// uploads bigger than any export or screen uses are kept at 1024 px, and the Sprite Studio's
// 1,300-row list is only built once the studio is shown.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, openSite, SPRITE_PNG, test } from './fixtures';

/** Counts the page's blob: addresses that are still live (made and not yet freed). */
async function countBlobAddresses(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const live = new Set<string>();
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (object: Blob | MediaSource) => {
            const url = create(object);
            live.add(url);
            return url;
        };
        URL.revokeObjectURL = (url: string) => {
            live.delete(url);
            revoke(url);
        };
        Object.assign(window, { liveBlobAddresses: live });
    });
}
const liveBlobAddresses = (page: Page): Promise<number> =>
    page.evaluate(() => (window as unknown as { liveBlobAddresses: Set<string> }).liveBlobAddresses.size);

/** A new list of your own things, with `count` small pictures added; returns the list's and items' ids. */
async function listWithPictures(page: Page, count: number): Promise<{ listId: string; ids: number[] }> {
    await page.evaluate(() => window.__app.lists.createList('custom', 'Pictures'));
    await page.waitForFunction(() => window.__app.state.state.kind === 'custom');
    return page.evaluate(
        async ({ png, count }) => {
            const files = Array.from(
                { length: count },
                (_, i) => new File([new Uint8Array(png)], `picture ${i}.png`, { type: 'image/png' }),
            );
            await window.__app.ownItems.addImageFiles(files);
            return {
                listId: window.__app.state.session.listId,
                ids: window.__app.state.state.ownItems.map((item: { id: number }) => item.id),
            };
        },
        { png: [...SPRITE_PNG], count },
    );
}

test('pictures free their addresses when replaced, removed, or another list opens', async ({ page, errors }) => {
    await countBlobAddresses(page);
    await openSite(page);
    const { listId, ids } = await listWithPictures(page, 4);
    expect(await liveBlobAddresses(page)).toBe(4);

    await page.evaluate(
        async ({ id, png }) => window.__app.sprites.pickUpload(id, new Blob([new Uint8Array(png)], { type: 'image/png' })),
        { id: ids[0], png: [...SPRITE_PNG] },
    );
    expect(await liveBlobAddresses(page)).toBe(4);

    await page.evaluate((id) => window.__app.itemDeletion.deleteItems([id]), ids[1]);
    expect(await liveBlobAddresses(page)).toBe(3);

    await page.evaluate(() => window.__app.lists.createList('custom', 'Another list'));
    expect(await liveBlobAddresses(page)).toBe(0);

    await page.evaluate((id) => window.__app.lists.openList(id), listId);
    expect(await liveBlobAddresses(page)).toBe(3);
    await expect(page.locator('#pgrid .pi img[src^="blob:"]')).toHaveCount(3);
    expect(errors).toEqual([]);
});

test('big uploads are kept at 1024 px in their own format; small ones exactly as they are', async ({ page, errors }) => {
    await openSite(page);
    await page.evaluate(() => window.__app.lists.createList('custom', 'Pictures'));
    const kept = await page.evaluate(
        async (png) => {
            /** A noisy picture (so it doesn't compress to nothing) of this size and type. */
            const picture = (width: number, height: number, type: string): Promise<Blob> => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const g = canvas.getContext('2d')!;
                const pixels = g.createImageData(width, height);
                for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.random() * 255;
                g.putImageData(pixels, 0, 0);
                return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), type, 0.9));
            };
            window.__app.state.state.trimSprites = false; // so the small one is kept byte for byte
            const files = [
                new File([new Uint8Array(png)], 'small.png', { type: 'image/png' }),
                new File([await picture(2000, 1500, 'image/png')], 'wide.png', { type: 'image/png' }),
                new File([await picture(900, 1600, 'image/jpeg')], 'tall.jpg', { type: 'image/jpeg' }),
            ];
            await window.__app.ownItems.addImageFiles(files);
            const { spriteBlobs, state } = window.__app.state;
            return Promise.all(
                state.ownItems.map(async (item: { id: number }) => {
                    const blob: Blob = spriteBlobs.get(item.id);
                    const bitmap = await createImageBitmap(blob);
                    return { type: blob.type, bytes: blob.size, width: bitmap.width, height: bitmap.height };
                }),
            );
        },
        [...SPRITE_PNG],
    );
    expect(kept).toEqual([
        { type: 'image/png', bytes: SPRITE_PNG.length, width: 96, height: 96 },
        expect.objectContaining({ type: 'image/png', width: 1024, height: 768 }),
        expect.objectContaining({ type: 'image/jpeg', width: 576, height: 1024 }),
    ]);
    // shown on the board like any other picture
    await expect(page.locator('#pgrid .pi img[src^="blob:"]')).toHaveCount(3);
    expect(errors).toEqual([]);
});

test('the Sprite Studio list is built when the studio is first shown, and for lists opened inside it', async ({ page, errors }) => {
    await openPokemonList(page);
    await expect(page.locator('#strows .sr')).toHaveCount(0);
    await page.locator('#tab-studio').click();
    const rows = await page.locator('#strows .sr').count();
    expect(rows).toBeGreaterThan(1000);
    await expect(page.locator('#strows .sr.cur')).toHaveCount(1); // filtered and marked as before
    // another Pokémon list opened while the studio is open has its list straight away
    await page.evaluate(() => window.__app.lists.createList('pokemon', 'Second list'));
    await expect(page.locator('#strows .sr')).toHaveCount(rows);
    expect(errors).toEqual([]);
});
