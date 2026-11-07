// src/features/find/find.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Find: a floating search (F or /) for when the pool is hidden. It jumps to
//  ranked matches in the tiers; unranked matches offer to open the pool. It shares
//  the pool search box's query, so the two never disagree.
// ─────────────────────────────────────────────────────────────────────────────
import { state } from '../../core/state';
import { byId, findById } from '../../lib/dom';
import { togglePool } from '../layout/layout';
import { applyFilters, jumpToNextHit, search } from '../tier-board/board';

/** Whether the Find bar is open, and how many pool items match (set by applyFilters). */
export const finder = { open: false, pool: 0 };
let jumpTimer: ReturnType<typeof setTimeout> | undefined;

export function openFind(): void {
    finder.open = true;
    byId('findbar').classList.remove('hid');
    byId('findfab').classList.add('hid');
    const input = byId<HTMLInputElement>('findin');
    input.value = state.searchQuery;
    input.focus();
    input.select();
    updateFindCount();
}

/** Closes Find and clears the search everywhere (nothing stays highlighted). */
export function clearFind(): void {
    clearTimeout(jumpTimer);
    finder.open = false;
    state.searchQuery = '';
    byId<HTMLInputElement>('psearch').value = '';
    byId<HTMLInputElement>('findin').value = '';
    byId('findbar').classList.add('hid');
    byId('findfab').classList.remove('hid');
    applyFilters();
}

/** "2 of 5, in S", "not ranked yet" (+ Show in pool), or "no match". */
export function updateFindCount(): void {
    const count = findById('findcnt');
    if (!count) return;
    const query = state.searchQuery.trim();
    const showInPool = byId('findpool');
    showInPool.classList.add('hid');
    byId('findnext').classList.toggle('hid', search.hits.length < 2);
    if (!query) {
        count.textContent = '';
        return;
    }
    if (search.hits.length) {
        const current = search.hits[Math.max(0, search.index)]!;
        const tier = state.tiers.find((t) => t.items.includes(current));
        count.textContent =
            search.index < 0
                ? `${search.hits.length} found`
                : `${search.index + 1} of ${search.hits.length}${tier ? ', in ' + tier.label : ''}`;
        return;
    }
    if (finder.pool) {
        count.textContent = 'not ranked yet';
        showInPool.classList.remove('hid');
        showInPool.textContent = `Show in pool (${finder.pool})`;
        return;
    }
    count.textContent = 'no match';
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupFind(): void {
    const input = byId<HTMLInputElement>('findin');
    byId('findfab').onclick = openFind;
    byId('findx').onclick = clearFind;
    byId('findnext').onclick = () => {
        jumpToNextHit();
        input.focus();
    };
    // keep the search, open the pool with it
    byId('findpool').onclick = () => {
        const query = state.searchQuery;
        finder.open = false;
        byId('findbar').classList.add('hid');
        byId('findfab').classList.remove('hid');
        togglePool(false, true);
        state.searchQuery = query;
        byId<HTMLInputElement>('psearch').value = query;
        applyFilters();
        byId('psearch').focus();
    };
    input.oninput = () => {
        state.searchQuery = input.value;
        byId<HTMLInputElement>('psearch').value = state.searchQuery;
        applyFilters();
        // jump to the first match once typing pauses
        clearTimeout(jumpTimer);
        jumpTimer = setTimeout(() => {
            if (search.hits.length && search.index < 0) jumpToNextHit();
        }, 280);
    };
    input.onkeydown = (e) => {
        e.stopPropagation(); // typed letters are text here, not shortcuts
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(jumpTimer);
            jumpToNextHit(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            clearFind();
        }
    };
}
