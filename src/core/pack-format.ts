// src/core/pack-format.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Reading pack files (see core/types.ts, section 2) safely. A pack can come from
//  anyone, so every field is checked and anything unexpected is dropped or the
//  whole pack refused: the rest of the app can then trust a pack's shape.
//
//    readGenericPack(raw)   any franchise (format 2)          → GenericPack | null
//    readPokemonPack(raw)   the Pokémon pack                   → PokemonPack | null
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../lib/checks';
import { isHexColor } from '../lib/color';
import { isPicturePath } from './snapshot';
import type { Crop, FormCategory, FormRow, GenericPack, LoreRow, PackPicture, PackRow, PokemonPack, RosterRow, SpriteIndex } from './types';

const MAX_PACK_ITEMS = 20_000;
const MAX_PICTURES_PER_ITEM = 200;
const FORM_CATEGORIES: readonly FormCategory[] = ['mega', 'gmax', 'regional', 'battle', 'cosmetic'];

// ── small checks ──
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const optionalText = (value: unknown, max: number): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined);
const isWhole = (value: unknown): value is number => Number.isInteger(value);
const strings = (value: unknown, maxCount: number, maxLength: number): string[] =>
    Array.isArray(value)
        ? value
              .filter((v): v is string => typeof v === 'string')
              .slice(0, maxCount)
              .map((v) => v.slice(0, maxLength))
        : [];
/** An https address (or ''): packs never point pictures or wikis anywhere else. */
const httpsOrEmpty = (value: unknown): string => (typeof value === 'string' && /^https:\/\//.test(value) ? value.slice(0, 500) : '');

/** A picture source: an https address, an embedded picture, or a file name on the pack's image server. */
function readPictureSource(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    if (/^https:\/\//.test(value)) return value.slice(0, 1000);
    if (/^data:image\/(png|gif|jpeg|webp);base64,/.test(value)) return value.length < 2_000_000 ? value : null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null; // any other scheme
    return value.slice(0, 500);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ANY FRANCHISE (format 2)
// ═════════════════════════════════════════════════════════════════════════════

function readPackRow(raw: unknown, rowCount: number): PackRow | null {
    if (!Array.isArray(raw) || typeof raw[0] !== 'string' || !raw[0].trim()) return null;
    const pictures: PackPicture[] = (Array.isArray(raw[2]) ? raw[2] : [])
        .slice(0, MAX_PICTURES_PER_ITEM)
        .flatMap((picture): PackPicture[] => {
            if (!Array.isArray(picture)) return [];
            const source = readPictureSource(picture[1]);
            if (!source) return [];
            const group = isWhole(picture[0]) && picture[0] >= 0 ? picture[0] : 0;
            return typeof picture[2] === 'string' ? [[group, source, picture[2].slice(0, 120)]] : [[group, source]];
        });
    const row: PackRow = [raw[0].slice(0, 80), strings(raw[1], 40, 40), pictures];
    const wikiTitle = optionalText(raw[3], 250);
    const variantOf = raw[4];
    if (isWhole(variantOf) && variantOf >= 0 && variantOf < rowCount) row.push(wikiTitle, variantOf);
    else if (wikiTitle !== undefined) row.push(wikiTitle);
    return row;
}

/** A format-2 pack, checked; null if it isn't one. */
export function readGenericPack(raw: unknown): GenericPack | null {
    if (!isRecord(raw) || raw.type !== 'tierpack' || raw.format !== 2) return null;
    const id =
        typeof raw.id === 'string'
            ? raw.id
                  .toLowerCase()
                  .replace(/[^a-z0-9-]+/g, '-')
                  .slice(0, 60)
            : '';
    if (!id || id === 'pokemon' || !Array.isArray(raw.items)) return null;
    const rawItems = raw.items.slice(0, MAX_PACK_ITEMS);
    const items = rawItems.map((row) => readPackRow(row, rawItems.length));
    if (items.some((row) => row === null)) return null; // a broken row would shift every variant index after it
    const pack: GenericPack = { type: 'tierpack', format: 2, id, name: text(raw.name, 80) || id, items: items as PackRow[] };
    const noun = optionalText(raw.noun, 40);
    if (noun) pack.noun = noun;
    const version = optionalText(raw.version, 40);
    if (version) pack.version = version;
    const about = optionalText(raw.about, 2000);
    if (about) pack.about = about;
    if (isRecord(raw.source))
        pack.source = { name: text(raw.source.name, 80), url: httpsOrEmpty(raw.source.url), api: httpsOrEmpty(raw.source.api) };
    // picture file names are completed with base + name + thumb, so base must be an https address
    const base = httpsOrEmpty(raw.base);
    if (base) pack.base = base;
    if (typeof raw.thumb === 'string' && !/[\s"'<>]/.test(raw.thumb)) pack.thumb = raw.thumb.slice(0, 200);
    if (Array.isArray(raw.groups)) pack.groups = strings(raw.groups, 100, 60);
    if (isRecord(raw.facets))
        pack.facets = Object.fromEntries(
            Object.entries(raw.facets)
                .slice(0, 30)
                .map(([facet, values]) => [facet.slice(0, 40), strings(values, 500, 40)]),
        );
    const dots = optionalText(raw.dots, 40);
    if (dots) pack.dots = dots;
    if (isRecord(raw.colors))
        pack.colors = Object.fromEntries(
            Object.entries(raw.colors)
                .filter((entry): entry is [string, string] => isHexColor(entry[1]))
                .slice(0, 500),
        );
    return pack;
}

// ═════════════════════════════════════════════════════════════════════════════
//  POKÉMON
// ═════════════════════════════════════════════════════════════════════════════

const isTypes = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isRosterRow = (row: unknown): row is RosterRow =>
    Array.isArray(row) && isWhole(row[0]) && typeof row[1] === 'string' && isWhole(row[2]) && isTypes(row[3]);
const isFormRow = (row: unknown): row is FormRow =>
    Array.isArray(row) &&
    isWhole(row[0]) &&
    isWhole(row[1]) &&
    typeof row[2] === 'string' &&
    isWhole(row[3]) &&
    (row[4] === null || isTypes(row[4])) &&
    FORM_CATEGORIES.includes(row[5]) &&
    typeof row[6] === 'string';
const isLoreRow = (row: unknown): row is LoreRow =>
    Array.isArray(row) && row.slice(0, 4).every((v) => typeof v === 'string') && (row[4] === undefined || row[4] === 1);
const isCrop = (crop: unknown): crop is Crop =>
    isRecord(crop) && (['x', 'y', 'w', 'h', 'W', 'H'] as const).every((key) => Number.isFinite(crop[key]) && Number(crop[key]) >= 0);
const isBox = (box: unknown): box is [number, number, number, number] =>
    Array.isArray(box) && box.length === 4 && box.every((v) => Number.isFinite(v) && v >= 0);

function isSpriteIndex(index: unknown): index is SpriteIndex {
    if (!isRecord(index) || !Array.isArray(index.dirs) || !Array.isArray(index.sets) || !isRecord(index.sp)) return false;
    return (
        index.dirs.every((dir) => Array.isArray(dir) && typeof dir[0] === 'string' && typeof dir[1] === 'string') &&
        index.sets.every((set) => Array.isArray(set) && set.every(isWhole)) &&
        Object.values(index.sp).every(
            (keys) =>
                Array.isArray(keys) &&
                keys.every((key) => Array.isArray(key) && typeof key[0] === 'string' && typeof key[1] === 'string' && isWhole(key[2])),
        )
    );
}

/** Keeps the entries of a record that pass `isValid`. */
const recordOf = <T>(value: unknown, isValid: (entry: unknown) => entry is T): Record<string, T> =>
    isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => isValid(entry[1]))) : {};
const listOf =
    <T>(isValid: (entry: unknown) => entry is T) =>
    (value: unknown): value is T[] =>
        Array.isArray(value) && value.every(isValid);

/** The Pokémon pack, checked; null if it isn't one (or its core tables are broken). */
export function readPokemonPack(raw: unknown): PokemonPack | null {
    if (!isRecord(raw) || raw.type !== 'tierpack' || raw.id !== 'pokemon') return null;
    if (!listOf(isRosterRow)(raw.roster) || !raw.roster.length || !listOf(isFormRow)(raw.forms) || !isSpriteIndex(raw.index)) return null;
    const pmd = isRecord(raw.pmd) ? raw.pmd : {};
    const pack: PokemonPack = {
        type: 'tierpack',
        id: 'pokemon',
        name: text(raw.name, 80) || 'Pokémon',
        version: text(raw.version, 40),
        roster: raw.roster.map(([id, name, gen, types]): RosterRow => [id, name.slice(0, 80), gen, types]),
        forms: raw.forms,
        index: raw.index,
        go: recordOf(raw.go, (value): value is string[] => isTypes(value)),
        pmd: {
            emo: strings(pmd.emo, 64, 40),
            d: recordOf(pmd.d, (value): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isWhole)),
            f: recordOf(
                pmd.f,
                listOf(
                    (form): form is [string, string, number] =>
                        Array.isArray(form) && typeof form[0] === 'string' && typeof form[1] === 'string' && isWhole(form[2]),
                ),
            ),
        },
        lore: recordOf(raw.lore, listOf(isLoreRow)),
    };
    const about = optionalText(raw.about, 2000);
    if (about) pack.about = about;
    const embedded = recordOf(raw.def, (value): value is string => typeof value === 'string' && /^[A-Za-z0-9+/=]+$/.test(value));
    if (Object.keys(embedded).length) pack.def = embedded;
    if (isRecord(raw.defCrop)) {
        pack.defCrop = recordOf(raw.defCrop, isBox);
        pack.defSize = isWhole(raw.defSize) && raw.defSize > 0 && raw.defSize <= 4096 ? raw.defSize : 96;
    }
    if (isRecord(raw.defaults)) {
        const defaults: NonNullable<PokemonPack['defaults']> = {};
        for (const [id, pick] of Object.entries(raw.defaults)) {
            if (!isRecord(pick)) continue;
            if (typeof pick.img === 'string' && /^data:image\//.test(pick.img))
                defaults[id] = { img: pick.img, ...(isCrop(pick.crop) ? { crop: pick.crop } : {}) };
            // the same check list files get: a path can't walk out of the sprite collection
            else if (isPicturePath(pick.path) && pick.path.length < 300) defaults[id] = { path: pick.path };
        }
        pack.defaults = defaults;
    }
    if (isRecord(raw.favs)) pack.favs = Object.fromEntries(Object.entries(raw.favs).map(([id, paths]) => [id, strings(paths, 200, 300)]));
    const by = optionalText(raw.by, 60);
    if (by) pack.by = by;
    return pack;
}
