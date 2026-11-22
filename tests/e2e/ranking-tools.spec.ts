// ⚡ Quick rank and ⇅ head to head.
import { expect, openPokemonList, rankItems, test } from './fixtures';

const tiers = (page: import('@playwright/test').Page): Promise<number[][]> =>
    page.evaluate(() => window.__app.state.state.tiers.map((tier: { items: number[] }) => tier.items));

test('quick rank: number keys place items, Back takes the last one out again', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, []);
    await page.fill('#psearch', 'chu'); // Pikachu, Raichu, Pichu…
    await page.click('#qrbtn');
    await expect(page.locator('#qr')).toHaveClass(/show/);
    const first = await page.locator('#qrname').textContent();
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    expect((await tiers(page)).slice(0, 2).map((items) => items.length)).toEqual([1, 1]);
    await page.keyboard.press('ArrowLeft');
    expect((await tiers(page))[1]).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#qr')).not.toHaveClass(/show/);
    expect(first).toBeTruthy();
    expect(errors).toEqual([]);
});

test('head to head: the answers decide the order; Ctrl+Z undoes it', async ({ page, errors }) => {
    await openPokemonList(page);
    await page.evaluate(() => {
        const { state } = window.__app.state;
        state.tiers.forEach((tier: { items: number[] }) => {
            tier.items = [];
        });
        state.tiers[0].items = [1, 4, 7, 25];
        window.__app.board.renderTiers();
    });
    await page.locator('#tsec .trow').first().locator('button', { hasText: '⇅' }).click();
    await expect(page.locator('#h2h')).toHaveClass(/show/);
    while (await page.locator('#h2h.show').count()) await page.click('#h2hb');
    // "second is better" every time keeps each new item after the ones before it: the order stays
    expect((await tiers(page))[0]).toEqual([1, 4, 7, 25]);

    await page.locator('#tsec .trow').first().locator('button', { hasText: '⇅' }).click();
    while (await page.locator('#h2h.show').count()) await page.click('#h2ha');
    expect((await tiers(page))[0]).toEqual([25, 7, 4, 1]);
    await page.keyboard.press('Control+z');
    expect((await tiers(page))[0]).toEqual([1, 4, 7, 25]);
    expect(errors).toEqual([]);
});
