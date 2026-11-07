// src/features/studio/gallery.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Your own pictures.
//
//    gallery          per Pokémon, kept for every list (fan art, anime/movie versions…):
//                     uploaded, pasted or dropped onto the studio or quick picker
//    extraPictures    extra picture choices for one of your own items, in this list
//
//  Every picture is checked first (see checkedImage): files that aren't pictures,
//  or are too big, are skipped.
// ─────────────────────────────────────────────────────────────────────────────
import { entryById } from '../../core/items';
import { isPokemonList, onListReset, state } from '../../core/state';
import { dbRequest, readAll, saveImage, storage } from '../../core/storage';
import type { ItemId } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId, randomId } from '../../lib/dom';
import { checkedImage, objectUrlFor } from '../../lib/images';
import { toast } from '../../lib/ui';
import { galleryNames } from '../../pokemon/data';
import { quickPicker, renderQuickPicker } from '../quick-picker/quick-picker';
import { renderStudio, studio } from './studio';

/** A picture in your gallery for one Pokémon. Stored (without `url`) in the database's "gallery" store. */
export interface GalleryPicture {
    id: ItemId;
    blob: Blob;
    name: string;
    added?: number;
    url: string;
}

/** An extra picture for one of your own items, in this list. */
export interface ExtraPicture {
    id: ItemId;
    blob: Blob;
    url: string;
}

export const gallery = new Map<string, GalleryPicture>();
galleryNames.of = (key) => gallery.get(key)?.name;
export const extraPictures = new Map<string, ExtraPicture>();

/** At start-up: your gallery from this browser. */
export async function loadGallery(): Promise<void> {
    try {
        for (const [key, saved] of await readAll(storage.db, 'gallery'))
            if (isRecord(saved) && saved.blob instanceof Blob) {
                const blob = saved.blob;
                gallery.set(String(key), { id: Number(saved.id), name: String(saved.name ?? 'image'), blob, url: objectUrlFor(blob) });
            }
    } catch {}
}

const freeUrl = (url: string): void => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
};

// ═════════════════════════════════════════════════════════════════════════════
//  EXTRA PICTURES (your own items)
// ═════════════════════════════════════════════════════════════════════════════

/** Keeps a (checked) picture as a choice for one of your items; returns its key. */
export async function addExtraPicture(id: ItemId, blob: Blob): Promise<string> {
    const key = 'x' + id + '~' + randomId();
    await saveImage(key, blob);
    extraPictures.set(key, { id, blob, url: objectUrlFor(blob) });
    return key;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GALLERY (Pokémon)
// ═════════════════════════════════════════════════════════════════════════════

/** Adds a picture to a Pokémon's gallery. Null if it isn't a picture this app can use. */
export async function addGalleryImage(id: ItemId, blob: Blob, name: string): Promise<string | null> {
    const picture = await checkedImage(blob);
    if (!picture) return null;
    const key = id + ':' + randomId();
    const record = {
        id,
        blob: picture,
        name: String(name || 'image')
            .replace(/\.[a-z0-9]+$/i, '')
            .slice(0, 40),
        added: Date.now(),
    };
    await dbRequest('readwrite', (store) => store.put(record, key), storage.db, 'gallery').catch(() => {});
    gallery.set(key, { ...record, url: objectUrlFor(picture) });
    return key;
}

async function deleteGalleryImage(key: string): Promise<void> {
    const picture = gallery.get(key);
    if (picture) freeUrl(picture.url);
    gallery.delete(key);
    await dbRequest('readwrite', (store) => store.delete(key), storage.db, 'gallery').catch(() => {});
}

/** Adds picked, pasted or dropped files to a Pokémon's gallery, then redraws where it's shown. */
async function addGalleryFiles(id: ItemId, files: File[]): Promise<void> {
    let added = 0;
    for (const file of files) if (await addGalleryImage(id, file, file.name || 'pasted image')) added++;
    if (!added) return toast("Those files aren't pictures this app can use (or they're over 25 MB)");
    toast(`Added ${added} image${added > 1 ? 's' : ''} to ${entryById.get(id)!.name}. Tap one to use it`);
    if (quickPicker.id === id) renderQuickPicker();
    else if (state.view === 'studio' && studio.currentId === id) renderStudio();
}

/**
 * The Pokémon whose gallery a paste or drop goes to: the quick picker's, or the studio's. Only on a
 * Pokémon list: the studio remembers its last Pokémon after you switch to a list of your own.
 */
export const galleryTarget = (): ItemId | null =>
    quickPicker.id ||
    (isPokemonList() && state.view === 'studio' && studio.mode === 'pokemon' && studio.currentId != null && entryById.has(studio.currentId)
        ? studio.currentId
        : null);

const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, className: 'hid' });
let uploadFor: ItemId | null = null;

/** A click on the gallery's cards (✕ remove, + add). True if it was one of those. */
export async function onGalleryClick(e: Event, id: ItemId | null): Promise<boolean> {
    const target = e.target as HTMLElement;
    const remove = target.closest<HTMLElement>('.gdel');
    if (remove) {
        e.stopPropagation();
        await deleteGalleryImage(remove.dataset.k!);
        if (quickPicker.id) renderQuickPicker();
        else renderStudio();
        return true;
    }
    if (target.closest('.gadd')) {
        uploadFor = id;
        fileInput.click();
        return true;
    }
    return false;
}

const isTyping = (target: EventTarget | null): boolean => target instanceof HTMLElement && /INPUT|TEXTAREA/.test(target.tagName);

// ── wiring (runs once at start-up, from main.ts) ──
export function setupGallery(): void {
    onListReset(() => {
        extraPictures.forEach((picture) => {
            freeUrl(picture.url);
        });
        extraPictures.clear();
    });

    document.body.append(fileInput);
    fileInput.onchange = () => {
        const files = [...(fileInput.files || [])];
        fileInput.value = '';
        if (uploadFor) void addGalleryFiles(uploadFor, files);
    };

    // paste (Ctrl/⌘+V) or drop pictures onto the quick picker or the studio
    document.addEventListener('paste', (e) => {
        const id = galleryTarget();
        const files = [...(e.clipboardData?.files || [])];
        if (!id || e.defaultPrevented || isTyping(e.target) || !files.length) return;
        e.preventDefault();
        void addGalleryFiles(id, files);
    });
    for (const area of ['qpbox', 'stmain']) {
        byId(area).addEventListener('dragover', (e) => {
            if (galleryTarget() && e.dataTransfer?.types.includes('Files')) e.preventDefault();
        });
        byId(area).addEventListener('drop', (e) => {
            const id = galleryTarget();
            const files = [...(e.dataTransfer?.files || [])];
            if (!id || !files.length) return;
            e.preventDefault();
            void addGalleryFiles(id, files);
        });
    }
}
