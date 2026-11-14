// Focus ▾ on a Pokémon list: the pool and the tiers show only what's chosen, and moving things while some are
// hidden keeps the hidden ones where they were.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, test } from './fixtures';

/** Puts exactly these items in the first tier, in this order, and nothing anywhere else. */
async function firstTier(page: Page, ids: number[]): Promise<void> {
    await page.evaluate((ids) => {
        const { state } = window.__app.state;
        state.tiers.forEach((tier: { items: number[] }, i: number) => {
            tier.items = i === 0 ? ids.slice() : [];
        });
        window.__app.board.placeAllTiles();
    }, ids);
}

const firstTierItems = (page: Page) => page.evaluate(() => window.__app.state.state.tiers[0].items as number[]);

async function focusOn(page: Page, facet: string, value: string): Promise<void> {
    await page.locator('#focusbtn').click();
    await page.locator(`#focuspop .chip[data-f="${facet}"][data-v="${value}"]`).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#focuspop')).toBeHidden();
}

// Pikachu 25 and Raichu 26 are Electric; Bulbasaur 1 and Charmander 4 aren't; Magnemite 81 is Electric / Steel.
test('choosing Electric hides everything else in the pool and the tiers, until Show all', async ({ page, errors }) => {
    await openPokemonList(page);
    await firstTier(page, [25, 1, 4, 26]);
    await focusOn(page, 'type', 'Electric');
    await expect(page.locator('#focusbtn')).toHaveText('Focus · 1 ▾');
    await expect(page.locator('#focusbar')).toBeVisible();
    await expect(page.locator('#focustext')).toContainText('Electric');
    await expect(page.locator('#focustext')).toContainText('2 of 4 ranked');
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(2);
    await expect(page.locator('#tsec .pi[data-id="1"]')).toBeHidden();
    await expect(page.locator('#pgrid .pi[data-id="81"]')).toBeVisible();
    await expect(page.locator('#pgrid .pi[data-id="7"]')).toBeHidden();
    // nothing about the ranking changed
    expect(await firstTierItems(page)).toEqual([25, 1, 4, 26]);
    await page.locator('#focusclr').click();
    await expect(page.locator('#focusbar')).toBeHidden();
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(4);
    await expect(page.locator('#focusbtn')).toHaveText('Focus ▾');
    expect(errors).toEqual([]);
});

test('within a facet any value matches, across facets all must; the stage shortcuts pick sets of stages', async ({ page }) => {
    await openPokemonList(page);
    await firstTier(page, [25, 26, 1, 3, 4, 6, 144]);
    await page.locator('#focusbtn').click();
    await page.locator('#focuspop .chip[data-f="type"][data-v="Electric"]').click();
    await page.locator('#focuspop .chip[data-f="type"][data-v="Fire"]').click();
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(4); // Pikachu, Raichu, Charmander, Charizard
    await page.locator('#focuspop .chip', { hasText: 'Fully evolved' }).click();
    await expect(page.locator('#focuspop .chip[data-f="stage"][data-v="final"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#focuspop .chip[data-f="stage"][data-v="single"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(2); // Raichu, Charizard
    await expect(page.locator('#focustext')).toContainText('Electric or Fire · Fully evolved');
    await page.locator('#focusnone').click();
    await expect(page.locator('#tsec .pi:visible')).toHaveCount(7);
});

test.describe('desktop', () => {
    test.skip(({ isMobile }) => !!isMobile, 'mouse dragging is a desktop interaction');

    test('dropped between two shown Pokémon, it lands straight after the left one', async ({ page, errors }) => {
        await openPokemonList(page);
        await firstTier(page, [25, 1, 4, 26]);
        await focusOn(page, 'type', 'Electric');
        const from = (await page.locator('#pgrid .pi[data-id="81"]').boundingBox())!;
        const raichu = (await page.locator('#tsec .pi[data-id="26"]').boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
        await page.mouse.move(raichu.x + 4, raichu.y + raichu.height / 2, { steps: 12 }); // Raichu's left half
        await page.mouse.up();
        expect(await firstTierItems(page)).toEqual([25, 81, 1, 4, 26]);
        expect(errors).toEqual([]);
    });
});

test('Alt+→ moves past the next shown Pokémon, and the hidden ones keep their places', async ({ page }) => {
    await openPokemonList(page);
    await firstTier(page, [25, 1, 4, 26, 7]);
    await focusOn(page, 'type', 'Electric');
    await page.locator('#tsec .pi[data-id="25"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    expect(await firstTierItems(page)).toEqual([1, 4, 26, 25, 7]);
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await firstTierItems(page)).toEqual([1, 4, 25, 26, 7]); // back before Raichu, after the hidden ones
});

test('Select all in the tiers takes only what the focus shows, and changing focus lets go of hidden ones', async ({ page }) => {
    await openPokemonList(page);
    await firstTier(page, [25, 1, 4, 26]);
    await page.locator('#tsec .pi[data-id="1"]').click();
    await focusOn(page, 'type', 'Electric');
    await expect(page.locator('#selcount')).toHaveText('0 selected');
    await page.evaluate(() => window.__app.board.selectAllIn('tiers'));
    expect(await page.evaluate(() => [...window.__app.state.state.selection].sort())).toEqual([25, 26]);
});

test('another list starts with nothing focused', async ({ page }) => {
    await openPokemonList(page);
    await focusOn(page, 'gen', '4');
    await expect(page.locator('#focusbar')).toBeVisible();
    await page.evaluate(() => window.__app.lists.createList('pokemon', 'Another'));
    await page.waitForFunction(() => window.__app.state.state.tiers.length > 0);
    await expect(page.locator('#focusbtn')).toHaveText('Focus ▾');
    await expect(page.locator('#focusbar')).toBeHidden();
});

test('a number key or a tier label puts the selection after the last one shown; ⇅ counts only what is shown', async ({ page }) => {
    await openPokemonList(page);
    await firstTier(page, [25, 1, 4]);
    await focusOn(page, 'type', 'Electric');
    await page.locator('#pgrid .pi[data-id="26"]').click();
    await page.keyboard.press('1');
    expect(await firstTierItems(page)).toEqual([25, 26, 1, 4]);
    // two shown: sortable while focused (three or more otherwise)
    await expect(page.locator('.trow >> nth=0 >> .h2hbtn')).toBeEnabled();
    await page.locator('#focusclr').click();
    await expect(page.locator('.trow >> nth=1 >> .h2hbtn')).toBeDisabled();
});
