// src/features/grid/cells.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What each cell of a grid holds, worked out from the ranking: every Pokémon
//  that fits it (after the grid's own focus and layer), best-ranked first, so
//  the cell's pick is the first one, unless you pinned another. No page code
//  here, so the rules are unit tested (tests/unit/grid-cells.test.ts).
// ─────────────────────────────────────────────────────────────────────────────
import type { Entry, FacetKey, ItemId, SavedGrid } from '../../core/types';
import { FACETS, type FacetValue, matchesFocus } from '../../pokemon/facets';

export interface GridCell {
    key: string;
    row: string;
    col: string | null;
    /** Everything that fits, ranked ones in ranking order, then the unranked in Pokédex order. */
    ids: ItemId[];
    ranked: number;
    /** The ranking's pick: the best-ranked one, if any is ranked. */
    top: ItemId | null;
    /** Your pin, if it still fits the cell. */
    pin: ItemId | null;
}

export interface GridModel {
    rows: readonly FacetValue[];
    /** Null: one column (a list of favourites, one per row). */
    cols: readonly FacetValue[] | null;
    cells: Map<string, GridCell>;
    /** How many fit each layer value (for the layer tabs). */
    layerCounts: Map<string, number>;
}

/** A cell's key in `pins`: the layer shown ("*" for all of them), the row and the column ("*" for none). */
export const cellKey = (layerValue: string | null, row: string, col: string | null): string => `${layerValue ?? '*'}|${row}|${col ?? '*'}`;

/** The facet's values a grid shows along an axis: the chosen ones in the order chosen (Grass, Fire, Water), or all. */
export const axisValues = (facet: FacetKey, chosen: readonly string[]): readonly FacetValue[] =>
    chosen.length ? chosen.flatMap((value) => FACETS[facet].values.filter((v) => v.value === value)) : FACETS[facet].values;

/**
 * The (row, column) pairs a Pokémon fills. Type × type: a single type sits on the diagonal and a dual type in both of
 * its pairings; the same facet both ways otherwise: only the diagonal.
 */
function pairsOf(entry: Entry, grid: SavedGrid): [string, string | null][] {
    const rows = FACETS[grid.rows].of(entry);
    if (!grid.cols) return rows.map((row) => [row, null]);
    if (grid.cols === grid.rows) {
        if (grid.rows === 'type' && rows.length === 2)
            return [
                [rows[0]!, rows[1]!],
                [rows[1]!, rows[0]!],
            ];
        return rows.map((row) => [row, row]);
    }
    const cols = FACETS[grid.cols].of(entry);
    return rows.flatMap((row) => cols.map((col): [string, string] => [row, col]));
}

/**
 * Fills the grid. `entries` are the list's rankable Pokémon in Pokédex order; `rankOf` gives each ranked one's place
 * (top tier first, left to right).
 */
export function buildGrid(grid: SavedGrid, entries: readonly Entry[], rankOf: ReadonlyMap<ItemId, number>): GridModel {
    const rows = axisValues(grid.rows, grid.rowValues);
    const cols = grid.cols ? axisValues(grid.cols, grid.colValues) : null;
    const rowSet = new Set(rows.map((v) => v.value));
    const colSet = cols ? new Set(cols.map((v) => v.value)) : null;
    const cells = new Map<string, GridCell>();
    const layerCounts = new Map<string, number>();
    for (const row of rows)
        for (const col of cols ?? [null]) {
            const key = cellKey(grid.layerValue, row.value, col?.value ?? null);
            cells.set(key, { key, row: row.value, col: col?.value ?? null, ids: [], ranked: 0, top: null, pin: null });
        }
    for (const entry of entries) {
        if (!matchesFocus(entry, grid.focus)) continue;
        if (grid.layer) {
            const layers = FACETS[grid.layer].of(entry);
            for (const value of layers) layerCounts.set(value, (layerCounts.get(value) ?? 0) + 1);
            if (grid.layerValue && !layers.includes(grid.layerValue)) continue;
        }
        for (const [row, col] of pairsOf(entry, grid)) {
            if (!rowSet.has(row) || (colSet && (col == null || !colSet.has(col)))) continue;
            cells.get(cellKey(grid.layerValue, row, col))?.ids.push(entry.id);
        }
    }
    const order = (id: ItemId) => rankOf.get(id) ?? Number.POSITIVE_INFINITY;
    for (const cell of cells.values()) {
        // a stable sort: the unranked keep their Pokédex order after the ranked
        cell.ids.sort((a, b) => order(a) - order(b) || 0);
        cell.ranked = cell.ids.filter((id) => rankOf.has(id)).length;
        cell.top = cell.ranked ? cell.ids[0]! : null;
        const pin = grid.pins[cell.key];
        cell.pin = pin != null && cell.ids.includes(pin) ? pin : null;
    }
    return { rows, cols, cells, layerCounts };
}

/** Each ranked item's place: the top tier's first item is 0, and so on down the list. */
export function rankPlaces(tiers: readonly { items: readonly ItemId[] }[]): Map<ItemId, number> {
    const places = new Map<ItemId, number>();
    for (const tier of tiers) for (const id of tier.items) places.set(id, places.size);
    return places;
}

/** "Gen × Type", "By type": a grid's name from its axes (kept up to date until you rename it). */
export function autoName(grid: Pick<SavedGrid, 'rows' | 'cols'>): string {
    const short: Record<FacetKey, string> = { type: 'Type', gen: 'Gen', stage: 'Stage', group: 'Group', form: 'Form' };
    return grid.cols ? `${short[grid.rows]} × ${short[grid.cols]}` : `By ${FACETS[grid.rows].label.toLowerCase()}`;
}
