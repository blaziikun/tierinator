// src/core/defaults.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What a brand-new list looks like: its tiers, colours, theme and settings.
//  Plain data (plus the tiers you saved as your own default in this browser).
// ─────────────────────────────────────────────────────────────────────────────
import { isHexColor } from '../lib/color';
import { randomId } from '../lib/dom';
import type { ListState, SpriteFilters, Theme, Tier } from './types';

/** Your own items (and items from non-Pokémon packs) are numbered from here, far above any Pokémon id. */
export const OWN_ITEM_ID_START = 2_000_000;

type TierPreset = readonly (readonly [label: string, color: string])[];

/** A new list's tiers, unless you've saved your own (below). U is for "unranked-ish". */
export const DEFAULT_TIERS: TierPreset = [
    ['SS', '#fbdf46'],
    ['S', '#65e3f9'],
    ['A', '#a2e49f'],
    ['B', '#1b7540'],
    ['C', '#995f25'],
    ['D', '#fedeb2'],
    ['E', '#fb88a7'],
    ['F', '#d60003'],
    ['U', '#131416'],
];

// ── your own default tiers (Style → Tiers → "Use these tiers for new lists") ──
const MY_TIERS_KEY = 'pt_tiers';

/** The tiers you saved as your default in this browser, if any (checked: 1–30 tiers, names and colours). */
export function myDefaultTiers(): TierPreset | null {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(MY_TIERS_KEY) || 'null');
        if (!Array.isArray(saved) || !saved.length || saved.length > 30) return null;
        const tiers = saved.filter(
            (tier): tier is [string, string] => Array.isArray(tier) && typeof tier[0] === 'string' && isHexColor(tier[1]),
        );
        return tiers.length === saved.length ? tiers.map(([label, color]) => [label.slice(0, 40), color] as const) : null;
    } catch {
        return null;
    }
}

/** Makes these tiers (names and colours) the start of every new list; null goes back to the built-in ones. */
export function saveMyDefaultTiers(tiers: readonly Tier[] | null): void {
    try {
        if (tiers) localStorage.setItem(MY_TIERS_KEY, JSON.stringify(tiers.map((tier) => [tier.label, tier.color])));
        else localStorage.removeItem(MY_TIERS_KEY);
    } catch {}
}

/** The colour palette before you customise it. */
export const DEFAULT_SWATCHES: readonly string[] = [
    ...DEFAULT_TIERS.map((tier) => tier[1]),
    '#c9a227',
    '#74b9ff',
    '#6c5ce7',
    '#fd79a8',
    '#8a9096',
    '#ffffff',
];

/** Which sprite versions the studio and quick picker show to begin with ("Default" in Show ▾). */
export const DEFAULT_SPRITE_FILTERS: Readonly<SpriteFilters> = {
    shiny: true,
    back: false,
    female: true,
    forms: true,
    icons: true,
    tints: true,
    animated: true,
    go: true,
    costumes: true,
    pmd: false,
    emotions: false,
    lore: true,
    favs: false,
};

/** Fresh, empty tiers from your saved default, or the built-in one. */
export const makePresetTiers = (): Tier[] =>
    (myDefaultTiers() || DEFAULT_TIERS).map(([label, color]) => ({ id: randomId(), label, subtitle: '', color, items: [] }));

// ── charts: tiers laid out as a grid of cells ──
/** How many cells a chart can have across. */
export const CHART_COLUMNS = { min: 2, max: 6, start: 3 } as const;

/**
 * The classic alignment chart, row by row (good, neutral, evil; lawful → chaotic across).
 * Cool colours for lawful, warm for chaotic, darker going down, so every cell reads apart.
 */
export const ALIGNMENT_CHART: TierPreset = [
    ['Lawful good', '#74b9ff'],
    ['Neutral good', '#a2e49f'],
    ['Chaotic good', '#fbdf46'],
    ['Lawful neutral', '#b2bec3'],
    ['True neutral', '#e8dcc4'],
    ['Chaotic neutral', '#f5a25d'],
    ['Lawful evil', '#6c5ce7'],
    ['Neutral evil', '#995f25'],
    ['Chaotic evil', '#d60003'],
];

/**
 * The built-in look: quiet greys so the tier colours and the pictures carry the page. Every new
 * list starts with it; Style changes any of it, and variations are saved as your own themes.
 * (There used to be a light one too. Lists saved with it keep their colours: a theme is stored whole.)
 */
export const BUILT_IN_THEME: Omit<Theme, 'preset' | 'name'> = {
    bg: '#0b0b0c',
    panel: '#141416',
    text: '#ededee',
    muted: '#8c8c93',
    accent: '#ededee',
    hi: '#ffffff',
    fHead: 'Playfair Display',
    fUi: 'Instrument Sans',
    wLogo: 600,
    wLabel: 500,
    wHead: 500,
    wUi: 400,
    logo: 'text',
    radius: 3,
    ls: -0.02,
    tt: 'none',
    fs: 13,
    fsLogo: 20,
    fsLabel: 16,
    lw: 88,
    gap: 2,
    rowBg: '',
    tint: 0.06,
    lblColor: '',
    lblFs: 7,
    lblGap: 0,
    tagDots: true,
};
/** The theme fields a theme file can set (everything except its name). */
export const THEME_KEYS = Object.keys(BUILT_IN_THEME) as (keyof typeof BUILT_IN_THEME)[];
export const DEFAULT_THEME: Theme = { preset: 'default', name: 'Tierinator', ...BUILT_IN_THEME };

/** On a phone the pool goes under the tiers: beside them it would leave each half too narrow to use. */
const isNarrowScreen = (): boolean => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;

/** A fresh list's settings: layout, sizes and which sprites to show. */
export function createListState(): ListState {
    return {
        notes: {},
        packId: null,
        familyOf: {},
        combinedFamilies: {},
        theme: { ...DEFAULT_THEME },
        tiers: [],
        layout: 'tiers',
        chartColumns: CHART_COLUMNS.start,
        tileSize: 88,
        tileShape: 'square',
        tileFit: 'contain',
        labelMode: 'off',
        showHoverInfo: true,
        topBarHidden: false,
        poolAsSidebar: !isNarrowScreen(),
        exportOptions: {
            labelMode: 'off',
            imageSize: 128,
            includeEmptyTiers: false,
            includeNotes: false,
            includeTitle: true,
            includeUnranked: false,
            includeCredit: true,
        },
        trimSprites: true,
        studioCardSize: 112,
        spriteFilters: { ...DEFAULT_SPRITE_FILTERS },
        poolHidden: false,
        tags: {},
        tagFilter: 'all',
        kind: 'custom',
        favouriteSprites: {},
        ownItems: [],
        nextItemId: OWN_ITEM_ID_START,
        splitFormCategories: { regional: true, mega: true, gmax: true, battle: true, cosmetic: false },
        formOverrides: {},
        poolTileSize: 76,
        poolHeight: 397,
        poolWidth: 279,
        poolOrder: { by: 'added', seed: 0 },
        picks: {},
        selection: new Set(),
        selectionSource: null,
        searchQuery: '',
        generationFilter: 'all',
        typeFilter: 'all',
        view: 'tier',
    };
}
