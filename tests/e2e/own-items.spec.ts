// Lists of your own items: adding pictures as items, the item editor, the custom studio.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, SPRITE_PNG, test } from './fixtures';

/** Starts an empty list of your own items with two pictures added (one real, one not a picture). */
async function listWithTwoItems(page: Page): Promise<number[]> {
    await openPokemonList(page);
    await page.evaluate(() => window.__app.lists.createList('custom', 'My things'));
    await page.waitForFunction(() => window.__app.state.state.kind === 'custom');
    return page.evaluate(
        async (png) => {
            const files = [
                new File([new Uint8Array(png)], 'red_panda.png', { type: 'image/png' }),
                new File(['<html><script>alert(1)</script></html>'], 'sneaky.png', { type: 'image/png' }),
            ];
            await window.__app.ownItems.addImageFiles(files);
            return window.__app.state.state.ownItems.map((item: { id: number }) => item.id);
        },
        [...SPRITE_PNG],
    );
}

test('pictures become items; a fake picture gets a text tile instead', async ({ page, errors }) => {
    const [panda, sneaky] = await listWithTwoItems(page);
    const picks = await page.evaluate(() => window.__app.state.state.picks);
    expect(picks[panda]).toMatchObject({ path: 'custom' });
    expect(picks[panda].text).toBeUndefined();
    expect(picks[sneaky]).toMatchObject({ path: 'custom', text: 1 });
    await expect(page.locator(`#pgrid .pi[data-id="${panda}"] .pname`)).toHaveText('red panda');
    expect(errors).toEqual([]);
});

test('item editor: rename, tag, and delete', async ({ page, errors }) => {
    const [, sneaky] = await listWithTwoItems(page);
    await page.click(`#pgrid .pi[data-id="${sneaky}"]`, { button: 'right' });
    await expect(page.locator('#ied')).toHaveClass(/show/);

    await page.fill('#iedname', 'Not so sneaky');
    await page.press('#iedname', 'Enter');
    await expect(page.locator(`#pgrid .pi[data-id="${sneaky}"] .pname`)).toHaveText('Not so sneaky');

    await page.fill('#iedtagin', 'odd');
    await page.press('#iedtagin', 'Enter');
    await expect(page.locator('#iedtags .tchip')).toHaveText(['odd✕']);
    expect(await page.evaluate((id) => window.__app.state.state.tags[id], sneaky)).toEqual(['odd']);

    await page.click('#ieddel'); // no question: the toast offers Undo instead (delete-items.spec.ts)
    await expect(page.locator('#cconf')).toBeHidden();
    await expect(page.locator(`#pgrid .pi[data-id="${sneaky}"]`)).toHaveCount(0);
    expect(await page.evaluate((id) => window.__app.state.state.ownItems.some((item: { id: number }) => item.id === id), sneaky)).toBe(
        false,
    );
    expect(errors).toEqual([]);
});

test('custom studio: your own picture becomes a choice, and choosing it uses it', async ({ page, errors }) => {
    const [, sneaky] = await listWithTwoItems(page);
    await page.click('#tab-studio');
    await page.click(`#strows .sr[data-cid="${sneaky}"]`);
    await expect(page.locator('#stmain h2')).toHaveText('sneaky');

    const chooser = page.waitForEvent('filechooser');
    await page.click('#stmain [data-act="add"]');
    await (await chooser).setFiles({ name: 'better.png', mimeType: 'image/png', buffer: SPRITE_PNG });
    const choice = page.locator('#stmain .vc[data-xp]');
    await expect(choice).toHaveCount(1);
    await choice.click();
    await expect.poll(() => page.evaluate((id) => window.__app.state.state.picks[id]?.path, sneaky)).toMatch(/^xp:/);
    expect(errors).toEqual([]);
});

test('variants: group the selection, combine into one, and undo', async ({ page, errors }) => {
    const [panda, sneaky] = await listWithTwoItems(page);
    await page.click(`#pgrid .pi[data-id="${panda}"]`);
    await page.click(`#pgrid .pi[data-id="${sneaky}"]`, { modifiers: ['Control'] });
    await page.click('#selmerge');
    await page.click('#calt'); // "Combine into one"
    const families = () => page.evaluate(() => ({ ...window.__app.state.state.familyOf }));
    await expect.poll(families).toEqual({ [sneaky]: panda });
    await expect(page.locator(`#pgrid .pi[data-id="${panda}"] .fbadge`)).toHaveText('+1');
    await expect(page.locator(`#pgrid .pi[data-id="${sneaky}"]`)).toBeHidden();

    await page.click('#undobtn');
    await expect.poll(families).toEqual({});
    await expect(page.locator(`#pgrid .pi[data-id="${panda}"] .fbadge`)).toHaveCount(0);
    await expect(page.locator(`#pgrid .pi[data-id="${sneaky}"]`)).toBeVisible();
    expect(errors).toEqual([]);
});

test('pasting a picture while the item editor is open changes that item, not the list', async ({ page, errors }) => {
    const [, sneaky] = await listWithTwoItems(page);
    await page.click(`#pgrid .pi[data-id="${sneaky}"]`, { button: 'right' });
    await expect(page.locator('#ied')).toHaveClass(/show/);
    await page.evaluate(
        async (png) => {
            const data = new DataTransfer();
            data.items.add(new File([new Uint8Array(png)], 'pasted.png', { type: 'image/png' }));
            document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        },
        [...SPRITE_PNG],
    );
    await expect.poll(() => page.evaluate((id) => window.__app.state.state.picks[id]?.text, sneaky)).toBeUndefined();
    expect(await page.evaluate(() => window.__app.state.state.ownItems.length)).toBe(2);
    expect(errors).toEqual([]);
});
