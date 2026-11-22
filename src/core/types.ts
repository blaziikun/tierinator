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
import type { BoardList, Crop, ItemId } from 'tier-engine/core';

// ═════════════════════════════════════════════════════════════════════════════
//  1. A LIST IN MEMORY
// ═════════════════════════════════════════════════════════════════════════════

// The shapes every app on the engine shares (tier-engine/core). Ids: Pokédex numbers for Pokémon, 2 000 000+ for your own items.
export type {
    BoardLayout,
    Crop,
    ItemId,
    LabelMode,
    Pick,
    PoolSortBy,
    Tier,
    TileFit,
    TileShape,
} from 'tier-engine/core';

export type ListKind = 'pokemon' | 'custom';

/** How Pokémon forms are grouped (see pokemon/forms.ts). */
export type FormCategory = 'mega' | 'gmax' | 'regional' | 'battle' | 'cosmetic';

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
    /** "#025" on Pokémon (shown before the name when labels show numbers); '' for your own items. */
    code?: string;
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

/** Everything about the open list: the board's part (tier-engine/core BoardList), Tierinator's own fields, and the screen settings saved with it. */
export interface ListState extends BoardList {
    /** Id of the non-Pokémon pack this list was made from. */
    packId: string | null;
    /** Variant → the main item of its family. */
    familyOf: Record<string, ItemId>;
    /** Families shown as one combined entry (main item → true). */
    combinedFamilies: Record<string, true>;
    theme: Theme;
    showHoverInfo: boolean;
    topBarHidden: boolean;
    poolAsSidebar: boolean;
    exportOptions: ExportOptions;
    trimSprites: boolean;
    /** Card size in the Sprite Studio, in px. */
    studioCardSize: number;
    spriteFilters: SpriteFilters;
    poolHidden: boolean;
    tagFilter: string;
    kind: ListKind;
    /** Starred sprite paths per Pokémon. */
    favouriteSprites: Record<string, string[]>;
    ownItems: OwnItem[];
    nextItemId: ItemId;
    splitFormCategories: Record<FormCategory, boolean>;
    /** Forms split out (true) or kept merged (false) individually. */
    formOverrides: Record<string, boolean>;
    poolHeight: number;
    poolWidth: number;
    searchQuery: string;
    /** Pokémon lists: which Pokémon the pool and the tiers show (not saved). */
    focus: Focus;
    /** Pokémon lists: the saved grids (Grid view), and which one is open. */
    grids: SavedGrid[];
    gridId: string | null;
    view: 'tier' | 'grid' | 'studio';
}

/** What a Pokémon can be sorted by: the Focus bar's facets and the grid's axes (pokemon/facets.ts). */
export type FacetKey = 'type' | 'gen' | 'stage' | 'group' | 'form';

/**
 * Which Pokémon to show. Within a facet any value matches (Electric or Ghost); across facets all must
 * (Electric, and from Gen 4). `only` narrows it to set items, such as one grid cell's.
 */
export type Focus = Partial<Record<FacetKey, string[]>> & { only?: { ids: ItemId[]; label: string } };

/** One saved grid: what runs down and across, an optional layer, its own focus, and the cells you pinned. */
export interface SavedGrid {
    id: string;
    name: string;
    rows: FacetKey;
    /** Which of the facet's values to show; empty means all. */
    rowValues: string[];
    /** Null: a single column (your favourite per row). */
    cols: FacetKey | null;
    colValues: string[];
    /** A third facet seen one value at a time, like slices of a cube. */
    layer: FacetKey | null;
    /** The slice shown; null shows them all together. */
    layerValue: string | null;
    focus: Focus;
    /** Your own pick for a cell, whatever the ranking says ("layer|row|col" → item). */
    pins: Record<string, ItemId>;
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
