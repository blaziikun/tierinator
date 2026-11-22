// Add items → From a wiki, against the fake "Mockugan" wiki.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, test } from './fixtures';
import { serveMockWiki, WIKI_HOST } from './mock-wiki';

async function openWikiTab(page: Page): Promise<void> {
    await serveMockWiki(page.context());
    await openPokemonList(page);
    await page.evaluate(() => window.__app.lists.createList('custom', 'Bakugan'));
    await page.waitForFunction(() => window.__app.state.state.kind === 'custom');
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="wiki"]');
}

test('a whole wiki lists its biggest categories; picking one loads its pages', async ({ page, errors }) => {
    await openWikiTab(page);
    await page.fill('#wkurl', 'mockugan');
    await page.click('#wkgo');
    await expect(page.locator('#wkcats .chip')).toHaveText(['Bakugan18', 'Characters2', 'Battle Gear1']);
    await page.click('#wkcats .chip[data-load="Bakugan"]');
    await expect(page.locator('#wkres .vc')).toHaveCount(18);
    await expect(page.locator('#wkres .vc.chosen')).toHaveCount(18);
    expect(errors).toEqual([]);
});

test('importing a category adds every page with its picture; same-name pages become variants', async ({ page, errors }) => {
    await openWikiTab(page);
    await page.fill('#wkurl', `${WIKI_HOST}/wiki/Category:Bakugan`);
    await page.press('#wkurl', 'Enter');
    await expect(page.locator('#wkres .vc')).toHaveCount(18);
    await page.fill('#wkq', 'preyas');
    await expect(page.locator('#wkres .vc:not(.hid)')).toHaveCount(2);
    await page.fill('#wkq', '');
    await page.click('#wkadd');
    await expect.poll(() => page.evaluate(() => window.__app.state.state.ownItems.length), { timeout: 20_000 }).toBe(18);
    // variants are grouped once every picture has been fetched
    await expect.poll(() => page.evaluate(() => Object.keys(window.__app.state.state.familyOf).length)).toBe(1);
    const result = await page.evaluate(() => {
        const { state } = window.__app.state;
        const named = (name: string) =>
            state.ownItems.filter((item: { name: string }) => item.name === name).map((item: { id: number }) => item.id);
        const [preyas, preyas2] = named('Preyas');
        const drago = named('Drago')[0];
        return {
            variantOf: state.familyOf[preyas2] === preyas,
            dragoPick: state.picks[drago]?.path,
            dragoWiki: state.ownItems.find((item: { id: number }) => item.id === drago).w,
        };
    });
    expect(result.variantOf).toBe(true);
    expect(result.dragoPick).toMatch(/^https:\/\/static\.wikia\.nocookie\.net\/.*Drago\.png$/);
    expect(result.dragoWiki).toEqual({ a: `${WIKI_HOST}/api.php`, t: 'Drago' });
    expect(errors).toEqual([]);
});
