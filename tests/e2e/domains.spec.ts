// The move to tierinator.com: the same built site served at both addresses, each its own origin with its own browser
// storage (as on Cloudflare). Requests to either address go to the local preview server, so the pages, headers and
// security policy are the real ones. Links made on a page use that page's address; the canonical links always say
// tierinator.com; and a backup made on the old address brings everything across to the new one.
import { readFileSync } from 'node:fs';
import type { BrowserContext, Download, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const NEW = 'https://tierinator.com';
const OLD = 'https://tierinator.sayel.dev';

/** Both addresses answered by the local preview server (which sends the site's real headers). */
async function serveBothAddresses(context: BrowserContext, local: string): Promise<void> {
    for (const origin of [NEW, OLD])
        await context.route(`${origin}/**`, async (route) => {
            const address = new URL(route.request().url());
            const response = await route.fetch({ url: local + address.pathname + address.search, maxRedirects: 0 });
            await route.fulfill({ response });
        });
}

async function openAt(page: Page, origin: string): Promise<void> {
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
}

const listNames = (page: Page) => page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name));

test.beforeEach(async ({ context }, testInfo) => {
    await serveBothAddresses(context, String(testInfo.project.use.baseURL));
});

for (const origin of [NEW, OLD])
    test(`${origin.slice(8)} serves the site; its share links use its own address, its canonical links tierinator.com`, async ({
        page,
        errors,
    }) => {
        await openAt(page, origin);
        expect(await page.evaluate(() => location.origin)).toBe(origin);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${NEW}/`);
        await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${NEW}/`);
        await expect(page.locator('#expcreditline')).toHaveText('Made with tierinator.com');
        await page.evaluate(() => window.__app.ownItems.addItem({ name: 'Lighthouse' }));
        const { link } = await page.evaluate(() => window.__app.share.makeShareLink());
        expect(link.startsWith(`${origin}/#l=`)).toBe(true);
        // the files a crawler reads name the one real address
        const robots = await page.evaluate(() => fetch('/robots.txt').then((response) => response.text()));
        expect(robots).toContain(`Sitemap: ${NEW}/sitemap.xml`);
        const sitemap = await page.evaluate(() => fetch('/sitemap.xml').then((response) => response.text()));
        expect(sitemap).toContain(`<loc>${NEW}/</loc>`);
        expect(sitemap).not.toContain('sayel.dev');
        expect(errors).toEqual([]);
    });

test('a backup made on the old address brings everything to the new one: lists, pictures, Studio, packs, themes, settings', async ({
    page,
    context,
    errors,
}) => {
    // ── on the old address: a list with an uploaded picture, a gallery picture, a pack of your own, saved settings
    await openAt(page, OLD);
    await page.evaluate(() => {
        localStorage.setItem('pt_themes', JSON.stringify([{ id: 'th-sea', name: 'Sea', t: { bg: '#0b1d2a' } }]));
        localStorage.setItem(
            'pt_tiers',
            JSON.stringify([
                ['Great', '#ff7f7f'],
                ['Fine', '#ffdf7f'],
                ['Meh', '#7fbfff'],
            ]),
        );
        localStorage.setItem('pt_view', JSON.stringify({ pool: true, bar: false }));
        localStorage.setItem('pt_stream', JSON.stringify({ hideNames: true }));
    });
    await openAt(page, OLD); // read at start-up, as they would be after you'd chosen them
    const madeOld = await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(32, 32);
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#3e63dd';
        g.fillRect(0, 0, 32, 32);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const app = window.__app;
        const id = await app.ownItems.addItem({ name: 'Robin', blob });
        await app.gallery.addGalleryImage(id, blob, 'robin.png');
        await app.packs.installPack({ type: 'tierpack', format: 2, id: 'coast-birds', name: 'Coast birds', items: [['Gannet', [], []]] });
        app.state.currentListMeta().name = 'Birds of the coast';
        app.state.saveListIndex();
        app.persist.saveNow();
        return { id, gallery: app.gallery.gallery.size };
    });
    expect(madeOld.gallery).toBe(1);
    const download: Promise<Download> = page.waitForEvent('download');
    await page.click('#filebtn');
    await page.click('#backupbtn');
    const backup = readFileSync((await (await download).path())!);

    // ── the new address, in the same browser: its own storage, so none of that is there
    const fresh = await context.newPage();
    await openAt(fresh, NEW);
    expect(await listNames(fresh)).toEqual(['My tier list']);
    expect(await fresh.evaluate(() => localStorage.getItem('pt_themes'))).toBeNull();

    await fresh.setInputFiles('#loadinp', { name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await fresh.click('#cok'); // Restore: the page reloads with everything in use
    await fresh.waitForFunction(
        () => window.__app?.state.session.lists.some((list: { name: string }) => list.name === 'Birds of the coast'),
        null,
        {
            timeout: 20_000,
        },
    );
    await expect(fresh.locator('#toast')).toContainText('Restored 1 list');
    expect(await listNames(fresh)).toEqual(['Birds of the coast']);
    const moved = await fresh.evaluate((id) => {
        const app = window.__app;
        return {
            open: app.state.currentListMeta().name,
            picture: app.state.spriteBlobs.get(id)?.type ?? null,
            gallery: app.gallery.gallery.size,
            pack: app.packs.genericPacks.get('coast-birds')?.name ?? null,
            themes: localStorage.getItem('pt_themes'),
            tiers: localStorage.getItem('pt_tiers'),
            view: localStorage.getItem('pt_view'),
            stream: localStorage.getItem('pt_stream'),
        };
    }, madeOld.id);
    expect(moved).toEqual({
        open: 'Birds of the coast',
        picture: 'image/png',
        gallery: 1,
        pack: 'Coast birds',
        themes: JSON.stringify([{ id: 'th-sea', name: 'Sea', t: { bg: '#0b1d2a' } }]),
        tiers: JSON.stringify([
            ['Great', '#ff7f7f'],
            ['Fine', '#ffdf7f'],
            ['Meh', '#7fbfff'],
        ]),
        view: JSON.stringify({ pool: true, bar: false }),
        stream: JSON.stringify({ hideNames: true }),
    });
    // and the old address still has its own copy
    expect(await listNames(page)).toEqual(['Birds of the coast']);
    expect(errors).toEqual([]);
});

test('restoring a backup where you already saved themes adds its themes to yours', async ({ page, errors }) => {
    await openAt(page, NEW);
    await page.evaluate(() => localStorage.setItem('pt_themes', JSON.stringify([{ id: 'th-mine', name: 'Mine', t: {} }])));
    const backup = {
        app: 'tierlist',
        type: 'backup',
        v: 1,
        created: '2026-11-22T10:00:00.000Z',
        lists: [{ meta: { name: 'Moved', kind: 'custom' }, snap: { v: 10, tiers: [] }, imgs: {} }],
        settings: {
            pt_themes: JSON.stringify([
                { id: 'th-sea', name: 'Sea', t: {} },
                { id: 'th-mine', name: 'Old mine', t: {} },
            ]),
        },
    };
    await page.setInputFiles('#loadinp', {
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.click('#cok');
    await page.waitForFunction(() => window.__app?.state.session.lists.some((list: { name: string }) => list.name === 'Moved'), null, {
        timeout: 20_000,
    });
    const themes = JSON.parse((await page.evaluate(() => localStorage.getItem('pt_themes')))!);
    expect(themes.map((theme: { id: string; name: string }) => `${theme.id} ${theme.name}`)).toEqual(['th-mine Mine', 'th-sea Sea']);
    expect(errors).toEqual([]);
});
