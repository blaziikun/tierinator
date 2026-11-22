// src/features/start/start.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The start screen: what a first visit sees instead of an empty board. In
//  Tierinator: your own things, a template, Pokémon (in PokeRank, pokemon-app.ts)
//  or a file, or just the empty list. In PokeRank: start ranking, or a file.
// ─────────────────────────────────────────────────────────────────────────────
import { currentListMeta, onListOpen } from '../../core/state';
import { byId } from '../../lib/dom';
import { emptyStartingList } from '../lists/lists';
import { showWelcomeOnce } from '../onboarding/onboarding';
import { newPokemonList } from '../pokemon-app/pokemon-app';

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

// ── wiring (runs once at start-up, from start.ts) ──
export function setupStartScreen(): void {
    onListOpen(syncStartScreen);
    byId('startpk').onclick = () => {
        closeStartScreen();
        void newPokemonList('My Pokémon tier list');
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
