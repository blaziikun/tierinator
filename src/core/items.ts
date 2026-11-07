// src/core/items.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Everything the open list can rank (entries): the Pokémon and forms of a
//  Pokémon list, plus your own items, with quick lookups by id. Also variant
//  families of your own items ("Four Arms" with "Four Arms (Omniverse)"…).
// ─────────────────────────────────────────────────────────────────────────────
import { pad3 } from '../lib/dom';
import { pokedex } from '../pokemon/data';
import { OWN_ITEM_ID_START } from './defaults';
import { state } from './state';
import type { Entry, ItemId } from './types';

export const entries: Entry[] = [];
export const entryById = new Map<ItemId, Entry>();
/** Species → its forms. */
export const formsByDex = new Map<number, Entry[]>();

export const isOwnItem = (id: ItemId): boolean => id >= OWN_ITEM_ID_START;

/** Rebuilds the entries of the open list: Pokémon (with the pack) and your own items. */
export function rebuildEntries(): void {
    entries.length = 0;
    entryById.clear();
    formsByDex.clear();
    if (state.kind === 'pokemon' && pokedex.pack) {
        for (const [id, name, gen, types] of pokedex.roster)
            entries.push({ id, dex: id, name, gen, types, lc: name.toLowerCase(), form: null });
        for (const [id, dex, name, gen, types, category, ident] of pokedex.forms)
            entries.push({
                id,
                dex,
                name,
                gen,
                types: types || pokedex.roster[dex - 1]![3],
                lc: name.toLowerCase(),
                form: category,
                ident,
            });
        entries.sort((a, b) => a.dex! - b.dex! || (a.form ? 1 : 0) - (b.form ? 1 : 0) || a.id - b.id);
    }
    for (const item of state.ownItems)
        entries.push({ id: item.id, dex: null, name: item.name, gen: 0, types: [], lc: item.name.toLowerCase(), form: null, custom: true });
    for (const entry of entries) entryById.set(entry.id, entry);
    rebuildAliases();
    for (const entry of entries) {
        if (!entry.form || entry.dex == null) continue;
        if (!formsByDex.has(entry.dex)) formsByDex.set(entry.dex, []);
        formsByDex.get(entry.dex)!.push(entry);
    }
}

/** "#025" for Pokémon, '' for your own items. */
export const dexLabel = (id: ItemId): string => {
    const dex = entryById.get(id)?.dex;
    return dex ? '#' + pad3(dex) : '';
};

/**
 * Whether an entry is ranked on its own. A form is if you split it individually, otherwise if
 * its whole category is split; a variant isn't while its family is combined into one entry.
 */
export function isRankable(id: ItemId): boolean {
    const entry = entryById.get(id);
    if (!entry) return false;
    if (entry.custom) {
        const base = familyOf(id);
        return !(base != null && state.combinedFamilies[base] && entryById.has(base));
    }
    if (!entry.form) return true;
    const override = state.formOverrides[id];
    return override != null ? !!override : !!state.splitFormCategories[entry.form];
}

export const rankableEntries = (): Entry[] => entries.filter((entry) => isRankable(entry.id));

// ═════════════════════════════════════════════════════════════════════════════
//  VARIANT FAMILIES (your own items)
// ═════════════════════════════════════════════════════════════════════════════

/** The main item of a variant's family, or null if it isn't a variant. */
export const familyOf = (id: ItemId): ItemId | null => (state.familyOf[id] ? Number(state.familyOf[id]) : null);

/** The variants of a main item. */
export const familyMembers = (base: ItemId): ItemId[] =>
    state.ownItems.filter((item) => Number(state.familyOf[item.id]) === base).map((item) => item.id);

/** Every main item that has variants. */
export const familyBases = (): ItemId[] => [...new Set(Object.values(state.familyOf).map(Number))].filter((base) => entryById.has(base));

/**
 * A combined family's main entry also answers to its variants' names and tags (search,
 * tag filter), and knows how many variants it holds (the +3 badge).
 */
export function rebuildAliases(): void {
    for (const entry of entries) {
        if (!entry.custom) continue;
        delete entry.alias;
        delete entry.ftags;
        delete entry.nvar;
    }
    for (const base of familyBases()) {
        const entry = entryById.get(base)!;
        const members = familyMembers(base);
        entry.nvar = members.length;
        if (!state.combinedFamilies[base]) continue;
        entry.alias = members.map((member) => entryById.get(member)?.lc || '').join(' | ');
        entry.ftags = [...new Set(members.flatMap((member) => state.tags[member] || []))];
    }
}
