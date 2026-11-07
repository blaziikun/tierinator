// src/features/tier-board/tile-keys.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Ranking without a mouse. Tab into the tiers or the pool, then:
//    arrows          move between items (by what's on screen, so it works in any layout)
//    Home / End      first / last item in that area
//    Space / Enter   select the item (Shift: range, Ctrl/⌘: add from another area)
//    1–9 / 0         send the selection, or this item if nothing's selected, to a tier / the pool
//    Alt+arrows      rows: ← → move the item along its tier, ↑ ↓ to the tier above / below
//                    (below the last: the pool). Chart: to the next cell that way, and
//                    Alt+Shift+← → along its cell
//    Menu, Shift+F10 the item's picture picker / editor, as right-click does
// ─────────────────────────────────────────────────────────────────────────────
import { onHistoryRestore, pushHistory } from '../../core/history';
import { autosave } from '../../core/persist';
import { findTier, state, tileById } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { toast } from '../../lib/ui';
import { onTileClick, placeAllTiles, removeFromTiers } from './board';

const AREAS = ['tsec', 'pgrid'] as const;

const isTile = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('pi');

/** Tiles the person can see in an area, in screen order. */
function visibleTiles(area: HTMLElement): HTMLElement[] {
    return [...area.querySelectorAll<HTMLElement>('.pi')].filter((tile) => tile.offsetParent !== null);
}

/**
 * The nearest tile in a direction, judged by where tiles are drawn, not by list order: rows wrap, the pool
 * can sit beside the tiers, and charts are grids, so "the one below" has to be measured.
 */
function neighbour(from: HTMLElement, tiles: HTMLElement[], key: string): HTMLElement | undefined {
    const index = tiles.indexOf(from);
    if (key === 'ArrowRight') return tiles[index + 1];
    if (key === 'ArrowLeft') return tiles[index - 1];
    const box = from.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    const down = key === 'ArrowDown';
    let best: HTMLElement | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const tile of tiles) {
        const other = tile.getBoundingClientRect();
        const rowGap = down ? other.top - box.bottom : box.top - other.bottom;
        if (rowGap < -box.height / 2) continue; // same row or the wrong way
        // the next row first, then the closest column within it
        const score = rowGap * 1000 + Math.abs(other.left + other.width / 2 - centre);
        if (score < bestScore) [best, bestScore] = [tile, score];
    }
    return best;
}

function focusTile(tile: HTMLElement | undefined): void {
    if (!tile) return;
    tile.focus();
    tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Moving a tile re-places every tile, which drops focus: put it back on the same item. */
function refocus(id: ItemId): void {
    requestAnimationFrame(() => focusTile(tileById.get(id)));
}

function moveWithinTier(id: ItemId, tierId: string, step: number): void {
    const tier = findTier(tierId);
    if (!tier) return;
    const from = tier.items.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= tier.items.length) return;
    pushHistory();
    tier.items.splice(from, 1);
    tier.items.splice(to, 0, id);
    placeAllTiles();
    autosave();
    refocus(id);
}

/**
 * To another tier `step` places on, keeping roughly the same place in the row. Rows: down from the last
 * tier is the pool. Charts: only to a real cell, and ← → never wrap round to the next row of cells.
 */
function moveToNextTier(id: ItemId, src: string, step: number, { toPool }: { toPool: boolean }): void {
    const index = state.tiers.findIndex((tier) => tier.id === src);
    if (index < 0 || index + step < 0) return; // in the pool the number keys say which tier; nothing above the first
    const columns = state.chartColumns;
    if (Math.abs(step) === 1 && state.layout === 'chart' && Math.floor(index / columns) !== Math.floor((index + step) / columns)) return;
    const target = state.tiers[index + step];
    if (!target && !toPool) return;
    const place = state.tiers[index]!.items.indexOf(id);
    pushHistory();
    removeFromTiers([id]);
    if (target) target.items.splice(Math.min(place, target.items.length), 0, id);
    placeAllTiles();
    autosave();
    toast(target ? `Moved to ${target.label}` : 'Back in the pool');
    refocus(id);
}

function onAreaKey(e: KeyboardEvent, area: HTMLElement): void {
    const focused = document.activeElement;
    const tiles = visibleTiles(area);
    if (!isTile(focused)) {
        // the area itself has focus: the first arrow press steps onto its first item
        if (focused === area && e.key.startsWith('Arrow') && tiles.length) {
            e.preventDefault();
            focusTile(tiles[0]);
        }
        return;
    }
    const id = Number(focused.dataset.id);
    const src = focused.dataset.src || 'pool';
    if (e.altKey && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const sideways = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        const direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const chart = state.layout === 'chart';
        if (src === 'pool') return;
        if (sideways && (!chart || e.shiftKey)) moveWithinTier(id, src, direction);
        else if (chart) moveToNextTier(id, src, sideways ? direction : direction * state.chartColumns, { toPool: false });
        else moveToNextTier(id, src, direction, { toPool: true });
        return;
    }
    if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        focusTile(neighbour(focused, tiles, e.key));
    } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        focusTile(e.key === 'Home' ? tiles[0] : tiles.at(-1));
    } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onTileClick({ id, src, shift: e.shiftKey, meta: e.ctrlKey || e.metaKey });
    } else if (e.ctrlKey || e.metaKey || e.altKey) {
        // modified keys belong to the shortcut layer (Ctrl+Z, Ctrl+A…)
    } else if (/^[0-9]$/.test(e.key) && !state.selection.size) {
        // nothing selected: the number applies to this item; the shortcut layer does the move itself
        onTileClick({ id, src, shift: false, meta: false });
        refocus(id);
    } else if (/^[0-9]$/.test(e.key)) refocus(id);
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const box = focused.getBoundingClientRect();
        focused.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: box.left + box.width / 2,
                clientY: box.top + box.height / 2,
            }),
        );
    }
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupTileKeys(): void {
    // undo and redo redraw every tile: keep the keyboard where it was
    let focusedBeforeRestore: ItemId | null = null;
    document.addEventListener('focusin', (e) => {
        focusedBeforeRestore = isTile(e.target as Element) ? Number((e.target as HTMLElement).dataset.id) : null;
    });
    onHistoryRestore(() => {
        if (focusedBeforeRestore != null && !isTile(document.activeElement)) refocus(focusedBeforeRestore);
    });
    for (const areaId of AREAS) {
        const area = byId(areaId);
        area.addEventListener('keydown', (e) => onAreaKey(e, area));
    }
}
