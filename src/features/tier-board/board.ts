// src/features/tier-board/board.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The tier board in Tierinator: the engine's board (tier-engine/board) mounted
//  on #tsec and #pgrid, with this app's items, pictures and screens plugged in
//  through its options. The engine draws the tiers, the pool and the tiles, and
//  does dragging, keyboard moves and selection; here are what Tierinator adds
//  around it (the Focus line, search, the selection bar, the pool's order menu,
//  the sliders) and the functions the rest of the app calls to change the board.
// ─────────────────────────────────────────────────────────────────────────────

import { type BoardHandle, type FilterResult, fitPictureInTile, mountBoard } from 'tier-engine/board';
import type { BoardItem, ItemSource, Picture } from 'tier-engine/core';
import { html, setHtml } from 'tier-engine/safe';
import { listHistory, onHistoryRestore, pushHistory } from '../../core/history';
import { entryById, isOwnItem, rankableEntries } from '../../core/items';
import { autosave } from '../../core/persist';
import { isPokemonList, itemWord, onListReset, spriteBlobs, state, tileById } from '../../core/state';
import type { ItemId, LabelMode, PoolSortBy, Tier } from '../../core/types';
import { setupChoiceMenu } from '../../lib/choice-menu';
import { byId, setStatus } from '../../lib/dom';
import { markPixelArt } from '../../lib/images';
import { ask, toast } from '../../lib/ui';
import { focusSummary, isFocusEmpty, matchesFocus } from '../../pokemon/facets';
import { labelTextColor, rowBackground } from '../appearance/theme';
import { finder, updateFindCount } from '../find/find';
import { startHeadToHead } from '../head-to-head/head-to-head';
import { openItemEditor } from '../items/item-editor';
import { openQuickPicker } from '../quick-picker/quick-picker';
import { healSprite, showFallbackSprite, spriteCrop, spriteSrc, tryNextDefaultMirror } from '../sprites/sprites';
import { updateTagDots } from '../tags/tags';
import { hideTip } from './hover-tip';
import { POOL_SORT_LABELS } from './pool-order';
import { openTierEditor, palette } from './tier-editor';

/** The mounted board (setupBoard, at start-up). */
let board: BoardHandle;

// ═════════════════════════════════════════════════════════════════════════════
//  ITEMS AND PICTURES (the board's item source)
// ═════════════════════════════════════════════════════════════════════════════

/** What a tile shows: the picked picture (or the item's default), its crop box, and whether it's a text tile. */
function pictureOf(id: ItemId): Picture {
    const crop = spriteCrop(id);
    return { src: spriteSrc(id), ...(crop ? { crop } : {}), ...(state.picks[id]?.text ? { whole: true } : {}) };
}

/** The open list's items: Pokémon and forms on a Pokémon list, and your own items (core/items.ts). */
const source: ItemSource = {
    id: 'tierinator',
    items: rankableEntries,
    item: (id) => entryById.get(id),
    picture: (item: BoardItem) => pictureOf(item.id),
    pictureFailed(item, img) {
        if (img.dataset.fb) return;
        const id = item.id;
        if (state.picks[id] || spriteBlobs.has(id)) void healSprite(id);
        else if (!tryNextDefaultMirror(img, id)) showFallbackSprite(id);
    },
};

// ═════════════════════════════════════════════════════════════════════════════
//  TILES
// ═════════════════════════════════════════════════════════════════════════════

/** Shows the item's picture on its tile again (after its pick changed). */
export const setTileImage = (id: ItemId): void => board.refreshPicture(id);

/** Fits an item's picture to a frame of the tile's shape: its board tile, or another frame (the grid's cells). */
export function fitTilePicture(id: ItemId, frame: HTMLElement): void {
    const img = frame.querySelector('img');
    if (img) fitPictureInTile(img, pictureOf(id), state.tileShape, state.tileFit);
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
export const ensureTile = (id: ItemId): HTMLElement | undefined => board.tile(id);

/** Width of a tier row's tile area, or of a chart cell's (export and drag use it). */
export const rowWidth = (): number => board.rowWidth();
export const measureRowWidth = (): void => board.measure();

// ═════════════════════════════════════════════════════════════════════════════
//  TIERS AND POOL
// ═════════════════════════════════════════════════════════════════════════════

/** Rebuilds every tier row, then puts the tiles in place. */
export const renderTiers = (): void => board.render();

/** Puts every tile where it belongs: in its tier, or in the pool. */
export const placeAllTiles = (): void => board.place();

/** Lays the board out again for the list's layout, labels, tile shape and fit (Style's controls). */
export const refitBoard = (): void => board.refit();

/** After every placement: the pool's empty-list hint, its order button, the ranked count. */
function afterPlacing(): void {
    byId('pgrid').dataset.empty = !isPokemonList() && !state.ownItems.length ? 'new' : '';
    syncPoolOrderButton();
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
    if (board.setPoolOrder(choice)) toast('Shuffled again');
}

export function showRankedCount(): void {
    const ranked = state.tiers.reduce((sum, tier) => sum + tier.items.length, 0);
    setStatus(`${ranked} / ${rankableEntries().length} ranked`);
}

/** Every item that's in a tier. */
export const rankedIds = (): Set<ItemId> => board.rankedIds();

export const removeFromTiers = (ids: Iterable<ItemId>): void => board.removeFromTiers(ids);

// ═════════════════════════════════════════════════════════════════════════════
//  SEARCH AND FILTERS
// ═════════════════════════════════════════════════════════════════════════════

/** A Pokémon list with something chosen in the Focus bar (features/focus). */
export const isFocused = (): boolean => isPokemonList() && !isFocusEmpty(state.focus);

/** False for an item the Focus bar hides (in the pool and in the tiers). */
export function inFocus(id: ItemId): boolean {
    if (!isFocused()) return true;
    const entry = entryById.get(id);
    return !!entry && matchesFocus(entry, state.focus);
}

/** Ranked items matching the search (so they can be found in the tiers), and which one is shown (Find reads it). */
export const search = { hits: [] as ItemId[], index: -1 };

const searchQuery = (): string => state.searchQuery.trim().toLowerCase().replace(/^#/, '');
const tagFilter = (): string | null => (state.tagFilter !== 'all' ? state.tagFilter : null);

/** The search box and the tag filter: names, combined families' variant names, Pokédex numbers, tags. */
function matchesSearch(id: ItemId): boolean {
    const entry = entryById.get(id);
    if (!entry) return false;
    const query = searchQuery();
    const tag = tagFilter();
    const isNumber = /^\d+$/.test(query);
    return (
        (!query || entry.lc.includes(query) || !!entry.alias?.includes(query) || (isNumber && String(entry.dex).startsWith(query))) &&
        (!tag || (state.tags[entry.id] || []).includes(tag) || !!entry.ftags?.includes(tag))
    );
}

/**
 * Applies the search box, the Focus bar and the tag filter to the pool, hides what the Focus bar leaves out of the
 * tiers, and highlights ranked search matches.
 */
export const applyFilters = (): void => board.filter();

/** What filtering showed: the pool's count, the ⇅ buttons, the Focus line, the ranked-hits button, Find's count. */
function showFilterResult(result: FilterResult): void {
    byId('pcount').textContent = `${result.poolShown} shown`;
    const focused = isFocused();
    for (const tier of state.tiers) {
        // ⇅ sorts what's shown: two or more with Focus on, three or more otherwise
        const sortButton = document.querySelector<HTMLButtonElement>(`.trow[data-tid="${CSS.escape(tier.id)}"] .h2hbtn`);
        if (sortButton) sortButton.disabled = (result.shownByTier.get(tier.id) ?? 0) < (focused ? 2 : 3);
    }
    showFocusBar(result.rankedShown, result.ranked);
    search.hits = result.hits;
    search.index = -1;
    const hitButton = byId('hitbtn');
    hitButton.classList.toggle('hid', !result.hits.length);
    hitButton.textContent = `${result.hits.length} ranked ↓`;
    finder.pool = result.poolShown;
    updateFindCount();
}

/** The line above the tiers while the Focus bar hides some of them: what's shown, and how many. */
function showFocusBar(shown: number, ranked: number): void {
    const bar = byId('focusbar');
    const focused = isFocused();
    bar.classList.toggle('hid', !focused);
    document.body.classList.toggle('focused', focused);
    if (!focused) {
        shownLine = '';
        return;
    }
    // it's a live region: rewrite it only when it says something new (search keystrokes and drags call this too)
    const line = `${focusSummary(state.focus)}|${shown}|${ranked}`;
    if (line === shownLine) return;
    shownLine = line;
    setHtml(byId('focustext'), html`Showing <b>${focusSummary(state.focus)}</b><span class="note">${shown} of ${ranked} ranked</span>`);
}
let shownLine = '';

/** Scrolls to the next (or previous) ranked match and flashes it. */
export function jumpToNextHit(direction = 1): void {
    const hit = board.nextHit(direction);
    if (!hit) return;
    search.index = hit.index;
    byId('hitbtn').textContent = `${hit.index + 1}/${hit.total}${hit.tier ? ' in ' + hit.tier.label : ''} ↓`;
    updateFindCount();
}

// ═════════════════════════════════════════════════════════════════════════════
//  SELECTION
// ═════════════════════════════════════════════════════════════════════════════

/** Item ids in screen order for 'pool' or a tier (shown ones only). */
export const orderedIds = (where: string): ItemId[] => board.orderedIds(where);

export const clearSelection = (): void => board.clearSelection();

/** Shows the selection on the tiles and in the selection bar. */
export const syncSelection = (): void => board.select(state.selection, state.selectionSource);

/** The selection bar and its buttons, for what's selected now. */
function showSelectionBar(): void {
    byId('selbar').classList.toggle('show', state.selection.size > 0 && state.view === 'tier');
    byId('clrselbtn').classList.toggle('hid', !state.selection.size);
    byId('selcount').textContent = `${state.selection.size} selected`;
    const selected = [...state.selection];
    byId('selmerge').classList.toggle('hid', selected.filter(isOwnItem).length < 2);
    const ranked = new Set(state.tiers.flatMap((tier) => tier.items));
    byId('seltopool').classList.toggle('hid', !selected.some((id) => ranked.has(id)));
    // only your own items can be deleted (a pack's Pokémon can't), and only all together
    byId('seldel').classList.toggle('hid', !selected.length || !selected.every(isOwnItem));
}

/** The selection in screen order (tiers top to bottom, then the pool). */
export const selectedInOrder = (): ItemId[] => board.selectedInOrder();

export const selectAllIn = (area: 'tiers' | 'pool'): void => board.selectAllIn(area);

export const moveSelectionTo = (tierId: string): void => board.moveSelectionTo(tierId);

/** Which area the pointer was last over, for Ctrl/⌘+A. */
export const pointerArea = (): 'tiers' | 'pool' => board.pointerArea();

/** True while tiles are being dragged (the hover tip stays quiet). */
export const isDragging = (): boolean => board.isDragging();

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
export const newTier = (paletteIndex: number, label = 'New tier'): Tier => board.newTier(paletteIndex, label);

/** Adds a tier at the bottom and opens its editor. */
export const addTier = (): void => board.addTier();

// ═════════════════════════════════════════════════════════════════════════════
//  WIRING (runs once at start-up, from start.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Names / numbers under tiles (the Labels menu). */
export function applyLabelMode(): void {
    byId<HTMLSelectElement>('lblsel').value = state.labelMode;
    document.body.classList.remove('lbl-off', 'lbl-name', 'lbl-num', 'lbl-both');
    document.body.classList.add('lbl-' + state.labelMode);
    board.refit();
}

export function syncHoverButton(): void {
    const button = byId('hoverbtn');
    button.textContent = 'Hover: ' + (state.showHoverInfo ? 'On' : 'Off');
    button.classList.toggle('cbtn', state.showHoverInfo);
}

/** ⇅ on each tier: sort it head to head (features/head-to-head); applyFilters keeps it in step with what Focus shows. */
function headToHeadButton(tier: Tier): HTMLElement {
    const button = document.createElement('button');
    button.textContent = '⇅';
    button.title = 'Sort this tier head-to-head (this or that?)';
    button.disabled = tier.items.length < 3;
    button.className = 'h2hbtn';
    button.onclick = () => void startHeadToHead(tier.id);
    return button;
}

export function setupBoard(): void {
    board = mountBoard(byId('tsec'), {
        list: state,
        source,
        pool: byId('pgrid'),
        poolArea: byId('psec'),
        tiersHeader: byId('focusbar'),
        ghost: byId('dghost'),
        marquee: byId('marq'),
        tileStore: tileById,
        history: listHistory,
        palette: () => palette,
        itemWord,
        visible: inFocus,
        matches: matchesSearch,
        searching: () => !!searchQuery() || !!tagFilter(),
        active: () => state.view === 'tier',
        tierStyle: (tier) => ({
            label: { background: tier.color, color: labelTextColor(tier) },
            row: rowBackground(tier.color),
        }),
        tierControls: (tier) => [headToHeadButton(tier)],
        decorate(_tile, item) {
            updateTagDots(item.id);
            if (entryById.get(item.id)?.custom) updateFamilyBadge(item.id);
        },
        pictureLoaded: markPixelArt,
        onChange: autosave,
        onSelect: showSelectionBar,
        onTileOpen(id) {
            if (isOwnItem(id)) openItemEditor(id);
            else if (isPokemonList()) openQuickPicker(id);
        },
        onTierOpen: openTierEditor,
        onFilter: showFilterResult,
        onPlace: afterPlacing,
        onDragStart: hideTip,
        notify: (message) => toast(message),
    });
    onListReset(() => board.reset());
    // undo and redo redraw every tile: keep the keyboard where it was
    let focusedBeforeRestore: ItemId | null = null;
    const isTile = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('pi');
    document.addEventListener('focusin', (e) => {
        focusedBeforeRestore = isTile(e.target as Element) ? Number((e.target as HTMLElement).dataset.id) : null;
    });
    onHistoryRestore(() => {
        updateFamilyBadges();
        clearSelection();
        renderTiers();
        if (focusedBeforeRestore != null && !isTile(document.activeElement)) board.focus(focusedBeforeRestore);
    });
    byId('seltopool').onclick = () => {
        pushHistory();
        removeFromTiers([...state.selection]);
        clearSelection();
        placeAllTiles();
        autosave();
    };
    byId('selclr').onclick = clearSelection;

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

    // the studio list's generation filter
    for (let gen = 1; gen <= 9; gen++) byId('stgen').append(new Option('Gen ' + gen, String(gen)));

    // select all / none in the pool
    byId('selallbtn').onclick = () => selectAllIn('pool');
    setupChoiceMenu({ buttonId: 'psortbtn', menuId: 'psortmenu', current: () => state.poolOrder.by, choose: choosePoolOrder });
    byId('clrselbtn').onclick = clearSelection;
}
