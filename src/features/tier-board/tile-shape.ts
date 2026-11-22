// src/features/tier-board/tile-shape.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Tile shape and fit (Style → Shape & spacing): square tiles, portrait 2:3 for
//  posters and book covers, or landscape 16:9 for thumbnails, each picture shown
//  whole or filling its tile. Saved with the list; the board draws it (tier-engine/board).
// ─────────────────────────────────────────────────────────────────────────────

import { isTileFit, isTileShape, tileRatio, tileScale } from 'tier-engine/core';
import { onHistoryRestore, pushHistory } from '../../core/history';
import { autosave } from '../../core/persist';
import { onListOpen, state } from '../../core/state';
import type { ItemId, TileFit, TileShape } from '../../core/types';
import { byId } from '../../lib/dom';
import { refitBoard } from './board';

/** How an item's picture sits in its tile. Text tiles always show whole: filling would cut their words off. */
export const pictureFit = (id: ItemId): TileFit => (state.picks[id]?.text ? 'contain' : state.tileFit);

/**
 * Shows the list's tile shape in Style, and puts it on the page as CSS variables for the views
 * outside the board (Grid, Stream mode). The board sets the same ones on itself (tier-engine/board).
 */
function showTileShape(): void {
    byId<HTMLSelectElement>('ap-shape').value = state.tileShape;
    byId<HTMLSelectElement>('ap-fit').value = state.tileFit;
    const root = document.documentElement.style;
    const scale = tileScale(state.tileShape);
    root.setProperty('--tile-wf', String(scale.width));
    root.setProperty('--tile-hf', String(scale.height));
    root.setProperty('--tile-ratio', String(tileRatio(state.tileShape)));
    root.setProperty('--tile-fit', state.tileFit);
}

/** Every tile's picture placed again for the current shape (crop boxes are worked out per shape). */
function refitTiles(): void {
    showTileShape();
    refitBoard();
}

function setTileShape(shape: TileShape, fit: TileFit): void {
    if (shape === state.tileShape && fit === state.tileFit) return;
    pushHistory();
    state.tileShape = shape;
    state.tileFit = fit;
    refitTiles();
    autosave();
}

// ── wiring (runs once at start-up, from start.ts) ──
export function setupTileShape(): void {
    byId<HTMLSelectElement>('ap-shape').onchange = (e) => {
        const shape = (e.target as HTMLSelectElement).value;
        if (isTileShape(shape)) setTileShape(shape, state.tileFit);
    };
    byId<HTMLSelectElement>('ap-fit').onchange = (e) => {
        const fit = (e.target as HTMLSelectElement).value;
        if (isTileFit(fit)) setTileShape(state.tileShape, fit);
    };
    // a list's tiles are drawn for its own shape as it opens; the page's sizes and the controls follow
    onListOpen(() => {
        showTileShape();
        refitBoard();
    });
    onHistoryRestore(refitTiles);
}
