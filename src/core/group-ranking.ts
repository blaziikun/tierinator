// src/core/group-ranking.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Group ranking: several people's rankings of the same things, combined into
//  one list. Reads each list through snapshot.ts's checks, matches items across
//  lists, and does the maths (a tier's score, an item's mean and spread, how
//  close each person was to the group). No screens: features/group shows it.
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../lib/checks';
import { OWN_ITEM_ID_START } from './defaults';
import { isKnownPictureAddress } from './picture-sites';
import { readOwnItems, readStored, type StoredList, type StoredTier } from './snapshot';
import type { ItemId, ListKind, OwnItem, Pick } from './types';

/** How many lists can be combined: two make a group; past thirty the window gets unwieldy and nobody reads the table. */
export const GROUP_SIZE = { min: 2, max: 30 } as const;

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
export interface RankedList {
    title: string;
    kind: ListKind;
    packId: string | null;
    tiers: GroupTier[];
    /** Only what's in a tier: the pool doesn't count. */
    items: RankedItem[];
}

/** Why something can't be combined (the window turns these into what to do instead). */
export type ListProblem = 'not a list' | 'backup' | 'pack' | 'chart' | 'nothing ranked';

/** "  Café  Noir " → "cafe noir": the same name whatever the case, accents or spacing. */
export const foldName = (name: string): string =>
    name
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

/**
 * What makes two people's items the same thing: the Pokémon's id; a pack item's row with
 * its name (a newer version of a pack may number its rows differently); otherwise the name.
 */
function itemKey(id: ItemId, own: OwnItem | undefined): string {
    if (!own) return 'pokemon:' + id;
    const name = foldName(own.name);
    return own.pk ? `pack:${own.pk}:${name}` : 'name:' + name;
}

/** The score of the tier at `index` of `tierCount`: evenly spaced from 1 (top) down to 0 (bottom); a lone tier is 1. */
export const tierScore = (index: number, tierCount: number): number => (tierCount > 1 ? 1 - index / (tierCount - 1) : 1);

/** A difference in scores, in tiers of a list with `tierCount` tiers (what people understand). */
export const inTiers = (scoreDifference: number, tierCount: number): number => scoreDifference * Math.max(1, tierCount - 1);

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
    if (raw.type === 'backup') return 'backup';
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

/** One thing in the group's ranking. */
export interface GroupItem {
    key: string;
    name: string;
    /** Mean of its scores (0–1). */
    mean: number;
    /** How far apart people placed it: the standard deviation of its scores (0 = all the same tier, at most 0.5). */
    spread: number;
    /** How many people ranked it. */
    votes: number;
    /** Its tier in the group list (an index into GroupRanking.tiers). */
    tier: number;
    /** Each list's copy of it, in list order: the first names it, and the first with a picture that can travel gives it one. */
    copies: { list: number; item: RankedItem }[];
}

/** How one person's ranking compares with the group's. */
export interface PersonFit {
    /** Which list (index into the lists combined). */
    list: number;
    /** How many items they ranked. */
    ranked: number;
    /** How many of those someone else ranked too (the only ones a distance means anything for). */
    compared: number;
    /** Mean distance between their score and the group's for those items; null when there were none. */
    distance: number | null;
}

export interface GroupRanking {
    /** The title most lists share (else the first list's); '' when none had one. */
    title: string;
    kind: ListKind;
    /** The pack every list was made from, if they all were from the same one. */
    packId: string | null;
    tiers: GroupTier[];
    /** Every ranked item: by group tier, then score, then votes, then name. */
    items: GroupItem[];
    people: PersonFit[];
}

/** What stops these lists being combined at all, or null. */
export function combineProblem(lists: readonly RankedList[]): 'too few' | 'too many' | 'mixed kinds' | null {
    if (lists.length < GROUP_SIZE.min) return 'too few';
    if (lists.length > GROUP_SIZE.max) return 'too many';
    // Pokémon ids and names of your own things never match each other
    if (lists.some((list) => list.kind !== lists[0]!.kind)) return 'mixed kinds';
    return null;
}

/** The most common value (by `keyOf`) of `values`; a tie goes to the one that came first. */
function mostCommon<T>(values: readonly T[], keyOf: (value: T) => string): T | undefined {
    const counts = new Map<string, { value: T; count: number }>();
    for (const value of values) {
        const key = keyOf(value);
        const seen = counts.get(key);
        if (seen) seen.count++;
        else counts.set(key, { value, count: 1 });
    }
    let best: { value: T; count: number } | undefined;
    // Map keeps insertion order, so only a strictly bigger count replaces an earlier one
    for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
    return best?.value;
}

/** The group tier nearest a mean score: exactly halfway between two goes to the higher one. */
export function nearestTier(mean: number, tierCount: number): number {
    if (tierCount <= 1) return 0;
    const position = (1 - mean) * (tierCount - 1);
    // the small allowance keeps a mean that is halfway on paper but a hair off in floating point on the higher tier
    return Math.min(tierCount - 1, Math.max(0, Math.ceil(position - 0.5 - 1e-9)));
}

/**
 * Combines the lists. Each list's tiers become scores by position, an item's group score is
 * the mean of the scores of the people who ranked it, and it goes into the group tier nearest
 * that mean. Call combineProblem first: this expects 2–30 lists of one kind.
 */
export function combineRankings(lists: readonly RankedList[]): GroupRanking {
    const tierLook = mostCommon(lists, (list) => list.tiers.map((tier) => foldName(tier.label)).join('\n'))?.tiers ?? [];
    const tiers = tierLook.map((tier) => ({ ...tier }));
    const title = mostCommon(
        lists.filter((list) => list.title),
        (list) => foldName(list.title),
    )?.title;

    const byKey = new Map<string, { list: number; item: RankedItem }[]>();
    lists.forEach((list, index) => {
        for (const item of list.items) {
            const copies = byKey.get(item.key);
            if (copies) copies.push({ list: index, item });
            else byKey.set(item.key, [{ list: index, item }]);
        }
    });

    const items: GroupItem[] = [...byKey].map(([key, copies]) => {
        const scores = copies.map((copy) => copy.item.score);
        const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        // the standard deviation: same units as the scores, and one person far off counts for more than many slightly off
        const spread = Math.sqrt(scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length);
        return { key, name: copies[0]!.item.name, mean, spread, votes: copies.length, tier: nearestTier(mean, tiers.length), copies };
    });
    items.sort((a, b) => a.tier - b.tier || b.mean - a.mean || b.votes - a.votes || a.name.localeCompare(b.name));

    const meanOf = new Map(items.map((item) => [item.key, item]));
    const people: PersonFit[] = lists.map((list, index) => {
        const shared = list.items.filter((item) => (meanOf.get(item.key)?.votes ?? 0) > 1);
        const total = shared.reduce((sum, item) => sum + Math.abs(item.score - meanOf.get(item.key)!.mean), 0);
        return { list: index, ranked: list.items.length, compared: shared.length, distance: shared.length ? total / shared.length : null };
    });

    const packId = lists[0]?.packId ?? null;
    return {
        title: title ?? '',
        kind: lists[0]?.kind ?? 'custom',
        packId: lists.every((list) => list.packId === packId) ? packId : null,
        tiers,
        items,
        people,
    };
}

/** The person whose ranking was closest to the group's (the first of equals), or null if nobody could be compared. */
export function closestPerson(people: readonly PersonFit[]): PersonFit | null {
    let closest: PersonFit | null = null;
    for (const person of people)
        if (person.distance !== null && (closest === null || person.distance < closest.distance!)) closest = person;
    return closest;
}

/**
 * The items most agreed on (smallest spread first, then most votes) and most disagreed on
 * (largest spread first), at most `most` of each. Only items at least two people ranked count,
 * and no item is in both: with few items, the same ones heading both lists would say nothing.
 */
export function agreementExtremes(items: readonly GroupItem[], most: number): { agreed: GroupItem[]; disagreed: GroupItem[] } {
    const shared = items.filter((item) => item.votes > 1);
    const agreed = [...shared]
        .sort((a, b) => a.spread - b.spread || b.votes - a.votes || b.mean - a.mean)
        .slice(0, Math.min(most, Math.ceil(shared.length / 2)));
    const disagreed = shared
        .filter((item) => item.spread > 1e-9 && !agreed.includes(item))
        .sort((a, b) => b.spread - a.spread || b.votes - a.votes)
        .slice(0, most);
    return { agreed, disagreed };
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
