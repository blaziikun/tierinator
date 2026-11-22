// src/core/csv-format.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The open list as CSV: one row per item, tiers top to bottom, then the
//  unranked pool (an empty Tier cell); Pokémon lists add a Number column.
//  Quoting, the formula guard and reading it back are tier-engine/core's
//  (tableAsCsv, readCsvRows); features/add-items/csv-import.ts uses the rows.
// ─────────────────────────────────────────────────────────────────────────────
import { tableAsCsv } from 'tier-engine/core';
import { dexLabel, entries, entryById, isRankable } from './items';
import { isPokemonList, state } from './state';
import type { ItemId } from './types';

/** A web address for the item's picture, when it has one anyone can open. */
function pictureAddress(id: ItemId): string {
    const pick = state.picks[id];
    const address = pick?.remote || pick?.path || '';
    return /^https:\/\//.test(address) ? address : '';
}

export function listAsCsv(): string {
    const withNumber = isPokemonList();
    const header = ['Tier', 'Position', withNumber && 'Number', 'Name', 'Picture'].filter((cell) => cell !== false);
    const row = (tier: string, position: string, id: ItemId): string[] => {
        const cells = [tier, position, entryById.get(id)?.name ?? '', pictureAddress(id)];
        if (withNumber) cells.splice(2, 0, dexLabel(id));
        return cells;
    };
    const rows: string[][] = [header];
    const ranked = new Set<ItemId>();
    for (const tier of state.tiers)
        tier.items.forEach((id, index) => {
            ranked.add(id);
            rows.push(row(tier.label, String(index + 1), id));
        });
    for (const entry of entries) if (!ranked.has(entry.id) && isRankable(entry.id)) rows.push(row('', '', entry.id));
    return tableAsCsv(rows);
}
