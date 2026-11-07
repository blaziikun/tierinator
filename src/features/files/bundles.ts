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
import { saveNow, toSnapshot } from '../../core/persist';
import { addListMeta, currentListMeta, saveListIndex, session, spriteBlobs } from '../../core/state';
import { dbRequest, readAll, readByPrefix, saveImage, storage } from '../../core/storage';
import type { ItemId, ListKind, ListMeta } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { downloadBlob, findById, nextTick, todayIso } from '../../lib/dom';
import { blobToDataUrl, checkedImage, dataUrlToBlob, EXT_BY_MIME, objectUrlFor } from '../../lib/images';
import { ask, hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { createZip } from '../../lib/zip';
import { fileStem } from '../export/layout';
import { emptyStartingList, forgetList, isUntouchedList, openList, renderListMenu } from '../lists/lists';
import { gallery } from '../studio/gallery';

/** Settings (in this browser) that a backup carries along. */
const BACKED_UP_SETTINGS = ['pt_palette', 'pt_bar', 'pt_coll', 'pt_stlist', 'pt_themes', 'pt_theme_default', 'pt_tiers'];

interface BackupList {
    meta: ListMeta;
    snap: unknown;
    /** Item id (or extra-picture key) → picture as a data: address. */
    imgs: Record<string, string>;
}

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
            const value = localStorage.getItem(key);
            if (value != null) settings[key] = value;
        } catch {}

    const lists: BackupList[] = [];
    for (const [index, meta] of session.lists.entries()) {
        if (progress.cancelled) return hideProgress();
        let snap: unknown = null;
        try {
            snap = JSON.parse(localStorage.getItem('ptl_' + meta.id) || 'null');
        } catch {}
        const picks = isRecord(snap) && isRecord(snap.picks) ? snap.picks : {};
        const imgs: Record<string, string> = {};
        for (const [key, blob] of await readByPrefix(meta.id + ':')) {
            const id = String(key).slice(meta.id.length + 1);
            const pick = picks[id];
            const path = isRecord(pick) && typeof pick.path === 'string' ? pick.path : 'custom';
            // only pictures that can't be downloaded again
            if (blob instanceof Blob && /^(custom|gal:|xp:)/.test(path)) imgs[id] = await blobToDataUrl(blob);
        }
        lists.push({ meta, snap, imgs });
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

    hideProgress();
    const backup = { app: 'tierlist', type: 'backup', v: 1, created: new Date().toISOString(), lists, gallery: galleryPictures, settings };
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
        localStorage.setItem('pt_lastbackup', String(Date.now()));
    } catch {}
    findById('nudge')?.remove();
    const count = session.lists.length;
    toast(`Backed up ${count} list${count > 1 ? 's' : ''}. Keep that file somewhere safe (cloud drive, email to yourself)`, 5000);
}

/** Adds every list of a backup next to yours (nothing is overwritten). */
export async function restoreBackup(backup: Record<string, unknown>): Promise<void> {
    const lists = (Array.isArray(backup.lists) ? backup.lists : [])
        .filter(isRecord)
        .filter((entry) => isRecord(entry.meta) && isRecord(entry.snap));
    if (!lists.length) return toast('That backup is empty');
    const made = String(backup.created || '').slice(0, 10);
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
        const meta = entry.meta as Record<string, unknown>;
        const name = String(meta.name || 'Restored list').slice(0, 52);
        const kind: ListKind = meta.kind === 'pokemon' ? 'pokemon' : 'custom';
        const list = addListMeta(session.lists.some((other) => other.name === name) ? name + ' (restored)' : name, kind);
        if (typeof meta.pack === 'string') list.pack = meta.pack.slice(0, 80);
        try {
            localStorage.setItem('ptl_' + list.id, JSON.stringify(entry.snap));
        } catch {
            toast('Browser storage is full');
            break;
        }
        for (const [key, dataUrl] of Object.entries(isRecord(entry.imgs) ? entry.imgs : {})) {
            const picture = await pictureFromDataUrl(dataUrl);
            if (picture) await dbRequest('readwrite', (store) => store.put(picture, list.id + ':' + key.slice(0, 80))).catch(() => {});
        }
        firstRestored ??= list.id;
        restored++;
        updateProgress(`${restored} / ${lists.length}`, (restored / lists.length) * 100);
    }
    for (const saved of (Array.isArray(backup.gallery) ? backup.gallery : []).filter(isRecord)) {
        const key = String(saved.k ?? '').slice(0, 80);
        if (!key || gallery.has(key)) continue;
        const picture = await pictureFromDataUrl(saved.data);
        if (!picture) continue;
        const record = { id: Number(saved.id), name: String(saved.name ?? 'image').slice(0, 40), blob: picture };
        await dbRequest('readwrite', (store) => store.put(record, key), storage.db, 'gallery').catch(() => {});
        gallery.set(key, { ...record, url: objectUrlFor(picture) });
    }
    const settings = isRecord(backup.settings) ? backup.settings : {};
    for (const key of BACKED_UP_SETTINGS)
        try {
            if (typeof settings[key] === 'string' && localStorage.getItem(key) == null) localStorage.setItem(key, settings[key]);
        } catch {}
    if (emptyStart && restored) await forgetList(emptyStart);
    saveListIndex();
    hideProgress();
    if (firstRestored) await openList(firstRestored);
    renderListMenu();
    toast(`Restored ${restored} list${restored > 1 ? 's' : ''}. Find them under the list menu`, 4500);
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
        localStorage.setItem('ptl_' + target.id, JSON.stringify({ ...list, kind }));
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
