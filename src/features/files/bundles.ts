// src/features/files/bundles.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Files that carry lists:
//
//    backup         one .json with every list, the pictures that can't be fetched
//                   again (your uploads, text tiles), your gallery and a few settings
//    list bundle    one list as a .zip with its pictures (lists with uploaded ones)
//    list file      one list as a .json (importing it adds or replaces a list)
//
//  Everything read back is untrusted: lists are checked when opened (core/snapshot.ts)
//  and every picture goes through checkedImage.
// ─────────────────────────────────────────────────────────────────────────────

import { type BackupEntry, isRecord, readBackup, writeBackup } from 'tier-engine/core';
import { local } from '../../core/local';
import { readGenericPack } from '../../core/pack-format';
import { saveNow, toSnapshot } from '../../core/persist';
import { addListMeta, currentListMeta, saveListIndex, session, spriteBlobs } from '../../core/state';
import { dbRequest, readAll, readByPrefix, saveImage, storage } from '../../core/storage';
import type { ItemId, ListKind, ListMeta } from '../../core/types';
import { downloadBlob, findById, nextTick, todayIso } from '../../lib/dom';
import { blobToDataUrl, checkedImage, dataUrlToBlob, EXT_BY_MIME, objectUrlFor } from '../../lib/images';
import { ask, hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { createZip } from '../../lib/zip';
import { fileStem } from '../export/layout';
import { emptyStartingList, forgetList, isUntouchedList, openList, renderListMenu } from '../lists/lists';
import { genericPacks, installPack } from '../packs/packs';
import { gallery } from '../studio/gallery';

/**
 * Settings (in this browser) that a backup carries along: everything you chose, so a backup moves you to another
 * browser or address whole. Left out: which list was open, and the app's own notes (when you last backed up…).
 */
const BACKED_UP_SETTINGS = [
    'pt_palette',
    'pt_bar',
    'pt_coll',
    'pt_stlist',
    'pt_themes',
    'pt_theme_default',
    'pt_tiers',
    'pt_view',
    'pt_stream',
    'pt_tips',
];

/** Set in this tab just before the reload that ends a restore, so the page that comes back can say how it went. */
const RESTORED_NOTE = 'pt_restored';

interface BackupGalleryPicture {
    k: string;
    id: ItemId;
    name: string;
    data: string;
}

/** A picture from a backup: only data: pictures (never a web address), checked like an upload. */
async function pictureFromDataUrl(dataUrl: unknown): Promise<Blob | null> {
    if (typeof dataUrl !== 'string' || !/^data:image\//.test(dataUrl)) return null;
    const blob = dataUrlToBlob(dataUrl);
    return blob && checkedImage(blob);
}

// ═════════════════════════════════════════════════════════════════════════════
//  BACKUP (every list)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Largest backup the app reads back. Backups carry uploaded pictures as text, so they can be far bigger than a
 * list (uploads are at most 1024 px, roughly 150 KB each: about 1,300 of them), and they're opened rarely.
 */
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

export async function backUpAllLists(): Promise<void> {
    saveNow();
    showProgress('Backing up every list…', true);
    const settings: Record<string, string> = {};
    for (const key of BACKED_UP_SETTINGS)
        try {
            const value = local.get(key);
            if (value != null) settings[key] = value;
        } catch {}

    const lists: BackupEntry[] = [];
    for (const [index, meta] of session.lists.entries()) {
        if (progress.cancelled) return hideProgress();
        let snap: Record<string, unknown> = {};
        try {
            const saved: unknown = JSON.parse(local.get('ptl_' + meta.id) || 'null');
            if (isRecord(saved)) snap = saved;
        } catch {}
        const picks = isRecord(snap.picks) ? snap.picks : {};
        const imgs: Record<string, string> = {};
        for (const [key, blob] of await readByPrefix(meta.id + ':')) {
            const id = String(key).slice(meta.id.length + 1);
            const pick = picks[id];
            const path = isRecord(pick) && typeof pick.path === 'string' ? pick.path : 'custom';
            // only pictures that can't be downloaded again
            if (blob instanceof Blob && /^(custom|gal:|xp:)/.test(path)) imgs[id] = await blobToDataUrl(blob);
        }
        lists.push({ meta: { ...meta }, snap, imgs });
        updateProgress(`${index + 1} / ${session.lists.length} lists`, ((index + 1) / session.lists.length) * 90);
        await nextTick();
    }

    const galleryPictures: BackupGalleryPicture[] = [];
    try {
        for (const [key, picture] of await readAll(storage.db, 'gallery'))
            if (isRecord(picture) && picture.blob instanceof Blob)
                galleryPictures.push({
                    k: String(key),
                    id: Number(picture.id),
                    name: String(picture.name),
                    data: await blobToDataUrl(picture.blob),
                });
    } catch {}

    // packs you installed or made (the pack builder): lists made from them need them for tags and filters
    const packs: unknown[] = [];
    try {
        for (const [key, pack] of await readAll(storage.db, 'packs')) if (String(key).startsWith('gp:')) packs.push(pack);
    } catch {}

    hideProgress();
    const backup = writeBackup('tierlist', lists, settings, { gallery: galleryPictures, packs });
    const file = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    downloadBlob(file, `tierlists-backup_${todayIso()}.json`);
    if (file.size > MAX_BACKUP_BYTES) {
        const megabytes = Math.round(file.size / 1024 / 1024);
        toast(
            `This backup is ${megabytes} MB, more than the 200 MB the app can open again. Save your biggest lists on their own too (File → Save list).`,
            12_000,
        );
        return;
    }
    try {
        local.set('pt_lastbackup', String(Date.now()));
    } catch {}
    findById('nudge')?.remove();
    const count = session.lists.length;
    toast(`Backed up ${count} list${count > 1 ? 's' : ''}. Keep that file somewhere safe (cloud drive, email to yourself)`, 5000);
}

/** Adds every list of a backup next to yours (nothing is overwritten). Its envelope is checked by tier-engine/core's readBackup. */
export async function restoreBackup(file: unknown): Promise<void> {
    const backup = readBackup(file, BACKED_UP_SETTINGS);
    const lists = backup?.lists ?? [];
    if (!backup || !lists.length) return toast('That backup is empty');
    const made = backup.created;
    if (
        !(await ask(
            `Restore ${lists.length} list${lists.length > 1 ? 's' : ''} from this backup (made ${made})? They're added next to your current lists, nothing is overwritten.`,
            'Restore',
        ))
    )
        return;
    saveNow();
    // restoring into a fresh visit: the empty starting list gives way to the restored ones
    const emptyStart = emptyStartingList();
    showProgress('Restoring…');
    let firstRestored: string | null = null;
    let restored = 0;
    for (const entry of lists) {
        const meta = entry.meta;
        const name = String(meta.name || 'Restored list').slice(0, 52);
        const kind: ListKind = meta.kind === 'pokemon' ? 'pokemon' : 'custom';
        const list = addListMeta(session.lists.some((other) => other.name === name) ? name + ' (restored)' : name, kind);
        if (typeof meta.pack === 'string') list.pack = meta.pack.slice(0, 80);
        try {
            local.set('ptl_' + list.id, JSON.stringify(entry.snap));
        } catch {
            toast('Browser storage is full');
            break;
        }
        for (const [key, dataUrl] of Object.entries(entry.imgs)) {
            const picture = await pictureFromDataUrl(dataUrl);
            if (picture) await dbRequest('readwrite', (store) => store.put(picture, list.id + ':' + key)).catch(() => {});
        }
        firstRestored ??= list.id;
        restored++;
        updateProgress(`${restored} / ${lists.length}`, (restored / lists.length) * 100);
    }
    for (const saved of (Array.isArray(backup.raw.gallery) ? backup.raw.gallery : []).filter(isRecord)) {
        const key = String(saved.k ?? '').slice(0, 80);
        if (!key || gallery.has(key)) continue;
        const picture = await pictureFromDataUrl(saved.data);
        if (!picture) continue;
        const record = { id: Number(saved.id), name: String(saved.name ?? 'image').slice(0, 40), blob: picture };
        await dbRequest('readwrite', (store) => store.put(record, key), storage.db, 'gallery').catch(() => {});
        gallery.set(key, { ...record, url: objectUrlFor(picture) });
    }
    for (const raw of Array.isArray(backup.raw.packs) ? backup.raw.packs : []) {
        const pack = readGenericPack(raw);
        if (pack && !genericPacks.has(pack.id)) await installPack(pack);
    }
    // a setting you already have here wins, except saved themes, which are added to yours
    let settingsChanged = false;
    for (const [key, value] of Object.entries(backup.settings))
        try {
            const mine = local.get(key);
            const merged = mine == null ? value : key === 'pt_themes' ? mergeThemes(mine, value) : mine;
            if (merged !== mine) {
                local.set(key, merged);
                settingsChanged = true;
            }
        } catch {}
    if (emptyStart && restored) await forgetList(emptyStart);
    saveListIndex();
    hideProgress();
    const message = `Restored ${restored} list${restored > 1 ? 's' : ''}. Find them under the list menu`;
    if (settingsChanged) {
        // themes, tiers, the palette and the rest are read at start-up: the simplest way to have every one in use
        try {
            if (firstRestored) local.set('pt_cur', firstRestored);
            sessionStorage.setItem(RESTORED_NOTE, message);
        } catch {}
        location.reload();
        return;
    }
    if (firstRestored) await openList(firstRestored);
    renderListMenu();
    toast(message, 4500);
}

/** Saved themes from a backup added to the ones here (a theme already here, by id, stays as it is). */
function mergeThemes(mine: string, theirs: string): string {
    try {
        const here: unknown = JSON.parse(mine);
        const there: unknown = JSON.parse(theirs);
        if (!Array.isArray(here) || !Array.isArray(there)) return mine;
        const ids = new Set(here.filter(isRecord).map((theme) => theme.id));
        const added = there.filter((theme) => isRecord(theme) && !ids.has(theme.id));
        return added.length ? JSON.stringify([...here, ...added]) : mine;
    } catch {
        return mine;
    }
}

/** After the reload that ends a restore: says how it went. */
export function announceRestore(): void {
    try {
        const message = sessionStorage.getItem(RESTORED_NOTE);
        if (!message) return;
        sessionStorage.removeItem(RESTORED_NOTE);
        toast(message, 4500);
    } catch {}
}

// ═════════════════════════════════════════════════════════════════════════════
//  ONE LIST
// ═════════════════════════════════════════════════════════════════════════════

/** Saves the open list as a .zip: list.json plus every picture it has. */
export async function exportListBundle(): Promise<void> {
    saveNow();
    showProgress('Saving list with images…');
    const zipFiles: Record<string, Blob | string> = {};
    const pictureFiles: Record<string, string> = {};
    for (const [id, blob] of spriteBlobs) {
        const file = `images/${id}.${EXT_BY_MIME[blob.type] || 'png'}`;
        zipFiles[file] = blob;
        pictureFiles[id] = file;
    }
    zipFiles['list.json'] = JSON.stringify({ ...toSnapshot(), bundle: { files: pictureFiles } }, null, 1);
    const zip = await createZip(zipFiles);
    hideProgress();
    downloadBlob(zip, `${fileStem()}_${todayIso()}.zip`);
    toast('Saved list with images');
}

/**
 * Imports a list file (or a bundle's list.json with its `pictures`). An untouched empty list
 * is replaced; a list with the same name is replaced only if you say so.
 */
export async function importList(list: Record<string, unknown>, fileName: string, pictures: [ItemId, Blob][] = []): Promise<void> {
    const kind: ListKind = list.kind === 'pokemon' || (!list.kind && list.app === 'poketier') ? 'pokemon' : 'custom';
    const theme = isRecord(list.theme) ? list.theme : {};
    const name = String(list.listName || theme.name || fileName || 'Imported list').slice(0, 60);
    const current = currentListMeta();
    const untouched = isUntouchedList();
    const sameName = session.lists.find((other) => other.name === name && other.kind === kind);
    let target: ListMeta | undefined;
    if (untouched) target = current;
    else if (
        sameName &&
        (await ask(
            `You already have a list called “${name}”. Replace it with this file? (Its downloaded sprites are reused.)`,
            'Replace',
            false,
            'Add as new',
        ))
    )
        target = sameName;
    saveNow();
    if (target) {
        target.name = name;
        target.kind = kind;
        saveListIndex();
    } else target = addListMeta(name, kind);
    try {
        local.set('ptl_' + target.id, JSON.stringify({ ...list, kind }));
    } catch {
        return toast('Browser storage is full');
    }
    // pictures are stored under the open list's id, so point it at the target while saving them
    session.listId = target.id;
    for (const [id, blob] of pictures) {
        const picture = await checkedImage(blob);
        if (picture) await saveImage(id, picture);
    }
    // no list is "open" now: opening the target mustn't first save the old state over the import
    session.listId = null;
    await openList(target.id);
    if (session.needsPack)
        toast("List imported. It needs the Pokémon pack, which couldn't be downloaded: check your connection and reload.", 5000);
    else toast(`Loaded “${name}”`);
}
