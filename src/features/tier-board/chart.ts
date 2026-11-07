// src/features/tier-board/chart.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Charts: a list's tiers laid out as a grid of labelled cells (an alignment
//  chart, say) instead of rows. Each cell is still a tier, so dragging, selection,
//  undo, quick rank and exports need nothing new. Here: the layout on the board,
//  and the Layout and Columns controls in Style → Tiers.
// ─────────────────────────────────────────────────────────────────────────────
import { CHART_COLUMNS } from '../../core/defaults';
import { onHistoryRestore, pushHistory } from '../../core/history';
import { autosave } from '../../core/persist';
import { onListOpen, state } from '../../core/state';
import type { BoardLayout } from '../../core/types';
import { byId } from '../../lib/dom';
import { renderTiers } from './board';

export const isChart = (): boolean => state.layout === 'chart';

/** Puts the list's layout on the tier area: rows, or a grid `chartColumns` cells across (chart.css). */
export function applyBoardLayout(): void {
    const section = byId('tsec');
    section.classList.toggle('chart', isChart());
    section.style.setProperty('--chart-cols', String(state.chartColumns));
}

/** Shows the open list's layout in Style → Tiers (Columns only matters for a chart). */
function syncLayoutControls(): void {
    byId<HTMLSelectElement>('ap-layout').value = state.layout;
    byId<HTMLInputElement>('ap-cols').value = String(state.chartColumns);
    byId('ap-colsval').textContent = String(state.chartColumns);
    byId('ap-colsrow').classList.toggle('hid', !isChart());
}

/** Switches between rows and a chart, or changes how many cells a chart has across. `record` = make it an undo step. */
function setBoardLayout(layout: BoardLayout, columns: number, record: boolean): void {
    columns = Math.max(CHART_COLUMNS.min, Math.min(CHART_COLUMNS.max, Math.round(columns) || CHART_COLUMNS.start));
    if (layout === state.layout && columns === state.chartColumns) return;
    if (record) pushHistory();
    state.layout = layout;
    state.chartColumns = columns;
    renderTiers();
    syncLayoutControls();
    autosave();
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupChart(): void {
    byId<HTMLSelectElement>('ap-layout').onchange = (e) =>
        setBoardLayout((e.target as HTMLSelectElement).value === 'chart' ? 'chart' : 'tiers', state.chartColumns, true);
    // one undo step per slider drag, however many steps it passes through
    const columns = byId<HTMLInputElement>('ap-cols');
    let dragging = false;
    columns.oninput = () => {
        setBoardLayout('chart', Number(columns.value), !dragging);
        dragging = true;
    };
    columns.onchange = () => {
        dragging = false;
    };
    onListOpen(syncLayoutControls);
    onHistoryRestore(syncLayoutControls);
}
