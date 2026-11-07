// src/core/types.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The shapes of the app's data, in one place. Every module that holds or
//  passes this data uses these types, so a wrong field name or a missing value
//  is caught while typing instead of breaking a list later.
//
//  Two groups:
//    1. what a list is made of in memory (Tier, Pick, Entry, ListState…)
//    2. what pack files look like on disk (PokemonPack, GenericPack)
// ─────────────────────────────────────────────────────────────────────────────
import type { Crop } from '../lib/images';

// ═════════════════════════════════════════════════════════════════════════════
//  1. A LIST IN MEMORY
// ═════════════════════════════════════════════════════════════════════════════

/** Every rankable thing has a number: Pokédex-style ids for Pokémon, 2 000 000+ for your own items. */
export type ItemId = number;

export type ListKind = 'pokemon' | 'custom';

/** How Pokémon forms are grouped (see pokemon/forms.ts). */
export type FormCategory = 'mega' | 'gmax' | 'regional' | 'battle' | 'cosmetic';

/** Part of a picture to show. Defined in lib/images.ts, which measures pictures and can't import from here. */
export type { Crop };

/** One picture an item of yours could show (from its pack, wiki, the web, or your uploads). */
export interface PictureChoice {
    /** Heading it's listed under ("Versions", "Your pictures", "Search: Wikipedia"…). */
    group: string;
    url: string;
    label: string;
    /** One of your uploaded pictures: its key in extraPictures. */
    extraKey?: string;
    /** A variant's current picture: that variant's id. */
    variantId?: ItemId;
}

/** The picture chosen for an item. Saved inside lists and backups exactly like this. */
export interface Pick {
    /** Where it came from: a PokeAPI path, 'go:…', 'pmd:…', 'lore:…', 'gal:…', 'xp:…', 'custom' or an https URL. */
    path: string;
    /** 1 = already checked for animation (older picks get checked once and repaired). */
    ck?: 1;
    /** Transparent edges were cut off when it was saved. */
    trim?: boolean;
    /** Animated (GIF/APNG/WebP): never re-encoded, cropped on screen instead. */
    anim?: boolean;
    crop?: Crop;
    /** Shown straight from this web address (the site won't let the app copy the picture). */
    remote?: string;
    /** 1 = a text tile made from the item's name. */
    text?: 1;
    /** Left over from the removed background-removal feature; cleared on load. */
    bg?: unknown;
    keepbg?: unknown;
    bgck?: unknown;
}

export interface Tier {
    id: string;
    label: string;
    /** Small second line under the label. */
    subtitle: string;
    color: string;
    /** Label text colour; empty = automatic. */
    textColor?: string;
    items: ItemId[];
}

/** Where an item's wiki page lives: the wiki's API address and the page title. */
export interface WikiRef {
    a: string;
    t: string;
}

/** One version of an item that was merged from several (label, wiki page, picture). */
export interface ItemVersion {
    l: string;
    t?: string;
    u?: string;
}

/**
 * Who made a picture from Wikimedia and under which licence (CC BY and the like ask to be
 * credited). It belongs to that one picture: shown only while the item still shows it.
 */
export interface PictureCredit {
    /** The file's name on Wikimedia Commons or Wikipedia, without "File:" ("Pluto in true colour.jpg"). */
    file: string;
    /** The author, as plain text. */
    by?: string;
    /** The licence's short name ("CC BY-SA 4.0"). */
    licence?: string;
}

/** Something you added yourself, or that came from a non-Pokémon pack. */
export interface OwnItem {
    id: ItemId;
    name: string;
    w?: WikiRef;
    credit?: PictureCredit;
    /** Other picture addresses found for it. */
    alts?: string[];
    /** Pack row reference: "packId:row". */
    pk?: string;
    /** Extra pack rows merged into this item: [reference, version label]. */
    pkx?: [string, string][];
    vars?: ItemVersion[];
}

/** One rankable entry of the open list: a Pokémon, a form, or one of your items. */
export interface Entry {
    id: ItemId;
    /** National Pokédex number; null for your own items. */
    dex: number | null;
    name: string;
    /** Generation it was introduced in; 0 for your own items. */
    gen: number;
    types: string[];
    /** Name in lower case, for search. */
    lc: string;
    form: FormCategory | null;
    /** PokeAPI's identifier for a form ("venusaur-mega"). */
    ident?: string;
    custom?: true;
    /** Names of its grouped variants, for search. */
    alias?: string;
    /** Tags of its grouped variants. */
    ftags?: string[];
    nvar?: number;
}

/** Which kinds of sprite the Sprite Studio shows. */
export interface SpriteFilters {
    shiny: boolean;
    back: boolean;
    female: boolean;
    forms: boolean;
    icons: boolean;
    tints: boolean;
    animated: boolean;
    go: boolean;
    costumes: boolean;
    pmd: boolean;
    emotions: boolean;
    lore: boolean;
    /** Show only the sprites you starred. */
    favs: boolean;
}

export interface ExportOptions {
    labelMode: 'off' | 'name' | 'num' | 'both';
    imageSize: number;
    includeEmptyTiers: boolean;
    includeNotes: boolean;
    /** The list's name as a heading above the tiers. */
    includeTitle: boolean;
    /** The pool's items, under the tiers. */
    includeUnranked: boolean;
    /** "Made with …" in a corner, small: how people find the site from a shared picture. */
    includeCredit: boolean;
}

/** How the app looks. Saved with each list and in your theme library (keys kept short for old files). */
export interface Theme {
    /** Which saved theme this started from ('default' = the built-in one). */
    preset?: string;
    /** Site name shown as the logo. */
    name: string;
    /** Colours: page background, panels, text, secondary text, accent (buttons), highlight (search hits). */
    bg: string;
    panel: string;
    text: string;
    muted: string;
    accent: string;
    hi: string;
    /** Fonts (Google Fonts names) for headings/labels and for everything else. */
    fHead: string;
    fUi: string;
    /** Font weights: logo, tier labels, headings, everything else. */
    wLogo: number;
    wLabel: number;
    wHead: number;
    wUi: number;
    /** Logo style: two colours, gradient, accent colour or plain text. */
    logo: string;
    /** Corner rounding in px. */
    radius: number;
    /** Tier label letter spacing (em) and case (CSS text-transform). */
    ls: number;
    tt: string;
    /** Font sizes in px: interface, logo, tier labels. */
    fs: number;
    fsLogo: number;
    fsLabel: number;
    /** Tier label column width and the gap between tier rows, in px. */
    lw: number;
    gap: number;
    /** Tier row background ('' = tinted from the tier colour) and how strong that tint is (0–1). */
    rowBg: string;
    tint: number;
    /** Name labels under sprites: colour ('' = automatic), size and spacing in px. */
    lblColor: string;
    lblFs: number;
    lblGap: number;
    /** Show coloured tag dots on tiles. */
    tagDots: boolean;
}

export type LabelMode = 'off' | 'name' | 'num' | 'both';

/** How the tiers are laid out: full-width rows, or a chart (a grid of labelled cells, each one a tier). */
export type BoardLayout = 'tiers' | 'chart';

/** A tile's shape: square, a poster or book cover (2:3), or a video thumbnail or screenshot (16:9). */
export type TileShape = 'square' | 'portrait' | 'landscape';
/** How a picture sits in its tile: whole, with space around it, or filling the tile and cropped to its centre. */
export type TileFit = 'contain' | 'cover';

/** How the pool is ordered on screen (the saved order and the ranking never change). */
export type PoolSortBy = 'added' | 'az' | 'za' | 'shuffled';
/** The pool's order; `seed` makes a shuffle the same each time the pool is drawn, until it's chosen again. */
export interface PoolOrder {
    by: PoolSortBy;
    seed: number;
}

/** Everything about the open list, plus the screen settings saved with it. */
export interface ListState {
    notes: Record<string, string>;
    /** Id of the non-Pokémon pack this list was made from. */
    packId: string | null;
    /** Variant → the main item of its family. */
    familyOf: Record<string, ItemId>;
    /** Families shown as one combined entry (main item → true). */
    combinedFamilies: Record<string, true>;
    theme: Theme;
    tiers: Tier[];
    layout: BoardLayout;
    /** Cells across a chart (2–6). */
    chartColumns: number;
    /** Sprite size in the tiers, in px. */
    tileSize: number;
    tileShape: TileShape;
    tileFit: TileFit;
    labelMode: LabelMode;
    showHoverInfo: boolean;
    topBarHidden: boolean;
    poolAsSidebar: boolean;
    exportOptions: ExportOptions;
    trimSprites: boolean;
    /** Card size in the Sprite Studio, in px. */
    studioCardSize: number;
    spriteFilters: SpriteFilters;
    poolHidden: boolean;
    tags: Record<string, string[]>;
    tagFilter: string;
    kind: ListKind;
    /** Starred sprite paths per Pokémon. */
    favouriteSprites: Record<string, string[]>;
    ownItems: OwnItem[];
    nextItemId: ItemId;
    splitFormCategories: Record<FormCategory, boolean>;
    /** Forms split out (true) or kept merged (false) individually. */
    formOverrides: Record<string, boolean>;
    /** Sprite size in the pool, in px. */
    poolTileSize: number;
    poolHeight: number;
    poolWidth: number;
    poolOrder: PoolOrder;
    picks: Record<string, Pick>;
    selection: Set<ItemId>;
    /** Where the selection is: 'pool', a tier id, or 'mixed'. */
    selectionSource: string | null;
    searchQuery: string;
    generationFilter: string;
    typeFilter: string;
    view: 'tier' | 'studio';
}

/** One row of the list menu (the list itself is stored separately under its id). */
export interface ListMeta {
    id: string;
    name: string;
    kind: ListKind;
    updated: number;
    count?: number;
    /** Pack the list was made from (non-Pokémon lists). */
    pack?: string;
    /** Opened from a share link and not kept yet: dropped unless you keep it. */
    preview?: true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  2. PACK FILES
// ═════════════════════════════════════════════════════════════════════════════

/** [id, name, generation, types] */
export type RosterRow = [ItemId, string, number, string[]];
/** [id, species id, name, generation, types (null = same as species), category, PokeAPI identifier] */
export type FormRow = [ItemId, number, string, number, string[] | null, FormCategory, string];

/** Where every PokeAPI sprite lives, packed small. */
export interface SpriteIndex {
    /** [folder, file extension] */
    dirs: [string, string][];
    /** Lists of folder numbers that share the same files. */
    sets: number[][];
    /** Species → [file stem, form name, sprite-set index] */
    sp: Record<string, [string, string, number][]>;
}

/** Mystery Dungeon portraits. */
export interface PmdIndex {
    /** Emotion names, in bit order. */
    emo: string[];
    /** Species → [bit mask of emotions, bit mask of shiny emotions] */
    d: Record<string, [number, number]>;
    /** Species → forms: [folder, form name, emotion bit mask] */
    f: Record<string, [string, string, number][]>;
}

/** [label, source, file name, archive hash, 1 = a scene with a background] */
export type LoreRow = [label: string, source: string, file: string, hash: string, hasBackground?: 1];

/** pokemon.json: everything the app knows about Pokémon (no artwork: sprites load from PokeAPI). */
export interface PokemonPack {
    type: 'tierpack';
    id: 'pokemon';
    name: string;
    version: string;
    about?: string;
    roster: RosterRow[];
    forms: FormRow[];
    index: SpriteIndex;
    /** Pokémon GO icon file stems per species. */
    go: Record<string, string[]>;
    pmd: PmdIndex;
    lore?: Record<string, LoreRow[]>;
    /** Old packs only: default sprites as base64 PNGs. */
    def?: Record<string, string>;
    /** Crop box [x, y, w, h] of each default sprite inside its defSize × defSize PokeAPI picture. */
    defCrop?: Record<string, [number, number, number, number]>;
    defSize?: number;
    /** Sprites picked by whoever exported the pack. */
    defaults?: Record<string, { path?: string; img?: string; crop?: Crop }>;
    /** Starred sprites of whoever exported the pack. */
    favs?: Record<string, string[]>;
    by?: string;
}

/** [group index, picture source, label?] */
export type PackPicture = [number, string, string?];
/** [name, tags, pictures, wiki title, index of the row it is a variant of] */
export type PackRow = [string, string[], PackPicture[], string?, number?];

/** Format 2 packs: any franchise (Bakugan, Beyblade…), often built from a wiki. */
export interface GenericPack {
    type: 'tierpack';
    format: 2;
    id: string;
    name: string;
    noun?: string;
    version?: string;
    about?: string;
    source?: { name?: string; url?: string; api?: string };
    /** Prefix and suffix added to relative picture sources. */
    base?: string;
    thumb?: string;
    groups?: string[];
    /** Filter name → its values (values are also item tags). */
    facets?: Record<string, string[]>;
    /** Which facet colours the dots on tiles. */
    dots?: string;
    colors?: Record<string, string>;
    items: PackRow[];
}
