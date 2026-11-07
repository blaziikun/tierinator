// src/core/tile-box.ts
// ─────────────────────────────────────────────────────────────────────────────
//  A tile's shape and size, and where a picture sits inside it (whole, or filling
//  it). Plain arithmetic shared by the board and the exports, so what's exported
//  matches the screen; unit-tested on its own.
// ─────────────────────────────────────────────────────────────────────────────
import type { Crop, TileFit, TileShape } from './types';

/** Width : height of each shape. */
const SHAPE_RATIOS: Record<TileShape, readonly [width: number, height: number]> = {
    square: [1, 1],
    portrait: [2, 3],
    landscape: [16, 9],
};

export const isTileShape = (value: unknown): value is TileShape => typeof value === 'string' && Object.hasOwn(SHAPE_RATIOS, value);
export const isTileFit = (value: unknown): value is TileFit => value === 'contain' || value === 'cover';

/** Width divided by height. */
export function tileRatio(shape: TileShape): number {
    const [width, height] = SHAPE_RATIOS[shape];
    return width / height;
}

/**
 * How much wider and taller than the tile size a tile of this shape is. A tile holds as much
 * picture as a size × size square, so switching shape keeps the board about as full and the
 * size slider means the same thing for every shape.
 */
export function tileScale(shape: TileShape): { width: number; height: number } {
    const side = Math.sqrt(tileRatio(shape));
    return { width: side, height: 1 / side };
}

/** A tile's width and height in whole pixels, for a tile size (the size slider's value). */
export function tileBox(shape: TileShape, size: number): { width: number; height: number } {
    const scale = tileScale(shape);
    return { width: Math.round(size * scale.width), height: Math.round(size * scale.height) };
}

/** A rectangle in a picture's own pixels. */
export interface PictureRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The part of a picture a tile shows when the picture has a crop box (animated pictures and
 * PokeAPI's padded sprites): a rectangle of the tile's shape, centred on the crop box. Whole
 * keeps the box in view with a pixel to spare, as square tiles always did; fill covers the
 * tile with the box's middle.
 */
export function cropView(crop: Crop, ratio: number, fit: TileFit): PictureRect {
    const width = fit === 'cover' ? Math.min(crop.w, crop.h * ratio) : Math.max(crop.w + 2, (crop.h + 2) * ratio);
    const height = width / ratio;
    return { x: crop.x + crop.w / 2 - width / 2, y: crop.y + crop.h / 2 - height / 2, width, height };
}

/** Where a picture is drawn inside a tile, in the tile's pixels. */
export interface FittedPicture {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Scaled up by two or more: drawn without smoothing, so pixel art keeps its hard edges. */
    crisp: boolean;
}

/**
 * A picture (or part of one) `source` big, drawn into a tile `box` big: whole and centred, or
 * covering it with the overflow cut off evenly. Pixel art scaled up whole goes up by whole
 * steps, so every pixel stays the same size; filling a tile can't, so it keeps the exact scale.
 */
export function fitPicture(source: { width: number; height: number }, box: { width: number; height: number }, fit: TileFit): FittedPicture {
    const across = box.width / source.width;
    const down = box.height / source.height;
    let scale = fit === 'cover' ? Math.max(across, down) : Math.min(across, down);
    const crisp = scale >= 2;
    if (crisp && fit === 'contain') scale = Math.floor(scale);
    const width = source.width * scale;
    const height = source.height * scale;
    return { x: Math.round((box.width - width) / 2), y: Math.round((box.height - height) / 2), width, height, crisp };
}
