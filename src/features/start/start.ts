// src/features/start/start.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The start screen: what a first visit sees instead of an empty board. Three ways
//  in (a Pokémon list, your own things, a file), or just the empty list.
// ─────────────────────────────────────────────────────────────────────────────
import { currentListMeta, onListOpen } from '../../core/state';
import { byId } from '../../lib/dom';
import { createList, emptyStartingList } from '../lists/lists';
import { showWelcomeOnce } from '../onboarding/onboarding';

const start = { dismissed: false };

export function closeStartScreen(): void {
    start.dismissed = true;
    byId('start').classList.add('hid');
    setTimeout(showWelcomeOnce, 300);
}

/** Shown while the open list is the untouched starting list (and you haven't waved it away). */
export function syncStartScreen(): void {
    const show = !start.dismissed && !!emptyStartingList() && !currentListMeta()?.preview;
    byId('start').classList.toggle('hid', !show);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupStartScreen(): void {
    onListOpen(syncStartScreen);
    byId('startpk').onclick = () => {
        closeStartScreen();
        void createList('pokemon', 'My Pokémon tier list');
    };
    byId('startown').onclick = () => {
        closeStartScreen();
        byId('addbtn').click();
    };
    byId('startfile').onclick = () => {
        closeStartScreen();
        byId('loadinp').click();
    };
    byId('startempty').onclick = closeStartScreen;
}
