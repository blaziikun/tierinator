// The Grid view: favourites per cell from the ranking, pins that override it, saved grids, and back to the tiers.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, openSite, test } from './fixtures';

/** Ranks these items in the first tier, in this order. */
async function rankFirstTier(page: Page, ids: number[]): Promise<void> {
    await page.evaluate((ids) => {
        const { state } = window.__app.state;
        state.tiers.forEach((tier: { items: number[] }, i: number) => {
            tier.items = i === 0 ? ids.slice() : [];
        });
        window.__app.board.placeAllTiles();
        window.__app.persist.saveNow();
    }, ids);
}

const cell = (page: Page, row: string, col: string) => page.locator(`#gtable .gcell[data-key="*|${row}|${col}"]`);

// Gen 1 Electric: Pikachu 25, Raichu 26, Magnemite 81, Magneton 82, Voltorb 100, Electabuzz 125, Jolteon 135, Zapdos 145
test('the grid shows the best-ranked Pokémon of each generation and type; a pin overrides it and is saved', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankFirstTier(page, [26, 25, 6]);
    await page.locator('#tab-grid').click();
    await expect(page.locator('#gtabs button.on')).toHaveText('Gen × Type');
    await expect(cell(page, '1', 'Electric').locator('.gname')).toHaveText('Raichu');
    await expect(cell(page, '1', 'Fire').locator('.gname')).toHaveText('Charizard');
    await expect(cell(page, '1', 'Flying').locator('.gname')).toHaveText('Charizard'); // dual types count under both
    await expect(cell(page, '1', 'Grass')).toHaveText(/to rank/); // Gen 1 Grass: nothing ranked yet
    // Pikachu is my favourite, though I rank Raichu higher
    await cell(page, '1', 'Electric').click();
    await expect(page.locator('#gcellpop')).toBeVisible();
    await expect(page.locator('#gcellpop .gli').first()).toContainText('Raichu');
    await page.locator('#gcellpop [data-pin="25"]').click();
    await expect(cell(page, '1', 'Electric').locator('.gname')).toHaveText('Pikachu');
    await expect(cell(page, '1', 'Electric').locator('.gtop')).toHaveText('Ranked: Raichu');
    await expect(cell(page, '1', 'Electric')).toHaveClass(/pinned/);
    await page.keyboard.press('Escape');
    // kept with the list
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId && !!window.__app.data.pokedex.pack);
    await page.locator('#tab-grid').click();
    await expect(cell(page, '1', 'Electric').locator('.gname')).toHaveText('Pikachu');
    // and Ctrl/⌘ Z undoes a pin
    await cell(page, '1', 'Electric').click();
    await page.locator('#gcellpop [data-pin="25"]').click(); // unpin
    await expect(cell(page, '1', 'Electric').locator('.gname')).toHaveText('Raichu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cell(page, '1', 'Electric').locator('.gname')).toHaveText('Pikachu');
    expect(errors).toEqual([]);
});

test("a cell's Show in the tiers goes back to the tier list showing only that cell", async ({ page }) => {
    await openPokemonList(page);
    await rankFirstTier(page, [26, 1, 25, 4]);
    await page.locator('#tab-grid').click();
    await cell(page, '1', 'Electric').click();
    await page.locator('#gcelltiers').click();
    await expect(page.locator('#tab-tier')).toHaveClass(/on/);
    await expect(page.locator('#focustext')).toContainText('Gen 1 · Electric');
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(2);
    await expect(page.locator('#pgrid .pi[data-id="81"]')).toBeVisible(); // Magnemite: in the cell, not ranked
    await expect(page.locator('#pgrid .pi[data-id="172"]')).toBeHidden(); // Pichu: Gen 2
    await page.locator('#focusclr').click();
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(4);
});

test('ready-made grids: starters by generation, one column by type, type pairings, layers', async ({ page }) => {
    await openPokemonList(page);
    await rankFirstTier(page, [1, 4, 7, 152, 25]);
    await page.locator('#tab-grid').click();
    await page.locator('#gnew').click();
    await page.locator('#gnewpop button', { hasText: 'Starters' }).click();
    await expect(page.locator('#gtabs button.on')).toHaveText('Starters');
    await expect(page.locator('#gtable thead th')).toHaveText(['', 'Grass', 'Fire', 'Water']);
    await expect(cell(page, '2', 'Grass').locator('.gname')).toHaveText('Chikorita');
    await expect(page.locator('#gfocus')).toHaveText('Focus · on ▾');
    // one column
    await page.locator('#gnew').click();
    await page.locator('#gnewpop button', { hasText: 'By type' }).click();
    await expect(page.locator('#gtable')).toHaveClass(/one/);
    await expect(page.locator('#gtable .gcell[data-key="*|Electric|*"] .gname')).toHaveText('Pikachu');
    // the axes can be changed: the name follows until it's renamed
    await page.locator('#grows').selectOption('gen');
    await expect(page.locator('#gtabs button.on')).toHaveText('By generation');
    await page.locator('#gcols').selectOption('stage');
    await expect(page.locator('#gtabs button.on')).toHaveText('Gen × Stage');
    // a layer is seen one value at a time
    await page.locator('#glayer').selectOption('type');
    await page.locator('#glayers button', { hasText: 'Electric' }).click();
    await expect(page.locator('#gtable .gcell[data-key="Electric|1|first"] .gname')).toHaveText('Pikachu');
    await expect(page.locator('#gtable .gcell[data-key="Electric|1|middle"]')).toHaveClass(/empty|unranked/);
    // three grids now, each kept
    await expect(page.locator('#gtabs button')).toHaveCount(3);
});

test('which values an axis shows, renaming and deleting a grid', async ({ page }) => {
    await openPokemonList(page);
    await page.locator('#tab-grid').click();
    await page.locator('#gcolsv').click();
    await page.locator('#gvalpop [data-val="Fire"]').click();
    await page.locator('#gvalpop [data-val="Water"]').click();
    await expect(page.locator('#gtable thead th')).toHaveText(['', 'Fire', 'Water']);
    await expect(page.locator('#gcolsv')).toHaveText('2 of 18 ▾');
    await page.keyboard.press('Escape');
    await page.locator('#gmore').click();
    await expect(page.locator('#gdel')).toBeHidden(); // the only grid
    await page.locator('#gren').click();
    await page.locator('#cinp').fill('Fire and water');
    await page.locator('#cok').click();
    await expect(page.locator('#gtabs button.on')).toHaveText('Fire and water');
    await page.locator('#gnew').click();
    await page.locator('#gnewpop button', { hasText: 'A copy of this grid' }).click();
    await expect(page.locator('#gtabs button.on')).toHaveText('Fire and water (copy)');
    await page.locator('#gmore').click();
    await page.locator('#gdel').click();
    await page.locator('#cok').click();
    await expect(page.locator('#gtabs button')).toHaveCount(1);
});

test('the grid downloads as a picture', async ({ page }) => {
    test.skip(!!test.info().project.use.isMobile, 'downloads are checked on desktop');
    await openPokemonList(page);
    await rankFirstTier(page, [26, 6, 1]);
    await page.locator('#tab-grid').click();
    await page.locator('#gcolsv').click();
    await page.locator('#gvalpop [data-val="Fire"]').click();
    await page.keyboard.press('Escape');
    await page.locator('#gmore').click();
    const download = page.waitForEvent('download');
    await page.locator('#gpng').click();
    expect((await download).suggestedFilename()).toMatch(/_gen-type_\d{4}-\d{2}-\d{2}\.png$/);
});

test('G switches to the grid and back on a Pokémon list; lists of your own have no grid', async ({ page }) => {
    await openPokemonList(page);
    await page.locator('body').press('g');
    await expect(page.locator('#gridview')).toBeVisible();
    await page.locator('body').press('g');
    await expect(page.locator('#main')).toBeVisible();
    await page.locator('body').press('g');
    await expect(page.locator('#gridview')).toBeVisible();
    // opening a list of your own while on the grid goes back to the tier list
    await page.evaluate(() => window.__app.lists.createList('custom', 'Mine'));
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#tab-grid')).toBeHidden();
});

test('a list of your own never shows the Grid tab', async ({ page }) => {
    await openSite(page);
    await expect(page.locator('#tab-grid')).toBeHidden();
    await expect(page.locator('#focusbtn')).toBeHidden();
});
