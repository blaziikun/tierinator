// src/features/add-items/csv-import.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Add items → Type → Open a CSV: one item per row (format: core/csv-format.ts).
//
//  A name already on the list is reused rather than added twice, so a list's own
//  CSV puts it back together. Rows with a tier go straight into it (a tier the
//  list doesn't have is made, in the order the file names them); rows without one
//  go to the pool.
// ─────────────────────────────────────────────────────────────────────────────
import { type CsvRow, readCsvRows } from '../../core/csv-format';
import { pushHistory } from '../../core/history';
import { entries } from '../../core/items';
import { autosave } from '../../core/persist';
import { state } from '../../core/state';
import type { ItemId, Tier } from '../../core/types';
import { decodeCsvBytes } from '../../lib/csv';
import { toast } from '../../lib/ui';
import { addItems } from '../items/items';
import { newTier, placeAllTiles, removeFromTiers, renderTiers } from '../tier-board/board';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** A file can name any tiers it likes; past this many, the rest of its items wait in the pool. */
const MAX_TIERS = 50;

const nameKey = (name: string): string => name.trim().toLowerCase();

export async function importCsvFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_BYTES) {
        toast('That file is over 5 MB. Split it into smaller files');
        return;
    }
    const rows = readCsvRows(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
    if (!rows.length) {
        toast('No names found in that file. It needs a Name column, or names in the first column');
        return;
    }
    // names already on the list, each used once: a list with two items of the same name gets both back
    const unused = new Map<string, ItemId[]>();
    for (const entry of entries) {
        const key = nameKey(entry.name);
        unused.set(key, [...(unused.get(key) ?? []), entry.id]);
    }
    const ids: (ItemId | undefined)[] = rows.map((row) => unused.get(nameKey(row.name))?.shift());
    const fresh = rows.flatMap((row, index) => (ids[index] == null ? [{ row, index }] : []));
    const freshIds = await addItems(
        fresh.map(({ row }) => ({ name: row.name, url: row.picture })),
        'Adding items from the CSV…',
        4,
    );
    fresh.forEach(({ index }, at) => {
        ids[index] = freshIds[at];
    });
    placeInTiers(rows, ids);
}

/** The rows' tiers, made where the list doesn't have them yet, up to a sensible number. */
function tiersForRows(rows: CsvRow[]): { tierByLabel: Map<string, Tier>; newTiers: number } {
    const tierByLabel = new Map<string, Tier>();
    for (const tier of state.tiers) if (!tierByLabel.has(nameKey(tier.label))) tierByLabel.set(nameKey(tier.label), tier);
    let newTiers = 0;
    for (const row of rows) {
        if (!row.tier || tierByLabel.has(nameKey(row.tier)) || state.tiers.length >= MAX_TIERS) continue;
        const tier = newTier(state.tiers.length, row.tier);
        state.tiers.push(tier);
        tierByLabel.set(nameKey(row.tier), tier);
        newTiers++;
    }
    return { tierByLabel, newTiers };
}

/** Rows with a tier go into it; rows without one go (back) to the pool. */
function placeInTiers(rows: CsvRow[], ids: (ItemId | undefined)[]): void {
    const seen = new Set<ItemId>();
    const placed = rows
        .map((row, index) => ({ ...row, id: ids[index] }))
        .filter((row): row is CsvRow & { id: ItemId } => row.id != null && !seen.has(row.id) && !!seen.add(row.id));
    if (!placed.length) return;
    pushHistory();
    const { tierByLabel, newTiers } = tiersForRows(placed);
    removeFromTiers(placed.map((row) => row.id));
    // sort is stable, so rows without a position keep the file's order
    placed.sort((a, b) => a.position - b.position);
    let inTiers = 0;
    for (const row of placed) {
        const tier = row.tier ? tierByLabel.get(nameKey(row.tier)) : undefined;
        if (!tier) continue;
        tier.items.push(row.id);
        inTiers++;
    }
    if (newTiers) renderTiers();
    else placeAllTiles();
    autosave();
    if (inTiers)
        toast(
            `Placed ${inTiers} in their tiers${newTiers ? `, with ${newTiers} new tier${newTiers > 1 ? 's' : ''}` : ''}. Ctrl/⌘+Z to undo`,
        );
}
