// The template gallery: find a template, open it as a list of your own, its pictures from (stand-in) Wikipedia.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pageImagesAnswer, test, WIKIPEDIA_API } from './fixtures';

const templateFile = (id: string): { title: string; tiers?: string[]; items: { name: string; wiki: string }[] } =>
    JSON.parse(readFileSync(new URL(`../../public/templates/${id}.json`, import.meta.url), 'utf8'));
const catalogue: { id: string; title: string; category: string }[] = JSON.parse(
    readFileSync(new URL('../../public/templates/index.json', import.meta.url), 'utf8'),
);

const ownItems = (page: Page) =>
    page.evaluate(() =>
        window.__app.state.state.ownItems.map((item: { id: number; name: string; w?: { t: string } }) => ({
            name: item.name,
            page: item.w?.t,
            picture: window.__app.state.state.picks[item.id]?.text ? 'text tile' : window.__app.state.state.picks[item.id]?.path,
        })),
    );

async function seriousProblems(page: Page): Promise<string[]> {
    const { violations } = await new AxeBuilder({ page }).include('#tplm').withTags(['wcag2a', 'wcag2aa']).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

/** Where focus starts: the search box with a mouse; on a touch screen the close button, so no keyboard pops up. */
const firstFocus = (isMobile: boolean) => (isMobile ? '#tplx' : '#tplq');

test('search, filter, then open a template: a new list with its items and their free Wikipedia pictures', async ({
    page,
    errors,
    isMobile,
}) => {
    const lookups: string[] = [];
    page.on('request', (request) => {
        if (WIKIPEDIA_API.test(request.url())) lookups.push(request.url());
    });
    await openSite(page);
    await page.click('#startgal');
    await expect(page.locator('#tplm')).toBeVisible();
    await expect(page.locator(firstFocus(isMobile))).toBeFocused();
    await expect(page.locator('#tplgrid .tplcard').first()).toContainText('Pokémon'); // the featured pack comes first
    expect(lookups).toEqual([]); // browsing fetches no pictures

    await page.fill('#tplq', 'dog');
    await expect(page.locator('#tplgrid .tplcard b')).toHaveText(['Dog breeds']);
    await expect(page.locator('#tplcount')).toHaveText('1 template');
    await page.fill('#tplq', 'nothing like this');
    await expect(page.locator('#tplgrid .empty')).toBeVisible();
    await page.fill('#tplq', '');
    await page.selectOption('#tplcat', 'Space');
    // every Space template, in catalogue order, and nothing else
    await expect(page.locator('#tplgrid .tplcard b')).toHaveText(
        catalogue.filter((entry) => entry.category === 'Space').map((entry) => entry.title),
    );
    await expect(page.locator('#tplgrid .tplcard b').first()).toHaveText('Planets and dwarf planets');
    await expect(page.locator('#tplgrid .tplcard[data-tpl="planets"]')).toContainText('13 items');

    await page.click('#tplgrid .tplcard[data-tpl="planets"]');
    await expect(page.locator('#tplm')).toBeHidden();
    const planets = templateFile('planets');
    await expect.poll(() => ownItems(page), { timeout: 20_000 }).toHaveLength(planets.items.length);
    await expect(page.locator('#progmod')).toBeHidden();
    const items = await ownItems(page);
    expect(items.map((item: { name: string }) => item.name)).toEqual(planets.items.map((item) => item.name));
    expect(items.map((item: { page: string }) => item.page)).toEqual(planets.items.map((item) => item.wiki));
    for (const item of items) expect(item.picture).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    await expect(page.locator('#pgrid .pi')).toHaveCount(planets.items.length);

    expect(await page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name))).toEqual([planets.title]);
    await expect(page.locator('#start')).toBeHidden();
    // one request for all 13, only freely licensed pictures; then one for all 13 pictures' credits
    const asking = (prop: string) => lookups.filter((lookup) => new URL(lookup).searchParams.get('prop') === prop);
    expect(asking('pageimages')).toHaveLength(1);
    expect(new URL(asking('pageimages')[0]!).searchParams.get('pilicense')).toBe('free');
    expect(new URL(asking('pageimages')[0]!).searchParams.get('titles')?.split('|')).toHaveLength(13);
    expect(asking('imageinfo')).toHaveLength(1);
    expect(new URL(asking('imageinfo')[0]!).searchParams.get('titles')?.split('|')).toHaveLength(13);
    expect(lookups).toHaveLength(2);
    expect(errors).toEqual([]);
});

test('from the list menu: a template’s own tiers, and text tiles where Wikipedia has no free picture', async ({ page, errors }) => {
    await page.route(WIKIPEDIA_API, (route) =>
        route.fulfill({
            json: pageImagesAnswer(route.request().url(), (title) => !title.startsWith('C')),
            headers: { 'access-control-allow-origin': '*' },
        }),
    );
    await openSite(page);
    await page.click('#startempty');
    await page.click('#listbtn');
    await page.click('#ltpl');
    await expect(page.locator('#tplm')).toBeVisible();
    await page.fill('#tplq', 'vegetables');
    await page.click('#tplgrid .tplcard[data-tpl="vegetables"]');

    const vegetables = templateFile('vegetables');
    await expect.poll(() => ownItems(page), { timeout: 20_000 }).toHaveLength(vegetables.items.length);
    await expect(page.locator('#progmod')).toBeHidden();
    const textTiles = (await ownItems(page)).filter((item: { picture: string }) => item.picture === 'text tile');
    expect(textTiles.map((item: { name: string }) => item.name)).toEqual(
        vegetables.items.filter((item) => item.wiki.startsWith('C')).map((item) => item.name),
    );
    expect(await page.evaluate(() => window.__app.state.state.tiers.map((tier: { label: string }) => tier.label))).toEqual(
        vegetables.tiers,
    );
    await expect(page.locator('#toast')).toContainText('no free picture');
    expect(errors).toEqual([]);
});

test('keyboard: Escape closes the gallery and focus goes back; the Pokémon card opens the Pokémon pack', async ({
    page,
    errors,
    isMobile,
}) => {
    await openSite(page);
    await page.focus('#startgal');
    await page.keyboard.press('Enter');
    await expect(page.locator('#tplm')).toBeVisible();
    await expect(page.locator(firstFocus(isMobile))).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tplm')).toBeHidden();
    await expect(page.locator('#startgal')).toBeFocused();
    await expect(page.locator('#start')).toBeVisible(); // nothing chosen, so the start screen stays

    await page.keyboard.press('Enter');
    await expect(page.locator('#tplm')).toBeVisible();
    // Tab stays inside the window: from the search box round to the close button
    await page.focus('#tplq');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#tplx')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#tplgrid .tplcard').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#tplx')).toBeFocused();

    await page.locator('#tplgrid .tplcard[data-pack="pokemon"]').press('Enter');
    await page.waitForFunction(() => window.__app.state.state.kind === 'pokemon' && !!window.__app.data.pokedex.pack, null, {
        timeout: 20_000,
    });
    await expect(page.locator('#tplm')).toBeHidden();
    await expect(page.locator('#start')).toBeHidden();
    expect(errors).toEqual([]);
});

test('the gallery window passes the automatic accessibility checks', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startgal');
    await expect(page.locator('#tplgrid .tplcard').first()).toBeVisible();
    expect(await seriousProblems(page)).toEqual([]);
    expect(errors).toEqual([]);
});
