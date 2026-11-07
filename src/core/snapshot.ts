// src/core/snapshot.ts
// ─────────────────────────────────────────────────────────────────────────────
//  A list as it is stored: in this browser (localStorage "ptl_<id>"), in saved
//  .json files, in bundles and backups. The format is version 10 of the original
//  app and never changes shape here, so every file anyone ever saved still loads.
//
//  The in-memory names (core/types.ts ListState) are clearer than the stored keys;
//  this is the one place that translates between them, and the one place that
//  checks everything read from a file before the app uses it.
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../lib/checks';
import { isHexColor } from '../lib/color';
import { CHART_COLUMNS, DEFAULT_SPRITE_FILTERS } from './defaults';
import { isTileFit, isTileShape } from './tile-box';
import type {
    BoardLayout,
    ExportOptions,
    FormCategory,
    ItemId,
    LabelMode,
    ListKind,
    ListState,
    OwnItem,
    Pick,
    PictureCredit,
    PoolSortBy,
    SpriteFilters,
    Theme,
    Tier,
    TileFit,
    TileShape,
} from './types';

/** The stored shape (keys kept short and stable on purpose). */
export interface StoredList {
    app: 'tierlist';
    v: 10;
    kind: ListKind;
    pack?: string;
    notes: Record<string, string>;
    fam: Record<string, ItemId>;
    famM: Record<string, true>;
    listName: string;
    items: OwnItem[];
    nextId: ItemId;
    theme: Theme;
    tiers: StoredTier[];
    sz: number;
    psz: number;
    poolH: number;
    poolW: number;
    lbl: LabelMode;
    hover: boolean;
    sidebar: boolean;
    /** title, pool and credit were added later: older files have none of them. */
    exp: { lbl: LabelMode; px: number; empty: boolean; notes: boolean; title: boolean; pool: boolean; credit: boolean };
    trim: boolean;
    favs: Record<string, string[]>;
    vc: number;
    F: SpriteFilters;
    picks: Record<string, Pick>;
    formCats: Record<FormCategory, boolean>;
    formOv: Record<string, boolean>;
    tags: Record<string, string[]>;
    poolHidden: boolean;
    /** Added later: older files have neither, and open as tier rows. */
    lay: BoardLayout;
    cols: number;
    /** Added later still: older files have neither, and open with square tiles showing whole pictures. */
    shape: TileShape;
    fit: TileFit;
    /** The pool's order on screen (older files show it in the order items were added). */
    psort: PoolSortBy;
    pseed: number;
}
export interface StoredTier {
    id: string;
    label: string;
    sub: string;
    color: string;
    text: string;
    items: ItemId[];
}

/** The parts of a list that are saved (selection, filters and the open view are not). */
type SavedState = Omit<
    ListState,
    'selection' | 'selectionSource' | 'searchQuery' | 'generationFilter' | 'typeFilter' | 'tagFilter' | 'view' | 'topBarHidden'
>;

export function toStored(state: SavedState, listName: string): StoredList {
    return {
        app: 'tierlist',
        v: 10,
        kind: state.kind,
        pack: state.packId || undefined,
        notes: state.notes,
        fam: state.familyOf,
        famM: state.combinedFamilies,
        listName,
        items: state.ownItems,
        nextId: state.nextItemId,
        theme: state.theme,
        tiers: state.tiers.map(storeTier),
        sz: state.tileSize,
        psz: state.poolTileSize,
        poolH: state.poolHeight,
        poolW: state.poolWidth,
        lbl: state.labelMode,
        hover: state.showHoverInfo,
        sidebar: state.poolAsSidebar,
        exp: storeExportOptions(state.exportOptions),
        trim: state.trimSprites,
        favs: state.favouriteSprites,
        vc: state.studioCardSize,
        F: state.spriteFilters,
        picks: state.picks,
        formCats: state.splitFormCategories,
        formOv: state.formOverrides,
        tags: state.tags,
        poolHidden: state.poolHidden,
        lay: state.layout,
        cols: state.chartColumns,
        shape: state.tileShape,
        fit: state.tileFit,
        psort: state.poolOrder.by,
        pseed: state.poolOrder.seed,
    };
}

const storeTier = (tier: Tier): StoredTier => ({
    id: tier.id,
    label: tier.label,
    sub: tier.subtitle,
    color: tier.color,
    text: tier.textColor || '',
    items: tier.items,
});
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

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) && n ? n : fallback));
};
const LABEL_MODES: readonly LabelMode[] = ['off', 'name', 'num', 'both'];
const isLabelMode = (value: unknown): value is LabelMode => LABEL_MODES.includes(value as LabelMode);
const isBoardLayout = (value: unknown): value is BoardLayout => value === 'tiers' || value === 'chart';
const POOL_SORTS: readonly PoolSortBy[] = ['added', 'az', 'za', 'shuffled'];
const isPoolSort = (value: unknown): value is PoolSortBy => POOL_SORTS.includes(value as PoolSortBy);

/** More than anyone ranks into, and enough to stop a hostile file building a page nobody can scroll. */
const MAX_TIERS = 100;
/** As many items as a pack may have. */
const MAX_OWN_ITEMS = 20_000;

/**
 * Tiers from a file or from undo history. Accepts both the stored keys (sub, text) and
 * the in-memory ones (subtitle, textColor). Unknown items and duplicates are dropped.
 */
export function readTiers(raw: unknown, itemExists: (id: ItemId) => boolean, makeId: () => string): Tier[] {
    const placed = new Set<ItemId>();
    const tierIds = new Set<string>();
    // a repeated id would make two rows answer to one name: the second gets a fresh one
    const uniqueTierId = (id: unknown): string => {
        const wanted = String(id || '').slice(0, 40);
        const chosen = wanted && !tierIds.has(wanted) ? wanted : makeId();
        tierIds.add(chosen);
        return chosen;
    };
    return (Array.isArray(raw) ? raw : [])
        .filter(isRecord)
        .slice(0, MAX_TIERS)
        .map((t) => ({
            id: uniqueTierId(t.id),
            label: String(t.label ?? '?').slice(0, 40),
            subtitle: String(t.subtitle ?? t.sub ?? '').slice(0, 60),
            color: isHexColor(t.color) ? t.color : '#888888',
            textColor: isHexColor(t.textColor ?? t.text) ? String(t.textColor ?? t.text) : '',
            items: (Array.isArray(t.items) ? t.items : [])
                .map(Number)
                .filter((id) => itemExists(id) && !placed.has(id) && !!placed.add(id)),
        }));
}

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
    layout?: BoardLayout;
    chartColumns?: number;
    tileSize?: number;
    tileShape?: TileShape;
    tileFit?: TileFit;
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
}

/**
 * Checks a stored list field by field. `itemExists` says which item ids belong to the
 * list's items (entries that point elsewhere are dropped, so a broken file can't corrupt it).
 */
export function readStored(raw: unknown, itemExists: (id: ItemId) => boolean, makeId: () => string): ReadList {
    const s = isRecord(raw) ? raw : {};
    const out: ReadList = {
        packId: typeof s.pack === 'string' ? s.pack : null,
        familyOf: {},
        combinedFamilies: {},
        notes: {},
        favouriteSprites: {},
        picks: {},
        chosenSprites: {},
    };
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
    if (isRecord(s.notes))
        for (const [key, value] of Object.entries(s.notes))
            if (ownsId(key) && typeof value === 'string' && value.trim()) out.notes[key] = value.slice(0, 300);
    if (isRecord(s.tags)) {
        out.tags = {};
        // as the tag box allows: 24 characters each, and a sensible number per item
        for (const [key, list] of Object.entries(s.tags))
            if (ownsId(key) && Array.isArray(list))
                out.tags[key] = list
                    .map((tag) => String(tag).slice(0, 24))
                    .filter(Boolean)
                    .slice(0, 40);
    }
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
    if (Array.isArray(s.tiers)) out.tiers = readTiers(s.tiers, itemExists, makeId);
    if (isBoardLayout(s.lay)) out.layout = s.lay;
    if (s.cols != null) out.chartColumns = Math.round(clamp(s.cols, CHART_COLUMNS.min, CHART_COLUMNS.max, CHART_COLUMNS.start));
    if (s.sz) out.tileSize = clamp(s.sz, 28, 160, 64);
    if (isTileShape(s.shape)) out.tileShape = s.shape;
    if (isTileFit(s.fit)) out.tileFit = s.fit;
    if (s.psz) out.poolTileSize = clamp(s.psz, 24, 128, 56);
    if (s.poolH != null) out.poolHeight = clamp(s.poolH, 0, 4000, 0);
    if (s.poolW != null) out.poolWidth = clamp(s.poolW, 0, 4000, 0);
    // any whole number does as a seed; it only has to stay the same
    if (isPoolSort(s.psort)) out.poolOrder = { by: s.psort, seed: Number.isSafeInteger(s.pseed) ? Number(s.pseed) >>> 0 : 1 };
    if (isLabelMode(s.lbl)) out.labelMode = s.lbl;
    else if (typeof s.names === 'boolean') out.labelMode = s.names ? 'name' : 'off';
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
    if (isRecord(s.picks))
        for (const [key, pick] of Object.entries(s.picks))
            if (ownsId(key) && isRecord(pick) && isPicturePath(pick.path)) out.picks[key] = readPick(pick);
    if (isRecord(s.chosenSprites))
        for (const [key, url] of Object.entries(s.chosenSprites)) if (ownsId(key) && isPicturePath(url)) out.chosenSprites[key] = url;
    return out;
}

/**
 * A picture path as the app writes them: a web address, or a path inside one of the sprite
 * collections ("other/home/25.png", "go:25", "lore:…"). Collection paths are joined onto a
 * fixed address, so ".." or a backslash could walk out of it; those are refused.
 */
export function isPicturePath(path: unknown): path is string {
    if (typeof path !== 'string' || !path || path.length > 500) return false;
    if (/^https?:\/\//.test(path)) return !/[\s\\]/.test(path);
    // %2e and %2f would be read as . and / once joined onto the collection's address
    return !/(^|[/:])\.\.([/]|$)|[\\?#]|%(2e|2f|5c)|^\/|^[a-z][\w+.-]*:\/\//i.test(path);
}

/** A pick from a file: only the known fields, with the right types. */
function readPick(raw: Record<string, unknown>): Pick {
    const pick: Pick = { path: String(raw.path) };
    if (raw.ck) pick.ck = 1;
    if (typeof raw.trim === 'boolean') pick.trim = raw.trim;
    if (typeof raw.anim === 'boolean') pick.anim = raw.anim;
    if (raw.text) pick.text = 1;
    if (typeof raw.remote === 'string' && /^https:\/\//.test(raw.remote)) pick.remote = raw.remote;
    const c = raw.crop;
    if (isRecord(c) && ['x', 'y', 'w', 'h', 'W', 'H'].every((k) => Number.isFinite(c[k])))
        pick.crop = { x: Number(c.x), y: Number(c.y), w: Number(c.w), h: Number(c.h), W: Number(c.W), H: Number(c.H) };
    // markers from old versions: only whether they're set matters
    if (raw.bg) pick.bg = 1;
    if (raw.keepbg) pick.keepbg = 1;
    if (raw.bgck) pick.bgck = 1;
    return pick;
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
