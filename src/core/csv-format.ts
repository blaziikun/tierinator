// src/core/csv-format.ts
// ─────────────────────────────────────────────────────────────────────────────
//  A list as CSV, both ways. Writing: one row per item, tiers top to bottom,
//  then the unranked pool (an empty Tier cell). Reading: the same columns in any
//  order or case (Tier, Position, Name, Picture); a file without a header row is
//  read as names in its first column. What to do with the rows is up to
//  features/add-items/csv-import.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { csvCell, detectSeparator, parseCsv, unguardCell } from '../lib/csv';
import { dexLabel, entries, entryById, isRankable } from './items';
import { isPokemonList, state } from './state';
import type { ItemId } from './types';

// ═════════════════════════════════════════════════════════════════════════════
//  WRITING
// ═════════════════════════════════════════════════════════════════════════════

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
    // the byte-order mark makes Excel read accents and emoji as UTF-8
    return `\uFEFF${rows.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  READING
// ═════════════════════════════════════════════════════════════════════════════

const MAX_NAME_LENGTH = 80; // as long as an item name may be (features/items)
const MAX_TIER_LENGTH = 40; // as long as a saved tier label can be

export interface CsvRow {
    name: string;
    tier: string;
    /** Place inside its tier; rows without one keep the file's order. */
    position: number;
    picture?: string;
}

type Columns = Record<'name' | 'tier' | 'position' | 'picture', number>;

/** Which column holds what, from the header row; null when the first row is already data. */
function readHeader(cells: string[]): Columns | null {
    const find = (...names: string[]) => cells.findIndex((cell) => names.includes(cell.trim().toLowerCase()));
    const columns = {
        name: find('name', 'item', 'title'),
        tier: find('tier'),
        position: find('position', 'order'),
        picture: find('picture', 'image', 'url', 'link'),
    };
    return columns.name >= 0 ? columns : null;
}

export function readCsvRows(text: string): CsvRow[] {
    const table = parseCsv(text, detectSeparator(text.replace(/^\uFEFF/, '')));
    const header = table[0] ? readHeader(table[0]) : null;
    const column: Columns = header ?? { name: 0, tier: -1, position: -1, picture: -1 };
    const read = (cells: string[], index: number) => (index >= 0 ? unguardCell((cells[index] ?? '').trim()) : '');
    return (header ? table.slice(1) : table).flatMap((cells) => {
        const name = read(cells, column.name).slice(0, MAX_NAME_LENGTH);
        if (!name) return [];
        const picture = read(cells, column.picture);
        const position = Number(read(cells, column.position));
        return [
            {
                name,
                tier: read(cells, column.tier).slice(0, MAX_TIER_LENGTH),
                position: position > 0 ? position : Number.POSITIVE_INFINITY,
                picture: /^https:\/\/\S+$/.test(picture) ? picture : undefined,
            },
        ];
    });
}
