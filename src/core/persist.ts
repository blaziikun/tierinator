// src/core/persist.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Saving the open list to this browser: half a second after the last change,
//  and when the page closes. Only one tab saves the open list at a time (the newest one opened).
//  The stored format itself lives in core/snapshot.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { byId, randomId } from '../lib/dom';
import { toast } from '../lib/ui';
import { entryById } from './items';
import { readTiers, type StoredList, toStored } from './snapshot';
import { currentListMeta, saveListIndex, session, state } from './state';
import type { ItemId, Tier } from './types';

/** Tiers from a file or from undo history, cleaned up (unknown items and duplicates dropped). */
export const sanitizeTiers = (raw: unknown): Tier[] => readTiers(raw, (id: ItemId) => entryById.has(id), randomId);

/** The open list in its stored form. */
export const toSnapshot = (): StoredList => toStored(state, currentListMeta()?.name || '');

// ── autosave ──
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** A failed save has been reported, and nothing has saved since. */
let saveFailureShown = false;

/** Writes the open list to this browser right now. */
export function writeCurrentList(): void {
    if (session.needsPack || !session.listId || tabs.otherTabInCharge || tabs.stopped) return;
    try {
        localStorage.setItem('ptl_' + session.listId, JSON.stringify(toSnapshot()));
        saveFailureShown = false;
        delete document.documentElement.dataset.unsaved;
        const meta = currentListMeta();
        if (meta) {
            meta.updated = Date.now();
            meta.count = state.tiers.reduce((count, tier) => count + tier.items.length, 0);
            saveListIndex();
            if (meta.count || state.ownItems.length) askToKeepStorage();
        }
    } catch {
        // storage full or blocked: keep ranking, but say so once (and mark the list's name) until a save works again
        document.documentElement.dataset.unsaved = '';
        if (saveFailureShown) return;
        saveFailureShown = true;
        toast(
            "Your changes aren't being saved: this browser's storage is full or blocked. Save the list as a file (Ctrl/⌘ S), then delete lists you don't need.",
            10_000,
        );
    }
}

let keepStorageAsked = false;
/**
 * Asks the browser not to clear this site's storage when space runs low (once, and only
 * when there's something worth keeping: Firefox shows a question, the others decide quietly).
 */
function askToKeepStorage(): void {
    if (keepStorageAsked || !navigator.storage?.persist) return;
    keepStorageAsked = true;
    navigator.storage
        .persisted()
        .then((kept) => kept || navigator.storage.persist())
        .catch(() => {});
}

/** Saves half a second after the last change (many quick changes, one write). */
export function autosave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeCurrentList, 500);
}

export function saveNow(): void {
    clearTimeout(saveTimer);
    writeCurrentList();
}

// ═════════════════════════════════════════════════════════════════════════════
//  ONE TAB AT A TIME
//  Each tab holds its own copy of the open list and saves it when it closes, so with
//  two tabs open the last one closed would overwrite the other's changes (an old tab
//  quietly putting back an old look or old tiers). So the newest tab takes charge:
//  older tabs save what they have, then stop saving and offer to reload.
// ═════════════════════════════════════════════════════════════════════════════

const TAB_KEY = 'pt_tab'; // the id of the tab in charge
const tabs = { id: randomId(), otherTabInCharge: false, stopped: false };

/** After "Delete everything": nothing more is written before the page reloads. */
export function stopSaving(): void {
    clearTimeout(saveTimer);
    tabs.stopped = true;
}

function takeCharge(): void {
    try {
        localStorage.setItem(TAB_KEY, tabs.id);
    } catch {}
}

function handOverToOtherTab(): void {
    saveNow(); // anything not yet saved here is written before the other tab carries on
    tabs.otherTabInCharge = true;
    byId('tabm').classList.add('show');
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupPersist(): void {
    takeCharge();
    window.addEventListener('pagehide', saveNow);
    // "storage" fires in every other tab of this site when one of them writes
    window.addEventListener('storage', (e) => {
        if (e.key === TAB_KEY && e.newValue !== tabs.id && !tabs.otherTabInCharge) handOverToOtherTab();
    });
    byId('tabuse').onclick = () => location.reload(); // reloading reads the latest saves and takes charge again
}
