// Charts: a new alignment chart, placing items in its cells, switching a list between rows and a chart, sharing and exporting one.

import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { expect, openPokemonList, openSite, rankItems, test } from './fixtures';

const layout = (page: Page) => page.evaluate(() => [window.__app.state.state.layout, window.__app.state.state.chartColumns]);
const columnsOnScreen = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.getElementById('tsec')!).gridTemplateColumns.split(' ').length);

/** List menu → New alignment chart, plus two items of your own in the pool. */
async function newAlignmentChart(page: Page): Promise<number[]> {
    await openSite(page);
    await page.click('#startempty');
    await page.click('#listbtn');
    await page.click('#lnewchart');
    await page.waitForFunction(() => window.__app.state.state.layout === 'chart');
    return page.evaluate(async () => {
        const ids = [await window.__app.ownItems.addItem({ name: 'Paladin' }), await window.__app.ownItems.addItem({ name: 'Trickster' })];
        window.__app.board.placeAllTiles();
        return ids;
    });
}

test('New alignment chart makes nine labelled cells; an item put in one is still there after a reload', async ({
    page,
    errors,
    isMobile,
}) => {
    const [paladin] = await newAlignmentChart(page);
    await expect(page.locator('#tsec.chart .trow')).toHaveCount(9);
    await expect(page.locator('#tsec .tgap')).toHaveCount(0);
    await expect(page.locator('.tlbl-main').first()).toHaveText('Lawful good');
    await expect(page.locator('.tlbl-main').nth(4)).toHaveText('True neutral');
    await expect(page.locator('.tlbl-main').last()).toHaveText('Chaotic evil');
    expect(await layout(page)).toEqual(['chart', 3]);
    expect(await columnsOnScreen(page)).toBe(3);

    const tile = page.locator(`#pgrid .pi[data-id="${paladin}"]`);
    if (isMobile) {
        // touch: tap the item, then the cell's label
        await tile.click();
        await page.locator('.tlbl').nth(4).click();
    } else {
        await tile.scrollIntoViewIfNeeded();
        const from = (await tile.boundingBox())!;
        const to = (await page.locator('.tcont').nth(4).boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
        await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 12 });
        await page.mouse.up();
    }
    await expect(page.locator('.tcont').nth(4).locator(`.pi[data-id="${paladin}"]`)).toHaveCount(1);
    await page.evaluate(() => window.__app.persist.saveNow());

    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
    expect(await layout(page)).toEqual(['chart', 3]);
    expect(await page.evaluate(() => window.__app.state.state.tiers[4].items)).toEqual([paladin]);
    await expect(page.locator('#tsec.chart .tcont').nth(4).locator(`.pi[data-id="${paladin}"]`)).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('Style → Layout switches a list between rows and a chart; undo puts each step back', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [1, 4, 7, 25]);
    await expect(page.locator('#tsec')).not.toHaveClass(/chart/);
    await page.click('#stylebtn');
    await expect(page.locator('#ap-colsrow')).toBeHidden();
    await page.selectOption('#ap-layout', 'chart');
    await expect(page.locator('#tsec')).toHaveClass(/chart/);
    await expect(page.locator('#ap-colsrow')).toBeVisible();
    await page.locator('#ap-cols').fill('4');
    await expect(page.locator('#ap-colsval')).toHaveText('4');
    expect(await layout(page)).toEqual(['chart', 4]);
    expect(await columnsOnScreen(page)).toBe(4);
    // the cells keep their items
    expect(await page.evaluate(() => window.__app.state.state.tiers.slice(0, 4).map((t: { items: number[] }) => t.items))).toEqual([
        [1],
        [4],
        [7],
        [25],
    ]);
    await page.click('#apdone');

    await page.click('#undobtn');
    expect(await layout(page)).toEqual(['chart', 3]);
    await page.click('#undobtn');
    expect(await layout(page)).toEqual(['tiers', 3]);
    await expect(page.locator('#tsec')).not.toHaveClass(/chart/);
    await expect(page.locator('#tsec .tgap').first()).toBeAttached();
    await page.click('#stylebtn');
    await expect(page.locator('#ap-layout')).toHaveValue('tiers');
    expect(errors).toEqual([]);
});

test('a chart travels in a share link', async ({ page, browser, errors }, testInfo) => {
    await openPokemonList(page);
    await rankItems(page, [25, 6]);
    await page.evaluate(() => {
        Object.assign(window.__app.state.state, { layout: 'chart', chartColumns: 5 });
        window.__app.board.renderTiers();
    });
    const { link } = await page.evaluate(() => window.__app.share.makeShareLink());
    const { baseURL, viewport } = testInfo.project.use;
    const friend = await browser.newContext({ baseURL, viewport });
    await friend.addInitScript(() => localStorage.setItem('pt_tips', '1'));
    const visitor = await friend.newPage();
    await visitor.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await visitor.waitForFunction(() => !!window.__app?.state.session.listId);
    // kind turns 'pokemon' as the list starts opening; its saved settings follow a moment later
    await expect.poll(() => layout(visitor)).toEqual(['chart', 5]);
    await expect(visitor.locator('#tsec.chart')).toBeVisible();
    await friend.close();
    expect(errors).toEqual([]);
});

async function exportAs(page: Page, button: string): Promise<Buffer> {
    await page.click('#filebtn');
    await page.click('#expbtn');
    const download: Promise<Download> = page.waitForEvent('download');
    await page.click(button);
    return readFileSync((await (await download).path())!);
}

test('a chart exports as SVG, PNG and PDF, every cell included', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [1, 4, 7, 25, 133]);
    await page.evaluate(() => {
        const { state } = window.__app.state;
        state.layout = 'chart';
        state.tiers[0].subtitle = 'top of the class';
        state.exportOptions.includeEmptyTiers = false;
        state.exportOptions.labelMode = 'name';
        window.__app.board.renderTiers();
    });

    const svg = (await exportAs(page, '#svgbtn')).toString('utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<image /g)).toHaveLength(5);
    // nine cells, empty ones too: a chart with holes would read wrong
    expect(svg.match(/<clipPath /g)).toHaveLength(9);
    const blank = await page.context().newPage();
    const parsed = await blank.evaluate(
        (text) => new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror') === null,
        svg,
    );
    await blank.close();
    expect(parsed).toBe(true);

    const png = await exportAs(page, '#pngbtn');
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const [width, height] = await page.evaluate(
        async (bytes) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
            return [bitmap.width, bitmap.height];
        },
        [...png],
    );
    expect(width).toBeGreaterThan(300);
    expect(height).toBeGreaterThan(300);

    const pdf = await exportAs(page, '#pdfbtn');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(errors).toEqual([]);
});
