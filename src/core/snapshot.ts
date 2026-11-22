// src/core/snapshot.ts
// ─────────────────────────────────────────────────────────────────────────────
//  A list as it is stored: in this browser (localStorage "ptl_<id>"), in saved
//  .json files, in bundles and backups. The format is version 10, and it never
//  changes shape without a migration, so every file anyone ever saved still loads.
//
//  The engine (tier-engine/core writeList / readList) writes and checks the
//  board's fields: tiers, pictures, notes, tags, layout, tiles, labels, the
//  pool's order. This adds Tierinator's own beside them in the same object
//  (kind, pack, own items, variant families, the look, Pokémon settings, grids)
//  and checks those. The in-memory names (core/types.ts ListState) are clearer
//  than the stored keys; this is where they're translated.
// ─────────────────────────────────────────────────────────────────────────────
import {
    clamp,
    isHexColor,
    isPicturePath,
    isRecord,
    type ReadContext,
    readTiers as readBoardTiers,
    readList,
    type StoredBoard,
    type StoredTier,
    writeList,
} from 'tier-engine/core';
import { DEFAULT_SPRITE_FILTERS } from './defaults';
import { readGrids } from './grid-format';
import type {
    ExportOptions,
    FormCategory,
    ItemId,
    LabelMode,
    ListKind,
    ListState,
    OwnItem,
    Pick,
    PictureCredit,
    SavedGrid,
    SpriteFilters,
    Theme,
    Tier,
} from './types';

export { isPicturePath, type StoredTier };

/** Tierinator's own stored keys, beside the board's (tier-engine/core StoredBoard; keys kept short and stable on purpose). */
interface StoredAppFields {
    kind: ListKind;
    pack?: string;
    fam: Record<string, ItemId>;
    famM: Record<string, true>;
    items: OwnItem[];
    nextId: ItemId;
    theme: Theme;
    poolH: number;
    poolW: number;
    hover: boolean;
    sidebar: boolean;
    /** title, pool and credit were added later: older files have none of them. */
    exp: { lbl: LabelMode; px: number; empty: boolean; notes: boolean; title: boolean; pool: boolean; credit: boolean };
    trim: boolean;
    favs: Record<string, string[]>;
    vc: number;
    F: SpriteFilters;
    formCats: Record<FormCategory, boolean>;
    formOv: Record<string, boolean>;
    poolHidden: boolean;
    /** Pokémon lists' grids and the open one (added later: older files have none). */
    grids?: SavedGrid[];
    gsel?: string;
}

/** The stored shape: the board's keys and Tierinator's. */
export type StoredList = StoredBoard & StoredAppFields;

/** The parts of a list that are saved (selection, filters and the open view are not). */
type SavedState = Omit<ListState, 'selection' | 'selectionSource' | 'searchQuery' | 'focus' | 'tagFilter' | 'view' | 'topBarHidden'>;

export function toStored(state: SavedState, listName: string): StoredList {
    return writeList<StoredAppFields>(state, listName, {
        kind: state.kind,
        pack: state.packId || undefined,
        fam: state.familyOf,
        famM: state.combinedFamilies,
        items: state.ownItems,
        nextId: state.nextItemId,
        theme: state.theme,
        poolH: state.poolHeight,
        poolW: state.poolWidth,
        hover: state.showHoverInfo,
        sidebar: state.poolAsSidebar,
        exp: storeExportOptions(state.exportOptions),
        trim: state.trimSprites,
        favs: state.favouriteSprites,
        vc: state.studioCardSize,
        F: state.spriteFilters,
        formCats: state.splitFormCategories,
        formOv: state.formOverrides,
        poolHidden: state.poolHidden,
        ...(state.grids.length ? { grids: state.grids, gsel: state.gridId ?? undefined } : {}),
    });
}

const storeExportOptions = (o: ExportOptions): StoredList['exp'] => ({
    lbl: o.labelMode,
    px: o.imageSize,
    empty: o.includeEmptyTiers,
    notes: o.includeNotes,
    title: o.includeTitle,
    pool: o.includeUnranked,
    credit: o.includeCredit,
});

// ═════════════════════════════════════════════════════════════════════════════
//  READING (everything is checked: files can come from anywhere)
// ═════════════════════════════════════════════════════════════════════════════

const LABEL_MODES: readonly LabelMode[] = ['off', 'name', 'num', 'both'];
const isLabelMode = (value: unknown): value is LabelMode => LABEL_MODES.includes(value as LabelMode);

/** As many items as a pack may have. */
const MAX_OWN_ITEMS = 20_000;

/**
 * Tiers from a file or from undo history (tier-engine/core readTiers). Unknown items and duplicates are dropped.
 */
export const readTiers = (raw: unknown, itemExists: (id: ItemId) => boolean, makeId: () => string): Tier[] =>
    readBoardTiers(raw, { itemExists, makeId });

/** What a stored list says about each field, already checked. Only fields that were present and valid are returned. */
export interface ReadList {
    packId: string | null;
    familyOf: Record<string, ItemId>;
    combinedFamilies: Record<string, true>;
    notes: Record<string, string>;
    tags?: Record<string, string[]>;
    poolHidden?: boolean;
    splitFormCategories?: Partial<Record<FormCategory, boolean>>;
    formOverrides?: Record<string, boolean>;
    tiers?: Tier[];
    layout?: ListState['layout'];
    chartColumns?: number;
    tileSize?: number;
    tileShape?: ListState['tileShape'];
    tileFit?: ListState['tileFit'];
    poolTileSize?: number;
    poolHeight?: number;
    poolWidth?: number;
    poolOrder?: ListState['poolOrder'];
    labelMode?: LabelMode;
    showHoverInfo?: boolean;
    theme?: unknown;
    /** Very old files stored only a background colour. */
    backgroundColor?: string;
    poolAsSidebar?: boolean;
    exportOptions?: Partial<ExportOptions>;
    trimSprites?: boolean;
    favouriteSprites: Record<string, string[]>;
    studioCardSize?: number;
    spriteFilters?: Partial<SpriteFilters>;
    picks: Record<string, Pick>;
    /** Very old files stored chosen sprite addresses instead of picks. */
    chosenSprites: Record<string, string>;
    grids?: SavedGrid[];
    gridId?: string;
}

/**
 * Checks a stored list field by field: the board's fields through the engine (tier-engine/core readList), then
 * Tierinator's. `itemExists` says which item ids belong to the list's items (entries that point elsewhere are
 * dropped, so a broken file can't corrupt it).
 */
export function readStored(raw: unknown, itemExists: (id: ItemId) => boolean, makeId: () => string): ReadList {
    const context: ReadContext = { itemExists, makeId };
    const board = readList(raw, context);
    const s = board.raw;
    const out: ReadList = {
        packId: typeof s.pack === 'string' ? s.pack : null,
        familyOf: {},
        combinedFamilies: {},
        notes: board.notes,
        favouriteSprites: {},
        picks: board.picks,
        chosenSprites: board.chosenPictures,
    };
    const fromBoard = {
        tags: board.tags,
        tiers: board.tiers,
        layout: board.layout,
        chartColumns: board.chartColumns,
        tileSize: board.tileSize,
        tileShape: board.tileShape,
        tileFit: board.tileFit,
        poolTileSize: board.poolTileSize,
        poolOrder: board.poolOrder,
        labelMode: board.labelMode,
    };
    for (const [key, value] of Object.entries(fromBoard)) if (value !== undefined) Object.assign(out, { [key]: value });
    const ownsId = (key: string) => itemExists(Number(key));

    // variant families: variant → main item, with chains (a → b → c) flattened to a → c
    if (isRecord(s.fam))
        for (const [key, value] of Object.entries(s.fam))
            if (ownsId(key) && itemExists(Number(value)) && Number(key) !== Number(value)) out.familyOf[key] = Number(value);
    for (const key of Object.keys(out.familyOf)) {
        const main = out.familyOf[key]!;
        if (out.familyOf[main] != null) out.familyOf[key] = out.familyOf[main]!;
    }
    if (isRecord(s.famM)) for (const key of Object.keys(s.famM)) if (ownsId(key) && s.famM[key]) out.combinedFamilies[key] = true;
    if (typeof s.poolHidden === 'boolean') out.poolHidden = s.poolHidden;
    if (isRecord(s.formCats)) {
        out.splitFormCategories = {};
        for (const category of ['mega', 'gmax', 'regional', 'battle', 'cosmetic'] as const)
            if (typeof s.formCats[category] === 'boolean') out.splitFormCategories[category] = s.formCats[category] as boolean;
    }
    if (isRecord(s.formOv)) {
        out.formOverrides = {};
        for (const [key, value] of Object.entries(s.formOv)) if (typeof value === 'boolean') out.formOverrides[key] = value;
    }
    if (s.poolH != null) out.poolHeight = clamp(s.poolH, 0, 4000, 0);
    if (s.poolW != null) out.poolWidth = clamp(s.poolW, 0, 4000, 0);
    if (typeof s.hover === 'boolean') out.showHoverInfo = s.hover;
    if (s.theme) out.theme = s.theme;
    else if (isHexColor(s.bg)) out.backgroundColor = s.bg;
    if (typeof s.sidebar === 'boolean') out.poolAsSidebar = s.sidebar;
    if (isRecord(s.exp)) {
        const e = s.exp;
        out.exportOptions = {
            ...(isLabelMode(e.lbl) ? { labelMode: e.lbl } : {}),
            ...(e.px != null ? { imageSize: clamp(e.px, 64, 1024, 128) } : {}),
            ...(typeof e.empty === 'boolean' ? { includeEmptyTiers: e.empty } : {}),
            ...(typeof e.notes === 'boolean' ? { includeNotes: e.notes } : {}),
            ...(typeof e.title === 'boolean' ? { includeTitle: e.title } : {}),
            ...(typeof e.pool === 'boolean' ? { includeUnranked: e.pool } : {}),
            ...(typeof e.credit === 'boolean' ? { includeCredit: e.credit } : {}),
        };
    }
    if (typeof s.trim === 'boolean') out.trimSprites = s.trim;
    if (isRecord(s.favs))
        for (const [key, list] of Object.entries(s.favs))
            if (ownsId(key) && Array.isArray(list)) out.favouriteSprites[key] = list.map(String);
    if (s.vc) out.studioCardSize = clamp(s.vc, 48, 256, 96);
    if (isRecord(s.F)) {
        out.spriteFilters = {};
        for (const key of Object.keys(DEFAULT_SPRITE_FILTERS) as (keyof SpriteFilters)[]) {
            const value = s.F[key];
            if (typeof value === 'boolean') out.spriteFilters[key] = value;
        }
    }
    if (Array.isArray(s.grids)) {
        out.grids = readGrids(s.grids, itemExists, makeId);
        if (typeof s.gsel === 'string' && out.grids.some((grid) => grid.id === s.gsel)) out.gridId = s.gsel;
    }
    return out;
}

/** One line of plain text: control characters and runs of spaces become single spaces, cut to `max`. */
const plainLine = (value: unknown, max: number): string =>
    typeof value === 'string'
        ? value
              .replace(/[\s\p{Cc}]+/gu, ' ')
              .trim()
              .slice(0, max)
        : '';

/** A wiki file name as MediaWiki allows them: no characters that can't be in a page title, at most 240 long. */
export const isPictureFileName = (value: unknown): value is string =>
    typeof value === 'string' && /^[^#<>[\]|{}\p{Cc}]{1,240}$/u.test(value) && !!value.trim();

/** An item's picture credit (core/types.ts PictureCredit), or undefined if it isn't one. */
export function readPictureCredit(raw: unknown): PictureCredit | undefined {
    if (!isRecord(raw) || !isPictureFileName(raw.file)) return undefined;
    const credit: PictureCredit = { file: raw.file.trim() };
    const by = plainLine(raw.by, 120);
    const licence = plainLine(raw.licence, 60);
    if (by) credit.by = by;
    if (licence) credit.licence = licence;
    return credit;
}

/**
 * Your own items from a stored list. Only https picture addresses are kept, every text
 * is length-limited, and anything malformed is dropped.
 */
export function readOwnItems(raw: unknown, firstId: ItemId): OwnItem[] {
    const text = (value: unknown, max: number) => String(value ?? '').slice(0, max);
    const seen = new Set<number>();
    return (Array.isArray(raw) ? raw : [])
        .filter(
            (it): it is Record<string, unknown> =>
                isRecord(it) && Number(it.id) >= firstId && !seen.has(Number(it.id)) && !!seen.add(Number(it.id)),
        )
        .slice(0, MAX_OWN_ITEMS)
        .map((it) => {
            const item: OwnItem = { id: Number(it.id), name: text(it.name || 'Item', 80) };
            const wiki = it.w;
            if (isRecord(wiki) && typeof wiki.a === 'string' && /^https:\/\//.test(wiki.a) && typeof wiki.t === 'string')
                item.w = { a: wiki.a.slice(0, 300), t: wiki.t.slice(0, 250) };
            const credit = readPictureCredit(it.credit);
            if (credit) item.credit = credit;
            if (Array.isArray(it.alts))
                item.alts = it.alts.filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 12);
            if (typeof it.pk === 'string') item.pk = it.pk.slice(0, 80);
            if (Array.isArray(it.pkx))
                item.pkx = it.pkx
                    .filter((x): x is unknown[] => Array.isArray(x) && typeof x[0] === 'string')
                    .slice(0, 40)
                    .map((x): [string, string] => [text(x[0], 80), text(x[1] || '', 60)]);
            if (Array.isArray(it.vars))
                item.vars = it.vars
                    .filter(isRecord)
                    .slice(0, 40)
                    .map((v) => ({
                        l: text(v.l || '', 60),
                        ...(typeof v.t === 'string' ? { t: v.t.slice(0, 250) } : {}),
                        ...(typeof v.u === 'string' && /^https:/.test(v.u) ? { u: v.u } : {}),
                    }));
            return item;
        });
}
