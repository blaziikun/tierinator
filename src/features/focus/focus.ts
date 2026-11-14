// src/features/focus/focus.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Focus ▾ (Pokémon lists): show only some Pokémon, by type, generation,
//  evolution stage, group and form, in the pool and in the tiers at once, so a
//  set (the Electric types, the starters) can be checked in its own order.
//  The matching is pokemon/facets.ts; hiding, the line above the tiers and
//  where a dropped item lands are tier-board (board.ts, placement.ts).
//
//  The same picker sets a grid's own focus (features/grid), so it's built for
//  whichever focus it's opened on.
// ─────────────────────────────────────────────────────────────────────────────
import { rankableEntries } from '../../core/items';
import { isPokemonList, onListOpen, state } from '../../core/state';
import type { FacetKey, Focus } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { closePopovers, placePopover } from '../../lib/ui';
import { TYPE_COLORS } from '../../pokemon/data';
import { FACET_KEYS, FACETS, focusSummary, isFocusEmpty, STAGE_SHORTCUTS, sameSet } from '../../pokemon/facets';
import { applyFilters, inFocus, syncSelection } from '../tier-board/board';

/** Which focus the picker is changing: the tiers' and pool's, or a grid's. */
export interface FocusTarget {
    get: () => Focus;
    set: (focus: Focus) => void;
    title: string;
}

let target: FocusTarget | null = null;

/** The tiers' and pool's focus. */
const boardFocus: FocusTarget = {
    get: () => state.focus,
    set: setBoardFocus,
    title: 'Show only',
};

/** Changes what the pool and tiers show, and lets go of selected items that are now hidden. */
export function setBoardFocus(focus: Focus): void {
    state.focus = focus;
    for (const id of [...state.selection]) if (!inFocus(id)) state.selection.delete(id);
    if (!state.selection.size) state.selectionSource = null;
    applyFilters();
    syncSelection();
    syncFocusButton();
}

function syncFocusButton(): void {
    const button = byId('focusbtn');
    const chosen = FACET_KEYS.reduce((count, key) => count + (state.focus[key]?.length ?? 0), state.focus.only ? 1 : 0);
    button.textContent = chosen ? `Focus · ${chosen} ▾` : 'Focus ▾';
    button.classList.toggle('on', chosen > 0);
    button.title = chosen
        ? `Showing ${focusSummary(state.focus)}. Click to change`
        : 'Show only some Pokémon: by type, generation, stage, group or form';
}

/** How many of the list's Pokémon have each value (the pool and the tiers together), per facet. */
function countValues(): Record<FacetKey, Map<string, number>> {
    const counts = Object.fromEntries(FACET_KEYS.map((key) => [key, new Map<string, number>()])) as Record<FacetKey, Map<string, number>>;
    for (const entry of rankableEntries())
        for (const key of FACET_KEYS) for (const value of FACETS[key].of(entry)) counts[key].set(value, (counts[key].get(value) ?? 0) + 1);
    return counts;
}

function renderPicker(): void {
    if (!target) return;
    const focus = target.get();
    const counts = countValues();
    const facet = (key: FacetKey) => {
        const chosen = focus[key] ?? [];
        const chips = FACETS[key].values.map(({ value, label }) => {
            const on = chosen.includes(value);
            const count = counts[key].get(value) ?? 0;
            const dot = key === 'type' ? html`<i class="fdot" style="background:${TYPE_COLORS[value] ?? 'var(--muted)'}"></i>` : '';
            return html`<button class="chip${on ? ' on' : ''}${count ? '' : ' none'}" data-f="${key}" data-v="${value}" aria-pressed="${String(on)}">${dot}${label}<span class="fn">${count}</span></button>`;
        });
        const shortcuts =
            key === 'stage'
                ? html`<span class="fshort">${STAGE_SHORTCUTS.map(
                      (s, i) =>
                          html`<button class="chip${sameSet(s.values, chosen) ? ' on' : ''}" data-short="${i}" title="${s.title}">${s.label}</button>`,
                  )}</span>`
                : '';
        return html`<div class="fgroup"><h3>${FACETS[key].label}${shortcuts}</h3><div class="fchips">${chips}</div></div>`;
    };
    const only = focus.only
        ? html`<div class="fonly"><span>From the grid: <b>${focus.only.label}</b></span><button class="link" data-only="clear">Show all of them</button></div>`
        : '';
    setHtml(
        byId('focusbody'),
        html`<div class="fhead"><h3>${target.title}</h3><button id="focusnone" ${isFocusEmpty(focus) ? 'disabled' : ''}>Clear</button></div>
            <p class="note">Within a group any one matches; across groups all must. ${isFocusEmpty(focus) ? 'Nothing chosen: everything shows.' : html`Now: <b>${focusSummary(focus)}</b>`}</p>
            ${only}${FACET_KEYS.map(facet)}`,
    );
}

function change(update: (focus: Focus) => Focus): void {
    if (!target) return;
    target.set(update(structuredClone(target.get())));
    renderPicker();
}

/** Opens the picker under `anchor`, changing `on` (the tiers' and pool's focus unless a grid's is given). */
export function openFocusPicker(anchor: Element, on: FocusTarget = boardFocus): void {
    closePopovers();
    target = on;
    renderPicker();
    placePopover(byId('focuspop'), anchor);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupFocus(): void {
    byId('focusbtn').onclick = (e) => openFocusPicker(e.currentTarget as Element);
    byId('focusedit').onclick = (e) => openFocusPicker(e.currentTarget as Element);
    byId('focusclr').onclick = () => setBoardFocus({});
    onListOpen(() => {
        if (!isPokemonList()) state.focus = {};
        syncFocusButton();
    });
    byId('focuspop').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!button) return;
        if (button.id === 'focusnone') change(() => ({}));
        else if (button.dataset.only) change(({ only: _only, ...rest }) => rest);
        else if (button.dataset.short != null) {
            const shortcut = STAGE_SHORTCUTS[Number(button.dataset.short)]!;
            change((focus) => {
                const { stage, ...rest } = focus;
                return stage && sameSet(stage, shortcut.values) ? rest : { ...rest, stage: [...shortcut.values] };
            });
        } else if (button.dataset.f && button.dataset.v) {
            const key = button.dataset.f as FacetKey;
            const value = button.dataset.v;
            change((focus) => {
                const chosen = focus[key] ?? [];
                const next = chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
                if (next.length) focus[key] = next;
                else delete focus[key];
                return focus;
            });
        }
    });
}
