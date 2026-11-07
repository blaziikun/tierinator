// The look: unreadable colours can't hide the text, Style changes can be undone, and your own default tiers.
import type { Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

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
const shownText = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text').trim());
const themeText = (page: Page) => page.evaluate(() => window.__app.state.state.theme.text);

test('text the same colour as the background is shown readable anyway, and Ctrl+Z puts the old colour back', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    const original = await themeText(page);
    await setColour(page, 'text', '#0d0c0b');
    expect(await themeText(page)).toBe('#0d0c0b');
    expect(await shownText(page)).toBe('#ffffff');

    await page.keyboard.press('Control+z');
    await expect.poll(() => themeText(page)).toBe(original);
    expect(await shownText(page)).toBe(original);
    expect(errors).toEqual([]);
});

test('"Use these tiers for new lists" carries your tier names to new lists, "Forget mine" goes back to SS → U', async ({
    page,
    errors,
}) => {
    await openSite(page);
    await page.click('#startempty');
    const labels = () => page.evaluate(() => window.__app.state.state.tiers.map((tier: { label: string }) => tier.label));
    expect(await labels()).toEqual(['SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F', 'U']);

    await page.evaluate(() => {
        const { state } = window.__app.state;
        state.tiers = state.tiers.slice(0, 3);
        state.tiers[0].label = 'goats';
    });
    await page.evaluate(() => document.getElementById('mytiersbtn')!.click());
    await page.evaluate(() => window.__app.lists.createList('custom', 'Second'));
    expect(await labels()).toEqual(['goats', 'S', 'A']);

    await page.evaluate(() => document.getElementById('mytiersx')!.click());
    await page.evaluate(() => window.__app.lists.createList('custom', 'Third'));
    expect(await labels()).toEqual(['SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F', 'U']);
    expect(errors).toEqual([]);
});

test('there is one built-in theme to pick, and a list saved with the old light one keeps its colours', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await page.click('#stylebtn');
    await expect(page.locator('#presets .preset')).toHaveCount(1);
    await expect(page.locator('#presets .preset .pn')).toHaveText('Tierinator');

    // a share link made before the site went dark only, with the light theme stored in it
    const { link } = await page.evaluate(() => {
        const { state } = window.__app.state;
        state.theme = { ...state.theme, preset: 'light', bg: '#f6f6f4', panel: '#ffffff', text: '#151517', muted: '#6c6c73', tint: 0.14 };
        return window.__app.share.makeShareLink();
    });
    await page.goto('about:blank');
    await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.locator('#sharebar')).toBeVisible();
    await page.waitForFunction(() => window.__app?.state.state.theme.bg === '#f6f6f4', null, { timeout: 20_000 });
    expect(await page.evaluate(() => window.__app.state.state.theme)).toMatchObject({
        preset: 'default',
        panel: '#ffffff',
        text: '#151517',
    });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 246, 244)');
    expect(errors).toEqual([]);
});
