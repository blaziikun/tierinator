// Find works with the pool hidden; hiding the pool clears a search; the hidden view is remembered.
import type { Page } from '@playwright/test';
import { expect, openPokemonList, rankItems, test } from './fixtures';

/** Pool ▾ → Hidden. */
async function hidePool(page: Page): Promise<void> {
    await page.locator('#poolplacebtn').click();
    await page.locator('#poolmenu [data-choice="hidden"]').click();
}

test('find a ranked Pokémon without opening the pool', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [6, 25, 150, 445]);
    await hidePool(page);
    await page.keyboard.press('f');
    await expect(page.locator('#findbar')).toBeVisible();
    await page.keyboard.type('pika');
    await expect(page.locator('#findcnt')).toContainText('1 of 1');
    await expect(page.locator('#psec')).toHaveClass(/phid/); // the pool stayed hidden
    await expect(page.locator('.pi.hit')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('an unranked match offers to open the pool', async ({ page }) => {
    await openPokemonList(page);
    await rankItems(page, [6]);
    await hidePool(page);
    await page.keyboard.press('f');
    await page.keyboard.type('togep');
    await expect(page.locator('#findcnt')).toHaveText('not ranked yet');
    await page.locator('#findpool').click();
    await expect(page.locator('#psec')).not.toHaveClass(/phid/);
    await expect(page.locator('#psearch')).toHaveValue('togep');
});

test('hiding the pool clears the search', async ({ page }) => {
    await openPokemonList(page);
    await rankItems(page, [6, 4]);
    await page.locator('#psearch').fill('char');
    await expect(page.locator('.pi.hit')).toHaveCount(2);
    await hidePool(page);
    await expect(page.locator('.pi.hit')).toHaveCount(0);
    await expect(page.locator('#psearch')).toHaveValue('');
});

test('hidden pool and top bar stay hidden after a reload', async ({ page }) => {
    await openPokemonList(page);
    await hidePool(page);
    await page.keyboard.press('h');
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.data.pokedex.pack);
    await expect(page.locator('#psec')).toHaveClass(/phid/);
    await expect(page.locator('body')).toHaveClass(/barsoff/);
});

test('the "ranked ↓" button jumps to each ranked match in turn', async ({ page }) => {
    // regression: this button once passed the click event as the jump direction and did nothing
    await openPokemonList(page);
    await rankItems(page, [6, 4, 25]);
    await page.locator('#psearch').fill('char');
    await expect(page.locator('#hitbtn')).toHaveText('2 ranked ↓');
    await page.locator('#hitbtn').click();
    await expect(page.locator('#hitbtn')).toHaveText(/^1\/2 in .+ ↓$/);
    await page.locator('#hitbtn').click();
    await expect(page.locator('#hitbtn')).toHaveText(/^2\/2 in .+ ↓$/);
});
