// src/features/quick-rank/quick-rank.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Quick rank (#qr): the pool's items one at a time, big; press a tier's button
//  (or 1–9) to put it there, Skip (→) to leave it, Back (←) to undo the last one.
// ─────────────────────────────────────────────────────────────────────────────
import { pushHistory } from '../../core/history';
import { dexLabel, entryById } from '../../core/items';
import { autosave } from '../../core/persist';
import { findTier, isPokemonList, state } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { closePopovers, toast } from '../../lib/ui';
import { labelTextColor } from '../appearance/theme';
import { switchView } from '../layout/layout';
import { spriteSrc } from '../sprites/sprites';
import { clearSelection, placeAllTiles, rankedIds, removeFromTiers } from '../tier-board/board';

const quickRank = {
    /** The items to go through (the pool as shown when it started). */
    queue: [] as ItemId[],
    position: 0,
    /** Placed so far, newest last (for Back). */
    placed: [] as ItemId[],
};

export function startQuickRank(): void {
    if (state.view !== 'tier') switchView('tier');
    const shown = [...byId('pgrid').querySelectorAll<HTMLElement>(':scope > .pi')]
        .filter((tile) => tile.style.display !== 'none')
        .map((tile) => Number(tile.dataset.id));
    if (!shown.length) {
        toast(
            state.ownItems.length || isPokemonList()
                ? 'Nothing unranked in the pool (clear the search or filters?)'
                : 'Add some items first',
        );
        return;
    }
    if (!state.tiers.length) {
        toast('Add a tier first');
        return;
    }
    Object.assign(quickRank, { queue: shown, position: 0, placed: [] });
    closePopovers();
    clearSelection();
    setHtml(
        byId('qrtiers'),
        html`${state.tiers.map((tier, index) => html`<button data-tid="${tier.id}" style="background:${tier.color};color:${labelTextColor(tier)}" title="${tier.label}">${index < 9 && html`<i>${index + 1}</i>`}${tier.label}</button>`)}`,
    );
    byId('qr').classList.add('show');
    showCurrentItem();
}

function showCurrentItem(): void {
    const ranked = rankedIds();
    while (quickRank.position < quickRank.queue.length && ranked.has(quickRank.queue[quickRank.position]!)) quickRank.position++;
    const left = quickRank.queue.length - quickRank.position;
    byId('qrprog').textContent = left ? `${quickRank.placed.length} ranked, ${left} to go` : '';
    if (!left) {
        byId('qr').classList.remove('show');
        const skipped = quickRank.queue.filter((id) => !ranked.has(id)).length;
        toast(
            skipped
                ? `Done: ${quickRank.placed.length} ranked, ${skipped} skipped (still in the pool)`
                : `Done: ${quickRank.placed.length} ranked`,
            4000,
        );
        return;
    }
    const id = quickRank.queue[quickRank.position]!;
    const entry = entryById.get(id)!;
    byId<HTMLImageElement>('qrimg').src = spriteSrc(id);
    byId('qrname').textContent = entry.name;
    byId('qrmeta').textContent = entry.custom
        ? (state.tags[id] || []).join(', ')
        : [dexLabel(id), entry.types.join(' / '), `Gen ${entry.gen}`].filter(Boolean).join(', ');
    // start loading the next picture now, so it shows instantly
    const next = quickRank.queue[quickRank.position + 1];
    if (next != null) new Image().src = spriteSrc(next);
}

/** Puts the item shown into this tier. */
export function placeQuickRankItem(tierId: string): void {
    const id = quickRank.queue[quickRank.position];
    const tier = findTier(tierId);
    if (id == null || !tier) return;
    pushHistory();
    removeFromTiers([id]);
    tier.items.push(id);
    quickRank.placed.push(id);
    quickRank.position++;
    placeAllTiles();
    autosave();
    showCurrentItem();
}

/** Back: takes the last placed item out of its tier again (or steps back over a skip). */
export function quickRankBack(): void {
    const id = quickRank.placed.pop();
    if (id == null) {
        if (quickRank.position > 0) {
            quickRank.position--;
            showCurrentItem();
        }
        return;
    }
    pushHistory();
    removeFromTiers([id]);
    quickRank.position = quickRank.queue.indexOf(id);
    placeAllTiles();
    autosave();
    showCurrentItem();
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupQuickRank(): void {
    byId('qrtiers').addEventListener('click', (e) => {
        const tierId = (e.target as HTMLElement).closest<HTMLElement>('[data-tid]')?.dataset.tid;
        if (tierId) placeQuickRankItem(tierId);
    });
    byId('qrskip').onclick = () => {
        quickRank.position++;
        showCurrentItem();
    };
    byId('qrback').onclick = quickRankBack;
    byId('qrx').onclick = () => {
        byId('qr').classList.remove('show');
        if (quickRank.placed.length) toast(`${quickRank.placed.length} ranked`);
    };
    byId('qrbtn').onclick = startQuickRank;
}
