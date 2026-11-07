// Export ▾: SVG, PNG and PDF of the same tier list, and the title, unranked items and credit they can carry.

import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Download, Page } from '@playwright/test';
import { expect, openPokemonList, openSite, rankItems, test } from './fixtures';

/** Export ▾, set the panel's checkboxes as `options` says (by id), then press `button`. */
async function exportAs(page: Page, button: string, options: Record<string, boolean> = {}): Promise<Buffer> {
    await page.click('#filebtn');
    await page.click('#expbtn');
    for (const [id, on] of Object.entries(options)) await page.locator(id).setChecked(on);
    const download: Promise<Download> = page.waitForEvent('download');
    await page.click(button);
    return readFileSync((await (await download).path())!);
}

const pngSize = (page: Page, png: Buffer): Promise<number[]> =>
    page.evaluate(
        async (bytes) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
            return [bitmap.width, bitmap.height];
        },
        [...png],
    );

test('SVG, PNG and PDF exports', async ({ page, errors }) => {
    await openPokemonList(page);
    await rankItems(page, [1, 4, 7, 25, 133]);
    await page.evaluate(() => {
        const { state } = window.__app.state;
        state.tiers[0].label = 'Best </text><script>alert(1)</script>';
        state.notes[25] = 'Electric <b>mouse</b> & friend';
        state.exportOptions.includeNotes = true;
        window.__app.board.renderTiers();
    });

    const svg = (await exportAs(page, '#svgbtn')).toString('utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;/text&gt;'); // the label's markup is text
    expect(svg.match(/<image /g)).toHaveLength(5);
    expect(svg).toContain('Electric &lt;b&gt;mouse&lt;/b&gt; &amp; friend');
    // it parses as XML (in a blank page: the site's security policy rightly refuses to parse markup from a string)
    const blank = await page.context().newPage();
    const parsed = await blank.evaluate(
        (text) => new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror') === null,
        svg,
    );
    await blank.close();
    expect(parsed).toBe(true);

    const png = await exportAs(page, '#pngbtn');
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const size = await page.evaluate(
        async (bytes) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
            return [bitmap.width, bitmap.height];
        },
        [...png],
    );
    expect(size[0]).toBeGreaterThan(600);

    const pdf = await exportAs(page, '#pdfbtn');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(errors).toEqual([]);
});

test('the title, unranked items and "Made with" line, in SVG, PNG and PDF, rows and charts', async ({ page, errors }) => {
    await openSite(page);
    await page.click('#startempty');
    await page.evaluate(async () => {
        const ids: number[] = [];
        for (const name of ['Beacon Point', 'Gull Rock', 'North Head', 'Saltmarsh', 'Ferry Light', 'Stack Island'])
            ids.push(await window.__app.ownItems.addItem({ name }));
        const { state, currentListMeta } = window.__app.state;
        currentListMeta().name = 'Lighthouses of the north coast';
        state.tiers[0].items = ids.slice(0, 2);
        state.tiers[1].items = [ids[2]];
        window.__app.board.placeAllTiles();
    });
    const title = '>Lighthouses of the north coast</text>';
    const credit = '>Made with tierinator.sayel.dev</text>';

    // on by default: the title and the credit; the unranked items are not
    let svg = (await exportAs(page, '#svgbtn')).toString('utf8');
    expect(svg).toContain(title);
    expect(svg).toContain(credit);
    expect(svg).not.toContain('Not ranked');
    expect(svg.match(/<image /g)).toHaveLength(3);
    await expect(page.locator('#expcreditline')).toHaveText('Made with tierinator.sayel.dev');
    await page.click('#filebtn');
    await page.click('#expbtn');
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('#exppanel').analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    const withBoth = await pngSize(page, await exportAs(page, '#pngbtn'));
    expect((await exportAs(page, '#pdfbtn')).subarray(0, 5).toString()).toBe('%PDF-');

    // both off: the picture is only the tiers, and shorter
    svg = (await exportAs(page, '#svgbtn', { '#exptitle': false, '#expcredit': false })).toString('utf8');
    expect(svg).not.toContain(title);
    expect(svg).not.toContain(credit);
    const bare = await pngSize(page, await exportAs(page, '#pngbtn'));
    expect(bare[0]).toBe(withBoth[0]);
    expect(bare[1]).toBeLessThan(withBoth[1]!);
    expect((await exportAs(page, '#pdfbtn')).subarray(0, 5).toString()).toBe('%PDF-');

    // the unranked items: a section under the tiers with the pool's three
    svg = (await exportAs(page, '#svgbtn', { '#exppool': true })).toString('utf8');
    expect(svg).toContain('>Not ranked</text>');
    expect(svg.match(/<image /g)).toHaveLength(6);
    const withPool = await pngSize(page, await exportAs(page, '#pngbtn'));
    expect(withPool[1]).toBeGreaterThan(bare[1]!);
    expect((await exportAs(page, '#pdfbtn')).subarray(0, 5).toString()).toBe('%PDF-');

    // remembered with the list
    expect(await page.evaluate(() => window.__app.persist.toSnapshot().exp)).toMatchObject({ title: false, pool: true, credit: false });

    // a chart carries them too
    await page.evaluate(() => {
        window.__app.state.state.layout = 'chart';
        window.__app.board.renderTiers();
    });
    svg = (await exportAs(page, '#svgbtn', { '#exptitle': true, '#expcredit': true })).toString('utf8');
    expect(svg).toContain(title);
    expect(svg).toContain(credit);
    expect(svg).toContain('>Not ranked</text>');
    const chartPng = await pngSize(page, await exportAs(page, '#pngbtn'));
    expect(chartPng[1]).toBeGreaterThan(0);
    expect((await exportAs(page, '#pdfbtn')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(errors).toEqual([]);
});
