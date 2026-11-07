// The File menu: saving and loading lists, backups, sprite packs, and files built to cause trouble.

import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { expect, openPokemonList, openSite, rankItems, SPRITE_HOSTS, SPRITE_PNG, test } from './fixtures';

const tierItems = (page: Page) => page.evaluate(() => window.__app.state.state.tiers.map((tier: { items: number[] }) => tier.items));
const listNames = (page: Page) => page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name));
const contents = async (download: Download) => readFileSync((await download.path())!);

async function fromFileMenu(page: Page, button: string): Promise<Download> {
    const download = page.waitForEvent('download');
    await page.click('#filebtn');
    await page.click(button);
    return download;
}

async function loadFile(page: Page, name: string, buffer: Buffer, mimeType = 'application/json'): Promise<void> {
    await page.setInputFiles('#loadinp', { name, mimeType, buffer });
}

test('a saved list loads back exactly', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [1, 4, 7, 25, 150]);
    const before = await tierItems(page);
    const saved = await contents(await fromFileMenu(page, '#savebtn'));

    await page.evaluate(() => window.__app.lists.createList('pokemon', 'Another list'));
    await expect.poll(() => tierItems(page)).not.toEqual(before);
    await loadFile(page, 'my-list.json', saved); // goes into the new, untouched list
    await expect.poll(() => tierItems(page)).toEqual(before);
    expect(await listNames(page)).toHaveLength(2);
    expect(errors).toEqual([]);
});

test('backup and restore every list', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [25, 133]);
    const backup = await contents(await fromFileMenu(page, '#backupbtn'));
    const before = await listNames(page);

    await loadFile(page, 'backup.json', backup);
    await page.click('#cok'); // Restore
    await expect.poll(() => listNames(page)).toHaveLength(before.length * 2);
    expect(await tierItems(page)).toEqual(expect.arrayContaining([expect.arrayContaining([25])]));
    expect(errors).toEqual([]);
});

test('a backup restored on a fresh visit replaces the empty starting list, Pokémon data included', async ({
    page,
    browser,
    errors,
}, testInfo) => {
    await openPokemonList(page);
    await rankItems(page, [25, 133]);
    const backup = await contents(await fromFileMenu(page, '#backupbtn'));

    // a different browser: nothing stored, nothing installed
    const { baseURL, viewport } = testInfo.project.use;
    const freshBrowser = await browser.newContext({ baseURL, viewport });
    await freshBrowser.route(SPRITE_HOSTS, (route) => route.fulfill({ body: SPRITE_PNG, contentType: 'image/png' }));
    await freshBrowser.addInitScript(() => localStorage.setItem('pt_tips', '1'));
    const fresh = await freshBrowser.newPage();
    await openSite(fresh);
    expect(await listNames(fresh)).toEqual(['My tier list']);
    await loadFile(fresh, 'backup.json', backup);
    await fresh.click('#cok'); // Restore
    await expect.poll(() => listNames(fresh)).toEqual(['My Pokémon tier list']);
    await expect.poll(() => tierItems(fresh)).toEqual(expect.arrayContaining([expect.arrayContaining([25])]));
    await expect(fresh.locator('#needpack')).toBeHidden();
    await freshBrowser.close();
    expect(errors).toEqual([]);
});

test('a sprite pack carries picks to another list', async ({ page, errors }) => {
    await openPokemonList(page);
    await page.evaluate(() => window.__app.sprites.pickSprite(6, 'other/official-artwork/6.png', { quiet: true }));
    // the sprite pack buttons live in the studio's ⋯ menu
    await page.click('#tab-studio');
    await page.click('#stmore');
    const download = page.waitForEvent('download');
    await page.click('#packexp');
    const pack = await contents(await download);

    await page.evaluate(() => window.__app.lists.createList('pokemon', 'Fresh list'));
    await page.waitForFunction(() => !window.__app.state.state.picks[6]);
    await page.setInputFiles('#packinp', { name: 'sprites.zip', mimeType: 'application/zip', buffer: pack });
    await expect.poll(() => page.evaluate(() => window.__app.state.state.picks[6]?.path)).toBe('other/official-artwork/6.png');
    expect(errors).toEqual([]);
});

test('a booby-trapped backup restores safely: no outside requests, no SVG kept', async ({ page, errors }) => {
    const outside: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('evil.example')) outside.push(request.url());
    });
    await openPokemonList(page);
    const svg =
        'data:image/svg+xml;base64,' +
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>').toString('base64');
    const png = 'data:image/png;base64,' + SPRITE_PNG.toString('base64');
    const backup = {
        app: 'tierlist',
        type: 'backup',
        created: '2026-01-01',
        lists: [
            {
                meta: { name: '<img src=x onerror=alert(1)>', kind: 'custom', pack: 42 },
                snap: { kind: 'custom', tiers: [], picks: {} },
                imgs: { '2000000': 'https://evil.example/tracker.png', '2000001': svg, '2000002': png },
            },
        ],
        gallery: [{ k: '25:x', id: 25, name: 'trap', data: 'https://evil.example/g.png' }],
        settings: { pt_palette: '["#ff0000"]', pt_evil: 'nope' },
    };
    await loadFile(page, 'backup.json', Buffer.from(JSON.stringify(backup)));
    await page.click('#cok');
    await expect.poll(() => listNames(page)).toContain('<img src=x onerror=alert(1)>');

    // the restore finishes by opening the restored list; then its pictures are all stored
    await expect.poll(() => page.evaluate(() => window.__app.state.currentListMeta()?.name)).toBe('<img src=x onerror=alert(1)>');
    const stored = await page.evaluate(async () => {
        const { readByPrefix } = window.__app.storage;
        const id = window.__app.state.session.listId;
        const rows = await readByPrefix(id + ':');
        return rows.map(([key, blob]: [string, Blob]) => [String(key).split(':')[1], blob.type]);
    });
    expect(stored).toEqual([
        ['2000001', 'image/png'], // the SVG, redrawn as a PNG
        ['2000002', 'image/png'],
    ]);
    expect(outside).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('pt_evil'))).toBeNull();
    expect(await page.locator('#listrows img').count()).toBe(0); // the name is text, not markup
    expect(errors).toEqual([]);
});
