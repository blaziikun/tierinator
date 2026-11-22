// src/features/grid/grid.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The Grid view (Pokémon lists): your favourite in every cell of, say, Gen ×
//  Type, worked out from your ranking (cells.ts). "The best" and "my favourite"
//  aren't always the same, so any cell can be pinned to your own pick; the
//  ranking's pick still shows under it. Each list keeps several grids, each with
//  its own axes, layer, focus and pins (core/grid-format.ts reads them back).
//
//  Loads the first time the Grid tab (or G) is used: start.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { clearestTextOn } from 'tier-engine/core';
import { html, type SafeHtml, setHtml } from 'tier-engine/safe';
import { GRID_PRESETS, gridFromPreset, MAX_GRIDS } from '../../core/grid-format';
import { onHistoryRestore, pushHistory } from '../../core/history';
import { entryById, rankableEntries } from '../../core/items';
import { autosave } from '../../core/persist';
import { isPokemonList, onListOpen, state } from '../../core/state';
import type { FacetKey, ItemId, SavedGrid } from '../../core/types';
import { byId, randomId } from '../../lib/dom';
import { ask, askText, closePopovers, placePopover, toast } from '../../lib/ui';
import { TYPE_COLORS } from '../../pokemon/data';
import { FACET_KEYS, FACETS, focusSummary, isFocusEmpty, valueLabel } from '../../pokemon/facets';
import { labelTextColor } from '../appearance/theme';
import { openFocusPicker, setBoardFocus } from '../focus/focus';
import { gridView, switchView } from '../layout/layout';
import { startQuickRank } from '../quick-rank/quick-rank';
import { spriteSrc, tryNextDefaultMirror } from '../sprites/sprites';
import { fitTilePicture } from '../tier-board/board';
import { autoName, axisValues, buildGrid, cellKey, type GridCell, type GridModel, rankPlaces } from './cells';
import { exportGridPicture } from './grid-export';

/** The grid on screen, worked out last time it was drawn (cell pop-ups and export read it). */
let model: GridModel | null = null;

/** The open grid, making the first one (Gen × Type) if the list has none yet. */
export function currentGrid(): SavedGrid {
    let grid = state.grids.find((g) => g.id === state.gridId);
    if (!grid) {
        if (!state.grids.length) state.grids.push(gridFromPreset(GRID_PRESETS[0]!, randomId()));
        grid = state.grids[0]!;
        state.gridId = grid.id;
    }
    return grid;
}

/** Changes the open grid as one undo step, then saves and redraws. */
function changeGrid(update: (grid: SavedGrid) => void): void {
    pushHistory();
    const grid = currentGrid();
    const wasAutoNamed = grid.name === autoName(grid);
    update(grid);
    if (wasAutoNamed) grid.name = autoName(grid);
    autosave();
    renderGrid();
}

const facetLabel = (key: FacetKey): string => FACETS[key].label;

/** A heading for a row or column: types get their colour. */
function axisLabel(facet: FacetKey, value: string): SafeHtml {
    const label = valueLabel(facet, value);
    if (facet !== 'type') return html`<span class="gax">${label}</span>`;
    const color = TYPE_COLORS[value] ?? '#8b93a7';
    return html`<span class="gax gtype" style="background:${color};color:${clearestTextOn(color)}">${label}</span>`;
}

/** "Gen 4 · Electric (First stage)": a cell in words. */
function cellName(grid: SavedGrid, cell: Pick<GridCell, 'row' | 'col'>): string {
    const parts = [valueLabel(grid.rows, cell.row)];
    if (grid.cols && cell.col != null) parts.push(valueLabel(grid.cols, cell.col));
    const name = grid.cols === grid.rows && cell.col === cell.row && grid.rows === 'type' ? `${parts[0]} only` : parts.join(' · ');
    return grid.layer && grid.layerValue ? `${name} (${valueLabel(grid.layer, grid.layerValue)})` : name;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DRAWING
// ═════════════════════════════════════════════════════════════════════════════

/** A Pokémon's picture as on its tile: the tile's shape, cropped the same way. */
function picture(id: ItemId): HTMLElement {
    const frame = document.createElement('span');
    frame.className = 'gpic';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
        if (!tryNextDefaultMirror(img, id)) img.classList.add('gone');
    });
    frame.append(img);
    img.src = spriteSrc(id);
    fitTilePicture(id, frame);
    return frame;
}

function cellButton(grid: SavedGrid, cell: GridCell): HTMLElement {
    const shown = cell.pin ?? cell.top;
    const button = document.createElement('button');
    button.className = 'gcell';
    button.dataset.key = cell.key;
    const where = cellName(grid, cell);
    if (!cell.ids.length) {
        button.disabled = true;
        button.classList.add('empty');
        button.title = `${where}: no Pokémon fits`;
        setHtml(button, html`<span class="gdash">—</span>`);
        return button;
    }
    if (shown == null) {
        button.classList.add('unranked');
        button.title = `${where}: ${cell.ids.length} to rank`;
        setHtml(button, html`<span class="gwait">${cell.ids.length} to rank</span>`);
        return button;
    }
    const name = entryById.get(shown)?.name ?? '';
    const differs = cell.pin != null && cell.top != null && cell.top !== cell.pin;
    button.title = `${where}: ${name}${cell.pin != null ? ' (your pick)' : ''}. Click for everything in this cell`;
    button.append(picture(shown));
    const label = document.createElement('span');
    label.className = 'gname';
    label.textContent = name;
    button.append(label);
    if (cell.pin != null) {
        const pin = document.createElement('span');
        pin.className = 'gpin';
        pin.title = 'Your pick';
        button.append(pin);
        button.classList.add('pinned');
    }
    if (differs) {
        const rank = document.createElement('span');
        rank.className = 'gtop';
        rank.textContent = 'Ranked: ' + (entryById.get(cell.top!)?.name ?? '');
        button.append(rank);
    }
    return button;
}

function renderTabs(grid: SavedGrid): void {
    const tabs = byId('gtabs');
    setHtml(
        tabs,
        html`${state.grids.map(
            (g) => html`<button class="${g.id === grid.id ? 'on' : ''}" data-grid="${g.id}" title="${g.name}">${g.name}</button>`,
        )}`,
    );
}

function renderControls(grid: SavedGrid): void {
    // each facet once across the three, except types, which can run both ways (every type pairing)
    const options = (chosen: FacetKey | null, taken: (FacetKey | null)[], none: string | null) =>
        html`${none != null ? html`<option value="" ${chosen == null ? 'selected' : ''}>${none}</option>` : ''}${FACET_KEYS.filter(
            (key) => key === chosen || !taken.includes(key),
        ).map((key) => html`<option value="${key}" ${key === chosen ? 'selected' : ''}>${facetLabel(key)}</option>`)}`;
    setHtml(byId('grows'), options(grid.rows, [grid.layer], null));
    setHtml(byId('gcols'), options(grid.cols, [grid.rows === 'type' ? null : grid.rows, grid.layer], 'One column'));
    setHtml(byId('glayer'), options(grid.layer, [grid.rows, grid.cols], 'None'));
    const valuesButton = (id: string, facet: FacetKey | null, chosen: string[]) => {
        const button = byId(id);
        button.classList.toggle('hid', !facet);
        if (!facet) return;
        button.textContent = chosen.length ? `${chosen.length} of ${FACETS[facet].values.length} ▾` : 'All ▾';
        button.title = `Which ${facetLabel(facet).toLowerCase()} values to show`;
    };
    valuesButton('growsv', grid.rows, grid.rowValues);
    valuesButton('gcolsv', grid.cols, grid.colValues);
    const focusButton = byId('gfocus');
    const focused = !isFocusEmpty(grid.focus);
    focusButton.textContent = focused ? 'Focus · on ▾' : 'Focus ▾';
    focusButton.classList.toggle('on', focused);
    focusButton.title = focused
        ? `This grid shows only ${focusSummary(grid.focus)}`
        : "Narrow this grid's Pokémon: starters, legendaries, fully evolved…";
}

function renderLayers(grid: SavedGrid, counts: Map<string, number>): void {
    const strip = byId('glayers');
    strip.classList.toggle('hid', !grid.layer);
    if (!grid.layer) return;
    const layer = grid.layer;
    setHtml(
        strip,
        html`<button class="${grid.layerValue == null ? 'on' : ''}" data-layer="">All</button>${FACETS[layer].values.map(
            ({ value, label }) =>
                html`<button class="${grid.layerValue === value ? 'on' : ''}" data-layer="${value}" ${counts.get(value) ? '' : 'disabled'}>${label} <span class="note">${counts.get(value) ?? 0}</span></button>`,
        )}`,
    );
}

/** Draws the open grid: tabs, controls, the layer strip and the cells. */
export function renderGrid(): void {
    if (state.view !== 'grid') return;
    const grid = currentGrid();
    model = buildGrid(grid, rankableEntries(), rankPlaces(state.tiers));
    renderTabs(grid);
    renderControls(grid);
    renderLayers(grid, model.layerCounts);
    let pinned = 0;
    let filled = 0;
    for (const cell of model.cells.values()) {
        if (cell.pin != null) pinned++;
        if (cell.pin != null || cell.top != null) filled++;
    }
    const focus = isFocusEmpty(grid.focus) ? '' : ` Only ${focusSummary(grid.focus)}.`;
    byId('gnote').textContent =
        `${filled} of ${model.cells.size} cells have a pick${pinned ? `, ${pinned} of them yours` : ''}.${focus} ` +
        'A cell shows the best-ranked Pokémon that fits; click one to see them all, or to pin your own favourite.';
    const table = byId('gtable');
    table.replaceChildren();
    table.classList.toggle('one', !model.cols);
    if (model.cols) {
        const head = document.createElement('tr');
        head.append(document.createElement('th'));
        for (const col of model.cols) {
            const th = document.createElement('th');
            th.scope = 'col';
            setHtml(th, axisLabel(grid.cols!, col.value));
            head.append(th);
        }
        const thead = document.createElement('thead');
        thead.append(head);
        table.append(thead);
    }
    const body = document.createElement('tbody');
    for (const row of model.rows) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        setHtml(th, axisLabel(grid.rows, row.value));
        tr.append(th);
        for (const col of model.cols ?? [null]) {
            const td = document.createElement('td');
            td.append(cellButton(grid, model.cells.get(cellKey(grid.layerValue, row.value, col?.value ?? null))!));
            tr.append(td);
        }
        body.append(tr);
    }
    table.append(body);
}

// ═════════════════════════════════════════════════════════════════════════════
//  A CELL: everything in it, pins, and taking it to the tiers
// ═════════════════════════════════════════════════════════════════════════════

let openCell: string | null = null;

function tierChip(id: ItemId): SafeHtml {
    const tier = state.tiers.find((t) => t.items.includes(id));
    if (!tier) return html`<span class="note">Not ranked</span>`;
    return html`<span class="gtier" style="background:${tier.color};color:${labelTextColor(tier)}">${tier.label}</span>`;
}

function renderCellPopover(): void {
    const grid = currentGrid();
    const cell = openCell != null ? model?.cells.get(openCell) : undefined;
    if (!cell) {
        closePopovers();
        return;
    }
    const row = (id: ItemId, place: number | null) => {
        const pinned = cell.pin === id;
        return html`<div class="gli${pinned ? ' pinned' : ''}">
            <span class="gplace">${place ?? ''}</span><img alt="" src="${spriteSrc(id)}"><span class="gliname">${entryById.get(id)?.name ?? ''}</span>${tierChip(id)}
            <button class="${pinned ? 'cbtn' : ''}" data-pin="${id}" aria-pressed="${String(pinned)}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${entryById.get(id)?.name ?? ''}" title="${pinned ? 'Unpin: the cell follows your ranking again' : 'Make this the cell’s pick, whatever the ranking says'}">${pinned ? 'Your pick' : 'Pin'}</button>
        </div>`;
    };
    const ranked = cell.ids.slice(0, cell.ranked);
    const unranked = cell.ids.slice(cell.ranked);
    setHtml(
        byId('gcellpop'),
        html`<h3>${cellName(grid, cell)}</h3>
        <p class="note">${cell.ids.length} Pokémon, ${cell.ranked} ranked. ${
            cell.pin != null
                ? html`Pinned to <b>${entryById.get(cell.pin)?.name ?? ''}</b>${cell.top != null && cell.top !== cell.pin ? html`; your ranking would say <b>${entryById.get(cell.top)?.name ?? ''}</b>` : ''}.`
                : 'The best-ranked one is the pick; pin another to override it.'
        }</p>
        <div class="glist">${ranked.map((id, i) => row(id, i + 1))}${
            unranked.length ? html`<div class="gsub">Not ranked yet (${unranked.length})</div>${unranked.map((id) => row(id, null))}` : ''
        }</div>
        <div class="edbtns" style="justify-content:flex-start">
            <button id="gcelltiers" class="accent" title="Back to the tier list, showing only this cell's Pokémon, to reorder them">Show in the tiers</button>
            ${unranked.length ? html`<button id="gcellrank" title="Quick rank this cell's unranked Pokémon one at a time">Quick rank ${unranked.length}</button>` : ''}
        </div>`,
    );
}

function openCellPopover(button: HTMLElement): void {
    closePopovers();
    openCell = button.dataset.key ?? null;
    renderCellPopover();
    placePopover(byId('gcellpop'), button);
}

/** Back to the tiers, showing only the open cell's Pokémon. */
function focusTiersOnCell(): boolean {
    const cell = openCell != null ? model?.cells.get(openCell) : undefined;
    if (!cell) return false;
    setBoardFocus({ only: { ids: cell.ids.slice(), label: cellName(currentGrid(), cell) } });
    switchView('tier');
    return true;
}

function togglePin(id: ItemId): void {
    const key = openCell;
    if (key == null) return;
    const pinned = currentGrid().pins[key] === id;
    changeGrid((grid) => {
        if (pinned) delete grid.pins[key];
        else grid.pins[key] = id;
    });
    renderCellPopover();
    toast(pinned ? 'Unpinned: the cell follows your ranking' : `Pinned ${entryById.get(id)?.name ?? ''}. Ctrl/⌘ Z undoes it`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  GRIDS: new, rename, delete; which values an axis shows
// ═════════════════════════════════════════════════════════════════════════════

function newGrid(index: number): void {
    closePopovers();
    if (state.grids.length >= MAX_GRIDS) {
        toast(`${MAX_GRIDS} grids is the most a list keeps: delete one first`);
        return;
    }
    const source = index < 0 ? null : GRID_PRESETS[index];
    pushHistory();
    const grid = source
        ? gridFromPreset(source, randomId())
        : { ...structuredClone(currentGrid()), id: randomId(), name: `${currentGrid().name} (copy)` };
    state.grids.push(grid);
    state.gridId = grid.id;
    autosave();
    renderGrid();
}

async function renameGrid(): Promise<void> {
    closePopovers();
    const name = (await askText('Name this grid', currentGrid().name))?.trim().slice(0, 40);
    if (!name) return;
    pushHistory();
    currentGrid().name = name; // from now on the name stays as given when the axes change
    autosave();
    renderGrid();
}

async function deleteGrid(): Promise<void> {
    closePopovers();
    const grid = currentGrid();
    if (state.grids.length < 2) return toast("It's the only grid: change it instead");
    if (!(await ask(`Delete the grid “${grid.name}” and its pins? Ctrl/⌘ Z brings it back.`, 'Delete', true))) return;
    pushHistory();
    state.grids = state.grids.filter((g) => g !== grid);
    state.gridId = state.grids[0]?.id ?? null;
    autosave();
    renderGrid();
}

let valuesAxis: 'rows' | 'cols' = 'rows';

function renderValuesPopover(): void {
    const grid = currentGrid();
    const facet = valuesAxis === 'rows' ? grid.rows : grid.cols;
    if (!facet) {
        closePopovers();
        return;
    }
    const chosen = valuesAxis === 'rows' ? grid.rowValues : grid.colValues;
    const shown = new Set(axisValues(facet, chosen).map((v) => v.value));
    setHtml(
        byId('gvalpop'),
        html`<h3>Which ${facetLabel(facet).toLowerCase()} values ${valuesAxis === 'rows' ? 'run down' : 'run across'}</h3>
        <div class="fchips">${FACETS[facet].values.map(
            ({ value, label }) =>
                html`<button class="chip${chosen.length && shown.has(value) ? ' on' : ''}" data-val="${value}" aria-pressed="${String(!!chosen.length && shown.has(value))}">${label}</button>`,
        )}</div>
        <p class="note">${chosen.length ? `${chosen.length} chosen, in the order you picked them.` : 'Nothing chosen: all of them show, in the usual order.'}</p>
        <div class="edbtns" style="justify-content:flex-start"><button data-val="" ${chosen.length ? '' : 'disabled'}>Show all</button></div>`,
    );
}

// ── wiring (runs once, when the grid first loads) ──
export function setupGrid(): void {
    gridView.render = renderGrid;
    byId('tab-grid').onclick = () => switchView('grid');
    onHistoryRestore(renderGrid);
    onListOpen(() => {
        if (state.view === 'grid') {
            if (isPokemonList()) renderGrid();
            else switchView('tier');
        }
    });
    byId('gtabs').addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-grid]')?.dataset.grid;
        if (!id || id === state.gridId) return;
        state.gridId = id;
        autosave();
        renderGrid();
    });
    byId('gnew').onclick = (e) => {
        closePopovers();
        setHtml(
            byId('gnewpop'),
            html`${GRID_PRESETS.map((preset, i) => html`<button data-preset="${i}" title="${preset.title}">${preset.name}</button>`)}<hr><button data-preset="-1">A copy of this grid</button>`,
        );
        placePopover(byId('gnewpop'), e.currentTarget as Element);
    };
    byId('gnewpop').addEventListener('click', (e) => {
        const preset = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]')?.dataset.preset;
        if (preset != null) newGrid(Number(preset));
    });
    const axis = (id: string, apply: (grid: SavedGrid, value: FacetKey | null) => void) => {
        byId<HTMLSelectElement>(id).onchange = (e) => {
            const value = (e.target as HTMLSelectElement).value;
            changeGrid((grid) => apply(grid, value ? (value as FacetKey) : null));
        };
    };
    axis('grows', (grid, value) => {
        if (!value) return;
        grid.rows = value;
        grid.rowValues = [];
        if (grid.cols === value && value !== 'type') grid.cols = null;
    });
    axis('gcols', (grid, value) => {
        grid.cols = value;
        grid.colValues = [];
    });
    axis('glayer', (grid, value) => {
        grid.layer = value;
        grid.layerValue = null;
    });
    byId('glayers').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]');
        if (!button) return;
        changeGrid((grid) => {
            grid.layerValue = button.dataset.layer || null;
        });
    });
    for (const [id, which] of [
        ['growsv', 'rows'],
        ['gcolsv', 'cols'],
    ] as const)
        byId(id).onclick = (e) => {
            closePopovers();
            valuesAxis = which;
            renderValuesPopover();
            placePopover(byId('gvalpop'), e.currentTarget as Element);
        };
    byId('gvalpop').addEventListener('click', (e) => {
        const value = (e.target as HTMLElement).closest<HTMLElement>('[data-val]')?.dataset.val;
        if (value == null) return;
        changeGrid((grid) => {
            const key = valuesAxis === 'rows' ? 'rowValues' : 'colValues';
            const chosen = grid[key];
            grid[key] = !value ? [] : chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
        });
        renderValuesPopover();
    });
    byId('gfocus').onclick = (e) =>
        openFocusPicker(e.currentTarget as Element, {
            get: () => currentGrid().focus,
            set: (focus) =>
                changeGrid((grid) => {
                    const { only: _only, ...facets } = focus; // a grid's focus is facets only
                    grid.focus = facets;
                }),
            title: 'This grid shows only',
        });
    byId('gmore').onclick = (e) => {
        closePopovers();
        byId('gdel').classList.toggle('hid', state.grids.length < 2);
        placePopover(byId('gmorepop'), e.currentTarget as Element);
    };
    byId('gren').onclick = () => void renameGrid();
    byId('gdel').onclick = () => void deleteGrid();
    byId('gpng').onclick = () => {
        closePopovers();
        if (model) void exportGridPicture(currentGrid(), model, 'download');
    };
    byId('gcopy').onclick = () => {
        closePopovers();
        if (model) void exportGridPicture(currentGrid(), model, 'copy');
    };
    byId('gtable').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('.gcell');
        if (button && !(button as HTMLButtonElement).disabled) openCellPopover(button);
    });
    byId('gcellpop').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!button) return;
        if (button.dataset.pin) togglePin(Number(button.dataset.pin));
        else if (button.id === 'gcelltiers') focusTiersOnCell();
        else if (button.id === 'gcellrank' && focusTiersOnCell()) startQuickRank();
    });
}
