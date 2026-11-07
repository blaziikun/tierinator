// src/core/storage.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Browser storage for pictures and packs (IndexedDB). Lists themselves are small
//  and live in localStorage (core/persist.ts); pictures are big, so they live here.
//
//  Stores:  sprites  picked pictures, keyed "<listId>:<itemId>" (each list has its own)
//           gallery  your own images per Pokémon
//           packs    installed packs ("pokemon", "gp:<packId>")
// ─────────────────────────────────────────────────────────────────────────────
import { toast } from '../lib/ui';
import { session } from './state';
import type { ItemId } from './types';

export type StoreName = 'sprites' | 'gallery' | 'packs';

/** The storage names (this, and the pt… keys in localStorage) date from the first versions: renaming them would lose saved lists. */
export const DATABASE_NAME = 'poketier4';

/** The open database (null if the browser refuses storage, e.g. some private windows). */
export const storage: { db: IDBDatabase | null; warned: boolean } = { db: null, warned: false };

export function openDatabase(name: string, version = 3): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(name, version);
        } catch (error) {
            reject(error);
            return;
        }
        request.onupgradeneeded = () => {
            for (const store of ['sprites', 'gallery', 'packs'] as const)
                if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        };
        request.onsuccess = () => {
            // another tab deleting everything (About → Delete everything) mustn't be held up by this one
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('blocked'));
    });
}

/**
 * Runs one request in its own transaction and resolves with its result once the
 * transaction has finished (so writes are really saved). Resolves null without a database.
 */
export function dbRequest<T = unknown>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T> | null | undefined,
    db: IDBDatabase | null = storage.db,
    store: StoreName = 'sprites',
): Promise<T | null> {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve(null);
            return;
        }
        const transaction = db.transaction(store, mode);
        const request = makeRequest(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request ? request.result : null);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

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
export function readByPrefix(prefix: string, store: StoreName = 'sprites'): Promise<[IDBValidKey, unknown][]> {
    return new Promise((resolve) => {
        const out: [IDBValidKey, unknown][] = [];
        if (!storage.db) {
            resolve(out);
            return;
        }
        const cursor = storage.db
            .transaction(store, 'readonly')
            .objectStore(store)
            .openCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
        cursor.onsuccess = () => {
            const at = cursor.result;
            if (at) {
                out.push([at.key, at.value]);
                at.continue();
            } else resolve(out);
        };
        cursor.onerror = () => resolve(out);
    });
}

export function deleteByPrefix(prefix: string): Promise<void> {
    return new Promise((resolve) => {
        if (!storage.db) {
            resolve();
            return;
        }
        const transaction = storage.db.transaction('sprites', 'readwrite');
        transaction.objectStore('sprites').delete(IDBKeyRange.bound(prefix, prefix + '￿'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
    });
}

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
export function readAll(db: IDBDatabase | null = storage.db, store: StoreName = 'sprites'): Promise<[IDBValidKey, unknown][]> {
    return new Promise((resolve, reject) => {
        const out: [IDBValidKey, unknown][] = [];
        if (!db?.objectStoreNames.contains(store)) {
            resolve(out);
            return;
        }
        const cursor = db.transaction(store, 'readonly').objectStore(store).openCursor();
        cursor.onsuccess = () => {
            const at = cursor.result;
            if (at) {
                out.push([at.key, at.value]);
                at.continue();
            } else resolve(out);
        };
        cursor.onerror = () => reject(cursor.error);
    });
}

/**
 * Deletes everything Tierinator keeps in this browser: every list, picture, pack, theme
 * and setting. Storage names start with "pt" (from the first versions); nothing else is touched.
 */
export async function deleteEverything(): Promise<void> {
    try {
        for (const key of Object.keys(localStorage)) if (/^pt[l_]/.test(key)) localStorage.removeItem(key);
    } catch {} // storage switched off: nothing to delete
    storage.db?.close();
    storage.db = null;
    await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(DATABASE_NAME);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    // the offline copies of opened templates and packs (features/offline/sw.js) show what was opened; the app's own
    // files stay, so the page still loads without a connection
    try {
        await caches.delete('tierinator-data');
    } catch {} // no Cache Storage (an old browser, or not a secure page)
}
