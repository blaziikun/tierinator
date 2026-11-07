// src/features/items/delete-items.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Deleting your own items, with Undo. They go at once (no question); a toast
//  offers them back, and Ctrl/⌘ Z brings them back too, exactly as they were:
//  pictures and picture choices, tags, note, variants, credit and place. Their
//  pictures stay in this browser's storage until the toast has had its time or
//  the page is hidden, and are written back if Undo comes later than that.
// ─────────────────────────────────────────────────────────────────────────────
import { type DeletionSide, isLastStepBefore, onDeletionCrossed, pushHistory, undo } from '../../core/history';
import { entryById, familyMembers, isOwnItem, rebuildEntries } from '../../core/items';
import { onListReset, session, spriteBlobs, spriteUrls, state, tileById } from '../../core/state';
import { dbRequest, saveImage } from '../../core/storage';
import type { ItemId, OwnItem, Pick } from '../../core/types';
import { byId } from '../../lib/dom';
import { objectUrlFor } from '../../lib/images';
import { toast, toastWithAction } from '../../lib/ui';
import { extraPictures } from '../studio/gallery';
import { removeFromTiers, selectedInOrder } from '../tier-board/board';
import { afterFamilyChange } from '../variants/variants';
import { closeItemEditor, itemEditor } from './item-editor';

/** Everything that goes with one item, to put it back exactly. */
interface DeletedItem {
    /** The item itself: name, credit, picture choices, pack row, wiki page… */
    item: OwnItem;
    /** Its place among your items (the pool's "Order added"). */
    index: number;
    /** The tier it was in and where in it, or null for the pool. */
    tierId: string | null;
    position: number;
    pick?: Pick;
    blob?: Blob;
    /** A picture shown straight from the web (it has no file). */
    webAddress?: string;
    tags?: string[];
    note?: string;
    /** It was a variant of this item. */
    familyBase?: ItemId;
    /** It was the main item of these variants, combined into it or not. */
    members: ItemId[];
    combined: boolean;
    extraPictures: [key: string, blob: Blob][];
}

interface Deletion {
    listId: string;
    items: DeletedItem[];
    /** The items are deleted right now (undo and redo can bring them back and take them away again). */
    gone: boolean;
    /** Their pictures have been taken out of this browser's storage. */
    storageCleared: boolean;
}

/** How long the toast offers Undo; the pictures stay in storage at least this long. */
const UNDO_TOAST_MS = 8000;
/** Deletions kept for Ctrl/⌘ Z (each holds its pictures in memory); older ones can't come back. */
const KEPT_DELETIONS = 20;

const deletions = new Map<number, Deletion>();
let lastDeletion = 0;
let storageTimer: ReturnType<typeof setTimeout> | undefined;

// ═════════════════════════════════════════════════════════════════════════════
//  TAKING ITEMS OUT, PUTTING THEM BACK
// ═════════════════════════════════════════════════════════════════════════════

function remember(id: ItemId): DeletedItem | null {
    const index = state.ownItems.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const tier = state.tiers.find((t) => t.items.includes(id));
    const webAddress = spriteUrls.get(id);
    return {
        item: state.ownItems[index]!,
        index,
        tierId: tier?.id ?? null,
        position: tier ? tier.items.indexOf(id) : -1,
        pick: state.picks[id],
        blob: spriteBlobs.get(id),
        webAddress: webAddress && !webAddress.startsWith('blob:') ? webAddress : undefined,
        tags: state.tags[id],
        note: state.notes[id],
        familyBase: state.familyOf[id] != null ? Number(state.familyOf[id]) : undefined,
        members: familyMembers(id),
        combined: !!state.combinedFamilies[id],
        extraPictures: [...extraPictures].filter(([, picture]) => picture.id === id).map(([key, picture]) => [key, picture.blob]),
    };
}

/** Takes the items out of the list (their pictures stay in storage for now). */
function takeOut(deletion: Deletion): void {
    const ids = deletion.items.map((saved) => saved.item.id);
    const gone = new Set(ids);
    removeFromTiers(ids);
    state.ownItems = state.ownItems.filter((item) => !gone.has(item.id));
    for (const id of ids) {
        // its variants stay, on their own
        for (const [variant, base] of Object.entries(state.familyOf)) if (Number(base) === id) delete state.familyOf[variant];
        delete state.familyOf[id];
        delete state.combinedFamilies[id];
        delete state.tags[id];
        delete state.notes[id];
        delete state.picks[id];
        spriteBlobs.delete(id);
        const address = spriteUrls.get(id);
        if (address?.startsWith('blob:')) URL.revokeObjectURL(address);
        spriteUrls.delete(id);
        for (const [key, picture] of extraPictures)
            if (picture.id === id) {
                URL.revokeObjectURL(picture.url);
                extraPictures.delete(key);
            }
        tileById.get(id)?.remove();
        tileById.delete(id);
        state.selection.delete(id);
    }
    if (itemEditor.id != null && gone.has(itemEditor.id)) closeItemEditor();
    deletion.gone = true;
    rebuildEntries();
    afterFamilyChange();
    clearStorageSoon();
}

/** Puts the items back; with `placeBack`, in their tier and position too (undo puts back the tiers itself). */
function putBack(deletion: Deletion, placeBack: boolean): void {
    const missing = deletion.items.filter((saved) => !state.ownItems.some((item) => item.id === saved.item.id));
    for (const saved of [...missing].sort((a, b) => a.index - b.index)) {
        const id = saved.item.id;
        state.ownItems.splice(Math.min(saved.index, state.ownItems.length), 0, saved.item);
        if (saved.pick) state.picks[id] = saved.pick;
        if (saved.tags) state.tags[id] = saved.tags;
        if (saved.note) state.notes[id] = saved.note;
        if (saved.blob) {
            spriteBlobs.set(id, saved.blob);
            spriteUrls.set(id, objectUrlFor(saved.blob));
        } else if (saved.webAddress) spriteUrls.set(id, saved.webAddress);
        for (const [key, blob] of saved.extraPictures) extraPictures.set(key, { id, blob, url: objectUrlFor(blob) });
        if (deletion.storageCleared) {
            if (saved.blob) void saveImage(id, saved.blob);
            for (const [key, blob] of saved.extraPictures) void saveImage(key, blob);
        }
    }
    rebuildEntries();
    // families once every item is back, since a variant and its main item can be deleted together
    for (const saved of missing) {
        const id = saved.item.id;
        if (saved.familyBase != null && entryById.has(saved.familyBase)) state.familyOf[id] = saved.familyBase;
        for (const member of saved.members) if (entryById.has(member) && state.familyOf[member] == null) state.familyOf[member] = id;
        if (saved.combined) state.combinedFamilies[id] = true;
    }
    if (placeBack)
        for (const saved of missing) {
            const tier = state.tiers.find((t) => t.id === saved.tierId);
            if (tier) tier.items.splice(Math.min(saved.position, tier.items.length), 0, saved.item.id);
        }
    deletion.gone = false;
    deletion.storageCleared = false;
    afterFamilyChange();
}

const describe = (deletion: Deletion): string =>
    deletion.items.length === 1 ? `“${deletion.items[0]!.item.name}”` : `${deletion.items.length} items`;

// ═════════════════════════════════════════════════════════════════════════════
//  PICTURES IN STORAGE
// ═════════════════════════════════════════════════════════════════════════════

/** Removes a deletion's pictures from this browser's storage, unless its items are back. */
function clearStorageOf(deletion: Deletion): void {
    if (!deletion.gone || deletion.storageCleared) return;
    deletion.storageCleared = true;
    const keys = deletion.items.flatMap((saved) => [String(saved.item.id), ...saved.extraPictures.map(([key]) => key)]);
    void dbRequest('readwrite', (store) => {
        for (const key of keys) store.delete(deletion.listId + ':' + key);
        return null;
    }).catch(() => {});
}

function clearStorage(): void {
    clearTimeout(storageTimer);
    for (const deletion of deletions.values()) clearStorageOf(deletion);
}

const clearStorageSoon = (): void => {
    clearTimeout(storageTimer);
    storageTimer = setTimeout(clearStorage, UNDO_TOAST_MS);
};

// ═════════════════════════════════════════════════════════════════════════════
//  DELETING AND UNDOING
// ═════════════════════════════════════════════════════════════════════════════

/** Brings a deletion back from its toast: the same as Ctrl/⌘ Z if nothing has changed since, else on its own. */
function undoDeletion(number: number): void {
    const deletion = deletions.get(number);
    if (!deletion?.gone) return;
    if (isLastStepBefore(number)) {
        undo(false);
        return;
    }
    pushHistory({ deletion: number, itemsExist: false });
    putBack(deletion, true);
    toast(`Restored ${describe(deletion)}`);
}

/**
 * Deletes your own items from the open list, straight away, with Undo in a toast. `byKeyboard`: the
 * button that did it is going away, so focus moves to Undo rather than being lost.
 */
export function deleteItems(ids: readonly ItemId[], { byKeyboard = false } = {}): void {
    const items = ids
        .filter(isOwnItem)
        .map(remember)
        .filter((saved): saved is DeletedItem => !!saved);
    if (!items.length || !session.listId) return;
    const number = ++lastDeletion;
    const deletion: Deletion = { listId: session.listId, items, gone: false, storageCleared: false };
    deletions.set(number, deletion);
    // the oldest go (their pictures leave storage first if they're still there)
    for (const [old, oldDeletion] of deletions) {
        if (deletions.size <= KEPT_DELETIONS) break;
        clearStorageOf(oldDeletion);
        deletions.delete(old);
    }
    pushHistory({ deletion: number, itemsExist: true });
    takeOut(deletion);
    const undoButton = toastWithAction(`Deleted ${describe(deletion)}`, UNDO_TOAST_MS, {
        label: 'Undo',
        title: 'Bring it back (Ctrl/⌘ Z)',
        run: () => undoDeletion(number),
        refocus: () => byId(state.poolHidden ? 'tsec' : 'pgrid'),
    });
    if (byKeyboard) undoButton.focus();
}

/** Undo or redo reached a step marked with a deletion. */
function crossDeletion({ deletion: number, itemsExist }: DeletionSide): string | undefined {
    const deletion = deletions.get(number);
    if (!deletion) return undefined; // too long ago: the tiers come back without it, as before
    if (itemsExist) {
        putBack(deletion, false);
        return `Restored ${describe(deletion)}`;
    }
    // deleted again: what they are now (renamed, retagged since) is what Undo will bring back
    deletion.items = deletion.items.map((saved) => remember(saved.item.id)).filter((saved): saved is DeletedItem => !!saved);
    takeOut(deletion);
    return `Deleted ${describe(deletion)} again`;
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupItemDeletion(): void {
    onDeletionCrossed(crossDeletion);
    // another list opening ends what can be undone here; a hidden page may never come back, so its deleted
    // pictures leave storage now (a later Undo writes them back from memory)
    onListReset(() => {
        clearStorage();
        deletions.clear();
    });
    window.addEventListener('pagehide', clearStorage);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') clearStorage();
    });
    byId('ieddel').onclick = (e) => {
        const id = itemEditor.id;
        if (id == null) return;
        closeItemEditor();
        deleteItems([id], { byKeyboard: e.detail === 0 });
    };
    byId('seldel').onclick = (e) => deleteItems(selectedInOrder(), { byKeyboard: e.detail === 0 });
}
