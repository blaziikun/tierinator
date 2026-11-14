// src/core/grid-format.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Saved grids (the Grid view of a Pokémon list): the ready-made ones offered
//  for a new grid, and reading them back from a file or undo history, every
//  field checked.
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../lib/checks';
import { isFacetKey, readFocus, readValues } from '../pokemon/facets';
import type { FacetKey, Focus, ItemId, SavedGrid } from './types';

/** More grids than anyone keeps, and enough to stop a hostile file (New grid stops here too). */
export const MAX_GRIDS = 30;
/**
 * Pins kept per grid: every cell of Type × Type across a generation layer (324 cells × 10 layer views) is 3,240, and
 * pins from earlier axes are kept in case they come back. Past this, the oldest go first.
 */
const MAX_PINS = 5000;

interface GridPreset {
    name: string;
    title: string;
    rows: FacetKey;
    rowValues?: string[];
    cols: FacetKey | null;
    colValues?: string[];
    layer?: FacetKey;
    focus?: Focus;
}

/** The grids offered by New grid, the first one made for you. */
export const GRID_PRESETS: readonly GridPreset[] = [
    { name: 'Gen × Type', title: 'Your favourite of each type in each generation', rows: 'gen', cols: 'type' },
    { name: 'By type', title: 'Your favourite of each type', rows: 'type', cols: null },
    { name: 'By generation', title: 'Your favourite from each generation', rows: 'gen', cols: null },
    {
        name: 'Starters',
        title: 'Your favourite starter of each type, each generation (first stages)',
        rows: 'gen',
        cols: 'type',
        colValues: ['Grass', 'Fire', 'Water'],
        focus: { group: ['starter'], stage: ['first'] },
    },
    {
        name: 'Legendaries',
        title: 'Your favourite legendary, box legend and mythical of each generation',
        rows: 'gen',
        cols: 'group',
        colValues: ['legendary', 'box', 'mythical'],
    },
    { name: 'Type × Type', title: 'Your favourite of every type pairing (the diagonal: single types)', rows: 'type', cols: 'type' },
    {
        name: 'Gen × Type by stage',
        title: 'Gen × Type, one evolution stage at a time',
        rows: 'gen',
        cols: 'type',
        layer: 'stage',
    },
];

export function gridFromPreset(preset: GridPreset, id: string): SavedGrid {
    return {
        id,
        name: preset.name,
        rows: preset.rows,
        rowValues: preset.rowValues?.slice() ?? [],
        cols: preset.cols,
        colValues: preset.colValues?.slice() ?? [],
        layer: preset.layer ?? null,
        layerValue: null,
        focus: structuredClone(preset.focus ?? {}),
        pins: {},
    };
}

/**
 * Grids from a stored list or undo history. Unknown facets drop the grid; unknown values, pins of items
 * that aren't in the list, and anything malformed are left out.
 */
export function readGrids(raw: unknown, itemExists: (id: ItemId) => boolean, makeId: () => string): SavedGrid[] {
    const ids = new Set<string>();
    const grids: SavedGrid[] = [];
    for (const g of (Array.isArray(raw) ? raw : []).filter(isRecord).slice(0, MAX_GRIDS)) {
        // an unknown facet anywhere drops the grid; none (null or missing) is fine for the columns and the layer
        if (!isFacetKey(g.rows) || (g.cols != null && !isFacetKey(g.cols)) || (g.layer != null && !isFacetKey(g.layer))) continue;
        // the same facet both ways only for types (every type pairing)
        const cols = isFacetKey(g.cols) && (g.cols !== g.rows || g.rows === 'type') ? g.cols : null;
        const layer = isFacetKey(g.layer) && g.layer !== g.rows && g.layer !== cols ? g.layer : null;
        const wantedId = typeof g.id === 'string' ? g.id.slice(0, 40) : '';
        const id = wantedId && !ids.has(wantedId) ? wantedId : makeId();
        ids.add(id);
        const layerValues = layer ? readValues(layer, [g.layerValue]) : [];
        const pins: Record<string, ItemId> = {};
        if (isRecord(g.pins))
            for (const [key, value] of Object.entries(g.pins).slice(-MAX_PINS))
                if (key.length <= 60 && Number.isSafeInteger(value) && itemExists(Number(value))) pins[key] = Number(value);
        grids.push({
            id,
            name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 40) : 'Grid',
            rows: g.rows,
            rowValues: readValues(g.rows, g.rowValues),
            cols,
            colValues: cols ? readValues(cols, g.colValues) : [],
            layer,
            layerValue: layerValues[0] ?? null,
            focus: readFocus(g.focus),
            pins,
        });
    }
    return grids;
}
