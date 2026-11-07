// src/core/history.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Undo / redo for anything that changes the tiers, the variant families or the
//  list's look and layout. Each step is a JSON copy of those, at most 80 steps back.
//  A step can also mark a deletion of items, so stepping across it brings them back
//  (or deletes them again); the items themselves are kept by features/items.
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../lib/checks';
import { byId } from '../lib/dom';
import { toast } from '../lib/ui';
import { CHART_COLUMNS } from './defaults';
import { rebuildAliases } from './items';
import { autosave, sanitizeTiers } from './persist';
import { onListReset, state } from './state';
import { isTileFit, isTileShape } from './tile-box';
import type { ItemId, Theme } from './types';

const MAX_STEPS = 80;

/** While depth > 0, changes don't record their own undo step (a bigger change already did). */
export const undoLock = { depth: 0 };
export const undoStack: string[] = [];
export const redoStack: string[] = [];

const restoreListeners: (() => void)[] = [];
/** Runs after an undo or redo put back an earlier state (the board and studio redraw). */
export const onHistoryRestore = (listener: () => void): void => void restoreListeners.push(listener);

/** A step's side of a deletion: just before it (the items are there) or just after it (they're gone). */
export interface DeletionSide {
    deletion: number;
    itemsExist: boolean;
}
type DeletionCrossing = (side: DeletionSide) => string | undefined;
let crossDeletion: DeletionCrossing | null = null;
/**
 * Puts deleted items back, or deletes them again, as undo or redo reaches a step marked with their
 * deletion. Returns the message to show instead of "Undone".
 */
export const onDeletionCrossed = (handler: DeletionCrossing): void => {
    crossDeletion = handler;
};

const undoSnapshot = (side?: DeletionSide): string =>
    JSON.stringify({
        t: state.tiers,
        f: state.familyOf || {},
        m: state.combinedFamilies || {},
        th: state.theme,
        ly: state.layout,
        lc: state.chartColumns,
        ts: state.tileShape,
        tf: state.tileFit,
        ...(side ? { del: side.deletion, kept: side.itemsExist } : {}),
    });

const readDeletionSide = (saved: unknown): DeletionSide | undefined =>
    isRecord(saved) && Number.isInteger(saved.del) ? { deletion: Number(saved.del), itemsExist: saved.kept === true } : undefined;

/** True when the newest undo step is the moment just before `deletion` (so undoing it is the same as bringing the items back). */
export function isLastStepBefore(deletion: number): boolean {
    const step = undoStack.at(-1);
    if (step == null) return false;
    const side = readDeletionSide(JSON.parse(step));
    return side?.deletion === deletion && side.itemsExist;
}

/** Call before changing the tiers: records how they are now (`side`: this change deletes items, or brings them back). */
export function pushHistory(side?: DeletionSide): void {
    if (undoLock.depth) return;
    undoStack.push(undoSnapshot(side));
    if (undoStack.length > MAX_STEPS) undoStack.shift();
    redoStack.length = 0;
}

/** Makes several changes count as one undo step. */
export function asOneUndoStep<T>(change: () => T): T {
    pushHistory();
    undoLock.depth++;
    try {
        return change();
    } finally {
        undoLock.depth--;
    }
}

export function undo(redo: boolean): void {
    const from = redo ? redoStack : undoStack;
    const to = redo ? undoStack : redoStack;
    const step = from.pop();
    if (step == null) {
        toast(redo ? 'Nothing to redo' : 'Nothing to undo');
        return;
    }
    const saved: unknown = JSON.parse(step);
    // the state being left is on the other side of the same deletion
    const side = readDeletionSide(saved);
    to.push(undoSnapshot(side && { deletion: side.deletion, itemsExist: !side.itemsExist }));
    // items first: the tiers below only keep items that exist
    const message = side && crossDeletion?.(side);
    // older steps (from the tier editor) are just the tiers array
    if (Array.isArray(saved)) state.tiers = sanitizeTiers(saved);
    else if (isRecord(saved)) {
        state.tiers = sanitizeTiers(saved.t);
        if (isRecord(saved.f)) {
            state.familyOf = saved.f as Record<string, ItemId>;
            state.combinedFamilies = (isRecord(saved.m) ? saved.m : {}) as Record<string, true>;
            rebuildAliases();
        }
        // a copy of this tab's own earlier theme (older steps have none)
        if (isRecord(saved.th)) state.theme = saved.th as unknown as Theme;
        // rows or chart (older steps have neither)
        if (saved.ly === 'tiers' || saved.ly === 'chart') state.layout = saved.ly;
        if (Number.isInteger(saved.lc)) state.chartColumns = Math.max(CHART_COLUMNS.min, Math.min(CHART_COLUMNS.max, Number(saved.lc)));
        // tile shape and fit (older steps have neither)
        if (isTileShape(saved.ts)) state.tileShape = saved.ts;
        if (isTileFit(saved.tf)) state.tileFit = saved.tf;
    }
    restoreListeners.forEach((listener) => {
        listener();
    });
    autosave();
    toast(message || (redo ? 'Redone' : 'Undone. Ctrl/⌘ Shift Z redoes it'));
}

export function setupHistory(): void {
    onListReset(() => {
        undoStack.length = 0;
        redoStack.length = 0;
    });
    byId('undobtn').onclick = () => undo(false);
    byId('redobtn').onclick = () => undo(true);
}
