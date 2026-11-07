// tests/e2e/offline.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The installable app: the manifest, the service worker keeping the app for
//  offline use, and the "A new version is ready" notice. The only browser tests
//  that let the service worker run (playwright.config.ts blocks it elsewhere).
// ─────────────────────────────────────────────────────────────────────────────
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

test.use({ serviceWorkers: 'allow' });

/** Waits until the service worker has kept the app's files and looks after this page. */
async function waitForOfflineApp(page: Page): Promise<void> {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });
}

/** A PNG's width and height, from its header. */
function pngSize(bytes: Buffer): string {
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('the manifest describes an installable app, with icons that exist', async ({ page, errors }) => {
    await openSite(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(manifest).toMatchObject({
        id: '/',
        name: 'Tierinator',
        short_name: 'Tierinator',
        description,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0b0b0c',
        background_color: '#0b0b0c',
    });

    const icons: { src: string; sizes: string; type: string; purpose: string }[] = manifest.icons;
    expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of icons) {
        const picture = await page.request.get(icon.src);
        expect(picture.ok(), icon.src).toBe(true);
        expect(icon.type).toBe('image/png');
        expect(pngSize(await picture.body()), icon.src).toBe(icon.sizes);
    }
    expect(errors).toEqual([]);
});

test('after one visit the app opens offline, with its lists and the privacy page', async ({ page, context, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await page.evaluate(async () => {
        const placed = await window.__app.ownItems.addItem({ name: 'Lighthouse' });
        await window.__app.ownItems.addItem({ name: 'Windmill' });
        window.__app.state.state.tiers[0].items.push(placed);
        window.__app.board.placeAllTiles();
        window.__app.persist.saveNow();
    });
    const listId = await page.evaluate(() => window.__app.state.session.listId);
    await waitForOfflineApp(page);
    // the worker kept this version's files; the big Pokémon pack waits until it's used
    const kept = await page.evaluate(async () => {
        const names = await caches.keys();
        const app = await caches.open(names.find((name) => name.startsWith('tierinator-app-'))!);
        return (await app.keys()).map((request) => new URL(request.url).pathname);
    });
    expect(kept).toEqual(expect.arrayContaining(['/', '/privacy.html', '/manifest.webmanifest']));
    expect(kept.some((path) => /^\/assets\/app-.+\.js$/.test(path))).toBe(true);
    expect(kept).not.toContain('/packs/pokemon.json');

    await context.setOffline(true);
    const reloaded = await page.reload();
    expect(reloaded?.fromServiceWorker()).toBe(true);
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    expect(await page.evaluate(() => window.__app.state.session.listId)).toBe(listId);
    expect(await page.evaluate(() => window.__app.state.state.tiers[0].items.length)).toBe(1);
    await expect(page.locator('#toolbar')).toBeVisible();

    // any other address opens the app, as the host does; the privacy page is kept too
    await page.goto('/privacy.html');
    await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
    await context.setOffline(false);
    expect(errors).toEqual([]);
});

test('a new version waits for the Reload button instead of reloading by itself', async ({ page, context, errors }) => {
    // the first visit gets an older sw.js (any changed byte makes another version). The browser's own update
    // checks don't pass through page routes, so the next check finds the real one: a new version to offer
    await context.route('**/sw.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\n// the version before\n` });
    });
    await openSite(page);
    await waitForOfflineApp(page);
    await context.unroute('**/sw.js');
    await expect(page.locator('#updatebox')).toBeHidden();

    await page.evaluate(() => {
        Object.assign(window, { stillTheSamePage: true });
        return navigator.serviceWorker.getRegistration().then((registration) => registration?.update());
    });
    await expect(page.locator('#updatebox')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#updatebox')).toContainText('A new version is ready');
    expect(await page.evaluate(() => 'stillTheSamePage' in window)).toBe(true);

    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('#updatetoast').analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

    await page.click('#updatelater');
    await expect(page.locator('#updatebox')).toBeHidden();
    expect(await page.evaluate(() => 'stillTheSamePage' in window)).toBe(true);

    // a reload of its own doesn't start the new version (the page never closed), so the notice is back
    await page.reload();
    await expect(page.locator('#updatebox')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => Object.assign(window, { stillTheSamePage: true }));
    await Promise.all([page.waitForEvent('load'), page.click('#updatereload')]);
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    expect(await page.evaluate(() => 'stillTheSamePage' in window)).toBe(false);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).toBeNull();
    await expect(page.locator('#updatebox')).toBeHidden();
    expect(errors).toEqual([]);
});

test('the security policy lets the page register only its own service worker', async ({ page }) => {
    await openSite(page);
    await waitForOfflineApp(page);
    const result = await page.evaluate(async () => {
        const outcome = async (attempt: () => unknown) => {
            try {
                await attempt();
                return 'allowed';
            } catch (error) {
                return (error as Error).name;
            }
        };
        const trustedTypes = (window as unknown as { trustedTypes: { createPolicy(name: string, rules: object): unknown } }).trustedTypes;
        return {
            // even the real address is refused as plain text: Trusted Types want it made by the policy
            plainAddress: await outcome(() => navigator.serviceWorker.register('/sw.js')),
            // and the one policy that makes them can't be made a second time, by anyone else
            secondPolicy: await outcome(() => trustedTypes.createPolicy('tierinator-sw', { createScriptURL: (url: string) => url })),
        };
    });
    expect(result).toEqual({ plainAddress: 'TypeError', secondPolicy: 'TypeError' });
});
