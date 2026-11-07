// src/features/files/sprite-packs.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Sprite packs (Pokémon lists): every picked sprite and your gallery in one .zip,
//  to move picks between browsers or keep them offline. Also where any opened
//  .zip is sorted out: a list with pictures, a sprite pack, or a pokemon.zip.
// ─────────────────────────────────────────────────────────────────────────────
import { entryById } from '../../core/items';
import { autosave } from '../../core/persist';
import { isPicturePath } from '../../core/snapshot';
import { spriteBlobs, state } from '../../core/state';
import type { ItemId } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId, downloadBlob, nextTick, pad3, todayIso } from '../../lib/dom';
import { checkedImage, EXT_BY_MIME, extensionOf } from '../../lib/images';
import { hideProgress, showProgress, toast, updateProgress } from '../../lib/ui';
import { createZip, openZipArchive, type ZipArchive, ZipError } from '../../lib/zip';
import { useSpriteZip } from '../../pokemon/local-source';
import { switchView } from '../layout/layout';
import { setPick } from '../sprites/sprites';
import { addGalleryImage, gallery } from '../studio/gallery';
import { renderStudio } from '../studio/studio';
import { importList } from './bundles';

/** Largest list.json / manifest.json read from a zip. */
const MAX_JSON_BYTES = 20 * 1024 * 1024;
/** Most picture data unpacked from one list zip, all files together. */
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

export async function exportSpritePack(): Promise<void> {
    const ids = Object.keys(state.picks)
        .map(Number)
        .filter((id) => spriteBlobs.has(id));
    if (!ids.length && !gallery.size) return toast('No sprites picked yet');
    showProgress('Building sprite pack…');
    const files: Record<string, Blob | string> = {};
    const picks: Record<string, unknown> = {};
    for (const id of ids) {
        const blob = spriteBlobs.get(id)!;
        const ext = EXT_BY_MIME[blob.type] || extensionOf(state.picks[id]!.path) || 'png';
        const file = `sprites/${pad3(id)}-${entryById.get(id)!.name.replace(/[^a-z0-9]+/gi, '_')}.${ext}`;
        files[file] = blob;
        picks[id] = { ...state.picks[id], file };
    }
    const galleryFiles = [...gallery.values()].map((picture, index) => {
        const file = `gallery/${pad3(entryById.get(picture.id)?.dex ?? 0)}-${picture.id}-${index + 1}.${EXT_BY_MIME[picture.blob.type] || 'png'}`;
        files[file] = picture.blob;
        return { id: picture.id, name: picture.name, file };
    });
    files['manifest.json'] = JSON.stringify(
        { app: 'tierinator', type: 'spritepack', v: 1, created: new Date().toISOString(), count: ids.length, picks, gallery: galleryFiles },
        null,
        1,
    );
    const zip = await createZip(files);
    hideProgress();
    downloadBlob(zip, `tierinator-sprites_${ids.length}_${todayIso()}.zip`);
    toast(`Sprite pack saved: ${ids.length} sprites`);
}

/** A JSON file inside a zip, or null if it's missing, too big or not JSON. */
async function readZipJson(zip: ZipArchive, path: string): Promise<Record<string, unknown> | null> {
    try {
        const bytes = await zip.readBytes(path);
        if (bytes.length > MAX_JSON_BYTES) return null;
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** A picture inside a zip, checked like any upload. */
async function readZipPicture(zip: ZipArchive, path: unknown): Promise<Blob | null> {
    if (typeof path !== 'string' || !zip.has(path)) return null;
    try {
        return await checkedImage(await zip.readBlob(path, 'application/octet-stream'));
    } catch {
        return null;
    }
}

async function importSpritePack(zip: ZipArchive, manifest: Record<string, unknown>, fileName: string): Promise<void> {
    const picks = Object.entries(isRecord(manifest.picks) ? manifest.picks : {});
    showProgress(`Importing ${fileName}…`);
    let imported = 0;
    for (const [index, [key, pick]] of picks.entries()) {
        const id = Number(key);
        if (isRecord(pick) && entryById.has(id)) {
            const picture = await readZipPicture(zip, pick.file);
            if (picture) {
                // the picture comes from the zip; the path only names where it came from, checked like a list file's
                const path = isPicturePath(pick.path) && pick.path.length < 300 ? pick.path : 'custom';
                await setPick(id, picture, { path, trim: !!pick.trim });
                imported++;
            }
        }
        if ((index + 1) % 25 === 0) {
            updateProgress(`${index + 1} / ${picks.length}`, ((index + 1) / picks.length) * 100);
            await nextTick();
        }
    }
    let galleryAdded = 0;
    for (const saved of (Array.isArray(manifest.gallery) ? manifest.gallery : []).filter(isRecord)) {
        const id: ItemId = Number(saved.id);
        const name = String(saved.name ?? 'image');
        if (!entryById.has(id) || [...gallery.values()].some((picture) => picture.id === id && picture.name === name)) continue;
        const picture = await readZipPicture(zip, saved.file);
        if (picture && (await addGalleryImage(id, picture, name))) galleryAdded++;
    }
    hideProgress();
    autosave();
    if (state.view === 'studio') renderStudio();
    toast(`Imported ${imported} sprites${galleryAdded ? ` and ${galleryAdded} of your images` : ''} from pack`);
}

/**
 * The list in a list .zip (Save list, for lists with uploaded pictures) and its pictures,
 * still unchecked (whoever uses them checks them like any upload); or what's wrong with it.
 */
export async function readListZip(zip: ZipArchive): Promise<{ list: Record<string, unknown>; pictures: [ItemId, Blob][] } | string> {
    const list = await readZipJson(zip, 'list.json');
    if (!list) return "That zip's list.json can't be read";
    const bundle = isRecord(list.bundle) && isRecord(list.bundle.files) ? list.bundle.files : {};
    delete list.bundle;
    // each file is unpacked once however many items share it, and all of them together are capped
    const pictures: [ItemId, Blob][] = [];
    const unpacked = new Map<string, Blob>();
    let unpackedBytes = 0;
    for (const [id, path] of Object.entries(bundle)) {
        if (typeof path !== 'string' || !zip.has(path)) continue;
        let picture = unpacked.get(path);
        if (!picture) {
            picture = await zip.readBlob(path, 'application/octet-stream');
            unpackedBytes += picture.size;
            if (unpackedBytes > MAX_BUNDLE_BYTES) return 'The pictures in that zip are too big to open';
            unpacked.set(path, picture);
        }
        pictures.push([Number(id), picture]);
    }
    return { list, pictures };
}

/** Opens a .zip: a list with its pictures, a sprite pack, or a pokemon.zip of sprites. */
export async function openZip(file: File): Promise<void> {
    showProgress(`Opening ${file.name}…`);
    let zip: ZipArchive;
    try {
        zip = await openZipArchive(file);
    } catch (error) {
        hideProgress();
        return toast(error instanceof ZipError ? error.message : 'Not a valid zip');
    }
    hideProgress();
    if (zip.has('list.json')) {
        const bundle = await readListZip(zip);
        if (typeof bundle === 'string') return toast(bundle);
        return importList(bundle.list, file.name.replace(/\.zip$/i, ''), bundle.pictures);
    }
    if (zip.has('manifest.json')) {
        const manifest = await readZipJson(zip, 'manifest.json');
        if (!manifest) return toast("That zip's manifest.json can't be read");
        return importSpritePack(zip, manifest, file.name);
    }
    await useSpriteZip(file, zip);
    switchView('studio');
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupSpritePacks(): void {
    const input = byId<HTMLInputElement>('packinp');
    byId('packexp').onclick = () => void exportSpritePack();
    byId('packimp').onclick = () => input.click();
    input.onchange = () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) void openZip(file);
    };
}
