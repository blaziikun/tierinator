// tests/visual/screens.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Pixel-for-pixel screenshots of ~30 screens (desktop and phone), for changing
//  CSS safely. Pictures depend on the computer's fonts, so they're not kept in git:
//
//    pnpm test:visual --update-snapshots        take the "before" pictures
//    …change the CSS…
//    pnpm test:visual                           anything that moved by a pixel fails
// ─────────────────────────────────────────────────────────────────────────────
import type { Page } from '@playwright/test';
import { expect, openPokemonList, rankItems, SPRITE_PNG, test } from '../e2e/fixtures';

const shot = (page: Page, name: string) =>
    expect(page).toHaveScreenshot(name + '.png', { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 });
test.setTimeout(180_000);
/** Lets pictures load and transitions finish. */
const settle = (page: Page) => page.waitForTimeout(400);

test('pokemon screens', async ({ page }) => {
    await openPokemonList(page);
    await rankItems(page, [1, 4, 7, 25, 133, 150, 6, 9, 3]);
    await settle(page);
    await shot(page, 'tier');
    await page.click('#tsec .pi[data-id="25"]');
    await page.click('#tsec .pi[data-id="4"]', { modifiers: ['Control'] });
    await shot(page, 'selection');
    await page.keyboard.press('Escape');
    await page.locator('#tsec .pi[data-id="25"]').hover();
    await settle(page);
    await shot(page, 'hover');
    await page
        .locator('#tsec .tlbl')
        .first()
        .locator('..')
        .locator('button', { hasText: '✏' })
        .click()
        .catch(() => {});
    await settle(page);
    await shot(page, 'tier-editor');
    await page.keyboard.press('Escape');
    for (const [button, name] of [
        ['#listbtn', 'list-menu'],
        ['#filebtn', 'file-menu'],
        ['#formbtn', 'forms'],
    ] as const) {
        if (!(await page.locator(button).isVisible())) continue;
        await page.click(button);
        await settle(page);
        await shot(page, name);
        await page.keyboard.press('Escape');
    }
    await page.click('#filebtn');
    await page.click('#expbtn');
    await shot(page, 'export');
    await page.keyboard.press('Escape');
    // the other place for the pool (B switches beside and below)
    await page.keyboard.press('b');
    await settle(page);
    await shot(page, 'sidebar');
    await page.keyboard.press('b');
    await page.click('#addbtn');
    for (const tab of ['up', 'wiki', 'txt', 'web', 'url']) {
        await page.click(`#addtabs [data-t="${tab}"]`);
        await shot(page, 'add-' + tab);
    }
    await page.click('#addx');
    await page.click('#tsec .pi[data-id="25"]', { button: 'right' });
    await settle(page);
    await shot(page, 'quick-picker');
    await page.click('#qpdone');
    await page.click('#statsbtn');
    await settle(page);
    await shot(page, 'stats');
    await page.selectOption('#statfacet', 'type');
    await settle(page);
    await shot(page, 'stats-type');
    await page.click('#statsx');
    await page.click('#qrbtn');
    await shot(page, 'quick-rank');
    await page.keyboard.press('Escape');
    await page.click('#stylebtn');
    await settle(page);
    await shot(page, 'appearance');
    await page.keyboard.press('Escape');
    await page.click('#keysbtn');
    await shot(page, 'keys');
    await page.keyboard.press('Escape');
    await page.click('#tab-studio');
    await settle(page);
    await shot(page, 'studio-mine');
    await page.click('#vm-mon');
    await settle(page);
    await shot(page, 'studio-pokemon');
    await page.click('#vm-style');
    await settle(page);
    await shot(page, 'studio-style');
    await page.click('#showbtn');
    await shot(page, 'studio-show');
});

test('own items screens', async ({ page }) => {
    await openPokemonList(page);
    await page.evaluate(() => window.__app.lists.createList('custom', 'Mine'));
    await page.waitForFunction(() => window.__app.state.state.kind === 'custom');
    await page.evaluate(
        async (png) => {
            const files = ['Alpha', 'Beta', 'Gamma (Two)', 'Gamma'].map((n, i) =>
                i % 2
                    ? new File(['x'], n + '.png', { type: 'image/png' })
                    : new File([new Uint8Array(png)], n + '.png', { type: 'image/png' }),
            );
            await window.__app.ownItems.addImageFiles(files);
            window.__app.state.state.tags[window.__app.state.state.ownItems[0].id] = ['red', 'blue'];
            window.__app.board.renderTiers();
            window.__app.board.placeAllTiles();
        },
        [...SPRITE_PNG],
    );
    await settle(page);
    await shot(page, 'custom-tier');
    const first = await page.evaluate(() => window.__app.state.state.ownItems[0].id);
    await page.click(`#pgrid .pi[data-id="${first}"]`, { button: 'right' });
    await settle(page);
    await shot(page, 'item-editor');
    await page.click('#ieddone');
    await page.click('#varbtn');
    await shot(page, 'variants');
    await page.keyboard.press('Escape');
    await page.click('#tab-studio');
    await settle(page);
    await shot(page, 'custom-studio');
    await page.click('#cvm-all');
    await settle(page);
    await shot(page, 'custom-studio-all');
});
