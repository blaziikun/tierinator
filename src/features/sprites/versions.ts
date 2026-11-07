// src/features/sprites/versions.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Every sprite version of one Pokémon, as cards grouped by game. Shared by the
//  Sprite Studio and the right-click quick picker.
//
//    filters      Show ▾ chips: which kinds of versions are listed
//    versions     what exists for a Pokémon (PokeAPI, GO, Mystery Dungeon, lore art)
//    cards        the card markup, favourites (★) and folding sections
//    pictures     loading card pictures (mirror fallback, sprites from your zip)
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_SPRITE_FILTERS } from '../../core/defaults';
import { entryById, formsByDex, isRankable } from '../../core/items';
import { autosave } from '../../core/persist';
import { state } from '../../core/state';
import type { ItemId, SpriteFilters } from '../../core/types';
import { byId, prettyName } from '../../lib/dom';
import { html, joinHtml, type SafeHtml } from '../../lib/html';
import { markPixelArt } from '../../lib/images';
import { closePopovers, placePopover, toast } from '../../lib/ui';
import {
    currentSectionName,
    describeSpritePath,
    GO_COSTUME_DIR,
    GO_DIR,
    loreDirFor,
    PMD_DIR,
    pad4,
    parseGoIcon,
    pokedex,
    prettyGoName,
    type SpriteDir,
    type SpriteDirFlags,
    spriteDirs,
    spriteExists,
    spriteKeysFor,
    spritePath,
} from '../../pokemon/data';
import { hasLocalSprite, spriteUrl } from '../../pokemon/local-source';
import { mirrorOrder, recordNetResult, spriteUrlsFor } from '../../pokemon/sprite-urls';
import { formsBar } from '../forms/forms';
import { gallery } from '../studio/gallery';
import { pickSprite } from './sprites';

// ═════════════════════════════════════════════════════════════════════════════
//  FILTERS
// ═════════════════════════════════════════════════════════════════════════════

export const FILTER_CHIPS: readonly [key: keyof SpriteFilters, label: string][] = [
    ['favs', '★ Favourites only'],
    ['lore', 'Lore & spin-offs'],
    ['go', 'Pokémon GO'],
    ['costumes', 'GO costumes'],
    ['pmd', 'PMD portraits'],
    ['emotions', 'PMD emotions'],
    ['forms', 'Other forms'],
    ['female', '♀ Female'],
    ['animated', 'Animated'],
    ['shiny', 'Shiny'],
    ['back', 'Back'],
    ['icons', 'Icons'],
    ['tints', 'Gray / GBC'],
];

/** "Basic": just the games' own front sprites. */
const BASIC_FILTERS: Partial<SpriteFilters> = {
    go: false,
    costumes: false,
    pmd: false,
    emotions: false,
    lore: false,
    icons: false,
    tints: false,
    back: false,
    favs: false,
};

const filterListeners: (() => void)[] = [];
/** Runs after the filters change (the studio and quick picker redraw). */
export const onFiltersChange = (listener: () => void): void => void filterListeners.push(listener);

export function setFilters(changes: Partial<SpriteFilters>): void {
    Object.assign(state.spriteFilters, changes);
    syncFilterChips();
    filterListeners.forEach((listener) => {
        listener();
    });
    autosave();
}

const toggleFilter = (key: keyof SpriteFilters): void => setFilters({ [key]: !state.spriteFilters[key] });

/** Lights up the chips that are on, and shows "9/12" on the Show ▾ button. */
export function syncFilterChips(): void {
    document.querySelectorAll<HTMLElement>('.chip[data-filter]').forEach((chip) => {
        chip.classList.toggle('on', !!state.spriteFilters[chip.dataset.filter as keyof SpriteFilters]);
    });
    const shown = FILTER_CHIPS.filter(([key]) => key !== 'favs' && state.spriteFilters[key]).length;
    byId('showcount').textContent = `${shown}/${FILTER_CHIPS.length - 1}`;
}

/** Whether a sprite folder's kind (shiny, back, …) is switched on. */
export const passesFilters = (flags: Partial<SpriteDirFlags>): boolean =>
    !(
        (flags.shiny && !state.spriteFilters.shiny) ||
        (flags.back && !state.spriteFilters.back) ||
        (flags.female && !state.spriteFilters.female) ||
        (flags.icon && !state.spriteFilters.icons) ||
        (flags.tint && !state.spriteFilters.tints) ||
        (flags.animated && !state.spriteFilters.animated)
    );

// ═════════════════════════════════════════════════════════════════════════════
//  VERSIONS
// ═════════════════════════════════════════════════════════════════════════════

export interface SpriteVersion {
    path: string;
    dir: SpriteDir;
    /** Sort order inside its section: 0 = the Pokémon itself, then its forms. */
    rank: number;
    /** Form, costume or artwork name ('' for the plain sprite). */
    formLabel: string;
    /** Extra tags shown after the name; the folder's own tags when absent. */
    tags?: string[];
}

/** Forms of a species that aren't ranked on their own (their sprites are listed with it). */
const mergedFormIds = (dex: number | null): ItemId[] =>
    (formsByDex.get(dex ?? -1) || []).filter((form) => !isRankable(form.id)).map((form) => form.id);

/** Every sprite version of a Pokémon that the filters let through, in display order. */
export function spriteVersionsFor(id: ItemId): SpriteVersion[] {
    const entry = entryById.get(id)!;
    const filters = state.spriteFilters;
    const versions: SpriteVersion[] = [];

    // PokeAPI: every game folder that has this Pokémon (or one of its forms)
    spriteKeysFor(id).forEach(([stem, formName, setIndex], rank) => {
        const isForm = stem !== String(id);
        if (isForm && !filters.forms) return;
        for (const dir of spriteDirs) {
            if (dir.go || dir.pmd || !spriteExists(stem, setIndex, dir.i) || !passesFilters(dir.info.flags)) continue;
            versions.push({ path: spritePath(dir, stem), dir, rank, formLabel: isForm ? prettyName(formName || stem) : '' });
        }
    });

    // Pokémon GO icons (and costumes)
    if (filters.go) {
        const stems = [String(id), ...(!entry.form && filters.forms ? mergedFormIds(entry.dex).map(String) : [])];
        stems.forEach((stem, rank) => {
            (pokedex.goIcons[stem] || []).forEach((core) => {
                const icon = parseGoIcon(core);
                if ((icon.shiny && !filters.shiny) || (icon.female && !filters.female) || (icon.costume && !filters.costumes)) return;
                const formLabel = rank > 0 ? entryById.get(Number(stem))!.name : icon.form && !entry.form ? prettyGoName(icon.form) : '';
                versions.push({
                    path: 'go:' + core,
                    dir: icon.costume ? GO_COSTUME_DIR : GO_DIR,
                    rank,
                    formLabel: icon.costume || formLabel,
                    tags: [icon.costume && formLabel ? formLabel : '', icon.female ? '♀' : '', icon.shiny ? 'shiny' : ''].filter(Boolean),
                });
            });
        });
    }

    // lore and spin-off art (Bulbagarden archives)
    if (filters.lore !== false) {
        const ids = [id, ...(!entry.form ? mergedFormIds(entry.dex) : [])];
        ids.forEach((owner, rank) => {
            (pokedex.lore[String(owner)] || []).forEach(([label, source, file, hash, hasBackground]) => {
                versions.push({
                    path: `lore:${hash}/${file}`,
                    dir: loreDirFor(source),
                    rank: rank + (hasBackground ? 0.5 : 0),
                    formLabel: rank ? entryById.get(owner)!.name + ': ' + label : label,
                    tags: hasBackground ? ['scene with background'] : [],
                });
            });
        });
    }

    // Mystery Dungeon portraits: one per emotion (bit i of a mask = emotion i exists)
    const portraits = !entry.form && pokedex.pmd.d[String(id)];
    if (filters.pmd && portraits) {
        const emotions = pokedex.pmd.emo;
        const [normalMask, shinyMask] = portraits;
        (
            [
                [normalMask, ''],
                [filters.shiny ? shinyMask : 0, '/0000/0001'],
            ] as const
        ).forEach(([mask, subfolder], rank) => {
            emotions.forEach((emotion, bit) => {
                if (!((mask >> bit) & 1) || (!filters.emotions && bit > 0)) return;
                versions.push({
                    path: `pmd:${pad4(id)}${subfolder}/${emotion}`,
                    dir: PMD_DIR,
                    rank,
                    formLabel: emotion === 'Normal' ? '' : emotion,
                    tags: rank ? ['shiny'] : [],
                });
            });
        });
        (pokedex.pmd.f[String(id)] || []).forEach(([folder, formName, mask], formIndex) => {
            emotions.forEach((emotion, bit) => {
                if (!((mask >> bit) & 1)) return;
                if (!filters.emotions && bit > 0) {
                    // without emotions: only the form's first portrait (Normal if it has one)
                    const firstBit = Math.log2(mask & -mask);
                    if (mask & 1 || bit !== firstBit) return;
                }
                versions.push({
                    path: `pmd:${folder}/${emotion}`,
                    dir: PMD_DIR,
                    rank: 2 + formIndex,
                    formLabel: formName + (emotion === 'Normal' ? '' : ` (${emotion})`),
                    tags: [],
                });
            });
        });
    }

    return versions.sort(
        (a, b) =>
            a.dir.info.order - b.dir.info.order ||
            a.dir.info.sec.localeCompare(b.dir.info.sec) ||
            a.rank - b.rank ||
            (a.dir.i || 0) - (b.dir.i || 0),
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  CARDS
// ═════════════════════════════════════════════════════════════════════════════

interface CardOptions {
    chosen?: boolean;
    /** Show a ★ button that stars this sprite for that item. */
    favouriteOf?: ItemId;
    /** Cards for many Pokémon at once (By Style) say which one each is. */
    itemId?: ItemId;
}

/** One clickable sprite card. Its picture tries each mirror in turn (see watchVersionPictures). */
export function spriteCard(path: string, label: SafeHtml | string, { chosen = false, favouriteOf, itemId }: CardOptions = {}): SafeHtml {
    const picture = hasLocalSprite(path)
        ? html`<img alt="" data-path="${path}" data-local="1" data-px data-var-error>`
        : path.startsWith('gal:')
          ? html`<img alt="" src="${gallery.get(path.slice(4))?.url || ''}" data-px>`
          : html`<img alt="" loading="lazy" decoding="async" data-path="${path}" data-m="0" src="${spriteUrlsFor(path)[0]}" data-var>`;
    const starred = favouriteOf != null && (state.favouriteSprites[favouriteOf] || []).includes(path);
    const star = favouriteOf != null && html`<button class="fav${starred ? ' on' : ''}" data-fav="${path}" title="Favourite">★</button>`;
    return html`<div class="vc${chosen ? ' chosen' : ''}"${itemId != null && html` data-id="${itemId}"`} data-path="${path}" title="${path}">${star}<div class="vimg">${picture}</div><div class="vl">${label}</div></div>`;
}

/** The "can't reach online sprites" note (filled in by renderNetState). */
export const NET_NOTE = html`<div class="netnote hid"><div class="nmsg"></div><button class="cbtn" data-click="zipinp">Load pokemon.zip</button></div>`;

/** "<b>Alolan</b>, shiny" under a card ('standard' for the plain sprite). */
function versionLabel(version: SpriteVersion): SafeHtml | string {
    const parts: (SafeHtml | string)[] = [
        version.formLabel && html`<b>${version.formLabel}</b>`,
        ...(version.tags || version.dir.info.tags),
    ].filter(Boolean);
    return parts.length ? joinHtml(parts, ', ') : 'standard';
}

const section = (name: string, count: number, cards: SafeHtml | SafeHtml[]): SafeHtml =>
    html`<div class="stsec"><h4 data-sec="${name}">${name}<em>${count}</em></h4><div class="stgrid">${cards}</div></div>`;

/** Everything shown for one Pokémon: forms bar, your images, favourites, then every version grouped by game. */
export function versionSections(id: ItemId): { html: SafeHtml; count: number } {
    const chosenPath = state.picks[id]?.path;
    const versions = spriteVersionsFor(id);
    const parts: SafeHtml[] = [formsBar(id), NET_NOTE];

    // your own images (uploads, paste, drag & drop)
    const yours = [...gallery.entries()].filter(([, picture]) => picture.id === id);
    const yourCards = yours.map(([key, picture]) =>
        spriteCard(
            'gal:' + key,
            html`<b>${picture.name || 'image'}</b><button class="gdel" data-k="${key}" title="Remove from your images">✕</button>`,
            { chosen: chosenPath === 'gal:' + key },
        ),
    );
    const addCard = html`<div class="vc gadd" title="Upload, paste (Ctrl/⌘+V) or drop images: fan art, anime/movie versions…"><div class="vimg gaddi">+</div><div class="vl"><b>Add image</b><br>upload, paste or drop</div></div>`;
    parts.push(section('Your images', yours.length, [...yourCards, addCard]));

    const favourites = state.favouriteSprites[id] || [];
    if (favourites.length) {
        const cards = favourites.map((path) => {
            const version = versions.find((v) => v.path === path);
            const label = version ? html`${version.dir.info.sec}<br>${versionLabel(version)}` : describeSpritePath(path);
            return spriteCard(path, label, { chosen: chosenPath === path, favouriteOf: id });
        });
        parts.push(section('★ Favourites', favourites.length, cards));
    } else if (state.spriteFilters.favs)
        parts.push(html`<div class="empty">No favourites yet. Turn off “★ Favourites only” and tap the ★ on sprites you like.</div>`);

    if (!state.spriteFilters.favs) {
        if (!versions.length) parts.push(html`<div class="empty">No sprites match the current "Show" filters.</div>`);
        const groups = new Map<string, SpriteVersion[]>();
        for (const version of versions) {
            const group = groups.get(version.dir.info.sec);
            if (group) group.push(version);
            else groups.set(version.dir.info.sec, [version]);
        }
        groups.forEach((group, name) => {
            parts.push(
                section(
                    name,
                    group.length,
                    group.map((v) => spriteCard(v.path, versionLabel(v), { chosen: chosenPath === v.path, favouriteOf: id })),
                ),
            );
        });
    }
    return { html: joinHtml(parts), count: versions.length };
}

/** A click on a card's ★: stars or unstars it. True if the click was a ★ (the caller redraws). */
export function toggleFavourite(e: Event, id: ItemId | null): boolean {
    const star = (e.target as HTMLElement).closest<HTMLElement>('.fav');
    if (!star || !id) return false;
    e.stopPropagation();
    const path = star.dataset.fav!;
    state.favouriteSprites[id] ??= [];
    const favourites = state.favouriteSprites[id];
    const index = favourites.indexOf(path);
    if (index >= 0) favourites.splice(index, 1);
    else favourites.push(path);
    if (!favourites.length) delete state.favouriteSprites[id];
    autosave();
    return true;
}

/**
 * A click on a sprite card: picks that version for the item and marks the card chosen
 * (unmarking `others`). False if the card can't be used or the sprite didn't load.
 */
export async function pickCard(card: HTMLElement, id: ItemId, others: Iterable<Element>): Promise<boolean> {
    const path = card.dataset.path;
    if (!path || card.classList.contains('missing') || card.classList.contains('busy')) return false;
    card.classList.add('busy');
    try {
        await pickSprite(id, path);
        for (const other of others) other.classList.remove('chosen');
        card.classList.add('chosen');
        return true;
    } catch {
        toast("Couldn't load that sprite. Online sprites may be blocked; load your pokemon.zip");
        return false;
    } finally {
        card.classList.remove('busy');
    }
}

// ── folding sections (remembered per section name, in this browser) ──
const COLLAPSED_KEY = 'pt_coll';
const collapsedSections = new Set<string>();
/** Each card area and its "Collapse all" button. */
const CARD_AREAS = [
    ['stmain', 'stcollbtn'],
    ['qpbody', 'qpcollbtn'],
] as const;

const sectionKey = (heading: HTMLElement): string => heading.dataset.sec || heading.firstChild?.textContent || '';

function saveCollapsed(): void {
    try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedSections]));
    } catch {}
}

/** Folds the sections of a freshly drawn card area that were folded before. */
export function applyCollapsed(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.stsec').forEach((sec) => {
        const heading = sec.querySelector<HTMLElement>('h4');
        if (heading) sec.classList.toggle('coll', collapsedSections.has(sectionKey(heading)));
    });
    syncCollapseButtons();
}

function syncCollapseButtons(): void {
    for (const [area, button] of CARD_AREAS) {
        const sections = [...byId(area).querySelectorAll('.stsec')];
        const allFolded = sections.length > 0 && sections.every((sec) => sec.classList.contains('coll'));
        byId(button).textContent = allFolded ? '⊞ Expand all' : '⊟ Collapse all';
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICTURES
// ═════════════════════════════════════════════════════════════════════════════

/** Sprites from your pokemon.zip load as their cards scroll into view. */
const lazyLocalPictures = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            lazyLocalPictures.unobserve(entry.target);
            void loadLocalPicture(entry.target as HTMLImageElement);
        }
    },
    { rootMargin: '300px' },
);

async function loadLocalPicture(img: HTMLImageElement): Promise<void> {
    try {
        img.src = await spriteUrl(img.dataset.path!);
    } catch {
        img.closest('.vc')?.classList.add('missing');
    }
}

/** Starts loading the zip sprites of a freshly drawn card area. */
export function hydrateImages(root: HTMLElement): void {
    root.querySelectorAll<HTMLImageElement>('.vimg img[data-local]').forEach((img) => {
        lazyLocalPictures.observe(img);
    });
}

/** Stops loading zip sprites of a card area that is being redrawn. */
export const forgetLazyImages = (): void => lazyLocalPictures.disconnect();

function onVersionPictureLoad(img: HTMLImageElement): void {
    markPixelArt(img);
    if (img.dataset.m != null && !img.dataset.path!.startsWith('lore:')) recordNetResult(true, mirrorOrder()[Number(img.dataset.m)]);
}

/** A card picture failed: try the next mirror, or mark the card missing. */
function onVersionPictureError(img: HTMLImageElement): void {
    if (img.dataset.m != null) {
        const next = Number(img.dataset.m) + 1;
        const urls = spriteUrlsFor(img.dataset.path!);
        if (next < urls.length) {
            img.dataset.m = String(next);
            img.src = urls[next]!;
            return;
        }
        if (!img.dataset.path!.startsWith('lore:')) recordNetResult(false);
    }
    img.closest('.vc')?.classList.add('missing');
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupVersions(): void {
    // card pictures: load and error don't bubble, so listen in the capture phase
    document.addEventListener(
        'load',
        (e) => {
            if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-var')) onVersionPictureLoad(e.target);
        },
        true,
    );
    document.addEventListener(
        'error',
        (e) => {
            const img = e.target;
            if (img instanceof HTMLImageElement && (img.hasAttribute('data-var') || img.hasAttribute('data-var-error')))
                onVersionPictureError(img);
        },
        true,
    );

    // Show ▾ chips (in the studio's popover and the quick picker)
    for (const container of ['fchips', 'qpchips']) {
        for (const [key, label] of FILTER_CHIPS) {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.dataset.filter = key;
            chip.textContent = label;
            chip.onclick = () => toggleFilter(key);
            byId(container).append(chip);
        }
    }
    byId('favquick').onclick = () => toggleFilter('favs');
    byId('fall').onclick = () => setFilters(Object.fromEntries(FILTER_CHIPS.map(([key]) => [key, key !== 'favs'])));
    byId('fdef').onclick = () => setFilters({ ...DEFAULT_SPRITE_FILTERS });
    byId('fbasic').onclick = () => setFilters(BASIC_FILTERS);
    for (const [button, popover] of [
        ['showbtn', 'showpop'],
        ['stmore', 'stmorepop'],
    ] as const) {
        byId(button).onclick = (e) => {
            const wasOpen = byId(popover).classList.contains('open');
            closePopovers();
            if (!wasOpen) placePopover(byId(popover), e.currentTarget as Element);
        };
    }

    // folding sections: click a heading, or Collapse / Expand all
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
        if (Array.isArray(saved))
            saved.forEach((key) => {
                collapsedSections.add(currentSectionName(String(key)));
            });
    } catch {}
    for (const [area, button] of CARD_AREAS) {
        byId(area).addEventListener(
            'click',
            (e) => {
                const heading = (e.target as HTMLElement).closest<HTMLElement>('.stsec h4');
                if (!heading) return;
                e.stopPropagation();
                const key = sectionKey(heading);
                if (!collapsedSections.delete(key)) collapsedSections.add(key);
                saveCollapsed();
                heading.parentElement!.classList.toggle('coll', collapsedSections.has(key));
                syncCollapseButtons();
            },
            true,
        );
        byId(button).onclick = () => {
            const headings = [...byId(area).querySelectorAll<HTMLElement>('.stsec h4')];
            const allFolded = headings.length > 0 && headings.every((h) => collapsedSections.has(sectionKey(h)));
            for (const heading of headings) {
                if (allFolded) collapsedSections.delete(sectionKey(heading));
                else collapsedSections.add(sectionKey(heading));
            }
            saveCollapsed();
            applyCollapsed(byId(area));
        };
    }
}
