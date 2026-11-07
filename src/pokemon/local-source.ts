// src/pokemon/local-source.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Sprites from your own pokemon.zip (or a folder of PokeAPI sprites): used before
//  the online mirrors, and the only source when GitHub can't be reached.
//
//  Files are found by their PokeAPI path (".../sprites/pokemon/versions/.../25.png"),
//  read only when a sprite is shown, and checked like any other picture.
// ─────────────────────────────────────────────────────────────────────────────
import { byId } from '../lib/dom';
import { html, setHtml } from '../lib/html';
import { checkedImage, objectUrlFor } from '../lib/images';
import { hideProgress, showProgress, toast, updateProgress } from '../lib/ui';
import { openZipArchive, type ZipArchive, ZipError } from '../lib/zip';
import { describeSpriteDir, localStems, spriteDirByPath, spriteDirs, spritePath } from './data';
import { renderNetState, spriteUrlsFor } from './sprite-urls';

/** A sprite file in the zip or folder, read only when needed. */
interface LocalFile {
    path: string;
    read(): Promise<Blob>;
}

/** Sprite path ("versions/generation-v/black-white/25.png") → its file. Null when none are loaded. */
let localSprites: Map<string, LocalFile> | null = null;
/** Addresses of local sprites already shown, so each file is read once. */
const localUrls = new Map<string, string>();

export const hasLocalSprite = (path: string): boolean => !!localSprites?.has(path);
export const usingLocalSprites = (): boolean => localSprites != null;

const changeListeners: (() => void)[] = [];
/** Runs after a zip or folder is loaded (the studio and quick picker redraw). */
export const onLocalSpritesChange = (listener: () => void): void => void changeListeners.push(listener);

/** ".../sprites/pokemon/versions/x/25.png" → "versions/x/25.png" (and an old folder name fixed). */
function normaliseLocalPath(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const start = parts.lastIndexOf('pokemon');
    return (start >= 0 ? parts.slice(start + 1) : parts)
        .join('/')
        .replace('generation-vi/omegaruby-alphasapphire', 'generation-vi/omega-ruby-alpha-sapphire');
}

/** Makes these files the local sprite source (folders the app doesn't know yet are added as new styles). */
function registerLocalSprites(files: readonly LocalFile[], sourceName: string): void {
    const found = new Map<string, LocalFile>();
    localUrls.forEach((url) => {
        URL.revokeObjectURL(url);
    });
    localUrls.clear();
    localStems.clear();
    for (const file of files) {
        const match = normaliseLocalPath(file.path).match(/^(?:(.*)\/)?(\d+(?:-[a-z0-9-]+)?)\.(png|gif|svg|webp)$/i);
        if (!match) continue;
        const [, folder = '', stem = '', ext = ''] = match;
        let dir = spriteDirByPath.get(folder);
        if (!dir) {
            dir = { dir: folder, ext: ext.toLowerCase(), i: spriteDirs.length, local: true, info: describeSpriteDir(folder) };
            spriteDirs.push(dir);
            spriteDirByPath.set(folder, dir);
        }
        found.set(spritePath(dir, stem), file);
        if (!localStems.has(stem)) localStems.set(stem, new Set());
        localStems.get(stem)!.add(dir.i);
    }
    const count = found.size;
    localSprites = count ? found : null;
    setHtml(
        byId('srcinfo'),
        count
            ? html`<b>Local</b>: ${sourceName}, ${count.toLocaleString()} sprites (online fills gaps)`
            : html`<b>Online</b>: nothing usable found in ${sourceName}`,
    );
    renderNetState();
    changeListeners.forEach((listener) => {
        listener();
    });
    toast(count ? `Using ${count.toLocaleString()} local sprites from ${sourceName}` : 'No Pokémon sprites found in that file');
}

/** A local sprite's picture, or null if there's none (or it isn't really a picture). */
export async function readLocalSprite(path: string): Promise<Blob | null> {
    const file = localSprites?.get(path);
    if (!file) return null;
    try {
        return await checkedImage(await file.read());
    } catch {
        return null;
    }
}

/** An address to show a sprite at: the local file if there is one, otherwise the first mirror. */
export async function spriteUrl(path: string): Promise<string> {
    if (hasLocalSprite(path)) {
        const known = localUrls.get(path);
        if (known) return known;
        const picture = await readLocalSprite(path);
        if (picture) {
            const url = objectUrlFor(picture);
            localUrls.set(path, url);
            return url;
        }
    }
    return spriteUrlsFor(path)[0]!;
}

/** Loads a pokemon.zip (already opened when it came from somewhere else, like a dropped file). */
export async function useSpriteZip(file: File, opened?: ZipArchive): Promise<void> {
    showProgress(`Reading ${file.name}…`);
    updateProgress('Large zips take a few seconds', 30);
    try {
        const zip = opened || (await openZipArchive(file));
        registerLocalSprites(
            zip.paths.map((path) => ({ path, read: () => zip.readBlob(path, 'application/octet-stream') })),
            file.name,
        );
    } catch (error) {
        toast(error instanceof ZipError ? error.message : 'Could not read that zip');
    } finally {
        hideProgress();
    }
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupLocalSource(): void {
    const zipInput = byId<HTMLInputElement>('zipinp');
    const folderInput = byId<HTMLInputElement>('dirinp');
    byId('zipbtn').onclick = () => zipInput.click();
    zipInput.onchange = () => {
        const file = zipInput.files?.[0];
        zipInput.value = '';
        if (file) void useSpriteZip(file);
    };
    byId('dirbtn').onclick = () => folderInput.click();
    folderInput.onchange = () => {
        const files = [...(folderInput.files || [])];
        folderInput.value = '';
        if (!files.length) return;
        registerLocalSprites(
            files.map((file) => ({ path: file.webkitRelativePath || file.name, read: async () => file })),
            (files[0]!.webkitRelativePath || 'folder').split('/')[0]!,
        );
    };
}
