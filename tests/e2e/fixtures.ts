// tests/e2e/fixtures.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Shared set-up for every end-to-end test:
//    - outside sites are replaced: sprite mirrors serve a local stand-in picture,
//      Google Fonts is blocked (the app falls back to system fonts), and Wikipedia's
//      lead-picture lookups (templates) answer with pictures on a stand-in Commons,
//      its picture-credit lookups with an invented photographer
//    - the welcome pop-up is skipped
//    - `errors` collects uncaught page errors and anything the security policy blocked,
//      so each test can assert there were none
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

export const SPRITE_PNG = readFileSync(new URL('./fixtures/sprite.png', import.meta.url));
export const SPRITE_HOSTS = /^https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\//;
export const WIKIPEDIA_API = /^https:\/\/en\.wikipedia\.org\/w\/api\.php/;
const COMMONS = /^https:\/\/upload\.wikimedia\.org\//;

/**
 * A MediaWiki answer to a lead-picture query (prop=pageimages): every page asked about has a
 * picture on Commons ("<Title>.png"), except those `hasPicture` turns down. Titles with "_" come back normalised.
 */
export function pageImagesAnswer(address: string, hasPicture: (title: string) => boolean = () => true): unknown {
    const titles = (new URL(address).searchParams.get('titles') || '').split('|').filter(Boolean);
    const normalized = titles.filter((title) => title.includes('_')).map((title) => ({ from: title, to: title.replace(/_/g, ' ') }));
    const pages = Object.fromEntries(
        titles.map((asked, index) => {
            const title = asked.replace(/_/g, ' ');
            const file = encodeURIComponent(title.replace(/ /g, '_'));
            const picture = { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/${file}.png/256px-${file}.png` };
            const lead = { thumbnail: picture, pageimage: `${title.replace(/ /g, '_')}.png` };
            return [String(index + 1), { pageid: index + 1, ns: 0, title, ...(hasPicture(title) ? lead : {}) }];
        }),
    );
    return { batchcomplete: '', query: { normalized, pages } };
}

/** The author every stand-in picture is credited to, as Commons writes authors: HTML. */
export const STAND_IN_AUTHOR =
    '<bdi><a href="//commons.wikimedia.org/wiki/User:Example" title="User:Example">Example&nbsp;<b>Photographer</b></a></bdi>';

/**
 * A MediaWiki answer to a picture-credit query (prop=imageinfo, extmetadata), shaped like the real
 * one for Commons files: negative page ids, "missing" but "known". Files `isDescribed` turns down
 * come back with no details at all.
 */
export function creditsAnswer(address: string, isDescribed: (file: string) => boolean = () => true): unknown {
    const titles = (new URL(address).searchParams.get('titles') || '').split('|').filter(Boolean);
    const pages = Object.fromEntries(
        titles.map((title, index) => {
            const details = {
                Artist: { value: STAND_IN_AUTHOR, source: 'commons-desc-page' },
                LicenseShortName: { value: 'CC BY-SA 4.0', source: 'commons-desc-page' },
                AttributionRequired: { value: 'true', source: 'commons-desc-page' },
            };
            const described = isDescribed(title.replace(/^File:/, ''));
            return [
                String(-(index + 1)),
                { ns: 6, title, missing: '', known: '', imagerepository: 'shared', imageinfo: [{ extmetadata: described ? details : {} }] },
            ];
        }),
    );
    return { batchcomplete: '', query: { pages } };
}

/** Wikipedia's API stand-in: picture credits for imageinfo questions, lead pictures for the rest. */
export const wikipediaAnswer = (address: string): unknown =>
    new URL(address).searchParams.get('prop') === 'imageinfo' ? creditsAnswer(address) : pageImagesAnswer(address);

declare global {
    interface Window {
        /** The app's modules, exposed by src/testing.ts in test builds. Tests reach into them freely. */
        // biome-ignore lint/suspicious/noExplicitAny: test-only handle to every module; typing it would just repeat the app
        __app: any;
    }
}

export const test = base.extend<{ errors: string[] }>({
    context: async ({ context }, use) => {
        await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
        await context.route(SPRITE_HOSTS, (route) =>
            route.fulfill({
                body: SPRITE_PNG,
                contentType: 'image/png',
                headers: { 'access-control-allow-origin': '*' },
            }),
        );
        await context.route(WIKIPEDIA_API, (route) =>
            route.fulfill({ json: wikipediaAnswer(route.request().url()), headers: { 'access-control-allow-origin': '*' } }),
        );
        await context.route(COMMONS, (route) =>
            route.fulfill({ body: SPRITE_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }),
        );
        await context.addInitScript(() => {
            try {
                localStorage.setItem('pt_tips', '1');
            } catch {}
        });
        await use(context);
    },
    errors: async ({ page }, use) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        // anything the security policy blocked (the preview server sends the site's real headers)
        page.on('console', (message) => {
            if (message.type() === 'error' && /Content Security Policy|Trusted Type|TrustedHTML|TrustedScript/i.test(message.text()))
                errors.push(message.text());
        });
        await use(errors);
    },
});
export { expect };

/** Opens the (empty) site and waits until its starting list is ready. */
export async function openSite(page: Page): Promise<void> {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
}

/** Opens the site and makes a Pokémon list, as List menu → New Pokémon list does. */
export async function openPokemonList(page: Page): Promise<void> {
    await openSite(page);
    await page.evaluate(() => window.__app.lists.createList('pokemon', 'My Pokémon tier list'));
    await page.waitForFunction(() => !!window.__app.data.pokedex.pack && window.__app.state.state.kind === 'pokemon', null, {
        timeout: 20_000,
    });
}

/** Puts these items into the tiers, spread round-robin from the top tier. */
export async function rankItems(page: Page, ids: number[]): Promise<void> {
    await page.evaluate((ids) => {
        const { state } = window.__app.state;
        state.tiers.forEach((tier: { items: number[] }) => {
            tier.items = [];
        });
        ids.forEach((id, i) => {
            state.tiers[i % state.tiers.length].items.push(id);
        });
        window.__app.board.placeAllTiles();
        window.__app.persist.saveNow();
    }, ids);
}
