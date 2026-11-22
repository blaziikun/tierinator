// src/core/storage.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Browser storage, through the engine's adapters (tier-engine/core). Lists are
//  small and live in localStorage under Tierinator's prefixes (`local`, used by
//  core/persist.ts and the features); pictures and packs are big, so they live
//  in IndexedDB here.
//
//  Stores:  sprites  picked pictures, keyed "<listId>:<itemId>" (each list has its own)
//           gallery  your own images per Pokémon
//           packs    installed packs ("pokemon", "gp:<packId>")
// ─────────────────────────────────────────────────────────────────────────────

import {
    deleteDatabase,
    deleteEntries,
    dbRequest as engineRequest,
    openDatabase as openEngineDatabase,
    readEntries,
} from 'tier-engine/core';
import { toast } from '../lib/ui';
import { local } from './local';
import { session } from './state';
import type { ItemId } from './types';

export type StoreName = 'sprites' | 'gallery' | 'packs';

/** The storage names (this, and the pt… keys in localStorage) date from the first versions: renaming them would lose saved lists. */
export const DATABASE_NAME = 'poketier4';

/** The open database (null if the browser refuses storage, e.g. some private windows). */
export const storage: { db: IDBDatabase | null; warned: boolean } = { db: null, warned: false };

export const openDatabase = (name: string, version = 3): Promise<IDBDatabase> =>
    openEngineDatabase(name, ['sprites', 'gallery', 'packs'] satisfies StoreName[], version);

/**
 * Runs one request in its own transaction and resolves with its result once the
 * transaction has finished (so writes are really saved). Resolves null without a database.
 */
export const dbRequest = <T = unknown>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T> | null | undefined,
    db: IDBDatabase | null = storage.db,
    store: StoreName = 'sprites',
): Promise<T | null> => engineRequest(db, store, mode, makeRequest);

/** Pictures are stored per list. */
export const imageKey = (key: ItemId | string): string => session.listId + ':' + key;

/** Says once per visit that pictures won't outlast it: no database (private browsing) or it's full. */
function warnPicturesNotKept(): void {
    if (storage.warned) return;
    storage.warned = true;
    toast("This browser isn't keeping pictures (private browsing, or storage is full). Save the list (Ctrl/⌘ S) to keep them.", 8000);
}

export const saveImage = (key: ItemId | string, blob: Blob): Promise<unknown> =>
    storage.db
        ? dbRequest('readwrite', (s) => s.put(blob, imageKey(key))).catch(warnPicturesNotKept)
        : Promise.resolve(warnPicturesNotKept());

export const deleteImage = (key: ItemId | string): Promise<unknown> =>
    dbRequest('readwrite', (s) => s.delete(imageKey(key))).catch(() => {});

/** Every [key, value] whose key starts with `prefix`. */
export const readByPrefix = (prefix: string, store: StoreName = 'sprites'): Promise<[IDBValidKey, unknown][]> =>
    readEntries(storage.db, store, prefix);

export const deleteByPrefix = (prefix: string): Promise<void> => deleteEntries(storage.db, 'sprites', prefix);

/** Copies every picture of one list to another (duplicating a list). */
export async function copyByPrefix(from: string, to: string): Promise<void> {
    const all = await readByPrefix(from);
    await dbRequest('readwrite', (s) => {
        all.forEach(([key, value]) => {
            s.put(value, to + String(key).slice(from.length));
        });
    }).catch(() => {});
}

/** Every [key, value] in a store. */
export const readAll = (db: IDBDatabase | null = storage.db, store: StoreName = 'sprites'): Promise<[IDBValidKey, unknown][]> =>
    readEntries(db, store);

/**
 * Deletes everything the app keeps in this browser: every list, picture, pack, theme
 * and setting. Storage names start with "pt" (from the first versions); nothing else is touched.
 */
export async function deleteEverything(): Promise<void> {
    local.removeAll();
    storage.db?.close();
    storage.db = null;
    await deleteDatabase(DATABASE_NAME);
    // the offline copies of opened templates and packs (features/offline/sw.js) show what was opened; the app's own
    // files stay, so the page still loads without a connection
    try {
        await caches.delete('tierinator-data');
    } catch {} // no Cache Storage (an old browser, or not a secure page)
}
