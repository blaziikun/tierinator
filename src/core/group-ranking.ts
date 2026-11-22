// src/core/group-ranking.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Group ranking: several people's rankings of the same things, combined into
//  one list. This reads each list through snapshot.ts's checks, says which items
//  are the same thing in two lists, and writes the group's list; the maths (a
//  tier's score, an item's mean and spread, how close each person was) is
//  tier-engine/core's. No screens: features/group shows it.
// ─────────────────────────────────────────────────────────────────────────────
import {
    combineRankings as combineEngineRankings,
    type GroupItem as EngineGroupItem,
    type GroupRanking as EngineGroupRanking,
    type RankedList as EngineRankedList,
    foldName,
    groupSizeProblem,
    isBackup,
    isRecord,
    tierScore,
} from 'tier-engine/core';
import { OWN_ITEM_ID_START } from './defaults';
import { isKnownPictureAddress } from './picture-sites';
import { readOwnItems, readStored, type StoredList, type StoredTier } from './snapshot';
import type { ItemId, ListKind, OwnItem, Pick } from './types';

/** A tier's look (the group list copies it from one of the lists). */
export interface GroupTier {
    label: string;
    subtitle: string;
    color: string;
    textColor: string;
}

/** One thing a person put in a tier. */
export interface RankedItem {
    /** What makes it the same thing in someone else's list (see itemKey). */
    key: string;
    name: string;
    /** Its id in the list it came from. */
    id: ItemId;
    /** Where it was placed: the top tier is 1, the bottom tier 0. */
    score: number;
    /** The item itself, for your own items (Pokémon have none). */
    own?: OwnItem;
    pick?: Pick;
}

/** One person's list, checked and reduced to what combining needs. */
export interface RankedList extends EngineRankedList<RankedItem, GroupTier> {
    kind: ListKind;
    packId: string | null;
}

/** Why something can't be combined (the window turns these into what to do instead). */
export type ListProblem = 'not a list' | 'backup' | 'pack' | 'chart' | 'nothing ranked';

/**
 * What makes two people's items the same thing: the Pokémon's id; a pack item's row with
 * its name (a newer version of a pack may number its rows differently); otherwise the name.
 */
function itemKey(id: ItemId, own: OwnItem | undefined): string {
    if (!own) return 'pokemon:' + id;
    const name = foldName(own.name);
    return own.pk ? `pack:${own.pk}:${name}` : 'name:' + name;
}

// ═════════════════════════════════════════════════════════════════════════════
//  READING ONE PERSON'S LIST
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A list from a share link, a file or this browser, or why it can't be combined. Everything
 * goes through snapshot.ts like any list that's opened. `pokemonName` names the Pokémon of the
 * installed pack (undefined for an id it doesn't have, which is then left out).
 */
export function readRankedList(raw: unknown, pokemonName: (id: ItemId) => string | undefined = () => undefined): RankedList | ListProblem {
    if (!isRecord(raw)) return 'not a list';
    if (isBackup(raw)) return 'backup';
    if (raw.type === 'tierpack') return 'pack';
    if (!Array.isArray(raw.tiers)) return 'not a list';
    // a chart's cells (good and evil, lawful and chaotic) aren't better and worse
    if (raw.lay === 'chart') return 'chart';
    const kind: ListKind = raw.kind === 'pokemon' || (!raw.kind && raw.app === 'poketier') ? 'pokemon' : 'custom';
    const ownItems = new Map(readOwnItems(raw.items, OWN_ITEM_ID_START).map((item) => [item.id, item]));
    const isPokemon = (id: ItemId) => kind === 'pokemon' && id < OWN_ITEM_ID_START && pokemonName(id) !== undefined;
    let tierNumber = 0;
    const read = readStored(
        raw,
        (id) => ownItems.has(id) || isPokemon(id),
        () => 'tier' + tierNumber++,
    );
    const tiers = read.tiers ?? [];
    const ranked = new Map<string, RankedItem>();
    tiers.forEach((tier, index) => {
        const score = tierScore(index, tiers.length);
        for (const id of tier.items) {
            const own = ownItems.get(id);
            const key = itemKey(id, own);
            // the same thing twice in one list (two spellings of one name): its higher place counts, once
            if (ranked.has(key)) continue;
            const name = (own ? own.name : pokemonName(id) || '').trim() || 'Item';
            const pick = read.picks[id];
            ranked.set(key, { key, name, id, score, ...(own ? { own } : {}), ...(pick ? { pick } : {}) });
        }
    });
    if (!ranked.size) return 'nothing ranked';
    return {
        title: String(raw.listName ?? '')
            .trim()
            .slice(0, 60),
        kind,
        packId: read.packId,
        tiers: tiers.map((tier) => ({ label: tier.label, subtitle: tier.subtitle, color: tier.color, textColor: tier.textColor || '' })),
        items: [...ranked.values()],
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMBINING
// ═════════════════════════════════════════════════════════════════════════════

export type GroupItem = EngineGroupItem<RankedItem>;

export interface GroupRanking extends EngineGroupRanking<RankedItem, GroupTier> {
    kind: ListKind;
    /** The pack every list was made from, if they all were from the same one. */
    packId: string | null;
}

/** What stops these lists being combined at all, or null. */
export function combineProblem(lists: readonly RankedList[]): 'too few' | 'too many' | 'mixed kinds' | null {
    const size = groupSizeProblem(lists.length);
    if (size) return size;
    // Pokémon ids and names of your own things never match each other
    if (lists.some((list) => list.kind !== lists[0]!.kind)) return 'mixed kinds';
    return null;
}

/** Combines the lists (tier-engine/core's maths), keeping the kind and the pack they share. Call combineProblem first. */
export function combineRankings(lists: readonly RankedList[]): GroupRanking {
    const packId = lists[0]?.packId ?? null;
    return {
        ...combineEngineRankings(lists),
        kind: lists[0]?.kind ?? 'custom',
        packId: lists.every((list) => list.packId === packId) ? packId : null,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE GROUP LIST, IN THE STORED FORMAT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A picture that can go into the group list as it is: one from the sprite collections, or a
 * web address on a site trusted without asking (as in share links, a picture from anywhere else
 * could tell its site the list was opened). Pictures that live only in someone's browser
 * (uploads, the gallery) and text tiles can't: the item gets a text tile instead.
 */
function travellingPick(pick: Pick | undefined): Pick | null {
    if (!pick || pick.text || pick.path === 'custom' || /^(gal|xp):/.test(pick.path)) return null;
    if (/^https?:/i.test(pick.path) && !isKnownPictureAddress(pick.path)) return null;
    if (pick.remote && !isKnownPictureAddress(pick.remote)) return null;
    return {
        path: pick.path,
        ...(pick.ck ? { ck: 1 as const } : {}),
        ...(pick.trim !== undefined ? { trim: pick.trim } : {}),
        ...(pick.anim !== undefined ? { anim: pick.anim } : {}),
        ...(pick.crop ? { crop: { ...pick.crop } } : {}),
        ...(pick.remote ? { remote: pick.remote } : {}),
    };
}

/**
 * The group's ranking as a new list in the stored format (core/snapshot.ts), and each item's id
 * in it. Pokémon keep their ids; your own items are numbered afresh.
 */
export function toGroupList(group: GroupRanking, listName: string): { stored: Partial<StoredList>; idOf: Map<string, ItemId> } {
    let nextId = OWN_ITEM_ID_START;
    const idOf = new Map<string, ItemId>();
    const items: OwnItem[] = [];
    const picks: Record<string, Pick> = {};
    for (const item of group.items) {
        const first = item.copies[0]!.item;
        const id = first.own ? nextId++ : first.id;
        idOf.set(item.key, id);
        if (first.own)
            items.push({ id, name: item.name, ...(first.own.pk ? { pk: first.own.pk } : {}), ...(first.own.w ? { w: first.own.w } : {}) });
        const pick = item.copies.map((copy) => travellingPick(copy.item.pick)).find((travelling) => travelling !== null);
        if (pick) picks[id] = pick;
    }
    const tiers: StoredTier[] = group.tiers.map((tier, index) => ({
        id: 'group' + index,
        label: tier.label,
        sub: tier.subtitle,
        color: tier.color,
        text: tier.textColor,
        items: group.items.filter((item) => item.tier === index).map((item) => idOf.get(item.key)!),
    }));
    const stored: Partial<StoredList> = {
        app: 'tierlist',
        v: 10,
        kind: group.kind,
        ...(group.packId ? { pack: group.packId } : {}),
        listName,
        items,
        nextId,
        tiers,
        picks,
    };
    return { stored, idOf };
}
