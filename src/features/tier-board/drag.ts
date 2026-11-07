// src/features/tier-board/drag.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Moving tiles with the pointer:
//    - press a tile and move  → drag it (or the whole selection) to a tier or the pool
//    - press and release      → select it (handled by board.onTileClick)
//    - press empty space      → drag a box to select every tile inside it
//    - right-click a tile     → its picture picker / item editor
//  Touch: tap to select, then tap a tier label (dragging a finger scrolls instead).
// ─────────────────────────────────────────────────────────────────────────────
import { pushHistory } from '../../core/history';
import { entryById, isOwnItem } from '../../core/items';
import { autosave } from '../../core/persist';
import { findTier, isPokemonList, itemWord, state, tileById } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { openItemEditor } from '../items/item-editor';
import { openQuickPicker } from '../quick-picker/quick-picker';
import { clearSelection, onTileClick, placeAllTiles, removeFromTiers, selectedInOrder, syncSelection } from './board';
import { hideTip } from './hover-tip';

/** Pixels the pointer must move before a press becomes a drag. */
const DRAG_START_PX = 6;
const BOX_START_PX = 5;

/** Where dropped tiles go: a tier (before/after one of its tiles), or back to the pool. */
type DropTarget = { tierId: string; nextTo?: ItemId; after?: boolean } | { pool: true };

interface TileDrag {
    id: ItemId;
    /** Where the pressed tile sits: 'pool' or a tier id. */
    src: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moving: boolean;
    pointerType: string;
    shift: boolean;
    meta: boolean;
    /** The tiles being moved (the selection, if the pressed tile is in it). */
    ids: ItemId[];
    target: DropTarget | null;
}
let tileDrag: TileDrag | null = null;

/** True while tiles are being dragged (the hover tip stays quiet). */
export const isDragging = (): boolean => !!tileDrag;

/** Which area the pointer was last over, for Ctrl/⌘+A. */
export const pointer = { area: 'pool' as 'pool' | 'tiers' };

// ═════════════════════════════════════════════════════════════════════════════
//  DROP TARGETS
// ═════════════════════════════════════════════════════════════════════════════

let markedTile: HTMLElement | null = null;
let markedArea: HTMLElement | null = null;

function clearDropMarks(): void {
    markedTile?.classList.remove('ins-a', 'ins-b');
    markedTile = null;
    markedArea?.classList.remove('dov');
    markedArea = null;
}

/** Works out (and highlights) where the tiles would land at this point. */
function findDropTarget(x: number, y: number): void {
    clearDropMarks();
    if (!tileDrag) return;
    tileDrag.target = null;
    const under = document.elementFromPoint(x, y);
    if (!under) return;
    const tierTiles = under.closest<HTMLElement>('.tcont');
    const tierRow = under.closest<HTMLElement>('.trow');
    if (tierTiles) {
        markedArea = tierTiles.parentElement;
        markedArea?.classList.add('dov');
        const tile = under.closest<HTMLElement>('.pi');
        const tileId = Number(tile?.dataset.id);
        if (tile && tile.parentElement === tierTiles && !tileDrag.ids.includes(tileId)) {
            const box = tile.getBoundingClientRect();
            const after = x > box.left + box.width / 2;
            markedTile = tile;
            tile.classList.add(after ? 'ins-a' : 'ins-b');
            tileDrag.target = { tierId: tierTiles.dataset.tid!, nextTo: tileId, after };
        } else tileDrag.target = { tierId: tierTiles.dataset.tid! };
    } else if (tierRow) {
        markedArea = tierRow;
        tierRow.classList.add('dov');
        tileDrag.target = { tierId: tierRow.dataset.tid! };
    } else if (under.closest('#psec')) {
        markedArea = byId('psec');
        markedArea.classList.add('dov');
        tileDrag.target = { pool: true };
    }
}

/** Near the top/bottom edge of the tiers or pool, scroll so far-away tiers can be reached. */
let autoScrollFrame = 0;
function autoScrollWhileDragging(): void {
    if (autoScrollFrame || !tileDrag?.moving) return;
    const step = () => {
        autoScrollFrame = 0;
        const drag = tileDrag;
        if (!drag?.moving) return;
        const area = [byId('tsec'), byId('pgrid')].find((element) => {
            const box = element.getBoundingClientRect();
            return drag.x >= box.left && drag.x <= box.right && drag.y >= box.top - 30 && drag.y <= box.bottom + 30;
        });
        if (!area) return;
        const box = area.getBoundingClientRect();
        const edge = 60;
        let speed = 0;
        if (drag.y < box.top + edge) speed = -Math.ceil((box.top + edge - drag.y) / 3);
        else if (drag.y > box.bottom - edge) speed = Math.ceil((drag.y - (box.bottom - edge)) / 3);
        if (!speed) return;
        area.scrollTop += Math.max(-40, Math.min(40, speed));
        findDropTarget(drag.x, drag.y);
        autoScrollFrame = requestAnimationFrame(step);
    };
    autoScrollFrame = requestAnimationFrame(step);
}

function endDragVisuals(): void {
    clearDropMarks();
    byId('dghost').style.display = 'none';
    document.body.classList.remove('dragging');
    tileById.forEach((tile) => {
        tile.classList.remove('dsrc');
    });
}

/** Moves the dragged tiles to their drop target. */
function drop(drag: TileDrag): void {
    const target = drag.target;
    if (!target) return;
    pushHistory();
    removeFromTiers(drag.ids);
    if ('tierId' in target) {
        const tier = findTier(target.tierId)!;
        let at = tier.items.length;
        if (target.nextTo != null) {
            const i = tier.items.indexOf(target.nextTo);
            if (i >= 0) at = i + (target.after ? 1 : 0);
        }
        tier.items.splice(at, 0, ...drag.ids);
    }
    clearSelection();
    placeAllTiles();
    autosave();
}

// ═════════════════════════════════════════════════════════════════════════════
//  BOX SELECTION
// ═════════════════════════════════════════════════════════════════════════════

interface SelectionBox {
    area: HTMLElement;
    startX: number;
    startY: number;
    startScroll: number;
    x: number;
    y: number;
    /** Shift/Ctrl/⌘ held: add to the selection instead of replacing it. */
    adding: boolean;
    before: Set<ItemId>;
    moved: boolean;
}
let selectionBox: SelectionBox | null = null;
let boxFrame = 0;

/** Redraws the box, selects what's inside it, and scrolls when it's near an edge. */
function updateSelectionBox(): void {
    boxFrame = 0;
    const sel = selectionBox;
    if (!sel) return;
    const area = sel.area;
    const bounds = area.getBoundingClientRect();
    const nearTop = sel.y < bounds.top + 28;
    const nearBottom = sel.y > bounds.bottom - 28;
    if (nearTop) area.scrollTop -= 18;
    else if (nearBottom) area.scrollTop += 18;
    const startY = sel.startY - (area.scrollTop - sel.startScroll); // the start point scrolls with the content
    const left = Math.min(sel.startX, sel.x);
    const right = Math.max(sel.startX, sel.x);
    const top = Math.min(startY, sel.y);
    const bottom = Math.max(startY, sel.y);
    const outline = byId('marq').style;
    outline.display = 'block';
    outline.left = left + 'px';
    outline.top = Math.max(top, bounds.top) + 'px';
    outline.width = right - left + 'px';
    outline.height = Math.min(bottom, bounds.bottom) - Math.max(top, bounds.top) + 'px';
    const selected = sel.adding ? new Set(sel.before) : new Set<ItemId>();
    area.querySelectorAll<HTMLElement>('.pi').forEach((tile) => {
        if (tile.style.display === 'none') return;
        const box = tile.getBoundingClientRect();
        if (box.right > left && box.left < right && box.bottom > top && box.top < bottom) selected.add(Number(tile.dataset.id));
    });
    state.selection = selected;
    const sources = new Set([...selected].map((id) => tileById.get(id)?.dataset.src));
    state.selectionSource = !selected.size ? null : sources.size === 1 ? ([...sources][0] ?? null) : 'mixed';
    syncSelection();
    if (nearTop || nearBottom) boxFrame = requestAnimationFrame(updateSelectionBox);
}

// ═════════════════════════════════════════════════════════════════════════════
//  WIRING (runs once at start-up, from main.ts)
// ═════════════════════════════════════════════════════════════════════════════

export function setupDrag(): void {
    // press a tile: maybe a click, maybe the start of a drag
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || state.view !== 'tier') return;
        const tile = (e.target as HTMLElement).closest<HTMLElement>('#tsec .pi, #pgrid .pi');
        if (!tile) return;
        if (e.pointerType === 'mouse') e.preventDefault();
        tileDrag = {
            id: Number(tile.dataset.id),
            src: tile.dataset.src!,
            startX: e.clientX,
            startY: e.clientY,
            x: e.clientX,
            y: e.clientY,
            moving: false,
            pointerType: e.pointerType,
            shift: e.shiftKey,
            meta: e.metaKey || e.ctrlKey,
            ids: [],
            target: null,
        };
    });
    document.addEventListener(
        'pointerover',
        (e) => {
            const over = e.target as HTMLElement;
            if (over.closest?.('#tsec')) pointer.area = 'tiers';
            else if (over.closest?.('#psec')) pointer.area = 'pool';
        },
        { passive: true },
    );
    // press empty space in the tiers or pool: start a selection box
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || state.view !== 'tier' || e.pointerType === 'touch') return;
        const target = e.target as HTMLElement;
        const area = target.closest<HTMLElement>('#tsec, #pgrid');
        if (!area || target.closest('.pi,.tlbl,.tctrl,button,input,select')) return;
        const bounds = area.getBoundingClientRect();
        if (e.clientX > bounds.left + area.clientWidth || e.clientY > bounds.top + area.clientHeight) return; // on the scrollbar
        e.preventDefault();
        hideTip();
        selectionBox = {
            area,
            startX: e.clientX,
            startY: e.clientY,
            startScroll: area.scrollTop,
            x: e.clientX,
            y: e.clientY,
            adding: e.shiftKey || e.metaKey || e.ctrlKey,
            before: new Set(state.selection),
            moved: false,
        };
    });
    window.addEventListener(
        'pointermove',
        (e) => {
            if (!selectionBox) return;
            selectionBox.x = e.clientX;
            selectionBox.y = e.clientY;
            if (!selectionBox.moved) {
                if (Math.hypot(e.clientX - selectionBox.startX, e.clientY - selectionBox.startY) < BOX_START_PX) return;
                selectionBox.moved = true;
            }
            if (!boxFrame) boxFrame = requestAnimationFrame(updateSelectionBox);
        },
        { passive: true },
    );
    window.addEventListener('pointerup', () => {
        const box = selectionBox;
        if (!box) return;
        selectionBox = null;
        cancelAnimationFrame(boxFrame);
        boxFrame = 0;
        byId('marq').style.display = 'none';
        if (!box.moved && !box.adding) clearSelection(); // a plain click on empty space
    });

    // moving a pressed tile
    window.addEventListener(
        'pointermove',
        (e) => {
            const drag = tileDrag;
            if (!drag) return;
            if (!drag.moving) {
                if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START_PX) return;
                if (drag.pointerType === 'touch') {
                    tileDrag = null; // a finger moving = scrolling
                    return;
                }
                drag.moving = true;
                hideTip();
                drag.ids = state.selection.has(drag.id) ? selectedInOrder() : [drag.id];
                drag.ids.forEach((id) => {
                    tileById.get(id)?.classList.add('dsrc');
                });
                const ghost = byId('dghost');
                ghost.textContent =
                    drag.ids.length === 1 ? entryById.get(drag.ids[0]!)!.name : `${drag.ids.length} ${itemWord(drag.ids.length)}`;
                ghost.style.display = 'block';
                document.body.classList.add('dragging');
            }
            const ghost = byId('dghost').style;
            ghost.left = e.clientX + 14 + 'px';
            ghost.top = e.clientY - 12 + 'px';
            drag.x = e.clientX;
            drag.y = e.clientY;
            autoScrollWhileDragging();
            findDropTarget(e.clientX, e.clientY);
        },
        { passive: true },
    );
    window.addEventListener('pointerup', () => {
        const drag = tileDrag;
        if (!drag) return;
        tileDrag = null;
        if (!drag.moving) {
            onTileClick({ id: drag.id, src: drag.src, shift: drag.shift, meta: drag.meta });
            return;
        }
        endDragVisuals();
        drop(drag);
    });
    window.addEventListener('pointercancel', () => {
        if (tileDrag?.moving) endDragVisuals();
        tileDrag = null;
    });

    // right-click a tile: choose its picture
    document.addEventListener('contextmenu', (e) => {
        const tile = (e.target as HTMLElement).closest<HTMLElement>('#tsec .pi, #pgrid .pi');
        if (!tile) return;
        e.preventDefault();
        const id = Number(tile.dataset.id);
        if (isOwnItem(id)) openItemEditor(id);
        else if (isPokemonList()) openQuickPicker(id);
    });
}
