// src/features/lists/lists.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Your tier lists: opening one (its items, tiers, settings and pictures), making
//  a new one, duplicating, deleting, and the list menu (#listpop) that shows them
//  all plus the installed packs.
// ─────────────────────────────────────────────────────────────────────────────
import { ALIGNMENT_CHART, CHART_COLUMNS, makePresetTiers, OWN_ITEM_ID_START } from '../../core/defaults';
import { entryById, isRankable, rebuildAliases, rebuildEntries } from '../../core/items';
import { autosave, saveNow } from '../../core/persist';
import { readOwnItems, readStored } from '../../core/snapshot';
import {
    addListMeta,
    currentListMeta,
    isPokemonList,
    listOpened,
    loadListIndex,
    resetListState,
    saveListIndex,
    session,
    spriteBlobs,
    spriteUrls,
    state,
} from '../../core/state';
import { copyByPrefix, deleteByPrefix, deleteImage, readByPrefix } from '../../core/storage';
import type { Crop, ItemId, ListKind } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId, randomId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { checkedImage, dataUrlToBlob, isImageBlob, objectUrlFor } from '../../lib/images';
import { ask, closePopovers, placePopover, popoverAnchor, toast } from '../../lib/ui';
import { pokedex } from '../../pokemon/data';
import { POKEAPI_SPRITES } from '../../pokemon/sprite-urls';
import { applyTheme, sanitizeTheme } from '../appearance/theme';
import { buildFormPanel, syncFormPanel } from '../forms/forms';
import { applyPoolLayout, readView, togglePool, toggleTopBar } from '../layout/layout';
import { renderListButton } from '../layout/top-bar';
import { genericPacks, installPokemonPackIfAvailable } from '../packs/packs';
import {
    pickSprite,
    repairAnimatedPicks,
    restorePickedSprites,
    setPick,
    showPicksWhileTheyLoad,
    undoBackgroundRemoval,
} from '../sprites/sprites';
import { syncFilterChips } from '../sprites/versions';
import { renderCustomStudio } from '../studio/custom-studio';
import { extraPictures } from '../studio/gallery';
import { buildStudioList } from '../studio/studio';
import { refreshTagUI } from '../tags/tags';
import { applyLabelMode, renderTiers, syncHoverButton } from '../tier-board/board';
import { loadPalette } from '../tier-board/tier-editor';

// ═════════════════════════════════════════════════════════════════════════════
//  OPENING A LIST
// ═════════════════════════════════════════════════════════════════════════════

/** Loads a stored list into the open list's state (items must already be in place). */
export function applySnapshot(raw: unknown): void {
    const read = readStored(raw, (id) => entryById.has(id), randomId);
    state.packId = read.packId;
    state.familyOf = read.familyOf;
    state.combinedFamilies = read.combinedFamilies;
    rebuildAliases();
    state.notes = read.notes;
    if (read.tags) state.tags = read.tags;
    if (read.poolHidden != null) state.poolHidden = read.poolHidden;
    if (read.splitFormCategories) state.splitFormCategories = { ...state.splitFormCategories, ...read.splitFormCategories };
    if (read.formOverrides) state.formOverrides = { ...read.formOverrides };
    if (read.tiers) {
        state.tiers = read.tiers;
        // a form that's ranked stays its own entry even if its category is merged
        for (const tier of state.tiers) for (const id of tier.items) if (!isRankable(id)) state.formOverrides[id] = true;
    }
    if (read.layout) state.layout = read.layout;
    if (read.chartColumns) state.chartColumns = read.chartColumns;
    if (read.tileSize) state.tileSize = read.tileSize;
    if (read.tileShape) state.tileShape = read.tileShape;
    if (read.tileFit) state.tileFit = read.tileFit;
    if (read.poolTileSize) state.poolTileSize = read.poolTileSize;
    if (read.poolHeight != null) state.poolHeight = read.poolHeight;
    if (read.poolWidth != null) state.poolWidth = read.poolWidth;
    if (read.poolOrder) state.poolOrder = read.poolOrder;
    if (read.labelMode) state.labelMode = read.labelMode;
    if (read.showHoverInfo != null) state.showHoverInfo = read.showHoverInfo;
    if (read.theme) state.theme = sanitizeTheme(read.theme);
    else if (read.backgroundColor) state.theme.bg = read.backgroundColor;
    if (read.poolAsSidebar != null) state.poolAsSidebar = read.poolAsSidebar;
    if (read.exportOptions) state.exportOptions = { ...state.exportOptions, ...read.exportOptions };
    if (read.trimSprites != null) state.trimSprites = read.trimSprites;
    Object.assign(state.favouriteSprites, read.favouriteSprites);
    if (read.studioCardSize) state.studioCardSize = read.studioCardSize;
    if (read.spriteFilters) state.spriteFilters = { ...state.spriteFilters, ...read.spriteFilters };
    Object.assign(state.picks, read.picks);
    // very old files: chosen sprite addresses instead of picks
    for (const [key, url] of Object.entries(read.chosenSprites))
        if (!state.picks[key]) state.picks[key] = { path: url.startsWith(POKEAPI_SPRITES) ? url.slice(POKEAPI_SPRITES.length) : url };
}

/** Puts the open list's settings on screen (sizes, labels, theme, export options, pool and bar). */
export function applySettings(): void {
    const root = document.documentElement.style;
    root.setProperty('--sz', state.tileSize + 'px');
    root.setProperty('--psz', state.poolTileSize + 'px');
    byId<HTMLInputElement>('pszsl').value = String(state.poolTileSize);
    applyPoolLayout();
    root.setProperty('--vc', state.studioCardSize + 'px');
    applyTheme();
    byId<HTMLInputElement>('szsl').value = String(state.tileSize);
    byId('szval').textContent = state.tileSize + 'px';
    applyLabelMode();
    syncHoverButton();
    byId<HTMLSelectElement>('explbl').value = state.exportOptions.labelMode;
    byId<HTMLSelectElement>('exppx').value = String(state.exportOptions.imageSize);
    byId<HTMLInputElement>('expempty').checked = !!state.exportOptions.includeEmptyTiers;
    byId<HTMLInputElement>('expnotes').checked = !!state.exportOptions.includeNotes;
    byId<HTMLInputElement>('exptitle').checked = state.exportOptions.includeTitle;
    byId<HTMLInputElement>('exppool').checked = state.exportOptions.includeUnranked;
    byId<HTMLInputElement>('expcredit').checked = state.exportOptions.includeCredit;
    // the hidden pool / top bar you left last time wins over the list's own setting
    const view = readView();
    if (view) {
        state.poolHidden = !!view.pool;
        if (!!view.bar !== !!state.topBarHidden) toggleTopBar(!!view.bar);
    }
    togglePool(state.poolHidden);
    byId<HTMLInputElement>('trimck').checked = state.trimSprites;
    byId<HTMLInputElement>('vcsl').value = String(state.studioCardSize);
    byId('main').classList.toggle('sb', state.poolAsSidebar);
    syncFilterChips();
}

/** Shows or hides what only Pokémon lists have, and the "upload the pack" notice. */
export function syncKindUi(): void {
    document.body.classList.toggle('kind-pokemon', isPokemonList());
    renderListButton();
    byId('needpack').classList.toggle('hid', !session.needsPack);
    byId('tab-studio').textContent = isPokemonList() ? 'Sprite Studio' : 'Studio';
    if (!isPokemonList() && state.view === 'studio') setTimeout(renderCustomStudio, 0);
}

/** Opens a list: its items, tiers, settings and saved pictures. */
export async function openList(id: string): Promise<void> {
    if (session.listId) saveNow();
    const meta = session.lists.find((l) => l.id === id);
    if (!meta) return;
    let stored: unknown = null;
    try {
        stored = JSON.parse(localStorage.getItem('ptl_' + id) || 'null');
    } catch {}
    const saved = isRecord(stored) ? stored : null;
    resetListState();
    session.generation++;
    session.listId = id;
    try {
        localStorage.setItem('pt_cur', id);
    } catch {}
    state.kind = meta.kind || 'custom';
    // the Pokémon data comes from the site the first time a Pokémon list is opened
    if (state.kind === 'pokemon' && !pokedex.pack) await installPokemonPackIfAvailable();
    state.ownItems = readOwnItems(saved?.items, OWN_ITEM_ID_START);
    state.nextItemId = Math.max(Number(saved?.nextId) || OWN_ITEM_ID_START, ...state.ownItems.map((item) => item.id + 1));
    session.needsPack = state.kind === 'pokemon' && !pokedex.pack;
    rebuildEntries();
    if (saved && !session.needsPack) applySnapshot(saved);
    else if (saved?.theme) state.theme = sanitizeTheme(saved.theme);
    if (!state.tiers.length) state.tiers = makePresetTiers();
    await loadSavedPictures(id);
    if (isPokemonList()) {
        showPicksWhileTheyLoad();
        // 1,300 rows nobody sees from the tier list: built when the studio is first shown (renderStudio) unless it's open now
        if (state.view === 'studio') buildStudioList();
        buildFormPanel();
        syncFormPanel();
    }
    loadPalette();
    refreshTagUI();
    applySettings();
    renderTiers();
    syncKindUi();
    renderListMenu();
    listOpened();
    if (!session.needsPack) {
        autosave();
        void restorePickedSprites().then(repairAnimatedPicks).then(undoBackgroundRemoval);
    }
}

/** Picked pictures and extra pictures saved in this browser for list `listId`. */
async function loadSavedPictures(listId: string): Promise<void> {
    for (const [key, blob] of await readByPrefix(listId + ':')) {
        const name = String(key).slice(listId.length + 1);
        if (!(blob instanceof Blob)) continue;
        // "x<itemId>~<n>": an extra picture added to an item
        if (name.startsWith('x')) {
            const itemId = Number(name.slice(1).split('~')[0]);
            if (entryById.has(itemId)) extraPictures.set(name, { id: itemId, blob, url: objectUrlFor(blob) });
            continue;
        }
        const itemId = Number(name);
        if (!entryById.has(itemId)) continue;
        // saved by an older version from an error page instead of a picture: drop it so it's fetched again
        if (!(await isImageBlob(blob))) {
            void deleteImage(itemId);
            continue;
        }
        spriteBlobs.set(itemId, blob);
        spriteUrls.set(itemId, objectUrlFor(blob));
        if (!state.picks[itemId]) state.picks[itemId] = { path: 'custom' };
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  AT START-UP
// ═════════════════════════════════════════════════════════════════════════════

/** The list index went missing (cleared, or a crash mid-save): rebuild it from the saved lists. */
function recoverListIndex(): void {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith('ptl_')) continue;
            let saved: unknown = null;
            try {
                saved = JSON.parse(localStorage.getItem(key) || 'null');
            } catch {}
            if (!isRecord(saved) || !Array.isArray(saved.tiers)) continue;
            const ranked = saved.tiers.reduce(
                (count: number, tier: unknown) => count + (isRecord(tier) && Array.isArray(tier.items) ? tier.items.length : 0),
                0,
            );
            session.lists.push({
                id: key.slice(4),
                name: String(saved.listName || 'Recovered list').slice(0, 80),
                kind: saved.kind === 'pokemon' ? 'pokemon' : 'custom',
                updated: Date.now(),
                count: ranked,
            });
        }
    } catch {}
    if (!session.lists.length) return;
    saveListIndex();
    setTimeout(() => toast(`Recovered ${session.lists.length} saved list${session.lists.length > 1 ? 's' : ''}`), 1500);
}

/** Opens the list you had open last time (making sure there is one: recovered, brought over, or new). */
export async function openStartingList(): Promise<void> {
    loadListIndex();
    // shared lists you looked at but didn't keep
    for (const preview of session.lists.filter((l) => l.preview)) await forgetList(preview.id);
    if (!session.lists.length) recoverListIndex();
    // a first visit starts with one empty list: nothing is installed or filled in until you add or load something
    if (!session.lists.length) addListMeta(STARTING_LIST_NAME, 'custom');
    let listId: string | null = null;
    try {
        listId = localStorage.getItem('pt_cur');
    } catch {}
    const list = session.lists.find((l) => l.id === listId) || session.lists[0]!;
    await openList(list.id);
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE LIST MENU, NEW, DUPLICATE, DELETE
// ═════════════════════════════════════════════════════════════════════════════

export function renderListMenu(): void {
    const lists = [...session.lists].sort((a, b) => (b.updated || 0) - (a.updated || 0));
    setHtml(
        byId('listrows'),
        html`${lists.map(
            (l) =>
                html`<button class="lrow${l.id === session.listId ? ' on' : ''}" data-id="${l.id}"${l.id === session.listId && html` aria-current="true"`}><span class="lname">${l.name}</span>${l.kind === 'pokemon' && html`<span class="kbadge">Pokémon</span>`}<span class="note">${l.count || 0} ranked</span></button>`,
        )}`,
    );
    byId<HTMLInputElement>('lname').value = currentListMeta()?.name || '';
    const pack = pokedex.pack;
    byId('pkpack').classList.toggle('hid', !pack);
    byId('nopacks').classList.toggle('hid', !!pack || genericPacks.size > 0);
    if (pack) {
        const defaultCount = Object.keys(pack.defaults || {}).length;
        const defaultsNote = defaultCount > 0 && `, ${defaultCount} default sprites${pack.by ? ' picked by ' + pack.by : ''}`;
        setHtml(byId('packinfo'), html`<b>${pack.name} pack</b> <span class="note">${pack.count} Pokémon${defaultsNote}</span>`);
    }
    setHtml(
        byId('gplist'),
        html`${[...genericPacks.values()].map((p) => {
            const variantBases = new Set(p.items.filter((row) => Number.isInteger(row[4])).map((row) => row[4]));
            return html`<div class="gprow"><span><b>${p.name}</b> <span class="note">${p.items.length} ${p.noun || 'items'}${variantBases.size > 0 && `, ${variantBases.size} with variants`}${p.version ? ', ' + p.version : ''}</span></span><button data-gpnew="${p.id}" class="accent" title="A new list of every item in this pack">New list</button><button data-gpdel="${p.id}" title="Remove this pack from this browser (it asks first)" aria-label="Remove the ${p.name} pack">✕</button></div>`;
        })}`,
    );
    byId('lsavepack').classList.toggle('hid', isPokemonList() || !state.ownItems.length);
}

/** A sprite picked by whoever exported the pack (given as a picture, or as a sprite path). */
export async function applyPackDefaultSprite(id: ItemId, pick: { path?: string; img?: string; crop?: Crop }): Promise<void> {
    if (pick.img) {
        // only pictures inside the pack itself (data: addresses), checked like any upload
        if (!/^data:image\//.test(pick.img)) return;
        const blob = dataUrlToBlob(pick.img);
        const picture = blob && (await checkedImage(blob));
        if (picture) await setPick(id, picture, { path: 'custom', ck: 1, ...(pick.crop ? { crop: pick.crop, anim: true } : {}) });
        return;
    }
    if (!pick.path) return;
    state.picks[id] = { path: pick.path, ck: 1 };
    await pickSprite(id, pick.path, { quiet: true });
}

/** What a new list can start as: the usual tiers, or the 3 × 3 alignment chart. */
type ListPreset = 'tiers' | 'alignment';

export async function createList(kind: ListKind, name?: string, preset: ListPreset = 'tiers'): Promise<void> {
    if (kind === 'pokemon' && !pokedex.pack && !(await installPokemonPackIfAvailable())) {
        toast("The Pokémon pack couldn't be downloaded. Check your connection and try again.", 5000);
        return;
    }
    saveNow();
    const emptyStart = emptyStartingList();
    if (emptyStart) await forgetList(emptyStart);
    const chart = preset === 'alignment';
    const meta = addListMeta(name || (kind === 'pokemon' ? 'Pokémon tier list' : chart ? 'Alignment chart' : 'New tier list'), kind);
    const defaults = kind === 'pokemon' ? pokedex.pack?.defaults : undefined;
    // the pack's own sprite choices: paths go straight into the new list, pictures are added after it opens
    if (defaults) {
        try {
            const picks = Object.fromEntries(
                Object.entries(defaults)
                    .filter(([, d]) => !d.img && d.path)
                    .map(([key, d]) => [key, { path: d.path }]),
            );
            localStorage.setItem('ptl_' + meta.id, JSON.stringify({ kind, picks, favs: pokedex.pack?.favs || {} }));
        } catch {}
    }
    // a chart starts saved with its cells, so it opens like any other list
    if (chart)
        try {
            const saved: unknown = JSON.parse(localStorage.getItem('ptl_' + meta.id) || '{}');
            const tiers = ALIGNMENT_CHART.map(([label, color]) => ({ label, color, items: [] }));
            localStorage.setItem(
                'ptl_' + meta.id,
                JSON.stringify({ ...(isRecord(saved) ? saved : {}), kind, tiers, lay: 'chart', cols: CHART_COLUMNS.start }),
            );
        } catch {}
    await openList(meta.id);
    closePopovers();
    if (defaults)
        for (const [key, d] of Object.entries(defaults))
            if (d.img && entryById.has(Number(key))) applyPackDefaultSprite(Number(key), d).catch(() => {});
    toast(kind === 'pokemon' ? 'New Pokémon tier list' : `New ${chart ? 'alignment chart' : 'tier list'}. Use Add items to fill it`);
}

/** Copies the open list (with `unranked`, everything goes back to the pool). */
export async function duplicateList(unranked: boolean): Promise<void> {
    const meta = currentListMeta();
    if (!meta) return;
    saveNow();
    const copy = addListMeta(meta.name + (unranked ? ' (re-rank)' : ' copy'), meta.kind);
    if (meta.pack) copy.pack = meta.pack;
    saveListIndex();
    let stored = localStorage.getItem('ptl_' + meta.id) || 'null';
    if (unranked) {
        try {
            const list = JSON.parse(stored);
            if (isRecord(list) && Array.isArray(list.tiers)) for (const tier of list.tiers) if (isRecord(tier)) tier.items = [];
            stored = JSON.stringify(list);
        } catch {}
    }
    try {
        localStorage.setItem('ptl_' + copy.id, stored);
    } catch {}
    await copyByPrefix(meta.id + ':', copy.id + ':');
    closePopovers();
    await openList(copy.id);
    toast(unranked ? 'Copied with everything back in the pool' : 'Duplicated');
}

/** Removes a list and its pictures from this browser. No questions: callers ask first if needed. */
export async function forgetList(id: string): Promise<void> {
    session.lists = session.lists.filter((l) => l.id !== id);
    saveListIndex();
    try {
        localStorage.removeItem('ptl_' + id);
    } catch {}
    await deleteByPrefix(id + ':');
    if (session.listId === id) session.listId = null;
}

const STARTING_LIST_NAME = 'My tier list';

/** True while the open list has nothing in it yet (nothing ranked, nothing added). */
export function isUntouchedList(): boolean {
    return !!currentListMeta() && !state.tiers.some((tier) => tier.items.length) && !state.ownItems.length;
}

/** The empty starting list, if it's still there untouched next to the list `keptId`: it makes way (closed or not). */
export async function dropEmptyStartingList(keptId: string): Promise<void> {
    const others = session.lists.filter((l) => l.id !== keptId);
    const start = others.length === 1 ? others[0]! : null;
    if (start?.kind !== 'custom' || start.name !== STARTING_LIST_NAME || start.count) return;
    let saved: unknown = null;
    try {
        saved = JSON.parse(localStorage.getItem('ptl_' + start.id) || 'null');
    } catch {}
    if (isRecord(saved) && Array.isArray(saved.items) && saved.items.length) return;
    await forgetList(start.id);
}

/** The empty list a first visit starts with, while it's still the only list and untouched: it makes way for the first real one. */
export function emptyStartingList(): string | null {
    const meta = currentListMeta();
    return session.lists.length === 1 && meta?.kind === 'custom' && meta.name === STARTING_LIST_NAME && isUntouchedList() ? meta.id : null;
}

async function deleteCurrentList(): Promise<void> {
    const meta = currentListMeta();
    if (!meta) return;
    if (!(await ask(`Delete the tier list “${meta.name}”? This can't be undone (save it first if you want a copy).`, 'Delete', true)))
        return;
    closePopovers();
    await forgetList(meta.id);
    if (!session.lists.length) addListMeta(STARTING_LIST_NAME, 'custom');
    await openList(session.lists[0]!.id);
    toast('List deleted');
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupLists(): void {
    byId('listbtn').onclick = (e) => {
        renderListMenu();
        const button = e.currentTarget as HTMLElement;
        placePopover(byId('listpop'), button.offsetParent ? button : popoverAnchor('filebtn'));
    };
    byId('listrows').addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.lrow');
        if (!row) return;
        closePopovers();
        if (row.dataset.id && row.dataset.id !== session.listId) void openList(row.dataset.id);
    });
    byId('lnew').onclick = () => void createList('custom');
    byId('lnewpk').onclick = () => void createList('pokemon');
    byId('lnewchart').onclick = () => void createList('custom', undefined, 'alignment');
    byId<HTMLInputElement>('lname').onchange = (e) => {
        const meta = currentListMeta();
        if (!meta) return;
        meta.name = (e.target as HTMLInputElement).value.trim().slice(0, 60) || meta.name;
        saveListIndex();
        syncKindUi();
        renderListMenu();
        autosave();
    };
    byId('ldup').onclick = () => void duplicateList(false);
    byId('ldup0').onclick = () => void duplicateList(true);
    byId('ldel').onclick = () => void deleteCurrentList();
}
