// src/core/state.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The open list's state, the list index (which lists exist, which is open) and
//  the lookup tables every feature shares (tiles, picked pictures).
// ─────────────────────────────────────────────────────────────────────────────

import { randomId } from '../lib/dom';
import { pokedex } from '../pokemon/data';
import { createListState } from './defaults';
import type { ItemId, ListKind, ListMeta, ListState, Tier } from './types';

/** Which lists exist and which one is open. `generation` changes on every list switch, so slow downloads can tell they're stale. */
export const session: { lists: ListMeta[]; listId: string | null; needsPack: boolean; generation: number } = {
    lists: [],
    listId: null,
    needsPack: false,
    generation: 0,
};

export const state: ListState = createListState();

// ── the list index (localStorage "pt_lists") ──
export function loadListIndex(): void {
    let saved: unknown = [];
    try {
        saved = JSON.parse(localStorage.getItem('pt_lists') || '[]');
    } catch {}
    session.lists = (Array.isArray(saved) ? saved : []).filter(
        (l): l is ListMeta =>
            !!l && typeof l.id === 'string' && typeof l.name === 'string' && (l.kind === 'pokemon' || l.kind === 'custom'),
    );
}
export const saveListIndex = (): void => {
    try {
        localStorage.setItem('pt_lists', JSON.stringify(session.lists));
    } catch {}
};
export const currentListMeta = (): ListMeta | undefined => session.lists.find((l) => l.id === session.listId);
export function addListMeta(name: string, kind: ListKind): ListMeta {
    const l: ListMeta = {
        id: 'l' + randomId() + Date.now().toString(36).slice(-3),
        name,
        kind,
        updated: Date.now(),
    };
    session.lists.push(l);
    saveListIndex();
    return l;
}
// ── shared lookup tables for the open list ──
/** Picked pictures, as files. */
export const spriteBlobs = new Map<ItemId, Blob>();
/** Picked pictures, as addresses the page can show (blob: URLs, or web addresses). */
export const spriteUrls = new Map<ItemId, string>();
/** Each item's tile (.pi). Every item has exactly one: in the pool or in one tier. */
export const tileById = new Map<ItemId, HTMLElement>();
/** Each item's row in the Sprite Studio list. */
export const studioRowById = new Map<ItemId, HTMLElement>();
export const findTier = (tid: string): Tier | undefined => state.tiers.find((t) => t.id === tid);

// ════════════════════════════════════════════════════════════════
//  LISTS
// ════════════════════════════════════════════════════════════════
/** Clean-up each feature registers for when another list opens (views, caches, pop-ups). */
const resetHooks: (() => void)[] = [];
export function onListReset(hook: () => void): void {
    resetHooks.push(hook);
}

/** What features do once a list is open and drawn (banners, the start screen). */
const openHooks: (() => void)[] = [];
export function onListOpen(hook: () => void): void {
    openHooks.push(hook);
}
export const listOpened = (): void => {
    openHooks.forEach((hook) => {
        hook();
    });
};

/** Empties everything about the open list before another one opens. */
export function resetListState(): void {
    const view = state.view;
    const topBarHidden = state.topBarHidden;
    Object.assign(state, createListState(), { view, topBarHidden });
    tileById.clear();
    studioRowById.clear();
    spriteUrls.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    spriteUrls.clear();
    spriteBlobs.clear();
    resetHooks.forEach((hook) => {
        hook();
    });
}
/** A Pokémon list whose pack is installed. */
export const isPokemonList = (): boolean => state.kind === 'pokemon' && !!pokedex.pack;
/** What to call things in messages: "Pokémon" on a Pokémon list, else "item" or "items". */
export const itemWord = (count: number): string => (isPokemonList() ? 'Pokémon' : count === 1 ? 'item' : 'items');
