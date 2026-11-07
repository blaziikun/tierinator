// Automatic accessibility checks (axe-core, WCAG 2 A and AA) on the main screens: nothing serious or critical.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

// axe walks every tile of the Pokémon pool (about 1,300), which takes 15–25 s here and more on CI's runners
test.describe.configure({ timeout: 90_000 });

async function seriousProblems(page: Page, only?: string): Promise<string[]> {
    const checker = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
    const { violations } = await (only ? checker.include(only) : checker).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test('the start screen, the About window and a Pokémon list pass the automatic checks', async ({ page, errors }) => {
    await openSite(page);
    expect(await seriousProblems(page)).toEqual([]);

    await page.click('#filebtn');
    await page.click('#aboutbtn');
    await expect(page.locator('#aboutm')).toBeVisible();
    expect(await seriousProblems(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.click('#startpk');
    await page.waitForFunction(() => window.__app.state.state.kind === 'pokemon' && !!window.__app.data.pokedex.pack);
    expect(await seriousProblems(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test.describe('with the system set to light', () => {
    test.use({ colorScheme: 'light' });
    test('a new list still starts in the one built-in dark look, and passes', async ({ page, errors }) => {
        await openSite(page);
        expect(await page.evaluate(() => window.__app.state.state.theme)).toMatchObject({ preset: 'default', bg: '#0b0b0c' });
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 11, 12)');
        expect(await seriousProblems(page)).toEqual([]);
        await page.click('#startpk');
        await page.waitForFunction(() => window.__app.state.state.kind === 'pokemon' && !!window.__app.data.pokedex.pack);
        expect(await page.evaluate(() => window.__app.state.state.theme.preset)).toBe('default');
        expect(errors).toEqual([]);
    });
});

/** List menu → New alignment chart, with an item in a cell and one left in the pool. */
async function openAlignmentChart(page: Page): Promise<void> {
    await openSite(page);
    await page.click('#startempty');
    await page.click('#listbtn');
    await page.click('#lnewchart');
    await page.waitForFunction(() => window.__app.state.state.layout === 'chart');
    await page.evaluate(async () => {
        const placed = await window.__app.ownItems.addItem({ name: 'Paladin' });
        await window.__app.ownItems.addItem({ name: 'Trickster' });
        window.__app.state.state.tiers[0].items.push(placed);
        window.__app.state.state.tiers[4].subtitle = 'the middle way';
        window.__app.board.renderTiers();
    });
}

test('an alignment chart passes, and so do its Layout and Columns controls in Style', async ({ page, errors }) => {
    await openAlignmentChart(page);
    expect(await seriousProblems(page)).toEqual([]);
    await page.click('#stylebtn');
    await expect(page.locator('#ap-colsrow')).toBeVisible();
    expect(await seriousProblems(page, '#ap-layout')).toEqual([]);
    expect(await seriousProblems(page, '#ap-colsrow')).toEqual([]);
    expect(errors).toEqual([]);
});
