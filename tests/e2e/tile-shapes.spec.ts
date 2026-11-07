// Tile shape and fit (Style → Shape & spacing): portrait and landscape tiles, pictures whole or filling the tile, on the
// board, in the pool, in a chart, in stream mode and in exports; saved with the list and undone like any change.

import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Download, Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

/**
 * A new list of your own with `count` poster-shaped pictures (2:3, drawn on a canvas: a coloured
 * field with a pale band near the top, like a title), the first `ranked` of them in the top tier.
 */
async function listWithPosters(page: Page, count: number, ranked: number): Promise<number[]> {
    await openSite(page);
    await page.click('#startempty');
    return page.evaluate(
        async ({ count, ranked }) => {
            const colours = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#6c3483', '#117a65', '#a04000', '#1b4f72'];
            const files: File[] = [];
            for (let i = 0; i < count; i++) {
                const canvas = document.createElement('canvas');
                canvas.width = 200;
                canvas.height = 300;
                const g = canvas.getContext('2d')!;
                g.fillStyle = colours[i % colours.length]!;
                g.fillRect(0, 0, 200, 300);
                g.fillStyle = '#f4ecd8';
                g.fillRect(16, 24, 168, 40);
                g.beginPath();
                g.arc(100, 190, 54, 0, Math.PI * 2);
                g.fill();
                const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/png'));
                files.push(new File([blob], `Film ${i + 1}.png`, { type: 'image/png' }));
            }
            await window.__app.ownItems.addImageFiles(files);
            const { state } = window.__app.state;
            const ids: number[] = state.ownItems.map((item: { id: number }) => item.id);
            state.tiers[0].items = ids.slice(0, ranked);
            window.__app.board.placeAllTiles();
            window.__app.persist.saveNow();
            return ids;
        },
        { count, ranked },
    );
}

/** A picture frame's size on screen, the tile's own width (its frame plus a border), and the fit its picture uses. */
const frameOf = (page: Page, selector: string) =>
    page
        .locator(selector)
        .first()
        .evaluate((tile) => {
            const frame = tile.querySelector('.pimg')!.getBoundingClientRect();
            return {
                width: frame.width,
                height: frame.height,
                tileWidth: tile.getBoundingClientRect().width,
                fit: getComputedStyle(tile.querySelector('img')!).objectFit,
            };
        });

const shapeOf = (page: Page) => page.evaluate(() => [window.__app.state.state.tileShape, window.__app.state.state.tileFit]);

test('Style → Tile shape and Pictures reshape every tile; saved with the list and undone like any change', async ({ page, errors }) => {
    const ids = await listWithPosters(page, 6, 3);
    const ranked = `#tsec .pi[data-id="${ids[0]}"]`;
    const pooled = `#pgrid .pi[data-id="${ids[5]}"]`;
    // every list starts square, pictures whole
    let frame = await frameOf(page, ranked);
    expect(frame.width).toBeCloseTo(frame.height, 0);
    expect(frame.fit).toBe('contain');
    expect(await shapeOf(page)).toEqual(['square', 'contain']);

    await page.click('#stylebtn');
    // the new controls pass the automatic accessibility checks
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('#ap-shape').include('#ap-fit').analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await page.selectOption('#ap-shape', 'portrait');
    frame = await frameOf(page, ranked);
    expect(frame.width / frame.height).toBeCloseTo(2 / 3, 1);
    // as much picture as the list's 88 px square: about 72 px wide where the square was 88
    expect(frame.tileWidth).toBeCloseTo(88 * Math.sqrt(2 / 3), 0);
    const poolFrame = await frameOf(page, pooled);
    expect(poolFrame.width / poolFrame.height).toBeCloseTo(2 / 3, 1);

    await page.selectOption('#ap-fit', 'cover');
    expect((await frameOf(page, ranked)).fit).toBe('cover');
    await page.selectOption('#ap-shape', 'landscape');
    frame = await frameOf(page, ranked);
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
    expect(await shapeOf(page)).toEqual(['landscape', 'cover']);
    await page.click('#apdone');

    await page.keyboard.press('Control+z');
    expect(await shapeOf(page)).toEqual(['portrait', 'cover']);
    await page.keyboard.press('Control+z');
    expect(await shapeOf(page)).toEqual(['portrait', 'contain']);
    expect((await frameOf(page, ranked)).fit).toBe('contain');
    await page.click('#stylebtn');
    await expect(page.locator('#ap-shape')).toHaveValue('portrait');
    await expect(page.locator('#ap-fit')).toHaveValue('contain');
    await page.click('#apdone');

    // saved with the list: it opens portrait again after a reload
    await page.evaluate(() => window.__app.persist.saveNow());
    expect(await page.evaluate(() => window.__app.persist.toSnapshot())).toMatchObject({ shape: 'portrait', fit: 'contain' });
    await page.reload();
    await page.waitForFunction(() => window.__app?.state.state.ownItems.length === 6);
    expect(await shapeOf(page)).toEqual(['portrait', 'contain']);
    frame = await frameOf(page, ranked);
    expect(frame.width / frame.height).toBeCloseTo(2 / 3, 1);
    expect(errors).toEqual([]);
});

test('a chart, crop boxes, the hover tip and stream mode take the shape too', async ({ page, errors, isMobile }) => {
    const ids = await listWithPosters(page, 4, 2);
    await page.click('#stylebtn');
    await page.selectOption('#ap-shape', 'portrait');
    await page.selectOption('#ap-fit', 'cover');
    await page.selectOption('#ap-layout', 'chart');
    await page.click('#apdone');
    await expect(page.locator('#tsec')).toHaveClass(/chart/);
    const cellFrame = await frameOf(page, `#tsec.chart .pi[data-id="${ids[0]}"]`);
    expect(cellFrame.width / cellFrame.height).toBeCloseTo(2 / 3, 1);

    // a picture with a crop box (as animated ones have): filling a portrait tile shows the box's middle, edge to edge
    const placed = await page.evaluate((id) => {
        const { state } = window.__app.state;
        state.picks[id] = { ...state.picks[id], crop: { x: 50, y: 75, w: 100, h: 150, W: 200, H: 300 } };
        window.__app.board.setTileImage(id);
        const tile = document.querySelector(`.pi[data-id="${id}"]`)!;
        const frame = tile.querySelector('.pimg')!.getBoundingClientRect();
        const picture = tile.querySelector('img')!.getBoundingClientRect();
        return {
            across: picture.width / frame.width,
            down: picture.height / frame.height,
            left: (frame.left - picture.left) / frame.width,
        };
    }, ids[1]);
    expect(placed.across).toBeCloseTo(2, 1);
    expect(placed.down).toBeCloseTo(2, 1);
    expect(placed.left).toBeCloseTo(0.5, 1);

    if (!isMobile) {
        // the tip has the tile's shape, with the whole picture in it
        await page.hover(`#tsec .pi[data-id="${ids[0]}"]`);
        const tip = await page.locator('#tip img').evaluate((img) => {
            const box = img.getBoundingClientRect();
            return { ratio: box.width / box.height, fit: getComputedStyle(img).objectFit };
        });
        expect(tip.ratio).toBeCloseTo(2 / 3, 1);
        expect(tip.fit).toBe('contain');
    }

    await page.click('#listbtn');
    await page.click('#lstream');
    await page.selectOption('#streamwhich', 'unranked');
    await page.click('#streamgo');
    await expect(page.locator('#stream')).toBeVisible();
    const streamFrame = await frameOf(page, '#sboard .stile');
    expect(streamFrame.width / streamFrame.height).toBeCloseTo(2 / 3, 1);
    expect(streamFrame.fit).toBe('cover');
    const current = await page.locator('#snowpic').boundingBox();
    expect(current!.width / current!.height).toBeCloseTo(2 / 3, 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#stream')).toBeHidden();
    expect(errors).toEqual([]);
});

async function exportAs(page: Page, button: string): Promise<Buffer> {
    await page.click('#filebtn');
    await page.click('#expbtn');
    const download: Promise<Download> = page.waitForEvent('download');
    await page.click(button);
    return readFileSync((await (await download).path())!);
}

test('exports draw every picture in the tile shape', async ({ page, errors }) => {
    await listWithPosters(page, 3, 3);
    await page.evaluate(() => {
        window.__app.state.state.tileShape = 'portrait';
        window.__app.state.state.tileFit = 'cover';
    });
    let svg = (await exportAs(page, '#svgbtn')).toString('utf8');
    expect(svg.match(/<image [^>]*width="72" height="108"/g)).toHaveLength(3);
    const portraitPng = await exportAs(page, '#pngbtn');
    expect([...portraitPng.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    await page.evaluate(() => {
        window.__app.state.state.tileShape = 'landscape';
    });
    svg = (await exportAs(page, '#svgbtn')).toString('utf8');
    expect(svg.match(/<image [^>]*width="117" height="66"/g)).toHaveLength(3);
    // the pictures inside are drawn in that shape too, at the chosen detail (128 px along the longer side)
    const pictureSize = await page.evaluate(async (text) => {
        const address = /xlink:href="(data:image\/png;base64,[^"]+)"/.exec(text)![1]!;
        const picture = new Image();
        picture.src = address;
        await picture.decode();
        return [picture.naturalWidth, picture.naturalHeight];
    }, svg);
    expect(pictureSize).toEqual([128, 72]);
    const pdf = await exportAs(page, '#pdfbtn');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(errors).toEqual([]);
});
