// src/pokemon/data.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The installed Pokémon pack, unpacked into fast lookup tables, plus how to
//  describe any sprite path in words ("Gen V: Black / White, animated, shiny").
//
//  Pack parts:  roster (species) · forms · index (where every PokeAPI sprite lives)
//               go (Pokémon GO icons) · pmd (Mystery Dungeon portraits) · lore (spin-off art)
//               defCrop (crop boxes for the default sprites, which load from PokeAPI)
// ─────────────────────────────────────────────────────────────────────────────
import { entryById, isRankable } from '../core/items';
import type { FormRow, ItemId, LoreRow, PmdIndex, PokemonPack, RosterRow, SpriteIndex } from '../core/types';
import { prettyName } from '../lib/dom';
import { extensionOf } from '../lib/images';

// ═════════════════════════════════════════════════════════════════════════════
//  THE INSTALLED PACK
// ═════════════════════════════════════════════════════════════════════════════

/** The installed Pokémon pack, unpacked (empty until a pack is installed). */
export const pokedex: {
    roster: RosterRow[];
    spriteIndex: SpriteIndex;
    /** Old packs only: default sprites as base64 PNGs. */
    defaultSprites: Record<string, string>;
    /** Crop box [x, y, w, h] of each default sprite inside its defaultCropSize² PokeAPI picture. */
    defaultCrops: Record<string, [number, number, number, number]>;
    defaultCropSize: number;
    forms: FormRow[];
    goIcons: Record<string, string[]>;
    pmd: PmdIndex;
    lore: Record<string, LoreRow[]>;
    pack: {
        id: string;
        name: string;
        version: string;
        count: number;
        defaults: PokemonPack['defaults'] | null;
        favs?: PokemonPack['favs'];
        by?: string;
    } | null;
} = {
    roster: [],
    spriteIndex: { dirs: [], sets: [], sp: {} },
    defaultSprites: {},
    defaultCrops: {},
    defaultCropSize: 96,
    forms: [],
    goIcons: {},
    pmd: { emo: [], d: {}, f: {} },
    lore: {},
    pack: null,
};

export const POKEMON_TYPES = [
    'Normal',
    'Fire',
    'Water',
    'Electric',
    'Grass',
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

/** PokeAPI's game folder names → what people call the games (also their order, oldest first). */
export const GAME_NAMES: Record<string, string> = {
    'red-blue': 'Red / Blue',
    'red-green-japan': 'Red / Green (JP)',
    yellow: 'Yellow',
    gold: 'Gold',
    silver: 'Silver',
    crystal: 'Crystal',
    'ruby-sapphire': 'Ruby / Sapphire',
    emerald: 'Emerald',
    'firered-leafgreen': 'FireRed / LeafGreen',
    'diamond-pearl': 'Diamond / Pearl',
    platinum: 'Platinum',
    'heartgold-soulsilver': 'HeartGold / SoulSilver',
    'black-white': 'Black / White',
    'x-y': 'X / Y',
    'omega-ruby-alpha-sapphire': 'Omega Ruby / Alpha Sapphire',
    'ultra-sun-ultra-moon': 'Ultra Sun / Ultra Moon',
    'lets-go-pikachu-lets-go-eevee': "Let's Go Pikachu / Eevee",
    'sword-shield': 'Sword / Shield',
    'brilliant-diamond-shining-pearl': 'Brilliant Diamond / Shining Pearl',
    'legends-arceus': 'Legends: Arceus',
    'scarlet-violet': 'Scarlet / Violet',
    'legends-za': 'Legends: Z-A',
    champions: 'Champions',
    icons: 'Menu icons',
    'red-and-blue': 'Red & Blue art',
    'red-and-green': 'Red & Green art',
    'gold-and-silver': 'Gold & Silver art',
};
const GAME_ORDER = Object.keys(GAME_NAMES);
const ROMAN_NUMERALS: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };

// ═════════════════════════════════════════════════════════════════════════════
//  SPRITE FOLDERS
// ═════════════════════════════════════════════════════════════════════════════

export interface SpriteDirFlags {
    shiny: boolean;
    back: boolean;
    female: boolean;
    icon: boolean;
    tint: boolean;
    animated: boolean;
}
/** How a sprite folder is shown: its section heading, sort order and labels. */
export interface SpriteDirInfo {
    sec: string;
    order: number;
    tags: string[];
    flags: Partial<SpriteDirFlags>;
}
/** A folder of sprites (a PokeAPI folder, or one of the special sources). */
export interface SpriteDir {
    dir: string;
    ext: string;
    /** Position in spriteDirs. */
    i: number;
    local?: boolean;
    go?: boolean;
    pmd?: boolean;
    lore?: boolean;
    info: SpriteDirInfo;
}
/** [file stem, form name, sprite-set index] */
export type SpriteKey = [stem: string, formName: string, setIndex: number];

/** Which folders each sprite exists in (index = sprite-set index). */
export const spriteSets: Set<number>[] = [];
export const spriteDirs: SpriteDir[] = [];
export const spriteDirByPath = new Map<string, SpriteDir>();
/** Stem → folders it was found in, in a sprite zip or folder you loaded. */
export const localStems = new Map<string, Set<number>>();
export const spriteKeyByStem = new Map<string, SpriteKey>();

/** "versions/generation-v/black-white/animated/shiny" → "Gen V: Black / White", [animated, shiny]. */
export function describeSpriteDir(dir: string): SpriteDirInfo {
    const parts = dir ? dir.split('/') : [];
    const has = (part: string) => parts.includes(part);
    const flags: SpriteDirFlags = {
        shiny: has('shiny'),
        back: has('back'),
        female: has('female'),
        icon: has('icons'),
        tint: has('gray') || has('gbc'),
        animated: has('animated'),
    };
    const tags: string[] = [];
    if (flags.icon) tags.push('icon');
    if (flags.animated) tags.push('animated');
    if (flags.back) tags.push('back');
    if (flags.shiny) tags.push('shiny');
    if (flags.female) tags.push('♀');
    if (has('gray')) tags.push('gray');
    if (has('gbc')) tags.push('GBC colour');
    if (has('transparent')) tags.push('transparent bg');
    const first = parts[0] ?? '';
    if (first === 'versions') {
        const generation = (parts[1] || '').replace('generation-', '');
        const game = parts[2] || '';
        const gameIndex = GAME_ORDER.indexOf(game);
        return {
            sec: `Gen ${generation.toUpperCase()}: ${GAME_NAMES[game] || prettyName(game)}`,
            order: 100 + (ROMAN_NUMERALS[generation] || 0) * 10 + (game === 'icons' ? 9 : gameIndex < 0 ? 8 : gameIndex / 100),
            tags,
            flags,
        };
    }
    if (first === 'other') {
        const kind = parts[1] || '';
        const titles: Record<string, [string, number]> = {
            'official-artwork': ['Official artwork', 10],
            home: ['Pokémon HOME (3D render)', 11],
            'dream-world': ['Dream World (vector, infinite zoom)', 12],
            showdown: ['Showdown (animated)', 13],
        };
        if (parts[2] === 'versions' && parts[4]) tags.unshift(GAME_NAMES[parts[4]] || prettyName(parts[4]));
        const [sec, order] = titles[kind] || [prettyName(kind), 50];
        return { sec, order, tags, flags };
    }
    if (first === 'model') return { sec: '3D model (from your zip)', order: 60, tags, flags };
    if (!parts.length || ['shiny', 'back', 'female'].includes(first)) return { sec: 'Default sprites', order: 5, tags, flags };
    return { sec: prettyName(first) + ' (from your files)', order: 70, tags, flags };
}

/** A section name as it was saved before the names lost their separators ("Gen V — Black / White",
 *  "Lore & spin-offs · Pokkén"), in today's words, so sections folded in an older backup stay folded. */
export const currentSectionName = (name: string): string => name.replace(/^(Gen [IVX]+|Pokémon GO|Lore & spin-offs) [—·] /, '$1: ');

/** The item id a file stem belongs to ("10034-mega-x" → 10034). */
export const stemOwnerId = (stem: string): ItemId => Number(String(stem).match(/^\d+/)?.[0] ?? NaN);

/** Every sprite key of an entry. A species keeps the sprites of any of its forms that aren't split out. */
export function spriteKeysFor(id: ItemId): SpriteKey[] {
    const entry = entryById.get(id);
    if (!entry || entry.dex == null) return [[String(id), '', -1]];
    const all = pokedex.spriteIndex.sp[entry.dex] || [[String(entry.dex), '', -1]];
    if (entry.form) return all.filter((key) => stemOwnerId(key[0]) === id);
    return all.filter((key) => {
        const owner = stemOwnerId(key[0]);
        return owner === id || owner < 10000 || !isRankable(owner);
    });
}

/** The sprite-set index of an entry's own stem (-1 when unknown). */
export const baseSetIndexOf = (id: ItemId): number => spriteKeysFor(id).find((key) => key[0] === String(id))?.[2] ?? -1;

/** Does sprite `stem` exist in folder `dirIndex`? */
export const spriteExists = (stem: string, setIndex: number, dirIndex: number): boolean => {
    const dir = spriteDirs[dirIndex];
    if (dir?.pmd) return hasPmdPortrait(stem);
    if (dir?.go) return goBaseIcon.has(stem);
    return (setIndex >= 0 && !!spriteSets[setIndex]?.has(dirIndex)) || (localStems.get(stem)?.has(dirIndex) ?? false);
};

/** The sprite path of `stem` in folder `dir`. */
export const spritePath = (dir: SpriteDir, stem: string): string =>
    dir.pmd ? `pmd:${pad4(stem)}/Normal` : dir.go ? 'go:' + goBaseIcon.get(stem) : (dir.dir ? dir.dir + '/' : '') + stem + '.' + dir.ext;

export const pad4 = (n: number | string): string => String(n).padStart(4, '0');

// ═════════════════════════════════════════════════════════════════════════════
//  POKÉMON GO ICONS ("go:25.cHALLOWEEN_2018.s")
// ═════════════════════════════════════════════════════════════════════════════

const GO_WORDS: Record<string, string> = {
    GOFEST: 'GO Fest',
    GOTOUR: 'GO Tour',
    TCG: 'TCG',
    PI: 'Pi',
    GBL: 'GBL',
    WCS: 'WCS',
    KANTO: 'Kanto',
    JOHTO: 'Johto',
    HOENN: 'Hoenn',
    SINNOH: 'Sinnoh',
};
/** "HALLOWEEN_2018" → "Halloween 2018". */
export const prettyGoName = (name: string): string =>
    /^COPY_2019/i.test(name)
        ? 'Clone (Mewtwo Strikes Back)'
        : name
              .replace(/_NOEVOLVE$/i, '')
              .split('_')
              .filter(Boolean)
              .map((word) => GO_WORDS[word.toUpperCase()] || word[0]!.toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');

export interface GoIcon {
    core: string;
    shiny: boolean;
    female: boolean;
    costume: string;
    form: string;
}
/** A GO icon file stem → what it shows: ".s" shiny, ".g2"/"fFEMALE" female, ".c…" costume, ".f…" form. */
export function parseGoIcon(core: string): GoIcon {
    const icon: GoIcon = { core, shiny: false, female: false, costume: '', form: '' };
    for (const part of core.split('.').slice(1)) {
        if (part === 's') icon.shiny = true;
        else if (part === 'g2') icon.female = true;
        else if (part[0] === 'c') icon.costume = prettyGoName(part.slice(1));
        else if (part[0] === 'f') {
            const form = part.slice(1);
            if (/^FEMALE$/i.test(form)) icon.female = true;
            else
                icon.form =
                    form === 'A' && core.startsWith('150.') ? 'ARMORED' : form === 'S' && /^(249|250)\./.test(core) ? 'APEX_SHADOW' : form;
        }
    }
    // event "forms" (hats, tiaras…) behave like costumes
    if (icon.form && /\d{4}|COSTUME|TIARA|HAT|GOGGLES|COPY/i.test(icon.form)) {
        icon.costume = prettyGoName(icon.form);
        icon.form = '';
    }
    return icon;
}
/** Stem → its plain GO icon (not shiny, female or a costume). */
export const goBaseIcon = new Map<string, string>();

const specialDir = (dir: string, info: Omit<SpriteDirInfo, 'tags' | 'flags'>, kind: 'go' | 'pmd'): SpriteDir => ({
    dir,
    ext: 'png',
    i: -1,
    [kind]: true,
    info: { ...info, tags: [], flags: {} },
});
export const GO_DIR = specialDir('@go', { sec: 'Pokémon GO (3D icons)', order: 14 }, 'go');
export const GO_COSTUME_DIR = specialDir('@goc', { sec: 'Pokémon GO: costumes & events', order: 15 }, 'go');
export const PMD_DIR = specialDir('@pmd', { sec: 'Mystery Dungeon portraits', order: 16 }, 'pmd');

// ═════════════════════════════════════════════════════════════════════════════
//  LORE & SPIN-OFFS: art from non-mainline games, anime and movies (Bulbapedia's archive)
// ═════════════════════════════════════════════════════════════════════════════

const loreDirs = new Map<string, SpriteDir>();
/** One section per source ("Pokémon UNITE holowear", "Pokkén"…). */
export const loreDirFor = (source: string): SpriteDir => {
    if (!loreDirs.has(source))
        loreDirs.set(source, {
            dir: '@lore',
            ext: 'png',
            lore: true,
            i: 900 + loreDirs.size,
            info: { sec: 'Lore & spin-offs: ' + source, order: 8, tags: [], flags: {} },
        });
    return loreDirs.get(source)!;
};
/** The lore entry a "lore:" path points to: [species id, row]. */
export const findLoreEntry = (path: string): [ItemId, LoreRow] | null => {
    const file = path.slice(path.indexOf('/') + 1);
    for (const [id, rows] of Object.entries(pokedex.lore)) {
        const row = rows.find((r) => r[2] === file);
        if (row) return [Number(id), row];
    }
    return null;
};

/** Mystery Dungeon has a normal portrait for this species. */
export const hasPmdPortrait = (stem: string | number): boolean => {
    const entry = pokedex.pmd.d[stem];
    return !!(entry && entry[0] & 1);
};

// ═════════════════════════════════════════════════════════════════════════════
//  INSTALLING A PACK
// ═════════════════════════════════════════════════════════════════════════════

/** Unpacks a Pokémon pack into the lookup tables. */
export function installPokemonPack(pack: PokemonPack): void {
    pokedex.roster = pack.roster;
    pokedex.spriteIndex = pack.index;
    // old packs embed the default sprites; the website's pack has crop boxes and loads them from PokeAPI
    pokedex.defaultSprites = pack.def || {};
    pokedex.defaultCrops = pack.defCrop || {};
    pokedex.defaultCropSize = pack.defSize || 96;
    pokedex.forms = pack.forms;
    pokedex.goIcons = pack.go;
    pokedex.pmd = pack.pmd;
    pokedex.lore = pack.lore || {};
    pokedex.pack = {
        id: pack.id,
        name: pack.name,
        version: pack.version,
        count: pack.roster.length,
        defaults: pack.defaults || null,
        favs: pack.favs,
        by: pack.by || '',
    };
    spriteSets.length = 0;
    for (const folders of pokedex.spriteIndex.sets) spriteSets.push(new Set(folders));
    spriteDirs.length = 0;
    spriteDirByPath.clear();
    pokedex.spriteIndex.dirs.forEach(([dir, ext], i) => {
        const folder: SpriteDir = { dir, ext, i, local: false, info: describeSpriteDir(dir) };
        spriteDirs.push(folder);
        spriteDirByPath.set(dir, folder);
    });
    spriteKeyByStem.clear();
    for (const keys of Object.values(pokedex.spriteIndex.sp)) for (const key of keys) spriteKeyByStem.set(key[0], key);
    goBaseIcon.clear();
    for (const [stem, cores] of Object.entries(pokedex.goIcons)) {
        const plain = cores.map(parseGoIcon).filter((icon) => !icon.shiny && !icon.female && !icon.costume);
        const owner = stemOwnerId(stem);
        const choice = plain.find((icon) => !icon.form || owner >= 10000) || plain[0];
        if (choice) goBaseIcon.set(stem, choice.core);
    }
    for (const special of [GO_DIR, PMD_DIR]) {
        special.i = spriteDirs.length;
        spriteDirs.push(special);
        spriteDirByPath.set(special.dir, special);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  DESCRIBING A SPRITE PATH
// ═════════════════════════════════════════════════════════════════════════════

/** File extension of a sprite path (special sources are always PNG). */
export const extensionOfSpritePath = (path: string): string => (/^(go|gal|pmd|lore|xp):/.test(path) ? 'png' : extensionOf(path));

/** Where a picked sprite comes from, in words. */
/** Names of your gallery pictures ("gal:" paths); the gallery fills this in, so this file needs no features. */
export const galleryNames = { of: (_key: string): string | undefined => undefined };

export function describeSpritePath(path: string | undefined): string {
    if (!path) return 'Default sprite';
    if (path === 'custom') return 'Custom upload';
    if (/^https?:/.test(path)) return 'Image URL';
    if (path.startsWith('gal:')) {
        const name = galleryNames.of(path.slice(4));
        return 'Your image' + (name ? ': ' + name : '');
    }
    if (path.startsWith('pmd:')) {
        const parts = path.slice(4).split('/');
        const shiny = parts.length === 4 && parts[1] === '0000';
        const form =
            !shiny && parts.length === 3 ? (pokedex.pmd.f[Number(parts[0])] || []).find((f) => f[0] === parts[0] + '/' + parts[1]) : null;
        return ['Mystery Dungeon portrait', form?.[1], parts[parts.length - 1], shiny && 'shiny'].filter(Boolean).join(', ');
    }
    if (path.startsWith('lore:')) {
        const lore = findLoreEntry(path);
        return lore ? `Lore & spin-offs: ${lore[1][1]}, ${lore[1][0]}` : 'Lore & spin-offs';
    }
    if (path.startsWith('go:')) {
        const icon = parseGoIcon(path.slice(3));
        return [
            'Pokémon GO',
            icon.costume && icon.costume + ' costume',
            icon.form && prettyGoName(icon.form),
            icon.female && '♀',
            icon.shiny && 'shiny',
        ]
            .filter(Boolean)
            .join(', ');
    }
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const stem = path
        .split('/')
        .pop()!
        .replace(/\.[^.]+$/, '');
    const info = spriteDirByPath.get(dir)?.info ?? describeSpriteDir(dir);
    const key = spriteKeyByStem.get(stem);
    return [info.sec, ...info.tags, key?.[1] ? prettyName(key[1]) : ''].filter(Boolean).join(', ');
}
