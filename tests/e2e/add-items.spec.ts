// Add items: typed names, web search (sites mocked), and picture links.

import type { Page } from '@playwright/test';
import { expect, openPokemonList, SPRITE_PNG, test } from './fixtures';

const PICTURE_HOST = 'https://pictures.example/';
const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
});

async function emptyCustomList(page: Page): Promise<void> {
    await page.route(PICTURE_HOST + '**', (route) =>
        route.fulfill({ body: SPRITE_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }),
    );
    await openPokemonList(page);
    await page.evaluate(() => window.__app.lists.createList('custom', 'Test list'));
    await page.waitForFunction(() => window.__app.state.state.kind === 'custom');
    await page.click('#addbtn');
}

const ownItems = (page: Page) =>
    page.evaluate(() =>
        window.__app.state.state.ownItems.map((item: { id: number; name: string }) => ({
            name: item.name,
            text: !!window.__app.state.state.picks[item.id]?.text,
        })),
    );

test('typed names become text tiles', async ({ page, errors }) => {
    await emptyCustomList(page);
    await page.click('#addtabs [data-t="txt"]');
    await page.fill('#addtxt', 'Spirited Away\nAkira\n\n');
    await page.click('#addtxtgo');
    await expect
        .poll(() => ownItems(page))
        .toEqual([
            { name: 'Spirited Away', text: true },
            { name: 'Akira', text: true },
        ]);
    expect(errors).toEqual([]);
});

test('Wikipedia search: pick results to add them with their pictures', async ({ page, errors }) => {
    await page.route(/en\.wikipedia\.org\/w\/api\.php/, (route) =>
        route.fulfill(
            json({
                query: {
                    pages: {
                        11: { title: 'Totoro', index: 2, description: 'film', thumbnail: { source: PICTURE_HOST + 'totoro.png' } },
                        12: { title: 'Akira', index: 1, thumbnail: { source: PICTURE_HOST + 'akira.png' } },
                        13: { title: 'No picture', index: 3 },
                        14: { title: 'Sneaky', index: 4, thumbnail: { source: 'javascript:alert(1)' } },
                    },
                },
            }),
        ),
    );
    await emptyCustomList(page);
    await page.click('#addtabs [data-t="web"]');
    await page.selectOption('#websrc', 'wiki');
    await page.fill('#webq', 'ghibli');
    await page.press('#webq', 'Enter');
    await expect(page.locator('#webres .vc')).toHaveCount(2); // in Wikipedia's order, only https pictures
    await expect(page.locator('#webres .vc b')).toHaveText(['Akira', 'Totoro']);
    await page.click('#weball');
    await page.click('#webadd');
    await expect
        .poll(() => ownItems(page))
        .toEqual([
            { name: 'Akira', text: false },
            { name: 'Totoro', text: false },
        ]);
    expect(errors).toEqual([]);
});

test('character search merges the same character from two sites, and says which site failed', async ({ page, errors }) => {
    await page.route('https://graphql.anilist.co/**', (route) =>
        route.fulfill(
            json({
                data: {
                    Page: {
                        characters: [
                            {
                                id: 417,
                                name: { full: 'Lelouch Lamperouge', native: 'ルルーシュ・ランペルージ', alternative: ['Zero'] },
                                image: { large: PICTURE_HOST + 'anilist-lelouch.png' },
                                favourites: 50000,
                                media: { nodes: [{ idMal: 1575, type: 'ANIME', title: { english: 'Code Geass', romaji: 'Code Geass' } }] },
                            },
                        ],
                    },
                },
            }),
        ),
    );
    await page.route('https://api.jikan.moe/**', (route) =>
        route.fulfill(
            json({
                data: [
                    {
                        mal_id: 417,
                        name: 'Lamperouge, Lelouch',
                        name_kanji: 'ルルーシュ・ランペルージ',
                        favorites: 160000,
                        images: { jpg: { image_url: PICTURE_HOST + 'mal-lelouch.png' } },
                    },
                    {
                        mal_id: 9999,
                        name: 'Lelouch Fan',
                        favorites: 3,
                        images: { jpg: { image_url: PICTURE_HOST + 'questionmark_23.gif' } },
                    },
                ],
            }),
        ),
    );
    await page.route(/kitsu\.(app|io)/, (route) => route.fulfill({ status: 500, body: 'down' }));
    await emptyCustomList(page);
    await page.click('#addtabs [data-t="web"]');
    await page.selectOption('#websrc', 'chars');
    await page.fill('#webq', 'lelouch');
    await page.press('#webq', 'Enter');
    await expect(page.locator('#webres .webnote')).toContainText("Couldn't reach Kitsu");
    await expect(page.locator('#webres .vc')).toHaveCount(1); // merged; the placeholder-picture one is left out
    await expect(page.locator('#webres .vc .srcb')).toHaveText('AniList, MAL (2 pictures)');
    expect(errors).toEqual([]);
});

test('picture links: only https addresses are fetched', async ({ page, errors }) => {
    const fetched: string[] = [];
    page.on('request', (request) => {
        if (!request.url().startsWith('http://localhost') && !request.url().startsWith('http://127.0.0.1')) fetched.push(request.url());
    });
    await emptyCustomList(page);
    await page.click('#addtabs [data-t="url"]');
    await page.fill(
        '#addurl',
        `Good one | ${PICTURE_HOST}good.png\nBad one | javascript:alert(1)\n${PICTURE_HOST}files/named%20by%20file.png`,
    );
    await page.click('#addurlgo');
    await expect
        .poll(() => ownItems(page))
        .toEqual([
            { name: 'Good one', text: false },
            { name: 'Bad one', text: true },
            { name: 'named by file', text: false },
        ]);
    expect(fetched.filter((url) => url.startsWith('javascript'))).toEqual([]);
    expect(errors).toEqual([]);
});
