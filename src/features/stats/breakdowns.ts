// src/features/stats/breakdowns.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The numbers behind Stats. A breakdown sorts every ranked item into values
//  (Type → Fire, Water…; Generation → Gen 1…), then counts each value per tier and
//  scores it by average tier: the top tier scores 100, the bottom tier 0.
// ─────────────────────────────────────────────────────────────────────────────
import { entryById, rankableEntries } from '../../core/items';
import { isPokemonList, state } from '../../core/state';
import type { Entry, FormCategory, ItemId, Tier } from '../../core/types';
import { describeSpriteDir, findLoreEntry, parseGoIcon, spriteDirByPath } from '../../pokemon/data';
import { picturesOf } from '../items/items';
import { genericPacks } from '../packs/packs';
import { allTags, tagColor } from '../tags/tags';
import { BODY_COLOR_NAMES, baseStatTotal, bodyColor, CATEGORY_NAMES, evolutionStage, STAGE_NAMES, specialCategory } from './pokedex-extras';

export interface Breakdown {
    key: string;
    label: string;
    /** The values an item counts for (none = left out; several = counted for each). */
    valuesOf(id: ItemId): string[];
    colorOf?(value: string): string | undefined;
    /** Display order (values not in it go last). */
    order?: readonly string[];
    tipOf?(value: string): string;
    note?: string;
    /** Only ranked items have this (sprite source…), so "how many done" makes no sense. */
    rankedOnly?: boolean;
}

/** How a breakdown sees the list: the toggles on the stats page. */
export const statsOptions = {
    /** Type: count only a Pokémon's first type. */
    firstTypeOnly: false,
};

// ═════════════════════════════════════════════════════════════════════════════
//  NAMES AND COLOURS
// ═════════════════════════════════════════════════════════════════════════════

const TYPE_ORDER = [
    'Normal',
    'Fire',
    'Water',
    'Grass',
    'Electric',
    'Ice',
    'Fighting',
    'Poison',
    'Ground',
    'Flying',
    'Psychic',
    'Bug',
    'Rock',
    'Ghost',
    'Dragon',
    'Dark',
    'Steel',
    'Fairy',
];
const TYPE_COLORS: Record<string, string> = {
    Normal: '#9fa19f',
    Fire: '#e62829',
    Water: '#2980ef',
    Grass: '#3fa129',
    Electric: '#fac000',
    Ice: '#3dcef3',
    Fighting: '#ff8000',
    Poison: '#9141cb',
    Ground: '#915121',
    Flying: '#81b9ef',
    Psychic: '#ef4179',
    Bug: '#91a119',
    Rock: '#afa981',
    Ghost: '#704170',
    Dragon: '#5060e1',
    Dark: '#624d4e',
    Steel: '#60a1b8',
    Fairy: '#ef70ef',
};
const CATEGORY_COLORS: Record<string, string> = {
    Regular: '#8b93a7',
    'Starter line': '#4dabf7',
    'Pseudo-legendary line': '#748ffc',
    Paradox: '#e64980',
    'Ultra Beast': '#22b8cf',
    Legendary: '#fab005',
    'Box legend': '#ff6b6b',
    Mythical: '#da77f2',
};
const CATEGORY_TIPS: Record<string, string> = {
    'Box legend':
        'Restricted / box legends: Mewtwo, Lugia, Ho-Oh, Kyogre, Groudon, Rayquaza, Dialga, Palkia, Giratina, Reshiram, Zekrom, Kyurem, Xerneas, Yveltal, Zygarde, Cosmog, Cosmoem, Solgaleo, Lunala, Necrozma, Zacian, Zamazenta, Eternatus, Calyrex, Koraidon, Miraidon, Terapagos',
    Legendary: 'Other legendaries (birds, beasts, Regis, lake trio, Tapus, Treasures of Ruin, Loyal Three…)',
    Mythical: 'Mew, Celebi, Jirachi, Deoxys… Pecharunt',
    'Pseudo-legendary line': 'Dratini, Larvitar, Bagon, Beldum, Gible, Deino, Goomy, Jangmo-o, Dreepy and Frigibax lines',
    'Starter line': 'All the starter Pokémon and their evolutions, Gen 1–9',
    Paradox: 'Great Tusk … Iron Crown',
    'Ultra Beast': 'Nihilego … Blacephalon',
};
const BODY_COLORS: Record<string, string> = {
    Black: '#444',
    Blue: '#3b82f6',
    Brown: '#9a6233',
    Gray: '#9ca3af',
    Green: '#22a35a',
    Pink: '#f472b6',
    Purple: '#8b5cf6',
    Red: '#ef4444',
    White: '#e8e8ee',
    Yellow: '#facc15',
};
const FORM_KIND_NAMES: Record<FormCategory, string> = {
    mega: 'Mega Evolution',
    gmax: 'Gigantamax',
    regional: 'Regional form',
    battle: 'Battle form',
    cosmetic: 'Cosmetic form',
};
const STAT_TOTAL_BANDS = ['Under 300', '300–399', '400–499', '500–599', '600+'];
const SPRITE_STYLES = ['Standard', 'Shiny', 'Animated', 'Back view', 'Female', 'Icon', 'Costume', 'Retro tint'];
/** Colours for values without their own. */
export const CHART_PALETTE = [
    '#ff6b6b',
    '#ffa94d',
    '#ffd43b',
    '#69db7c',
    '#38d9a9',
    '#4dabf7',
    '#748ffc',
    '#b197fc',
    '#f783ac',
    '#63e6be',
    '#a9e34b',
    '#ffc078',
    '#91a7ff',
    '#e599f7',
    '#74c0fc',
    '#ced4da',
];

/** "Nth of these colours", for values in a fixed order. */
const colorByPosition = (order: readonly string[], colors: string[]) => (value: string) => colors[order.indexOf(value)];

// ═════════════════════════════════════════════════════════════════════════════
//  WHERE EACH PICTURE COMES FROM
// ═════════════════════════════════════════════════════════════════════════════

interface SpriteInfo {
    /** "PokeAPI games", "Pokémon GO", "Your pictures"… */
    source: string;
    /** The game or set: "Black / White", "Lore: Detective Pikachu"… */
    game: string;
    style: string[];
}

/** Sprite info is asked for many times per page; this remembers it while one page is drawn. */
let spriteInfoCache: Map<ItemId, SpriteInfo> | null = null;
export function withSpriteInfoCache<T>(draw: () => T): T {
    spriteInfoCache = new Map();
    try {
        return draw();
    } finally {
        spriteInfoCache = null;
    }
}

function spriteInfo(id: ItemId): SpriteInfo {
    const known = spriteInfoCache?.get(id);
    if (known) return known;
    const info = computeSpriteInfo(id);
    spriteInfoCache?.set(id, info);
    return info;
}

const same = (name: string, style: string[] = []): SpriteInfo => ({ source: name, game: name, style });

function computeSpriteInfo(id: ItemId): SpriteInfo {
    const entry = entryById.get(id);
    const pick = state.picks[id];
    const path = pick?.path;
    if (!entry || entry.custom) {
        if (pick?.text) return same('Text only');
        if (!path) return same('No picture');
        if (/^(custom|gal:|xp:)/.test(path)) return same('Your pictures');
        const choice = picturesOf(id).find((other) => other.url === path);
        const group = choice ? choice.group.replace(/^Variant: .*/, 'Variant pictures') : 'Other sources';
        return { source: group, game: choice?.label ? group + ': ' + choice.label : group, style: [] };
    }
    if (!path) return same('Default sprite', ['Standard']);
    if (/^(custom|gal:|xp:)/.test(path)) return same('Your own images', ['Standard']);
    if (/^https?:/.test(path)) return same('Image link', ['Standard']);
    if (path.startsWith('go:')) {
        const icon = parseGoIcon(path.slice(3));
        const style = [icon.shiny && 'Shiny', icon.costume && 'Costume', icon.female && 'Female'].filter((s): s is string => !!s);
        return same('Pokémon GO', style.length ? style : ['Standard']);
    }
    if (path.startsWith('pmd:')) {
        const parts = path.slice(4).split('/');
        return {
            source: 'Mystery Dungeon',
            game: 'Mystery Dungeon portraits',
            style: [parts.length === 4 && parts[1] === '0000' ? 'Shiny' : 'Standard'],
        };
    }
    if (path.startsWith('lore:')) {
        const lore = findLoreEntry(path);
        return { source: 'Lore & spin-offs', game: lore ? 'Lore: ' + lore[1][1] : 'Lore & spin-offs', style: ['Standard'] };
    }
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const info = spriteDirByPath.get(folder)?.info ?? describeSpriteDir(folder);
    const parts = folder.split('/');
    const section = info.sec.replace(/\s*\(.*\)$/, '');
    const flags = info.flags;
    const style = [
        flags.shiny && 'Shiny',
        flags.animated && 'Animated',
        flags.back && 'Back view',
        flags.female && 'Female',
        flags.icon && 'Icon',
        flags.tint && 'Retro tint',
    ].filter((s): s is string => !!s);
    return {
        source: parts[0] === 'versions' ? section.split(': ')[0] + ' games' : section,
        game: section + (parts[0] === 'other' && parts[2] === 'versions' && info.tags[0] ? ': ' + info.tags[0] : ''),
        style: style.length ? style : ['Standard'],
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE BREAKDOWNS
// ═════════════════════════════════════════════════════════════════════════════

/** Everything the open list can be broken down by. */
export function breakdowns(): Breakdown[] {
    const list: Breakdown[] = [];
    const pokemon = isPokemonList();
    const asPokemon = (id: ItemId): Entry | null => {
        const entry = entryById.get(id);
        return entry && !entry.custom ? entry : null;
    };
    const one = (value: string | null | undefined): string[] => (value ? [value] : []);

    if (pokemon) {
        list.push(
            {
                key: 'type',
                label: 'Type',
                valuesOf: (id) => {
                    const types = asPokemon(id)?.types ?? [];
                    return statsOptions.firstTypeOnly ? types.slice(0, 1) : types;
                },
                colorOf: (value) => TYPE_COLORS[value],
                order: TYPE_ORDER,
            },
            {
                key: 'gen',
                label: 'Generation',
                valuesOf: (id) => one(asPokemon(id)?.gen ? 'Gen ' + asPokemon(id)!.gen : null),
                order: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'Gen ' + n),
                note: 'A regional form or Mega counts for the generation it was introduced in.',
            },
            {
                key: 'stage',
                label: 'Evolution stage',
                valuesOf: (id) => one(evolutionStage(asPokemon(id))),
                order: STAGE_NAMES,
                colorOf: colorByPosition(STAGE_NAMES, ['#8b93a7', '#f783ac', '#69db7c', '#4dabf7', '#b197fc']),
                note: 'Babies (Pichu, Munchlax…) are their own group, so Pikachu counts as a first stage. Forms and Megas count as their species.',
            },
            {
                key: 'cat',
                label: 'Legendary & special',
                valuesOf: (id) => one(specialCategory(asPokemon(id))),
                order: CATEGORY_NAMES,
                colorOf: (value) => CATEGORY_COLORS[value],
                tipOf: (value) => CATEGORY_TIPS[value] || '',
                note: 'Each Pokémon is in one group. "Box legend" means the restricted legendaries (hover a name for the full list).',
            },
            {
                key: 'form',
                label: 'Forms',
                valuesOf: (id) => {
                    const entry = asPokemon(id);
                    return entry ? [entry.form ? FORM_KIND_NAMES[entry.form] || 'Other form' : 'Standard'] : [];
                },
                order: ['Standard', ...Object.values(FORM_KIND_NAMES)],
            },
            {
                key: 'dual',
                label: 'Single or dual type',
                valuesOf: (id) => {
                    const entry = asPokemon(id);
                    return entry ? [entry.types.length > 1 ? 'Dual type' : 'Single type'] : [];
                },
                order: ['Single type', 'Dual type'],
                colorOf: (value) => (value === 'Dual type' ? '#748ffc' : '#ffa94d'),
            },
            {
                key: 'body',
                label: 'Body colour',
                valuesOf: (id) => one(bodyColor(asPokemon(id))),
                order: BODY_COLOR_NAMES.slice(1),
                colorOf: (value) => BODY_COLORS[value],
                note: 'The official Pokédex colour of each species.',
            },
            {
                key: 'bst',
                label: 'Base stat total',
                valuesOf: (id) => {
                    const total = baseStatTotal(asPokemon(id));
                    return total == null ? [] : [STAT_TOTAL_BANDS[Math.min(4, Math.max(0, Math.floor(total / 100) - 2))]!];
                },
                order: STAT_TOTAL_BANDS,
                colorOf: colorByPosition(STAT_TOTAL_BANDS, ['#8b93a7', '#69db7c', '#4dabf7', '#b197fc', '#ff6b6b']),
            },
        );
    }
    list.push({
        key: 'ssrc',
        label: pokemon ? 'Sprite source' : 'Picture group',
        valuesOf: (id) => [spriteInfo(id).source],
        rankedOnly: true,
        note: pokemon
            ? 'Where the sprite you picked comes from. "Default sprite" means you never changed it.'
            : "Which group each item's chosen picture comes from.",
    });
    if (pokemon)
        list.push(
            { key: 'sgame', label: 'Sprite game / set', valuesOf: (id) => [spriteInfo(id).game], rankedOnly: true },
            { key: 'sstyle', label: 'Sprite style', valuesOf: (id) => spriteInfo(id).style, rankedOnly: true, order: SPRITE_STYLES },
        );

    // a pack's own filters (Attribute, Series…), then any other tags
    const facets = state.packId ? genericPacks.get(state.packId)?.facets : undefined;
    for (const [facet, values] of Object.entries(facets || {}))
        list.push({
            key: 'f:' + facet,
            label: facet,
            valuesOf: (id) => (state.tags[id] || []).filter((tag) => values.includes(tag)),
            colorOf: tagColor,
            order: values,
        });
    const inFacets = new Set(Object.values(facets || {}).flat());
    if (allTags().some(([tag]) => !inFacets.has(tag)))
        list.push({ key: 'tags', label: facets ? 'All tags' : 'Tags', valuesOf: (id) => state.tags[id] || [], colorOf: tagColor });
    return list;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COUNTING
// ═════════════════════════════════════════════════════════════════════════════

/** The top tier scores 100, the last one 0. */
const tierScore = (index: number): number => {
    const count = state.tiers.length;
    return count > 1 ? ((count - 1 - index) / (count - 1)) * 100 : 100;
};

/** The tier an average score falls in. */
export const tierAtScore = (average: number): Tier => {
    const count = state.tiers.length;
    return state.tiers[Math.max(0, Math.min(count - 1, Math.round((1 - average / 100) * (count - 1))))]!;
};

export interface ValueStats {
    value: string;
    /** How many ranked items have it. */
    count: number;
    /** …in each tier. */
    perTier: number[];
    /** How many unranked ones (still in the pool) have it. */
    inPool: number;
    /** Average tier score (0–100). */
    average: number;
    /** Ranked items with it, best tier first. */
    ids: ItemId[];
}

export interface BreakdownResult {
    values: ValueStats[];
    /** Most common first. */
    byCount: ValueStats[];
    /** In the breakdown's own order (or by count). */
    byOrder: ValueStats[];
    colors: Map<string, string>;
    ranked: number;
    /** Ranked items without any value. */
    without: number;
    /** Some items count for several values. */
    multiple: boolean;
    /** Values with fewer ranked than this are "too few to count" as favourites. */
    minimumCount: number;
    /** Highest average tier first (values with enough ranked first). */
    favourites: ValueStats[];
    /** Items in each tier. */
    tierSizes: number[];
}

export function computeBreakdown(breakdown: Breakdown): BreakdownResult {
    const tierCount = state.tiers.length;
    const tierOf = new Map<ItemId, number>();
    state.tiers.forEach((tier, index) => {
        tier.items.forEach((id) => {
            if (entryById.has(id) && !tierOf.has(id)) tierOf.set(id, index);
        });
    });
    const byValue = new Map<string, ValueStats & { scoreSum: number }>();
    const statsFor = (value: string) => {
        let stats = byValue.get(value);
        if (!stats) {
            stats = { value, count: 0, perTier: Array<number>(tierCount).fill(0), inPool: 0, average: 0, ids: [], scoreSum: 0 };
            byValue.set(value, stats);
        }
        return stats;
    };
    let without = 0;
    let multiple = false;
    for (const [id, tierIndex] of tierOf) {
        const values = [...new Set(breakdown.valuesOf(id))];
        if (!values.length) {
            without++;
            continue;
        }
        if (values.length > 1) multiple = true;
        for (const value of values) {
            const stats = statsFor(value);
            stats.count++;
            stats.perTier[tierIndex]!++;
            stats.scoreSum += tierScore(tierIndex);
            stats.ids.push(id);
        }
    }
    if (!breakdown.rankedOnly)
        for (const entry of rankableEntries())
            if (!tierOf.has(entry.id)) for (const value of new Set(breakdown.valuesOf(entry.id))) statsFor(value).inPool++;

    const values = [...byValue.values()].map(({ scoreSum, ...stats }) => ({ ...stats, average: stats.count ? scoreSum / stats.count : 0 }));
    const position = breakdown.order ? new Map(breakdown.order.map((value, index) => [value, index])) : null;
    const byCount = [...values].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const colors = new Map<string, string>();
    byCount.forEach((stats, index) => {
        colors.set(
            stats.value,
            breakdown.colorOf?.(stats.value) || CHART_PALETTE[(position?.get(stats.value) ?? index) % CHART_PALETTE.length]!,
        );
    });
    const byOrder = position
        ? [...values].sort((a, b) => (position.get(a.value) ?? 999) - (position.get(b.value) ?? 999) || b.count - a.count)
        : byCount;
    const ranked = tierOf.size;
    const minimumCount = ranked >= 60 ? 3 : 2;
    const enough = (stats: ValueStats) => Number(stats.count >= minimumCount);
    const favourites = values
        .filter((stats) => stats.count)
        .sort((a, b) => enough(b) - enough(a) || b.average - a.average || b.count - a.count);
    return {
        values,
        byCount,
        byOrder,
        colors,
        ranked,
        without,
        multiple,
        minimumCount,
        favourites,
        tierSizes: state.tiers.map((tier) => tier.items.filter((id) => entryById.has(id)).length),
    };
}
