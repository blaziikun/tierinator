// src/features/pokemon-app/pokemon-app.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Pokémon lists. Tierinator makes them itself (New Pokémon list, the start
//  screen, the Pokémon pack's card and its link), and keeps them working as
//  always. The Pokémon app (config.pokemonApp) is a second home: "Copy to
//  PokeRank…" sends a Pokémon list across in a link (the whole list, compressed
//  after "#"), which the Pokémon app opens as a preview to keep, the way a share
//  link opens (share.ts). Nothing goes through a server, and the list stays here.
// ─────────────────────────────────────────────────────────────────────────────

import { linkJsonBytes, MAX_LINK_LIST_BYTES, packForLink } from 'tier-engine/core';
import { app } from '../../core/app';
import { toSnapshot } from '../../core/persist';
import { currentListMeta, onListOpen, session, state } from '../../core/state';
import { byId } from '../../lib/dom';
import { ask, closePopovers, toast } from '../../lib/ui';
import { createList } from '../lists/lists';

/** Longest move link: well past a big Pokémon list (about 25 KB), well short of what browsers take in an address. */
const MAX_MOVE_LINK = 1_500_000;

/** Your uploaded pictures and gallery pictures live in this browser only: a link can't carry them. */
const staysBehind = (path: string): boolean => path === 'custom' || /^(gal|xp):/.test(path);

/** A new Pokémon list: every Pokémon and form, with sprites from every game. */
export const newPokemonList = (name?: string): Promise<void> => createList('pokemon', name);

/** The link that opens the open list in the Pokémon app (null if it's too big), and how many pictures stay behind. */
export async function moveLink(): Promise<{ link: string | null; picturesLeftBehind: number }> {
    const stored = toSnapshot() as unknown as Record<string, unknown>;
    const ownIds = new Set(state.ownItems.map((item) => String(item.id)));
    let picturesLeftBehind = 0;
    const picks = Object.fromEntries(
        Object.entries(state.picks).filter(([id, pick]) => {
            if (!staysBehind(pick.path)) return true;
            if (ownIds.has(id) && !pick.text) picturesLeftBehind++;
            return false;
        }),
    );
    const list = { ...stored, picks, movedFrom: app.name };
    // the other side refuses a link that unpacks past MAX_LINK_LIST_BYTES, however short the link is
    if (linkJsonBytes(list) > MAX_LINK_LIST_BYTES) return { link: null, picturesLeftBehind };
    const link = `${app.pokemonApp?.url ?? ''}/#l=${await packForLink(list)}`;
    return { link: link.length > MAX_MOVE_LINK ? null : link, picturesLeftBehind };
}

async function moveOpenList(): Promise<void> {
    closePopovers();
    const meta = currentListMeta();
    if (!app.pokemonApp || !meta || state.kind !== 'pokemon') return;
    if (session.needsPack) return toast('Load the Pokémon pack first');
    const { link, picturesLeftBehind } = await moveLink();
    if (!link)
        return toast(`This list is too big for a link. Save it (File → Save list), then open the file in ${app.pokemonApp.name}.`, 7000);
    const there = app.pokemonApp.name;
    const behind = picturesLeftBehind
        ? ` ${picturesLeftBehind} of your own uploaded picture${picturesLeftBehind > 1 ? 's' : ''} can't travel in a link and will show as names; to take ${picturesLeftBehind > 1 ? 'them' : 'it'} too, save the list as a file and open that in ${there} instead.`
        : '';
    if (
        !(await ask(
            `Open “${meta.name}” in ${there}? It opens there as a preview: press Keep it, and it's one of your lists in ${there}. ` +
                `This copy stays here until you delete it.${behind}`,
            `Open in ${there}`,
        ))
    )
        return;
    window.open(link, '_blank', 'noopener');
}

/** "Copy to …" shows for Pokémon lists in an app that has a Pokémon app. */
function syncMoveButton(): void {
    byId('lmove').classList.toggle('hid', !app.pokemonApp || state.kind !== 'pokemon');
}

// ── wiring (runs once at start-up, from start.ts) ──
export function setupPokemonApp(): void {
    byId('lnewpk').onclick = () => {
        closePopovers();
        void newPokemonList();
    };
    byId('lmove').onclick = () => void moveOpenList();
    onListOpen(syncMoveButton);
}
