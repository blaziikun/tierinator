// Two tabs of the site: only the newest one saves, so an old tab can't put back an old version when it closes.
import type { Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

/** Changes one of the list's theme colours the way the Style panel's colour boxes do. */
async function setColour(page: Page, field: string, colour: string): Promise<void> {
    await page.evaluate(
        ([field, colour]) => {
            const input = document.querySelector<HTMLInputElement>(`[data-t="${field}"]`)!;
            input.value = colour!;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        },
        [field, colour],
    );
}

const savedTextColour = (page: Page) =>
    page.evaluate(() => {
        const id = window.__app.state.session.listId;
        return JSON.parse(localStorage.getItem('ptl_' + id) || '{}').theme?.text;
    });

test('an older tab stops saving when a newer one opens, and closing it changes nothing', async ({ page, context, errors }) => {
    await openSite(page);
    await setColour(page, 'text', '#222222');
    await expect.poll(() => savedTextColour(page)).toBe('#222222');

    const newer = await context.newPage();
    await openSite(newer);
    await expect(page.locator('#tabm')).toBeVisible();
    await expect(newer.locator('#tabm')).toBeHidden();

    await setColour(newer, 'text', '#f1ece2');
    await expect.poll(() => savedTextColour(newer)).toBe('#f1ece2');

    // the old tab closing (as when the browser quits) used to write its old copy back
    await page.close({ runBeforeUnload: true });
    const reopened = await context.newPage();
    await openSite(reopened);
    expect(await savedTextColour(reopened)).toBe('#f1ece2');
    expect(await reopened.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text').trim())).toBe('#f1ece2');
    expect(errors).toEqual([]);
});

test('"Use this tab instead" reloads the old tab with the latest saves and hands over', async ({ page, context, errors }) => {
    await openSite(page);
    const newer = await context.newPage();
    await openSite(newer);
    await setColour(newer, 'text', '#abcdef');
    await expect.poll(() => savedTextColour(newer)).toBe('#abcdef');

    await page.click('#tabuse');
    await page.waitForFunction(
        () =>
            !!window.__app?.state.session.listId &&
            getComputedStyle(document.documentElement).getPropertyValue('--text').trim() === '#abcdef',
    );
    await expect(page.locator('#tabm')).toBeHidden();
    await expect(newer.locator('#tabm')).toBeVisible();
    expect(errors).toEqual([]);
});
