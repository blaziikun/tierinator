// The Sprite Studio and the quick picker: browsing versions, picking, uploads, forms.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, SPRITE_PNG, test } from './fixtures';

async function openStudio(page: Page): Promise<void> {
    await openPokemonList(page);
    await page.click('#tab-studio');
    await expect(page.locator('#studio')).toBeVisible();
}

const pickOf = (page: Page, id: number) => page.evaluate((id) => window.__app.state.state.picks[id]?.path ?? null, id);

test('My sprites → quick picker → picking a version', async ({ page, errors }) => {
    await openStudio(page);
    await expect.poll(() => page.locator('#stmain .stgrid.mine .vc').count()).toBeGreaterThan(100);
    await page.click('#stmain .vc[data-id="25"]');
    await expect(page.locator('#qp')).toHaveClass(/show/);
    await expect(page.locator('#qpname')).toContainText('Pikachu');

    const card = page.locator('#qpbody .vc[data-path]:not([data-path^="gal:"])').first();
    const path = await card.getAttribute('data-path');
    await card.click();
    await expect.poll(() => pickOf(page, 25)).toBe(path);
    await expect(card).toHaveClass(/chosen/);
    const described = await page.evaluate((path) => window.__app.data.describeSpritePath(path), path);
    await expect(page.locator('#qpcur')).toHaveText('Using: ' + described);
    expect(errors).toEqual([]);
});

test('One Pokémon view: ▶ steps through, Show ▾ filters what is listed', async ({ page, errors }) => {
    await openStudio(page);
    await page.click('#vm-mon');
    await expect(page.locator('#stmain h2')).toContainText('#001');
    await page.click('#stmain [data-act="next"]');
    await expect(page.locator('#stmain h2')).toContainText('#002');

    const versionCount = () => page.locator('#stmain .vc[data-path]').count();
    const before = await versionCount();
    await page.click('#showbtn');
    await page.click('#fchips .chip[data-filter="back"]');
    await expect.poll(versionCount).toBeGreaterThan(before);
    expect(errors).toEqual([]);
});

test('uploads: a file that only pretends to be a picture is refused, a real one is used', async ({ page, errors }) => {
    await openStudio(page);
    await page.click('#vm-mon');
    const upload = async (name: string, mimeType: string, buffer: Buffer) => {
        const chooser = page.waitForEvent('filechooser');
        await page.click('#stmain [data-act="upload"]');
        await (await chooser).setFiles({ name, mimeType, buffer });
    };

    await upload('evil.png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>'));
    await expect(page.locator('#toast')).toContainText("isn't a picture");
    expect(await pickOf(page, 1)).toBeNull();

    await upload('mine.png', 'image/png', SPRITE_PNG);
    await expect.poll(() => pickOf(page, 1)).toBe('custom');
    expect(errors).toEqual([]);
});

test('an SVG added to your images is kept as a PNG (scripts inside it can never run)', async ({ page, errors }) => {
    await openStudio(page);
    await page.click('#vm-mon');
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>alert(1)</script><rect width="40" height="40" fill="red"/></svg>';
    const chooser = page.waitForEvent('filechooser');
    await page.click('#stmain .gadd');
    await (await chooser).setFiles({ name: 'art.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    await expect(page.locator('#stmain .vc[data-path^="gal:"]')).toHaveCount(1);
    const types = await page.evaluate(() => [...window.__app.gallery.gallery.values()].map((picture: { blob: Blob }) => picture.blob.type));
    expect(types).toEqual(['image/png']);
    expect(errors).toEqual([]);
});

test('a form can be split into its own entry and merged back', async ({ page, errors }) => {
    await openStudio(page);
    await page.click('#stmain .vc[data-id="6"]');
    const chip = page.locator('#qpbody .fchip').first();
    const formId = Number(await chip.getAttribute('data-fid'));
    const isRankable = () => page.evaluate((id) => window.__app.items.isRankable(id), formId);
    const startedSeparate = await isRankable();
    await chip.click();
    await expect.poll(isRankable).toBe(!startedSeparate);
    await page.locator(`#qpbody .fchip[data-fid="${formId}"]`).click();
    await expect.poll(isRankable).toBe(startedSeparate);
    expect(errors).toEqual([]);
});
