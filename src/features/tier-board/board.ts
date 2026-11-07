// src/features/tier-board/board.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The tier board: tier rows, the pool (and its order), every item's tile, search
//  and filters, selection, and adding / moving / resetting tiers. Dragging is
//  drag.ts; the tier editor pop-up is tier-editor.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { onHistoryRestore, pushHistory } from '../../core/history';
import { dexLabel, entries, entryById, isOwnItem, isRankable, rankableEntries } from '../../core/items';
import { autosave } from '../../core/persist';
import { findTier, isPokemonList, itemWord, onListReset, spriteBlobs, state, tileById } from '../../core/state';
import { cropView, tileRatio } from '../../core/tile-box';
import type { Entry, ItemId, LabelMode, PoolSortBy, Tier } from '../../core/types';
import { setupChoiceMenu } from '../../lib/choice-menu';
import { byId, randomId, setStatus } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { markPixelArt } from '../../lib/images';
import { ask, toast } from '../../lib/ui';
import { POKEMON_TYPES } from '../../pokemon/data';
import { labelTextColor, rowBackground } from '../appearance/theme';
import { finder, updateFindCount } from '../find/find';
import { startHeadToHead } from '../head-to-head/head-to-head';
import { healSprite, showFallbackSprite, spriteCrop, spriteSrc, tryNextDefaultMirror } from '../sprites/sprites';
import { updateTagDots } from '../tags/tags';
import { applyBoardLayout, isChart } from './chart';
import { hideTip } from './hover-tip';
import { nextShuffleSeed, orderPool, POOL_SORT_LABELS } from './pool-order';
import { openTierEditor, palette } from './tier-editor';
import { pictureFit } from './tile-shape';

// ═════════════════════════════════════════════════════════════════════════════
//  TILES
// ═════════════════════════════════════════════════════════════════════════════

/** An item's tile: picture + number/name label. A picture that fails repairs itself or falls back. */
export function createTile(entry: Entry): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'pi';
    tile.dataset.id = String(entry.id);
    // focusable for keyboard ranking (tile-keys.ts); Tab lands on the area, arrows move between tiles
    tile.tabIndex = -1;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', entry.name);
    const frame = document.createElement('div');
    frame.className = 'pimg';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.loading = 'lazy'; // a Pokémon pool is 1,300 tiles: only the ones scrolled into view download
    img.addEventListener('load', () => markPixelArt(img));
    img.addEventListener('error', () => {
        if (img.dataset.fb || !img.getAttribute('src')) return;
        const id = Number(tile.dataset.id);
        if (state.picks[id] || spriteBlobs.has(id)) void healSprite(id);
        else if (!tryNextDefaultMirror(img, id)) showFallbackSprite(id);
    });
    frame.append(img);
    const label = document.createElement('span');
    label.className = 'pl';
    setHtml(label, html`<span class="pnum">${dexLabel(entry.id)}</span><span class="pname">${entry.name}</span>`);
    tile.append(frame, label);
    setTileImage(entry.id, tile);
    tileById.set(entry.id, tile);
    updateTagDots(entry.id);
    return tile;
}

/** Shows the item's picture on its tile. */
export function setTileImage(id: ItemId, tile = tileById.get(id)): void {
    if (!tile) return;
    const img = tile.querySelector('img')!;
    delete img.dataset.fb;
    delete img.dataset.mirror;
    img.src = spriteSrc(id);
    fitTilePicture(id, tile);
}

/**
 * Fits the picture to the tile's shape, whole or filling it (tile-shape.ts). Pictures with a crop
 * box (animated GIFs, which can't be re-encoded, and PokeAPI defaults) are scaled and shifted
 * inside the tile instead; text tiles always show whole, as their words would be cut off.
 */
export function fitTilePicture(id: ItemId, tile: HTMLElement): void {
    const img = tile.querySelector('img')!;
    img.classList.toggle('whole', !!state.picks[id]?.text);
    const crop = spriteCrop(id);
    if (!crop) {
        img.classList.remove('crop');
        img.style.cssText = '';
        return;
    }
    const view = cropView(crop, tileRatio(state.tileShape), pictureFit(id));
    img.classList.add('crop');
    img.style.width = (crop.W / view.width) * 100 + '%';
    img.style.height = (crop.H / view.height) * 100 + '%';
    img.style.left = (-view.x / view.width) * 100 + '%';
    img.style.top = (-view.y / view.height) * 100 + '%';
}

/** "+3" on a combined family's tile: how many variants it holds. */
export function updateFamilyBadge(id: ItemId): void {
    const tile = tileById.get(id);
    if (!tile) return;
    const entry = entryById.get(id);
    const count = entry?.nvar && state.combinedFamilies[id] ? entry.nvar : 0;
    let badge = tile.querySelector<HTMLElement>('.fbadge');
    if (!count) {
        badge?.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'fbadge';
        tile.append(badge);
    }
    badge.textContent = '+' + count;
    badge.title = `${count} variant${count > 1 ? 's' : ''} combined into this one`;
}

/** Refreshes every own item's "+3" badge (after families change). */
export function updateFamilyBadges(): void {
    tileById.forEach((_tile, id) => {
        if (entryById.get(id)?.custom) updateFamilyBadge(id);
    });
}

/** The tile for an item, created the first time it's needed. */
export const ensureTile = (id: ItemId): HTMLElement | undefined => {
    let tile = tileById.get(id);
    const entry = entryById.get(id);
    if (!tile && entry) {
        tile = createTile(entry);
        if (entry.custom) updateFamilyBadge(id);
    }
    return tile;
};

/** Width of a tier row's tile area, or of a chart cell's (export and drag use it). */
export let lastRowWidth = 0;
export function measureRowWidth(): void {
    const row = document.querySelector<HTMLElement>('.tcont');
    if (row && row.clientWidth > 0) lastRowWidth = row.clientWidth;
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIERS AND POOL
// ═════════════════════════════════════════════════════════════════════════════

/** Rebuilds every tier row, then puts the tiles in place. */
export function renderTiers(): void {
    const section = byId('tsec');
    section.replaceChildren();
    applyBoardLayout();
    // a chart adds cells with Add tier: a + between cells would take up a grid cell of its own
    const chart = isChart();
    const gap = (at: number) => {
        const element = document.createElement('div');
        element.className = 'tgap';
        setHtml(element, html`<button class="tadd" data-at="${at}" title="Add a tier here">+</button>`);
        return element;
    };
    state.tiers.forEach((tier, i) => {
        if (!chart) section.append(gap(i));
        section.append(tierRow(tier, i));
    });
    if (!chart) section.append(gap(state.tiers.length));
    placeAllTiles();
}

function tierRow(tier: Tier, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'trow';
    row.dataset.tid = tier.id;
    const label = document.createElement('div');
    label.className = 'tlbl';
    label.style.background = tier.color;
    label.style.color = labelTextColor(tier);
    label.title = `Click to edit the tier, or to move the selected ${itemWord(2)} here`;
    setHtml(label, html`<div class="tlbl-main">${tier.label}</div>${tier.subtitle && html`<div class="tlbl-sub">${tier.subtitle}</div>`}`);
    label.onclick = () => {
        if (state.selection.size) moveSelectionTo(tier.id);
        else openTierEditor(tier.id, label);
    };
    const tiles = document.createElement('div');
    tiles.className = 'tcont';
    tiles.dataset.tid = tier.id;
    tiles.style.background = rowBackground(tier.color);
    const controls = document.createElement('div');
    controls.className = 'tctrl';
    const button = (text: string, title: string, disabled: boolean, onClick: (e: MouseEvent) => void) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.title = title;
        b.disabled = disabled;
        b.onclick = onClick;
        return b;
    };
    const chart = isChart();
    controls.append(
        button(chart ? '←' : '↑', chart ? 'Move back one cell' : 'Move up', index === 0, () => moveTier(tier.id, -1)),
        button(chart ? '→' : '↓', chart ? 'Move on one cell' : 'Move down', index === state.tiers.length - 1, () => moveTier(tier.id, 1)),
        button('✎', 'Edit', false, (e) => openTierEditor(tier.id, e.currentTarget as Element)),
        button('⇅', 'Sort this tier head-to-head (this or that?)', tier.items.length < 3, () => void startHeadToHead(tier.id)),
    );
    row.append(label, tiles, controls);
    return row;
}

/** Puts every tile where it belongs: in its tier, or in the pool. */
export function placeAllTiles(): void {
    const ranked = new Set<ItemId>();
    for (const tier of state.tiers) {
        const row = document.querySelector(`.tcont[data-tid="${CSS.escape(tier.id)}"]`);
        if (!row) continue;
        const tiles = document.createDocumentFragment();
        for (const id of tier.items) {
            const tile = ensureTile(id);
            if (!tile) continue;
            tile.dataset.src = tier.id;
            tiles.append(tile);
            ranked.add(id);
        }
        row.replaceChildren(tiles);
    }
    const pool = document.createDocumentFragment();
    const unranked = entries.filter((entry) => !ranked.has(entry.id) && isRankable(entry.id));
    for (const entry of orderPool(unranked, state.poolOrder)) {
        const tile = ensureTile(entry.id)!;
        tile.dataset.src = 'pool';
        pool.append(tile);
    }
    const grid = byId('pgrid');
    grid.replaceChildren(pool);
    grid.dataset.empty = !isPokemonList() && !state.ownItems.length ? 'new' : '';
    applyFilters();
    syncSelection();
    syncPoolOrderButton();
    measureRowWidth();
    showRankedCount();
}

// ── the pool's order (display only: the saved order and the ranking stay as they are) ──
const poolSortLabel = (by: PoolSortBy): string => (by === 'added' && isPokemonList() ? 'Pokédex order' : POOL_SORT_LABELS[by]);

function syncPoolOrderButton(): void {
    const label = poolSortLabel(state.poolOrder.by);
    const button = byId('psortbtn');
    const caret = document.createElement('span');
    caret.textContent = '▾';
    caret.ariaHidden = 'true';
    button.replaceChildren(label, caret);
    button.setAttribute('aria-label', 'Pool order: ' + label);
    byId('psortmenu').querySelector('[data-choice="added"]')!.textContent = poolSortLabel('added');
}

const isPoolSort = (choice: string): choice is PoolSortBy => Object.hasOwn(POOL_SORT_LABELS, choice);

/** Choosing Shuffled always deals a new shuffle, even when the pool is shuffled already. */
function choosePoolOrder(choice: string): void {
    if (!isPoolSort(choice)) return;
    const reshuffle = choice === 'shuffled' && state.poolOrder.by === 'shuffled';
    const seed = choice === 'shuffled' ? nextShuffleSeed(state.poolOrder.seed) : state.poolOrder.seed;
    state.poolOrder = { by: choice, seed };
    placeAllTiles();
    autosave();
    if (reshuffle) toast('Shuffled again');
}

export function showRankedCount(): void {
    const ranked = state.tiers.reduce((sum, tier) => sum + tier.items.length, 0);
    setStatus(`${ranked} / ${rankableEntries().length} ranked`);
}

/** Every item that's in a tier. */
export const rankedIds = (): Set<ItemId> => new Set(state.tiers.flatMap((tier) => tier.items));

export const removeFromTiers = (ids: Iterable<ItemId>): void => {
    const remove = new Set(ids);
    for (const tier of state.tiers) tier.items = tier.items.filter((id) => !remove.has(id));
};

// ═════════════════════════════════════════════════════════════════════════════
//  SEARCH AND FILTERS
// ═════════════════════════════════════════════════════════════════════════════

/** Ranked items matching the search (so they can be found in the tiers), and which one is shown. */
export const search = { hits: [] as ItemId[], index: -1 };

/** Applies the search box, generation, type and tag filters to the pool, and highlights ranked matches. */
export function applyFilters(): void {
    const query = state.searchQuery.trim().toLowerCase().replace(/^#/, '');
    const isNumber = /^\d+$/.test(query);
    const tag = state.tagFilter !== 'all' ? state.tagFilter : null;
    const matches = (entry: Entry | undefined): boolean =>
        !!entry &&
        (!query || entry.lc.includes(query) || !!entry.alias?.includes(query) || (isNumber && String(entry.dex).startsWith(query))) &&
        (state.generationFilter === 'all' || String(entry.gen) === state.generationFilter) &&
        (state.typeFilter === 'all' || entry.types.includes(state.typeFilter)) &&
        (!tag || (state.tags[entry.id] || []).includes(tag) || !!entry.ftags?.includes(tag));
    let shown = 0;
    for (const tile of byId('pgrid').children as HTMLCollectionOf<HTMLElement>) {
        const show = matches(entryById.get(Number(tile.dataset.id)));
        tile.style.display = show ? '' : 'none';
        if (show) shown++;
    }
    byId('pcount').textContent = `${shown} shown`;
    // highlight matches that are already ranked, so nothing gets lost
    search.hits = [];
    const searching = !!query || !!tag;
    for (const tier of state.tiers)
        for (const id of tier.items) {
            const hit = searching && matches(entryById.get(id));
            tileById.get(id)?.classList.toggle('hit', hit);
            if (hit) search.hits.push(id);
        }
    search.index = -1;
    const hitButton = byId('hitbtn');
    hitButton.classList.toggle('hid', !search.hits.length);
    hitButton.textContent = `${search.hits.length} ranked ↓`;
    finder.pool = shown;
    updateFindCount();
}

/** Scrolls to the next (or previous) ranked match and flashes it. */
export function jumpToNextHit(direction = 1): void {
    const { hits } = search;
    if (!hits.length) return;
    search.index = search.index < 0 && direction < 0 ? hits.length - 1 : (search.index + direction + hits.length) % hits.length;
    const id = hits[search.index]!;
    const tile = tileById.get(id);
    if (!tile) return;
    tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tile.classList.remove('flash');
    void tile.offsetWidth; // restart the flash animation
    tile.classList.add('flash');
    const tier = state.tiers.find((t) => t.items.includes(id));
    byId('hitbtn').textContent = `${search.index + 1}/${hits.length}${tier ? ' in ' + tier.label : ''} ↓`;
    updateFindCount();
}

// ═════════════════════════════════════════════════════════════════════════════
//  SELECTION
// ═════════════════════════════════════════════════════════════════════════════

/** A click on a tile: which item, where it sits ('pool' or a tier id), and the modifier keys. */
export interface TileClick {
    id: ItemId;
    src: string;
    shift: boolean;
    meta: boolean;
}
let lastClick: { id: ItemId; src: string } | null = null;

/** Item ids in screen order for 'pool' (visible tiles only) or a tier. */
export function orderedIds(where: string): ItemId[] {
    if (where === 'pool')
        return [...(byId('pgrid').children as HTMLCollectionOf<HTMLElement>)]
            .filter((tile) => tile.style.display !== 'none')
            .map((tile) => Number(tile.dataset.id));
    return (findTier(where)?.items || []).slice();
}

/** Click selects/unselects; Shift+click selects a range; Ctrl/⌘+click adds from another area. */
export function onTileClick(click: TileClick): void {
    const { id, src } = click;
    if (click.shift && lastClick && lastClick.src === src && state.selectionSource === src) {
        const ids = orderedIds(src);
        let from = ids.indexOf(lastClick.id);
        let to = ids.indexOf(id);
        if (from > to) [from, to] = [to, from];
        if (from >= 0)
            ids.slice(from, to + 1).forEach((x) => {
                state.selection.add(x);
            });
    } else if (state.selection.has(id)) {
        state.selection.delete(id);
        if (!state.selection.size) state.selectionSource = null;
    } else {
        if (state.selectionSource && state.selectionSource !== src && state.selectionSource !== 'mixed' && !click.meta) {
            state.selection.clear();
            state.selectionSource = null;
        }
        state.selection.add(id);
        state.selectionSource = !state.selectionSource || state.selectionSource === src ? src : 'mixed';
    }
    lastClick = { id, src };
    syncSelection();
}

export function clearSelection(): void {
    state.selection.clear();
    state.selectionSource = null;
    syncSelection();
}

/** Shows the selection on the tiles and in the selection bar. */
export function syncSelection(): void {
    tileById.forEach((tile, id) => {
        const selected = state.selection.has(id);
        tile.classList.toggle('sel', selected);
        tile.ariaPressed = String(selected);
    });
    byId('selbar').classList.toggle('show', state.selection.size > 0 && state.view === 'tier');
    byId('clrselbtn').classList.toggle('hid', !state.selection.size);
    byId('selcount').textContent = `${state.selection.size} selected`;
    const selected = [...state.selection];
    byId('selmerge').classList.toggle('hid', selected.filter(isOwnItem).length < 2);
    const ranked = rankedIds();
    byId('seltopool').classList.toggle('hid', !selected.some((id) => ranked.has(id)));
    // only your own items can be deleted (a pack's Pokémon can't), and only all together
    byId('seldel').classList.toggle('hid', !selected.length || !selected.every(isOwnItem));
}

/** The selection in screen order (tiers top to bottom, then the pool). */
export function selectedInOrder(): ItemId[] {
    const onScreen = [...document.querySelectorAll<HTMLElement>('#tsec .pi, #pgrid .pi')]
        .map((tile) => Number(tile.dataset.id))
        .filter((id) => state.selection.has(id));
    const seen = new Set(onScreen);
    return [...onScreen, ...[...state.selection].filter((id) => !seen.has(id))];
}

export function selectAllIn(area: 'tiers' | 'pool'): void {
    state.selection.clear();
    if (area === 'tiers') {
        for (const tier of state.tiers) for (const id of tier.items) state.selection.add(id);
        state.selectionSource = 'mixed';
    } else {
        orderedIds('pool').forEach((id) => {
            state.selection.add(id);
        });
        state.selectionSource = 'pool';
    }
    if (!state.selection.size) state.selectionSource = null;
    syncSelection();
}

export function moveSelectionTo(tierId: string): void {
    pushHistory();
    const ids = selectedInOrder();
    removeFromTiers(ids);
    findTier(tierId)!.items.push(...ids);
    clearSelection();
    placeAllTiles();
    autosave();
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHANGING TIERS
// ═════════════════════════════════════════════════════════════════════════════

export async function resetList(): Promise<void> {
    const ranked = rankedIds().size;
    if (!ranked) {
        toast('Nothing ranked yet');
        return;
    }
    if (
        !(await ask(
            `Move all ${ranked} ranked ${itemWord(ranked)} back to the pool? Tiers, colours, sprites and tags stay. You can undo with Ctrl/⌘+Z.`,
            'Reset list',
            true,
        ))
    )
        return;
    pushHistory();
    for (const tier of state.tiers) tier.items = [];
    clearSelection();
    placeAllTiles();
    autosave();
    toast('List reset. Ctrl/⌘+Z to undo');
}

/** A tier in the next colour of the palette. */
export const newTier = (paletteIndex: number, label = 'New tier'): Tier => ({
    id: randomId(),
    label,
    subtitle: '',
    color: palette[paletteIndex % palette.length]!,
    textColor: '',
    items: [],
});

/** Adds a tier at the bottom and opens its editor. */
export function addTier(): void {
    pushHistory();
    const tier = newTier(state.tiers.length);
    state.tiers.push(tier);
    renderTiers();
    autosave();
    const rows = document.querySelectorAll<HTMLElement>('.trow');
    const last = rows[rows.length - 1]!;
    last.scrollIntoView({ block: 'nearest' });
    openTierEditor(tier.id, last.firstElementChild!);
}

/** Adds a tier at position `at` (the + between two tiers) and opens its editor. */
export function insertTier(at: number): void {
    pushHistory();
    const tier = newTier(at + 3);
    state.tiers.splice(at, 0, tier);
    renderTiers();
    autosave();
    const label = document.querySelector(`.trow[data-tid="${CSS.escape(tier.id)}"] .tlbl`);
    if (label) openTierEditor(tier.id, label);
}

export function moveTier(tierId: string, direction: number): void {
    pushHistory();
    const from = state.tiers.findIndex((t) => t.id === tierId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= state.tiers.length) return;
    [state.tiers[from], state.tiers[to]] = [state.tiers[to]!, state.tiers[from]!];
    renderTiers();
    autosave();
}

// ═════════════════════════════════════════════════════════════════════════════
//  WIRING (runs once at start-up, from main.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Names / numbers under tiles (the Labels menu). */
export function applyLabelMode(): void {
    byId<HTMLSelectElement>('lblsel').value = state.labelMode;
    document.body.classList.remove('lbl-off', 'lbl-name', 'lbl-num', 'lbl-both');
    document.body.classList.add('lbl-' + state.labelMode);
}

export function syncHoverButton(): void {
    const button = byId('hoverbtn');
    button.textContent = 'Hover: ' + (state.showHoverInfo ? 'On' : 'Off');
    button.classList.toggle('cbtn', state.showHoverInfo);
}

export function setupBoard(): void {
    onListReset(() => {
        byId('tsec').replaceChildren();
        byId('pgrid').replaceChildren();
    });
    onHistoryRestore(() => {
        updateFamilyBadges();
        clearSelection();
        renderTiers();
    });
    byId('seltopool').onclick = () => {
        pushHistory();
        removeFromTiers([...state.selection]);
        clearSelection();
        placeAllTiles();
        autosave();
    };
    byId('selclr').onclick = clearSelection;
    byId('tsec').addEventListener('click', (e) => {
        const add = (e.target as HTMLElement).closest<HTMLElement>('.tadd');
        if (add) insertTier(Number(add.dataset.at));
    });

    // sizes, labels, hover
    const root = document.documentElement.style;
    byId<HTMLInputElement>('szsl').oninput = (e) => {
        state.tileSize = Number((e.target as HTMLInputElement).value);
        byId('szval').textContent = state.tileSize + 'px';
        root.setProperty('--sz', state.tileSize + 'px');
    };
    byId('szsl').onchange = () => {
        measureRowWidth();
        autosave();
    };
    byId<HTMLInputElement>('pszsl').oninput = (e) => {
        state.poolTileSize = Number((e.target as HTMLInputElement).value);
        root.setProperty('--psz', state.poolTileSize + 'px');
    };
    byId('pszsl').onchange = autosave;
    byId<HTMLSelectElement>('lblsel').onchange = (e) => {
        state.labelMode = (e.target as HTMLSelectElement).value as LabelMode;
        applyLabelMode();
        autosave();
    };
    byId('hoverbtn').onclick = () => {
        state.showHoverInfo = !state.showHoverInfo;
        if (!state.showHoverInfo) hideTip();
        syncHoverButton();
        autosave();
    };
    byId('addtbtn').onclick = addTier;
    byId('resetbtn').onclick = () => void resetList();

    // the pool's search box (the floating Find bar in find.ts shares the same search)
    const searchBox = byId<HTMLInputElement>('psearch');
    searchBox.oninput = () => {
        state.searchQuery = searchBox.value;
        byId<HTMLInputElement>('findin').value = state.searchQuery;
        applyFilters();
    };
    searchBox.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            jumpToNextHit(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            searchBox.value = '';
            state.searchQuery = '';
            byId<HTMLInputElement>('findin').value = '';
            applyFilters();
            searchBox.blur();
        }
    };
    byId('hitbtn').onclick = () => jumpToNextHit();

    // filters
    byId<HTMLSelectElement>('gensel').onchange = (e) => {
        state.generationFilter = (e.target as HTMLSelectElement).value;
        applyFilters();
    };
    byId<HTMLSelectElement>('typesel').onchange = (e) => {
        state.typeFilter = (e.target as HTMLSelectElement).value;
        applyFilters();
    };
    for (let gen = 1; gen <= 9; gen++) for (const select of ['gensel', 'stgen']) byId(select).append(new Option('Gen ' + gen, String(gen)));
    for (const type of POKEMON_TYPES) byId('typesel').append(new Option(type, type));

    // select all / none in the pool
    byId('selallbtn').onclick = () => selectAllIn('pool');
    setupChoiceMenu({ buttonId: 'psortbtn', menuId: 'psortmenu', current: () => state.poolOrder.by, choose: choosePoolOrder });
    byId('clrselbtn').onclick = clearSelection;
}
