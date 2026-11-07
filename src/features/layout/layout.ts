// src/features/layout/layout.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The screen layout: the two views (tier list and studio), where the pool goes
//  (beside the tiers, below them, or hidden: the Pool menu), hiding the top bar
//  (both remembered for next time, for every list), and dragging the pool's edge to resize.
// ─────────────────────────────────────────────────────────────────────────────
import { autosave } from '../../core/persist';
import { isPokemonList, state } from '../../core/state';
import type { ListState } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { setupChoiceMenu } from '../../lib/choice-menu';
import { byId } from '../../lib/dom';
import { closePopovers, toast } from '../../lib/ui';
import { clearFind, finder } from '../find/find';
import { renderCustomStudio } from '../studio/custom-studio';
import { renderStudio } from '../studio/studio';
import { measureRowWidth, placeAllTiles, syncSelection } from '../tier-board/board';
import { hideTip } from '../tier-board/hover-tip';

// ── the two views ──
/** Shows the tier list or the studio (the top bar always shows in the studio). */
export function switchView(view: ListState['view']): void {
    const isTier = view === 'tier';
    state.view = view;
    hideTip();
    closePopovers();
    byId('tab-tier').classList.toggle('on', isTier);
    byId('tab-studio').classList.toggle('on', !isTier);
    byId('main').classList.toggle('hid', !isTier);
    byId('studio').classList.toggle('hid', isTier);
    byId('htoggle').classList.toggle('hid', !isTier);
    byId('findbox').classList.toggle('hid', !isTier);
    document.querySelectorAll('.tvo').forEach((el) => {
        el.classList.toggle('hid', !isTier);
    });
    if (isTier) {
        placeAllTiles();
        if (readView()?.bar && !state.topBarHidden) toggleTopBar(true);
    } else {
        if (state.topBarHidden) toggleTopBar(false);
        if (isPokemonList()) renderStudio();
        else renderCustomStudio();
    }
    syncSelection();
}

// ── remembered view ("pt_view"): the last hidden/shown pool and top bar, in this browser ──
export interface RememberedView {
    pool: boolean;
    bar: boolean;
}

function saveView(): void {
    try {
        localStorage.setItem('pt_view', JSON.stringify({ pool: !!state.poolHidden, bar: !!state.topBarHidden } satisfies RememberedView));
    } catch {}
}

export function readView(): RememberedView | null {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem('pt_view') || 'null');
        return isRecord(saved) ? { pool: !!saved.pool, bar: !!saved.bar } : null;
    } catch {
        return null;
    }
}

/**
 * Hides or shows the pool. Called without `force` it's the person's own toggle (remembered);
 * with `force` it's the app restoring a state (remembered only when `remember` is set).
 * Hiding the pool clears any search, so nothing stays highlighted.
 */
export function togglePool(force?: boolean, remember = false): void {
    state.poolHidden = force ?? !state.poolHidden;
    if (state.poolHidden && (state.searchQuery || finder.open)) clearFind();
    if (force === undefined || remember) saveView();
    byId('psec').classList.toggle('phid', state.poolHidden);
    document.body.classList.toggle('pooloff', state.poolHidden);
    setTimeout(measureRowWidth, 60);
    if (force === undefined) autosave();
}

/** Puts the pool beside the tiers or below them (B). */
export function switchPoolSide(beside = !state.poolAsSidebar): void {
    state.poolAsSidebar = beside;
    byId('main').classList.toggle('sb', state.poolAsSidebar);
    setTimeout(measureRowWidth, 50);
    autosave();
}

/** Where the pool is now, as the Pool menu names it. */
type PoolPlace = 'side' | 'below' | 'hidden';
const poolPlace = (): PoolPlace => (state.poolHidden ? 'hidden' : state.poolAsSidebar ? 'side' : 'below');

/** The Pool menu's choices: showing it again keeps the person's own toggle rules (remembered, autosaved). */
function placePool(place: string): void {
    if (place === 'hidden') {
        if (!state.poolHidden) togglePool();
        return;
    }
    if (state.poolHidden) togglePool();
    if (state.poolAsSidebar !== (place === 'side')) switchPoolSide(place === 'side');
}

/** Hides or shows the top bar (same rules as togglePool). */
export function toggleTopBar(force?: boolean, remember = false): void {
    state.topBarHidden = force ?? !state.topBarHidden;
    if (force === undefined || remember) saveView();
    byId('toolbar').classList.toggle('hbar', state.topBarHidden);
    document.body.classList.toggle('barsoff', state.topBarHidden);
    byId('hbbtn').textContent = state.topBarHidden ? 'Show bar' : 'Hide bar';
    if (state.topBarHidden && force === undefined) toast('Top bar hidden. Press H or Esc to bring it back', 3000);
    setTimeout(measureRowWidth, 250);
}

/** The pool's saved size (0 = automatic). */
export function applyPoolLayout(): void {
    const main = byId('main').style;
    if (state.poolHeight) main.setProperty('--poolh', state.poolHeight + 'px');
    else main.removeProperty('--poolh');
    if (state.poolWidth) main.setProperty('--poolw', state.poolWidth + 'px');
    else main.removeProperty('--poolw');
}

/** Drag the handle between tiers and pool to resize it; double-click to go back to automatic. */
function setupPoolResize(): void {
    const handle = byId('psplit');
    const main = byId('main');
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        dragging = true;
        handle.classList.add('on');
        main.classList.add('resizing');
        document.body.style.cursor = state.poolAsSidebar ? 'ew-resize' : 'ns-resize';
    });
    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const box = main.getBoundingClientRect();
        if (state.poolAsSidebar) state.poolWidth = Math.round(Math.max(160, Math.min(box.width - 240, box.right - e.clientX)));
        else state.poolHeight = Math.round(Math.max(70, Math.min(box.height - 90, box.bottom - e.clientY)));
        applyPoolLayout();
    });
    const finish = () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('on');
        main.classList.remove('resizing');
        document.body.style.cursor = '';
        measureRowWidth();
        autosave();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('dblclick', () => {
        if (state.poolAsSidebar) state.poolWidth = 0;
        else state.poolHeight = 0;
        applyPoolLayout();
        measureRowWidth();
        autosave();
    });
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupLayout(): void {
    setupPoolResize();
    setupChoiceMenu({ buttonId: 'poolplacebtn', menuId: 'poolmenu', current: poolPlace, choose: placePool });
    byId('tab-tier').onclick = () => switchView('tier');
    byId('tab-studio').onclick = () => switchView('studio');
    byId('hbbtn').onclick = () => toggleTopBar();
    byId('htoggle').onclick = () => toggleTopBar();
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(measureRowWidth, 150);
    });
}
