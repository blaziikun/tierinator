// Moving tiles: drag into a tier, drag back to the pool, box-select, click a tier label to move the selection.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, rankItems, test } from './fixtures';

const tierItems = (page: Page) => page.evaluate(() => window.__app.state.state.tiers.map((t: { items: number[] }) => t.items));

async function dragTo(page: Page, from: string, to: string) {
    await page.locator(from).scrollIntoViewIfNeeded();
    const a = (await page.locator(from).boundingBox())!;
    const b = (await page.locator(to).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
    await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
}

test.describe('desktop', () => {
    test.skip(({ isMobile }) => !!isMobile, 'mouse dragging is a desktop interaction');

    test('drag a tile from the pool into a tier, then back', async ({ page, errors }) => {
        await openPokemonList(page);
        await rankItems(page, []);
        await dragTo(page, '#pgrid .pi[data-id="25"]', '.tcont >> nth=1');
        expect((await tierItems(page))[1]).toEqual([25]);
        await expect(page.locator('.tcont >> nth=1').locator('.pi[data-id="25"]')).toHaveCount(1);
        await dragTo(page, '.tcont >> nth=1 >> .pi[data-id="25"]', '#pgrid');
        expect((await tierItems(page)).flat()).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('click tiles to select, then click a tier label to move them there', async ({ page }) => {
        await openPokemonList(page);
        await rankItems(page, []);
        await page.locator('#pgrid .pi[data-id="1"]').click();
        await page.locator('#pgrid .pi[data-id="4"]').click();
        await expect(page.locator('#selcount')).toHaveText('2 selected');
        await page.locator('.tlbl >> nth=2').click();
        expect((await tierItems(page))[2]).toEqual([1, 4]);
        await expect(page.locator('#selbar')).not.toHaveClass(/show/);
    });

    test('shift-click selects a range; Delete sends ranked ones back to the pool', async ({ page }) => {
        await openPokemonList(page);
        await rankItems(page, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
        const firstTier = page.locator('.tcont >> nth=0');
        await firstTier.locator('.pi[data-id="1"]').click();
        await page.keyboard.down('Shift');
        await page.locator('.tcont >> nth=0 >> .pi[data-id="1"]').click(); // (only id 1 sits in tier 1 with round-robin; range of one)
        await page.keyboard.up('Shift');
        await page
            .locator('#pgrid')
            .click({ position: { x: 5, y: 5 } })
            .catch(() => {});
        await rankItems(page, [10, 11, 12]);
        await page.evaluate(() => {
            const s = window.__app.state.state;
            s.tiers.forEach((t: { items: number[] }) => {
                t.items = [];
            });
            s.tiers[0].items = [10, 11, 12];
            window.__app.board.placeAllTiles();
        });
        await page.locator('.tcont >> nth=0 >> .pi[data-id="10"]').click();
        await page.keyboard.down('Shift');
        await page.locator('.tcont >> nth=0 >> .pi[data-id="12"]').click();
        await page.keyboard.up('Shift');
        await expect(page.locator('#selcount')).toHaveText('3 selected');
        await page.keyboard.press('Delete');
        expect((await tierItems(page)).flat()).toEqual([]);
    });

    test('drag a box over empty space to select every tile inside it', async ({ page }) => {
        await openPokemonList(page);
        await rankItems(page, []);
        const grid = (await page.locator('#pgrid').boundingBox())!;
        const first = (await page.locator('#pgrid .pi >> nth=0').boundingBox())!;
        // start in the grid's top-left padding, sweep across the first row of tiles
        await page.mouse.move(grid.x + 2, grid.y + 2);
        await page.mouse.down();
        await page.mouse.move(first.x + first.width * 3.5, first.y + first.height / 2, { steps: 10 });
        await page.mouse.up();
        await expect(page.locator('#selcount')).toHaveText(/^[2-9]\d* selected$/);
    });

    test('number keys move the selection to that tier; 0 sends it back', async ({ page }) => {
        await openPokemonList(page);
        await rankItems(page, []);
        await page.locator('#pgrid .pi[data-id="7"]').click();
        await page.keyboard.press('3');
        expect((await tierItems(page))[2]).toEqual([7]);
        await page.locator('.tcont >> nth=2 >> .pi[data-id="7"]').click();
        await page.keyboard.press('0');
        expect((await tierItems(page)).flat()).toEqual([]);
    });
});
