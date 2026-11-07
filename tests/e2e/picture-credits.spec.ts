// Picture credits: a template's Wikipedia pictures credited in the item editor and the Picture credits window,
// kept through saving, undo and share links, and still linked when the credit lookup fails. Also the wiki import.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { creditsAnswer, expect, openSite, pageImagesAnswer, test, WIKIPEDIA_API } from './fixtures';

const MERCURY_PAGE = 'https://commons.wikimedia.org/wiki/File:Mercury_(planet).png';

/** Opens the planets template from the start screen and waits until all 13 items are in. */
async function openPlanets(page: Page): Promise<void> {
    await openSite(page);
    await page.click('#startgal');
    await page.click('#tplgrid .tplcard[data-tpl="planets"]');
    await expect.poll(() => page.evaluate(() => window.__app.state.state.ownItems.length), { timeout: 20_000 }).toBe(13);
    await expect(page.locator('#progmod')).toBeHidden();
}

const idOf = (page: Page, name: string): Promise<number> =>
    page.evaluate((name) => window.__app.state.state.ownItems.find((item: { name: string }) => item.name === name).id, name);

const creditOf = (page: Page, name: string): Promise<unknown> =>
    page.evaluate((name) => window.__app.state.state.ownItems.find((item: { name: string }) => item.name === name).credit, name);

async function openEditor(page: Page, name: string): Promise<void> {
    await page.click(`#pgrid .pi[data-id="${await idOf(page, name)}"]`, { button: 'right' });
    await expect(page.locator('#ied')).toHaveClass(/show/);
}

async function openCreditsWindow(page: Page): Promise<void> {
    await page.click('#filebtn');
    await page.click('#aboutbtn');
    await expect(page.locator('#aboutm')).toBeVisible();
    await page.click('#aboutcredits');
    await expect(page.locator('#pcm')).toBeVisible();
}

async function seriousProblems(page: Page): Promise<string[]> {
    const { violations } = await new AxeBuilder({ page }).include('#pcm').withTags(['wcag2a', 'wcag2aa']).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test('a template’s pictures are credited in the item editor and the Picture credits window', async ({ page, errors }) => {
    await openPlanets(page);
    expect(await creditOf(page, 'Mercury')).toEqual({ file: 'Mercury (planet).png', by: 'Example Photographer', licence: 'CC BY-SA 4.0' });

    await openEditor(page, 'Mercury');
    await expect(page.locator('#iedcredit')).toHaveText('Picture: Example Photographer, CC BY-SA 4.0');
    const link = page.locator('#iedcredit a');
    await expect(link).toHaveAttribute('href', MERCURY_PAGE);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await page.click('#ieddone');

    await openCreditsWindow(page);
    await expect(page.locator('#pcx')).toBeFocused();
    const rows = page.locator('#pclist li');
    await expect(rows).toHaveCount(13);
    await expect(rows.first()).toContainText('Mercury');
    await expect(rows.first()).toContainText('Example Photographer, CC BY-SA 4.0');
    await expect(rows.first().locator('a')).toHaveText('Mercury (planet).png');
    await expect(rows.first().locator('a')).toHaveAttribute('href', MERCURY_PAGE);
    expect(await seriousProblems(page)).toEqual([]);

    // Tab stays inside the window; Escape closes only it, and focus goes back to the About window
    await page.keyboard.press('Shift+Tab');
    await expect(rows.last().locator('a')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#pcx')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pcm')).toBeHidden();
    await expect(page.locator('#aboutm')).toBeVisible();
    await expect(page.locator('#aboutcredits')).toBeFocused();
    expect(errors).toEqual([]);
});

test('credits survive undo, reloading and a share link; a new picture has no credit', async ({ page, errors }) => {
    await openPlanets(page);
    const mercury = await idOf(page, 'Mercury');
    await page.evaluate((id) => {
        window.__app.history.pushHistory();
        window.__app.state.state.tiers[0].items.push(id);
        window.__app.board.placeAllTiles();
    }, mercury);
    await page.evaluate(() => window.__app.history.undo(false));
    expect(await creditOf(page, 'Mercury')).toMatchObject({ by: 'Example Photographer' });

    await page.evaluate(() => window.__app.persist.saveNow());
    await page.reload();
    await page.waitForFunction(() => window.__app?.state.state.ownItems.length === 13, null, { timeout: 20_000 });
    expect(await creditOf(page, 'Mercury')).toMatchObject({ by: 'Example Photographer', licence: 'CC BY-SA 4.0' });

    const { link } = await page.evaluate(() => window.__app.share.makeShareLink());
    expect(link).toBeTruthy();
    await page.goto(link);
    await page.waitForFunction(
        () => window.__app?.state.currentListMeta()?.preview && window.__app.state.state.ownItems.length === 13,
        null,
        {
            timeout: 20_000,
        },
    );
    expect(await creditOf(page, 'Mercury')).toEqual({ file: 'Mercury (planet).png', by: 'Example Photographer', licence: 'CC BY-SA 4.0' });

    // a text tile isn't the credited picture: the line goes
    await openEditor(page, 'Venus');
    await expect(page.locator('#iedcredit a')).toHaveCount(1);
    await page.click('#iedtile');
    await expect(page.locator('#iedcredit')).toBeEmpty();
    expect(errors).toEqual([]);
});

test('when the credits can’t be fetched, the pictures stay and link to their page', async ({ page, errors }) => {
    await page.route(WIKIPEDIA_API, (route) =>
        new URL(route.request().url()).searchParams.get('prop') === 'imageinfo'
            ? route.abort()
            : route.fulfill({ json: pageImagesAnswer(route.request().url()), headers: { 'access-control-allow-origin': '*' } }),
    );
    await openPlanets(page);
    expect(await page.evaluate(() => window.__app.state.state.picks[window.__app.state.state.ownItems[0].id].path)).toMatch(
        /^https:\/\/upload\.wikimedia\.org\//,
    );
    expect(await creditOf(page, 'Mercury')).toEqual({ file: 'Mercury (planet).png' });
    await openEditor(page, 'Mercury');
    await expect(page.locator('#iedcredit')).toHaveText('Picture from Wikimedia Commons');
    await expect(page.locator('#iedcredit a')).toHaveAttribute('href', MERCURY_PAGE);
    expect(errors).toEqual([]);
});

test('a list with no Wikimedia pictures says so in the Picture credits window', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await openCreditsWindow(page);
    await expect(page.locator('#pclist .empty')).toContainText('nobody to credit');
    expect(await seriousProblems(page)).toEqual([]);
    await page.click('#pcx');
    await expect(page.locator('#pcm')).toBeHidden();
    expect(errors).toEqual([]);
});

test('the Picture credits window with credits in it passes the automatic checks too', async ({ page, errors }) => {
    await openPlanets(page);
    await openCreditsWindow(page);
    await expect(page.locator('#pclist li')).toHaveCount(13);
    expect(await seriousProblems(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test('importing a Wikipedia category credits its pictures the same way', async ({ page, errors }) => {
    const planets = ['Ceres (dwarf planet)', 'Eris (dwarf planet)'];
    await page.route(/^https:\/\/en\.wikipedia\.org\//, (route) => {
        const url = new URL(route.request().url());
        const asked = Object.fromEntries(url.searchParams);
        const json = (body: unknown) => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
        if (url.pathname !== '/w/api.php') return route.fulfill({ status: 404, body: '' });
        if (asked.meta === 'siteinfo')
            return json({
                query: {
                    general: { sitename: 'Wikipedia', server: '//en.wikipedia.org', articlepath: '/wiki/$1' },
                    namespaces: { 6: { name: 'File', canonical: 'File' }, 14: { name: 'Category', canonical: 'Category' } },
                    namespacealiases: [],
                },
            });
        if (asked.list === 'categorymembers') return json({ query: { categorymembers: planets.map((title) => ({ ns: 0, title })) } });
        if (asked.prop === 'pageimages') {
            // the wiki engine asks for answers in MediaWiki's newer shape: pages as a list
            const answer = pageImagesAnswer(url.href) as { query: { pages: Record<string, unknown> } };
            return json({ query: { ...answer.query, pages: Object.values(answer.query.pages) } });
        }
        if (asked.prop === 'imageinfo') return json(creditsAnswer(url.href, (file) => !file.startsWith('Eris')));
        return json({});
    });
    await openSite(page);
    await page.click('#startempty');
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="wiki"]');
    await page.fill('#wkurl', 'https://en.wikipedia.org/wiki/Category:Dwarf_planets');
    await page.click('#wkgo');
    await expect(page.locator('#wkres .vc.chosen')).toHaveCount(2);
    await page.click('#wkadd');
    await expect.poll(() => page.evaluate(() => window.__app.state.state.ownItems.length), { timeout: 20_000 }).toBe(2);
    expect(await creditOf(page, 'Ceres')).toEqual({
        file: 'Ceres (dwarf planet).png',
        by: 'Example Photographer',
        licence: 'CC BY-SA 4.0',
    });
    // nothing known about this one but its file: still linked
    expect(await creditOf(page, 'Eris')).toEqual({ file: 'Eris (dwarf planet).png' });
    await expect(page.locator('#progmod')).toBeHidden();
    await openEditor(page, 'Eris');
    await expect(page.locator('#iedcredit')).toHaveText('Picture from Wikimedia Commons');
    expect(errors).toEqual([]);
});
