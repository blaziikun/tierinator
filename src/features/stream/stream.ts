// src/features/stream/stream.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Stream mode (#stream): a presenter view for ranking live on video. Only the
//  tiers, big, and the item being ranked; 1–9 or a drag puts it in a tier, → / ←
//  skip and go back, U undoes, H hides the controls, Esc leaves. Loads on first use.
// ─────────────────────────────────────────────────────────────────────────────
import { pushHistory, redoStack, undo, undoStack } from '../../core/history';
import { entryById, rankableEntries } from '../../core/items';
import { autosave } from '../../core/persist';
import { findTier, onListReset, state } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { closePopovers, toast } from '../../lib/ui';
import { labelTextColor, rowBackground } from '../appearance/theme';
import { switchView } from '../layout/layout';
import { clearSelection, ensureTile, placeAllTiles, rankedIds, removeFromTiers } from '../tier-board/board';
import { isChart } from '../tier-board/chart';
import { checkStreamOptions, defaultStreamOptions, nextToRank, orderQueue, type StreamOptions } from './stream-queue';

const stream = {
    active: false,
    options: defaultStreamOptions(),
    /** Every item to go through, in the order they come up. */
    queue: [] as ItemId[],
    /** The item shown (an index into the queue); -1 once everything in the queue is ranked. */
    position: -1,
    /** Items changed this time, newest last, so an undo can show the item it gave back (and a redo take it again). */
    changed: [] as ItemId[],
    undone: [] as ItemId[],
    /** The item just placed: its tile arrives with a little bounce. */
    justPlaced: null as ItemId | null,
    hintsHidden: false,
    /** True while the real fullscreen is ours: leaving it (the browser's own Esc) leaves stream mode too. */
    inFullscreen: false,
};

/** Pixels the picture must move before a press becomes a drag. */
const DRAG_START_PX = 6;
/** Tile sizes the board shrinks between to fit the screen. */
const LARGEST_TILE_PX = 160;
const SMALLEST_TILE_PX = 28;

const currentItem = (): ItemId | undefined => (stream.position >= 0 ? stream.queue[stream.position] : undefined);

// ═════════════════════════════════════════════════════════════════════════════
//  OPTIONS AND STARTING
// ═════════════════════════════════════════════════════════════════════════════

function readSavedOptions(): StreamOptions {
    try {
        return checkStreamOptions(JSON.parse(localStorage.getItem('pt_stream') || 'null'));
    } catch {
        return defaultStreamOptions();
    }
}

function saveOptions(): void {
    try {
        localStorage.setItem('pt_stream', JSON.stringify(stream.options));
    } catch {}
}

/** The options panel, filled in with last time's choices. */
function openStreamOptions(): void {
    if (state.view !== 'tier') switchView('tier');
    if (!rankableEntries().length) {
        toast('Add some items first');
        return;
    }
    if (!state.tiers.length) {
        toast('Add a tier first');
        return;
    }
    closePopovers();
    const options = readSavedOptions();
    byId<HTMLSelectElement>('streambg').value = options.background;
    byId<HTMLSelectElement>('streamorder').value = options.order;
    byId<HTMLSelectElement>('streamwhich').value = options.fromScratch ? 'all' : 'unranked';
    byId<HTMLInputElement>('streamnames').checked = options.showNames;
    byId('streamm').classList.add('show');
    byId('streamgo').focus();
}

/** What the pool shows right now (its search and filters apply), in pool order. */
const poolShown = (): ItemId[] =>
    [...byId('pgrid').querySelectorAll<HTMLElement>(':scope > .pi')]
        .filter((tile) => tile.style.display !== 'none')
        .map((tile) => Number(tile.dataset.id));

function startStream(): void {
    stream.options = checkStreamOptions({
        background: byId<HTMLSelectElement>('streambg').value,
        order: byId<HTMLSelectElement>('streamorder').value,
        fromScratch: byId<HTMLSelectElement>('streamwhich').value === 'all',
        showNames: byId<HTMLInputElement>('streamnames').checked,
    });
    saveOptions();
    if (!stream.options.fromScratch && !poolShown().length) {
        toast(
            state.searchQuery || state.tagFilter !== 'all' || state.generationFilter !== 'all' || state.typeFilter !== 'all'
                ? 'Nothing unranked in the pool: clear the search or filters, or choose “All, from scratch”'
                : 'Everything is ranked: choose “All, from scratch” to rank it again',
            4000,
        );
        return;
    }
    clearSelection();
    const rankedBefore = state.tiers.map((tier) => tier.items.slice());
    const emptied = stream.options.fromScratch && rankedIds().size > 0;
    if (emptied) {
        // one undo step, so a single Ctrl/⌘+Z after leaving puts the old ranking back
        pushHistory();
        for (const tier of state.tiers) tier.items = [];
        placeAllTiles();
    }
    const queue = poolShown();
    if (!queue.length) {
        // the search or filters match nothing even with every item back in the pool: leave the tiers as they were
        if (emptied) {
            state.tiers.forEach((tier, index) => {
                tier.items = rankedBefore[index]!;
            });
            undoStack.pop();
            placeAllTiles();
        }
        toast('Nothing in the pool matches the search or filters');
        return;
    }
    if (emptied) autosave();
    byId('streamm').classList.remove('show');
    Object.assign(stream, {
        queue: orderQueue(queue, stream.options.order, Math.floor(Math.random() * 2 ** 32)),
        position: 0,
        changed: [],
        undone: [],
        justPlaced: null,
        active: true,
        inFullscreen: false,
    });
    const stage = byId('stream');
    stage.dataset.bg = stream.options.background;
    stage.classList.toggle('names', stream.options.showNames);
    stage.classList.toggle('nohints', stream.hintsHidden);
    stage.classList.remove('hid');
    document.body.classList.add('streaming');
    // real fullscreen where the browser offers it (not iPhones); the full window is fine without it
    if (document.fullscreenEnabled && !document.fullscreenElement)
        stage
            .requestFullscreen()
            .then(() => {
                // left again before the browser said yes (a quick Esc): don't stay fullscreen on a hidden view
                if (!stream.active) {
                    void document.exitFullscreen().catch(() => {});
                    return;
                }
                stream.inFullscreen = true;
                fitTiles();
            })
            .catch(() => {});
    showStream();
    stage.focus();
}

/** Back to the normal screen. */
function leaveStream(): void {
    if (!stream.active) return;
    stream.active = false;
    endDrag();
    if (stream.inFullscreen) {
        stream.inFullscreen = false;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
    byId('stream').classList.add('hid');
    document.body.classList.remove('streaming');
    placeAllTiles(); // the board was hidden: measure it again
    const ranked = rankedIds();
    const done = stream.queue.filter((id) => ranked.has(id)).length;
    toast(`Left stream mode: ${done} of ${stream.queue.length} ranked`);
    const button = byId('streambtn');
    (button.offsetParent ? button : byId('tsec')).focus();
}

// ═════════════════════════════════════════════════════════════════════════════
//  DRAWING
// ═════════════════════════════════════════════════════════════════════════════

/** A copy of the item's picture frame from its board tile (same picture, crop and fallbacks). */
function pictureOf(id: ItemId): HTMLElement {
    const source = ensureTile(id)?.querySelector('.pimg');
    const frame = source ? (source.cloneNode(true) as HTMLElement) : document.createElement('div');
    frame.className = 'pimg';
    const img = frame.querySelector('img');
    if (img) {
        img.loading = 'eager';
        img.setAttribute('data-px', ''); // crisp pixel art once it loads (lib/images)
    }
    return frame;
}

function streamTile(id: ItemId): HTMLElement {
    const tile = document.createElement('div');
    tile.className = id === stream.justPlaced ? 'stile new' : 'stile';
    const name = document.createElement('span');
    name.className = 'sname';
    name.textContent = entryById.get(id)?.name ?? '';
    tile.append(pictureOf(id), name);
    return tile;
}

function drawBoard(): void {
    const board = byId('sboard');
    board.classList.toggle('chart', isChart());
    board.style.setProperty('--chart-cols', String(state.chartColumns));
    setHtml(
        board,
        html`${state.tiers.map(
            (tier, index) =>
                html`<div class="srow" data-tid="${tier.id}"><button class="slbl" style="background:${tier.color};color:${labelTextColor(tier)}" title="Put the item here">${index < 9 && html`<i>${index + 1}</i>`}<span class="slbl-main">${tier.label}</span>${tier.subtitle && html`<span class="slbl-sub">${tier.subtitle}</span>`}</button><div class="scell" style="background:${rowBackground(tier.color)}"></div></div>`,
        )}`,
    );
    const cells = board.querySelectorAll<HTMLElement>('.scell');
    state.tiers.forEach((tier, index) => {
        cells[index]?.append(...tier.items.filter((id) => entryById.has(id)).map(streamTile));
    });
}

function drawCurrentItem(): void {
    const id = currentItem();
    const ranked = rankedIds();
    const done = stream.queue.filter((queued) => ranked.has(queued)).length;
    byId('sprog').textContent = `${done} of ${stream.queue.length} ranked`;
    byId('snowitem').classList.toggle('hid', id == null);
    byId('sdone').classList.toggle('hid', id != null);
    if (id == null) {
        byId('snowpic').replaceChildren();
        byId('sdoneleave').focus();
        return;
    }
    byId('snowpic').replaceChildren(pictureOf(id));
    byId('snowname').textContent = entryById.get(id)?.name ?? '';
    const tier = state.tiers.find((t) => t.items.includes(id));
    byId('snowwhere').textContent = tier ? `Now in ${tier.label}` : '';
    // start loading the next picture, so it shows straight away
    const next = stream.queue[nextToRank(stream.queue, stream.position, (queued) => ranked.has(queued))];
    if (next != null && next !== id) pictureOf(next);
}

/** The biggest tiles that let every tier fit on screen without scrolling (down to a floor). */
function fitTiles(): void {
    const board = byId('sboard');
    if (!stream.active) return;
    let size = Math.round(Math.min(LARGEST_TILE_PX, Math.max(56, Math.min(innerWidth, innerHeight) / 5)));
    const overflows = () => board.scrollHeight > board.clientHeight + 1 || board.scrollWidth > board.clientWidth + 1;
    board.style.setProperty('--stream-sz', size + 'px');
    while (size > SMALLEST_TILE_PX && overflows()) {
        size = Math.max(SMALLEST_TILE_PX, size - 6);
        board.style.setProperty('--stream-sz', size + 'px');
    }
}

function showStream(): void {
    drawBoard();
    drawCurrentItem();
    fitTiles();
    stream.justPlaced = null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RANKING
// ═════════════════════════════════════════════════════════════════════════════

function noteChange(id: ItemId): void {
    stream.changed.push(id);
    stream.undone.length = 0;
}

/** The next item still to rank after the one shown, or -1 when there's none. */
function nextPosition(): number {
    const ranked = rankedIds();
    return nextToRank(stream.queue, stream.position, (id) => ranked.has(id));
}

/** Puts the item shown into this tier (at its end) and moves on. */
function placeCurrent(tierId: string): void {
    const id = currentItem();
    const tier = findTier(tierId);
    if (id == null || !tier) return;
    pushHistory();
    removeFromTiers([id]);
    tier.items.push(id);
    noteChange(id);
    placeAllTiles();
    autosave();
    stream.justPlaced = id;
    stream.position = nextPosition();
    showStream();
}

/** 0, as on the board: the item shown goes back to the pool (it was ranked before, or placed and gone back to). */
function sendCurrentToPool(): void {
    const id = currentItem();
    if (id == null || !rankedIds().has(id)) return;
    pushHistory();
    removeFromTiers([id]);
    noteChange(id);
    placeAllTiles();
    autosave();
    showStream();
}

function skip(): void {
    if (stream.position < 0) return;
    stream.position = nextPosition();
    showStream();
}

/** Back one item in the queue, ranked or not (a number key then moves it). */
function back(): void {
    if (!stream.queue.length) return;
    stream.position = stream.position < 0 ? stream.queue.length - 1 : Math.max(0, stream.position - 1);
    showStream();
}

/** Undo (or redo) through the app's own history, then show the item that changed. */
function undoStep(redo: boolean): void {
    // with nothing to undo, history changes nothing (and says so): my list of changes stays as it is
    const hadStep = (redo ? redoStack : undoStack).length > 0;
    undo(redo);
    const id = hadStep ? (redo ? stream.undone : stream.changed).pop() : undefined;
    if (id != null) {
        (redo ? stream.changed : stream.undone).push(id);
        if (!redo) stream.position = stream.queue.indexOf(id);
        else if (currentItem() === id && rankedIds().has(id)) stream.position = nextPosition();
    }
    showStream();
}

function toggleHints(): void {
    stream.hintsHidden = !stream.hintsHidden;
    byId('stream').classList.toggle('nohints', stream.hintsHidden);
    fitTiles();
    if (stream.hintsHidden) byId('stream').focus();
    else byId('shide').focus();
}

// ═════════════════════════════════════════════════════════════════════════════
//  DRAGGING THE PICTURE ONTO A TIER
// ═════════════════════════════════════════════════════════════════════════════

const drag = { pointerId: -1, startX: 0, startY: 0, moving: false, over: null as HTMLElement | null };

function markDropTarget(x: number, y: number): void {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('#sboard .srow') ?? null;
    if (row === drag.over) return;
    drag.over?.classList.remove('over');
    row?.classList.add('over');
    drag.over = row;
}

function endDrag(): void {
    drag.over?.classList.remove('over');
    Object.assign(drag, { pointerId: -1, moving: false, over: null });
    byId('sghost').replaceChildren();
    byId('sghost').classList.add('hid');
    byId('snowpic').classList.remove('lifted');
}

function setupPictureDrag(): void {
    const picture = byId('snowpic');
    const ghost = byId('sghost');
    picture.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || currentItem() == null) return;
        e.preventDefault();
        picture.setPointerCapture(e.pointerId);
        Object.assign(drag, { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moving: false, over: null });
    });
    picture.addEventListener('pointermove', (e) => {
        if (e.pointerId !== drag.pointerId) return;
        if (!drag.moving) {
            if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START_PX) return;
            drag.moving = true;
            const id = currentItem();
            if (id != null) ghost.replaceChildren(pictureOf(id));
            ghost.classList.remove('hid');
            picture.classList.add('lifted');
        }
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
        markDropTarget(e.clientX, e.clientY);
    });
    picture.addEventListener('pointerup', (e) => {
        if (e.pointerId !== drag.pointerId) return;
        const tierId = drag.moving ? drag.over?.dataset.tid : undefined;
        endDrag();
        if (tierId) placeCurrent(tierId);
    });
    picture.addEventListener('pointercancel', endDrag);
}

// ═════════════════════════════════════════════════════════════════════════════
//  KEYS
// ═════════════════════════════════════════════════════════════════════════════

/** Runs before the app's own shortcuts (capture on window) and keeps them quiet while streaming. */
function onStreamKey(e: KeyboardEvent): void {
    if (!stream.active) return;
    e.stopImmediatePropagation();
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
        if (key === 'z') undoStep(e.shiftKey);
        else if (key === 'y') undoStep(true);
        else return; // the browser's own (zoom, reload…)
    } else if (e.altKey) return;
    else if (/^[1-9]$/.test(key)) {
        const tier = state.tiers[Number(key) - 1];
        if (tier) placeCurrent(tier.id);
    } else if (key === '0') sendCurrentToPool();
    else if (key === 'arrowright' || key === ' ') skip();
    else if (key === 'arrowleft') back();
    else if (key === 'u') undoStep(false);
    else if (key === 'h') toggleHints();
    else if (key === 'escape') leaveStream();
    else return; // Tab, Enter on a button…
    e.preventDefault();
}

// ── wiring (runs on first use, from main.ts) ──
export function setupStream(): void {
    byId('streambtn').onclick = openStreamOptions;
    byId('lstream').onclick = openStreamOptions;
    byId('streamgo').onclick = startStream;
    byId('streamm').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') byId('streamm').classList.remove('show');
    });
    byId('sboard').addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.srow');
        if (row?.dataset.tid) placeCurrent(row.dataset.tid);
    });
    byId('sback').onclick = back;
    byId('sskip').onclick = skip;
    byId('sundo').onclick = () => undoStep(false);
    byId('shide').onclick = toggleHints;
    byId('skeysshow').onclick = toggleHints;
    byId('sleave').onclick = leaveStream;
    byId('sdoneleave').onclick = leaveStream;
    setupPictureDrag();
    window.addEventListener('keydown', onStreamKey, true);
    document.addEventListener('fullscreenchange', () => {
        // the browser's own way out of fullscreen (Esc, its button) ends stream mode too
        if (!document.fullscreenElement && stream.inFullscreen) {
            stream.inFullscreen = false;
            leaveStream();
        }
    });
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(fitTiles);
    });
    onListReset(leaveStream);
}
