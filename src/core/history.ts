// src/core/history.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Undo / redo for anything that changes the tiers, the variant families, the
//  list's look and layout, or its grids: the engine's history (tier-engine/core
//  createHistory) keeping a JSON copy of those, at most 80 steps back.
//  A step can also mark a deletion of items, so stepping across it brings them back
//  (or deletes them again); the items themselves are kept by features/items.
// ─────────────────────────────────────────────────────────────────────────────
import { createHistory, isRecord, isTileFit, isTileShape } from 'tier-engine/core';
import { byId, randomId } from '../lib/dom';
import { toast } from '../lib/ui';
import { CHART_COLUMNS } from './defaults';
import { readGrids } from './grid-format';
import { entryById, rebuildAliases } from './items';
import { autosave, sanitizeTiers } from './persist';
import { onListReset, state } from './state';
import type { ItemId, Theme } from './types';

/** A step's side of a deletion: just before it (the items are there) or just after it (they're gone). */
export interface DeletionSide {
    deletion: number;
    itemsExist: boolean;
}

const restoreListeners: (() => void)[] = [];
/** Runs after an undo or redo put back an earlier state (the board and studio redraw). */
export const onHistoryRestore = (listener: () => void): void => void restoreListeners.push(listener);

type DeletionCrossing = (side: DeletionSide) => string | undefined;
let crossDeletion: DeletionCrossing | null = null;
/**
 * Puts deleted items back, or deletes them again, as undo or redo reaches a step marked with their
 * deletion. Returns the message to show instead of "Undone".
 */
export const onDeletionCrossed = (handler: DeletionCrossing): void => {
    crossDeletion = handler;
};
/** The message crossing a deletion gave, for the step being taken now. */
let crossingMessage: string | undefined;

/** What a step keeps: the tiers, the variant families, the look and layout, and the grids (tier-engine/core createHistory). */
const history = createHistory({
    capture: () => ({
        t: state.tiers,
        f: state.familyOf || {},
        m: state.combinedFamilies || {},
        th: state.theme,
        ly: state.layout,
        lc: state.chartColumns,
        ts: state.tileShape,
        tf: state.tileFit,
        g: state.grids,
    }),
    restore(saved, crossed) {
        // items first: the tiers below only keep items that exist
        crossingMessage = crossed && crossDeletion?.({ deletion: crossed.mark, itemsExist: crossed.before });
        if (!isRecord(saved)) return;
        state.tiers = sanitizeTiers(saved.t);
        if (isRecord(saved.f)) {
            state.familyOf = saved.f as Record<string, ItemId>;
            state.combinedFamilies = (isRecord(saved.m) ? saved.m : {}) as Record<string, true>;
            rebuildAliases();
        }
        if (isRecord(saved.th)) state.theme = saved.th as unknown as Theme;
        if (saved.ly === 'tiers' || saved.ly === 'chart') state.layout = saved.ly;
        if (Number.isInteger(saved.lc)) state.chartColumns = Math.max(CHART_COLUMNS.min, Math.min(CHART_COLUMNS.max, Number(saved.lc)));
        if (isTileShape(saved.ts)) state.tileShape = saved.ts;
        if (isTileFit(saved.tf)) state.tileFit = saved.tf;
        if (Array.isArray(saved.g)) {
            state.grids = readGrids(saved.g, (id) => entryById.has(id), randomId);
            if (!state.grids.some((grid) => grid.id === state.gridId)) state.gridId = state.grids[0]?.id ?? null;
        }
    },
});

/** The open list's undo history: the board takes changes through it too (features/tier-board). */
export const listHistory = history;

/** True when the newest undo step is the moment just before `deletion` (so undoing it is the same as bringing the items back). */
export const isLastStepBefore = (deletion: number): boolean => history.isLastStepBefore(deletion);

/** Call before changing the tiers: records how they are now (`side`: this change deletes items, or brings them back). */
export function pushHistory(side?: DeletionSide): void {
    history.push(side && { mark: side.deletion, before: side.itemsExist });
}

/** Makes several changes count as one undo step. */
export const asOneUndoStep = <T>(change: () => T): T => history.asOneStep(change);

/** Whether there's a step to undo (or redo). */
export const canUndo = (redo = false): boolean => (redo ? history.canRedo() : history.canUndo());

export function undo(redo: boolean): void {
    crossingMessage = undefined;
    const result = redo ? history.redo() : history.undo();
    if (!result.done) {
        toast(redo ? 'Nothing to redo' : 'Nothing to undo');
        return;
    }
    restoreListeners.forEach((listener) => {
        listener();
    });
    autosave();
    toast(crossingMessage || (redo ? 'Redone' : 'Undone. Ctrl/⌘ Shift Z redoes it'));
}

export function setupHistory(): void {
    onListReset(() => history.clear());
    byId('undobtn').onclick = () => undo(false);
    byId('redobtn').onclick = () => undo(true);
}
