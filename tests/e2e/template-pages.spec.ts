// The static template pages (/t/, /t/<id>/) and template links (/?template=<id>) into the app.
import { readdirSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

const templateFile = (id: string): { title: string; items: { name: string }[] } =>
    JSON.parse(readFileSync(new URL(`../../public/templates/${id}.json`, import.meta.url), 'utf8'));
const templateIds = readdirSync(new URL('../../public/templates/', import.meta.url))
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .map((name) => name.slice(0, -'.json'.length));

const listNames = (page: Page) => page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name));
const ownItemNames = (page: Page) =>
    page.evaluate(() => window.__app.state.state.ownItems.map((item: { name: string }) => item.name) as string[]);

async function seriousProblems(page: Page): Promise<string[]> {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test('a template page: its items as text, nothing from other sites, then "Rank these" makes a list of them', async ({
    page,
    errors,
    baseURL,
}) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/t/planets/');
    const planets = templateFile('planets');
    await expect(page).toHaveTitle('Planets and dwarf planets tier list on Tierinator');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Planets and dwarf planets tier list');
    await expect(page.locator('.items li')).toHaveText(planets.items.map((item) => item.name));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://tierinator.sayel.dev/t/planets/');
    await expect(page.locator('script')).toHaveCount(0);
    // its stylesheet and fonts load under the site's security policy, and nothing comes from anywhere else
    expect(
        await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((font) => font.status === 'loaded').length)),
    ).toBe(2);
    expect(requests.filter((address) => !address.startsWith(baseURL!))).toEqual([]);

    await page.getByRole('link', { name: 'Rank these' }).click();
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    await expect.poll(() => ownItemNames(page), { timeout: 20_000 }).toEqual(planets.items.map((item) => item.name));
    await expect(page.locator('#progmod')).toBeHidden();
    expect(await listNames(page)).toEqual([planets.title]);
    await expect(page.locator('#start')).toBeHidden();
    await expect(page.locator('#pgrid .pi')).toHaveCount(planets.items.length);
    // the link has done its job: a reload opens the list, not a second copy
    expect(new URL(page.url()).search).toBe('');
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    expect(await listNames(page)).toEqual([planets.title]);
    expect(errors).toEqual([]);
});

test('the index of templates: every template by category, the Pokémon pack, and the suggest link', async ({ page, errors }) => {
    await page.goto('/t');
    await expect(page).toHaveURL(/\/t\/$/); // as Cloudflare does, the address gets its last slash
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tier list templates');
    for (const id of templateIds) await expect(page.locator(`.cards a[href="/t/${id}/"]`)).toHaveCount(1);
    await expect(page.locator('.cards a[href="/?template=pokemon"]')).toContainText('Pokémon');
    await expect(page.getByRole('link', { name: 'Suggest a template' })).toHaveAttribute(
        'href',
        'https://github.com/blaziikun/tierinator/issues/new?template=template.yml',
    );
    await page.locator('.cards a[href="/t/dog-breeds/"]').click();
    await expect(page).toHaveURL(/\/t\/dog-breeds\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dog breeds tier list');
    await page.getByRole('link', { name: '← All templates' }).click();
    await expect(page).toHaveURL(/\/t\/$/);
    expect(errors).toEqual([]);
});

test('a template link to the Pokémon pack opens a Pokémon list', async ({ page, errors }) => {
    await page.goto('/?template=pokemon');
    await page.waitForFunction(() => window.__app?.state.state.kind === 'pokemon' && !!window.__app.data.pokedex.pack, null, {
        timeout: 20_000,
    });
    await expect(page.locator('#start')).toBeHidden();
    expect(errors).toEqual([]);
});

test('a broken or unknown template link: the normal start, and a toast saying why', async ({ page, errors }) => {
    await page.goto('/?template=..%2Fprivacy');
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    await expect(page.locator('#toast')).toContainText('That template link is broken');
    await expect(page.locator('#start')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');

    await page.goto('/?template=no-such-template');
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    await expect(page.locator('#toast')).toContainText("doesn't match any template");
    await expect(page.locator('#start')).toBeVisible();
    expect(await listNames(page)).toHaveLength(1);
    expect(await ownItemNames(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test('the gallery links to the suggestion form', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startgal');
    const suggest = page.locator('#tplm').getByRole('link', { name: 'Suggest a template' });
    await expect(suggest).toBeVisible();
    await expect(suggest).toHaveAttribute('href', 'https://github.com/blaziikun/tierinator/issues/new?template=template.yml');
    await expect(suggest).toHaveAttribute('target', '_blank');
    // reachable from the keyboard, between the filters and the cards
    await page.focus('#tplcat');
    await page.keyboard.press('Tab');
    await expect(suggest).toBeFocused();
    expect(errors).toEqual([]);
});

test('a template page and the index pass the automatic accessibility checks', async ({ page, errors }) => {
    await page.goto('/t/dog-breeds/');
    expect(await seriousProblems(page)).toEqual([]);
    await page.goto('/t/');
    expect(await seriousProblems(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test('the template pages and the privacy page link back to the app', async ({ page, errors }) => {
    for (const [address, name] of [
        ['/t/', '← Tierinator'],
        ['/t/dog-breeds/', 'Tierinator'],
        ['/privacy.html', '← Back to Tierinator'],
    ] as const) {
        await page.goto(address);
        await expect(page.getByRole('link', { name, exact: true }).first()).toHaveAttribute('href', '/');
    }
    await page.getByRole('link', { name: '← Back to Tierinator' }).click();
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    await expect(page.locator('#start')).toBeVisible();
    expect(errors).toEqual([]);
});
