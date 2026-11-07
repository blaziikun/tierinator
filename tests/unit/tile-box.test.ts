// Tile shapes: their sizes, where a cropped picture sits in them, and how a picture is fitted or fills one.
import { describe, expect, it } from 'vitest';
import { cropView, fitPicture, isTileFit, isTileShape, tileBox, tileRatio, tileScale } from '../../src/core/tile-box';

describe('tile sizes', () => {
    it('keeps square tiles exactly the tile size', () => {
        expect(tileBox('square', 88)).toEqual({ width: 88, height: 88 });
        expect(tileScale('square')).toEqual({ width: 1, height: 1 });
    });

    it('makes portrait 2:3 and landscape 16:9 tiles that hold as much picture as the square', () => {
        const portrait = tileBox('portrait', 88);
        const landscape = tileBox('landscape', 88);
        expect(portrait).toEqual({ width: 72, height: 108 });
        expect(landscape).toEqual({ width: 117, height: 66 });
        expect(portrait.width / portrait.height).toBeCloseTo(2 / 3, 2);
        expect(landscape.width / landscape.height).toBeCloseTo(16 / 9, 1);
        // the same area as an 88 px square, to within rounding
        expect(Math.abs(portrait.width * portrait.height - 88 * 88)).toBeLessThan(88);
        expect(Math.abs(landscape.width * landscape.height - 88 * 88)).toBeLessThan(88);
    });

    it('scales with the size slider, across its whole range', () => {
        for (const size of [28, 64, 160]) {
            const scale = tileScale('portrait');
            expect(tileBox('portrait', size)).toEqual({ width: Math.round(size * scale.width), height: Math.round(size * scale.height) });
        }
        expect(tileRatio('landscape')).toBeCloseTo(16 / 9);
    });

    it('knows only its own shapes and fits', () => {
        expect(['square', 'portrait', 'landscape'].every(isTileShape)).toBe(true);
        expect([undefined, '', 'Square', 'circle', 'constructor', 3].some(isTileShape)).toBe(false);
        expect(isTileFit('contain') && isTileFit('cover')).toBe(true);
        expect(isTileFit('fill')).toBe(false);
    });
});

describe('crop boxes (animated pictures, padded sprites)', () => {
    const crop = { x: 20, y: 30, w: 40, h: 50, W: 96, H: 96 };

    it('shows a crop box in a square tile exactly as square tiles always did', () => {
        // before tile shapes: a square of the longer side plus 2, centred on the box
        const square = Math.max(crop.w, crop.h) + 2;
        expect(cropView(crop, 1, 'contain')).toEqual({
            x: crop.x - (square - crop.w) / 2,
            y: crop.y - (square - crop.h) / 2,
            width: square,
            height: square,
        });
    });

    it('keeps the whole box in view in other shapes, centred', () => {
        const view = cropView(crop, 16 / 9, 'contain');
        expect(view.width / view.height).toBeCloseTo(16 / 9);
        expect(view.height).toBe(52);
        expect(view.x + view.width / 2).toBeCloseTo(crop.x + crop.w / 2);
        expect(view.x).toBeLessThanOrEqual(crop.x);
        expect(view.x + view.width).toBeGreaterThanOrEqual(crop.x + crop.w);
    });

    it('fills the tile with the middle of the box when filling', () => {
        const view = cropView(crop, 2 / 3, 'cover');
        expect(view.width / view.height).toBeCloseTo(2 / 3);
        expect(view.width).toBeLessThanOrEqual(crop.w);
        expect(view.height).toBeLessThanOrEqual(crop.h);
        expect(view.y + view.height / 2).toBeCloseTo(crop.y + crop.h / 2);
        expect(view.x + view.width / 2).toBeCloseTo(crop.x + crop.w / 2);
    });
});

describe('fitting a picture into a tile', () => {
    it('shows the whole picture, centred, when fitting', () => {
        const placed = fitPicture({ width: 600, height: 900 }, { width: 160, height: 90 }, 'contain');
        expect(placed.height).toBeCloseTo(90);
        expect(placed.width).toBeCloseTo(60);
        expect(placed.x).toBe(50);
        expect(placed.y).toBe(0);
        expect(placed.crisp).toBe(false);
    });

    it('covers the tile and cuts the overflow off evenly when filling', () => {
        const placed = fitPicture({ width: 600, height: 900 }, { width: 160, height: 90 }, 'cover');
        expect(placed.width).toBeCloseTo(160);
        expect(placed.height).toBeCloseTo(240);
        expect(placed.x).toBe(0);
        expect(placed.y).toBe(-75);
    });

    it('scales pixel art up by whole steps when fitting, so every pixel stays the same size', () => {
        const placed = fitPicture({ width: 40, height: 30 }, { width: 128, height: 128 }, 'contain');
        expect(placed).toEqual({ x: 4, y: 19, width: 120, height: 90, crisp: true });
    });

    it('keeps pixel art crisp when filling too, at the exact scale that covers the tile', () => {
        const placed = fitPicture({ width: 40, height: 40 }, { width: 85, height: 128 }, 'cover');
        expect(placed.crisp).toBe(true);
        expect(placed.width).toBeCloseTo(128);
        expect(placed.height).toBeCloseTo(128);
    });
});
