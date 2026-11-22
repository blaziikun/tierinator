// Stats: the numbers must match an independent count of the same ranking.
import { expect, openPokemonList, rankItems, test } from './fixtures';

const RANKED = [
    6, 149, 150, 151, 249, 250, 384, 445, 448, 483, 484, 487, 643, 644, 25, 26, 94, 130, 143, 248, 373, 376, 635, 887, 1, 4, 7, 10, 11, 12,
    13, 14, 15, 46, 47, 48, 49, 123,
];

test('type breakdown matches a hand count, and nothing overflows', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, RANKED);
    const expected = await page.evaluate(() => {
        const { state } = window.__app.state;
        const { entryById } = window.__app.items;
        return state.tiers.map((t: { items: number[] }) => t.items.filter((id) => entryById.get(id).types.includes('Dragon')).length);
    });
    await page.keyboard.press('i');
    await expect(page.locator('#statsm')).toBeVisible();
    await expect(page.locator('#statfacet option')).toContainText([
        'Overview',
        'Type',
        'Generation',
        'Evolution stage',
        'Legendary & special',
    ]);
    await page.selectOption('#statfacet', 'type');
    const dragonRow = page.locator('.hm tr', { has: page.locator('th', { hasText: 'Dragon' }) });
    const cells = await dragonRow.locator('td').allTextContents();
    expect(cells.slice(0, expected.length).map((c) => (c === '·' ? 0 : Number(c)))).toEqual(expected);
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win);
    expect(errors).toEqual([]);
});

test('box legends are counted as their own group', async ({ page }) => {
    await openPokemonList(page);
    await rankItems(page, [150, 249, 250, 384, 483, 25]);
    await page.keyboard.press('i');
    await page.selectOption('#statfacet', 'cat');
    const legend = await page.locator('.dnleg').first().innerText();
    expect(legend).toMatch(/Box legend\s+6 \(100%\)|Box legend[\s\S]*5/);
});

test('overview cards open breakdowns; the table and type toggles redraw', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [6, 149, 384, 25, 1, 4, 7, 150, 151, 143]);
    await page.click('#statsbtn');
    await expect(page.locator('#statsbody .sfacts')).toContainText('10');
    await page.locator('#statsbody .scard.taste[data-go="type"]').click();
    await expect(page.locator('#statfacet')).toHaveValue('type');
    const flyingRanked = page.locator('.hm tr', { has: page.locator('th', { hasText: 'Flying' }) }).locator('td.num b');
    await expect(flyingRanked).toHaveText('3'); // Charizard, Dragonite, Rayquaza are part Flying
    await page.click('[data-first="1"]');
    await expect(flyingRanked).toHaveText('0'); // …but none of them first
    await page.click('[data-hm="row"]');
    await expect(page.locator('.hm td').filter({ hasText: '%' }).first()).toBeVisible();
    expect(errors).toEqual([]);
});
