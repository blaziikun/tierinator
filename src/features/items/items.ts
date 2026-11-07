// src/features/items/items.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Your own items: adding them (from pictures, web addresses, searches, wikis),
//  their text tiles, and every picture each could show. Deleting them is delete-items.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_SWATCHES } from '../../core/defaults';
import { entries, entryById, familyMembers, familyOf, rebuildEntries } from '../../core/items';
import { autosave } from '../../core/persist';
import { spriteBlobs, spriteUrls, state } from '../../core/state';
import type { Entry, ItemId, ItemVersion, OwnItem, PictureChoice, PictureCredit, WikiRef } from '../../core/types';
import { readableTextOn } from '../../lib/color';
import { byId } from '../../lib/dom';
import { hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { fontsReady, headFont, measureCanvas, wrapText } from '../export/layout';
import { packImageUrl, packRowFor } from '../packs/packs';
import { copyPick, pickFromUrl, pickUpload, setPick, spriteSrc } from '../sprites/sprites';
import { extraPictures, galleryTarget } from '../studio/gallery';
import { refreshTagUI, setTags } from '../tags/tags';
import { placeAllTiles } from '../tier-board/board';
import { palette } from '../tier-board/tier-editor';
import { afterFamilyChange } from '../variants/variants';

/** Everything that can describe a new item; only the name is needed. */
export interface NewItem {
    name: string;
    /** A picture file (checked before it's used). */
    blob?: Blob;
    /** A picture's web address. */
    url?: string;
    tags?: string[];
    w?: WikiRef;
    /** Who made the picture at `url` (Wikimedia pictures). */
    credit?: PictureCredit;
    alts?: string[];
    vars?: ItemVersion[];
}

export const ownItem = (id: ItemId | null): OwnItem | undefined => state.ownItems.find((item) => item.id === id);

// ═════════════════════════════════════════════════════════════════════════════
//  TEXT TILES (items without a picture)
// ═════════════════════════════════════════════════════════════════════════════

/** The same colour every time for the same name, from your tier colours. */
function tileColor(name: string): string {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const colors = palette.length ? palette : DEFAULT_SWATCHES;
    return colors[hash % colors.length]!;
}

/** A 256 px tile (slightly rounded corners) with the name written as large as it fits. */
export async function textTile(name: string): Promise<Blob> {
    await fontsReady();
    const SIZE = 256;
    const TEXT_WIDTH = 220;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d')!;
    const background = tileColor(name);
    g.fillStyle = background;
    g.beginPath();
    g.roundRect(0, 0, SIZE, SIZE, 10);
    g.fill();

    // the largest font size where the wrapped name (and every single word) fits
    let fontSize = 72;
    let lines: string[] = [];
    for (; fontSize >= 14; fontSize -= 2) {
        lines = wrapText(name, TEXT_WIDTH, headFont(fontSize));
        measureCanvas.font = headFont(fontSize);
        const fits =
            lines.length * fontSize * 1.15 <= TEXT_WIDTH &&
            lines.every((line) => measureCanvas.measureText(line).width <= TEXT_WIDTH + 4) &&
            name.split(/\s+/).every((word) => measureCanvas.measureText(word).width <= TEXT_WIDTH);
        if (fits) break;
    }
    g.fillStyle = readableTextOn(background);
    g.font = headFont(fontSize);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lineHeight = fontSize * 1.15;
    lines.forEach((line, i) => {
        g.fillText(line, SIZE / 2, SIZE / 2 - ((lines.length - 1) * lineHeight) / 2 + i * lineHeight);
    });
    return new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the tile'))), 'image/png'),
    );
}

/** Gives an item its text tile as its picture. */
export async function useTextTile(id: ItemId): Promise<void> {
    await setPick(id, await textTile(entryById.get(id)!.name), { path: 'custom', text: 1, ck: 1 });
}

// ═════════════════════════════════════════════════════════════════════════════
//  ADDING
// ═════════════════════════════════════════════════════════════════════════════

/** Adds one item to the pool and gives it a picture (its text tile if the picture can't be used). */
export async function addItem({ name, blob, url, tags, w, credit, alts, vars }: NewItem): Promise<ItemId> {
    const id = state.nextItemId++;
    const cleanName =
        String(name || 'Item')
            .trim()
            .slice(0, 80) || 'Item';
    const pictureAddresses = [...new Set((alts || []).filter((address) => /^https:\/\//.test(address)))].slice(0, 12);
    state.ownItems.push({
        id,
        name: cleanName,
        ...(w ? { w } : {}),
        ...(credit && url ? { credit } : {}),
        ...(pictureAddresses.length > 1 ? { alts: pictureAddresses } : {}),
        ...(vars && vars.length > 1 ? { vars: vars.slice(0, 40) } : {}),
    });
    const entry: Entry = { id, dex: null, name: cleanName, gen: 0, types: [], lc: cleanName.toLowerCase(), form: null, custom: true };
    entries.push(entry);
    entryById.set(id, entry);
    if (tags?.length)
        setTags(
            id,
            tags.map((tag) => String(tag).slice(0, 24)),
        );
    try {
        if (blob) {
            if (!(await pickUpload(id, blob))) await useTextTile(id);
        } else if (url) await pickFromUrl(id, url);
        else await useTextTile(id);
    } catch {
        await useTextTile(id);
    }
    return id;
}

/**
 * Adds many items with a progress window (Cancel stops early). `concurrency` > 1 downloads
 * several pictures at once (wiki imports can be hundreds). Returns each new id at its
 * place in `list` (undefined for any left out by Cancel).
 */
export async function addItems(list: readonly NewItem[], label = 'Adding items…', concurrency = 1): Promise<(ItemId | undefined)[]> {
    const ids: (ItemId | undefined)[] = [];
    if (!list.length) return ids;
    showProgress(label, true);
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < list.length && !progress.cancelled) {
            const index = next++;
            ids[index] = await addItem(list[index]!);
            done++;
            updateProgress(`${done} / ${list.length}`, (done / list.length) * 100);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    hideProgress();
    refreshTagUI();
    placeAllTiles();
    autosave();
    toast(`Added ${done} item${done > 1 ? 's' : ''} to the pool`);
    return Array.from(list, (_, index) => ids[index]);
}

/** "my_cool-pic.png" → "my cool pic". */
export const nameFromFile = (file: { name: string }): string =>
    String(file.name || 'image')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Image';

/** Adds picture files as items, named after the files. */
export async function addImageFiles(files: Iterable<File>): Promise<void> {
    const pictures = [...files].filter((file) => file.type.startsWith('image/'));
    if (pictures.length) await addItems(pictures.map((file) => ({ name: nameFromFile(file), blob: file })));
}

/** A new item named by you; `like` copies another's picture, `familyWith` makes it that item's variant. */
export async function createItem(name: string, { like, familyWith }: { like?: ItemId; familyWith?: ItemId } = {}): Promise<ItemId> {
    const id = await addItem({ name });
    if (like != null && spriteBlobs.has(like)) await copyPick(id, like);
    if (familyWith != null) {
        const base = familyOf(familyWith) ?? familyWith;
        state.familyOf[id] = base;
        delete state.combinedFamilies[base];
    }
    rebuildEntries();
    afterFamilyChange();
    return id;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICTURE CHOICES
// ═════════════════════════════════════════════════════════════════════════════

/** "AniList", "Fandom", "en.wikipedia.org"… for a picture's address. */
export function sourceLabel(address: string): string {
    let host = '';
    try {
        host = new URL(address).host;
    } catch {}
    if (/anilist/.test(host)) return 'AniList';
    if (/myanimelist/.test(host)) return 'MyAnimeList';
    if (/kitsu/.test(host)) return 'Kitsu';
    if (/wikia|fandom/.test(host)) return 'Fandom';
    if (/wiki/.test(host)) return 'Wiki';
    return host.replace(/^www\./, '');
}

/** Every picture an item of yours could show: its pack's pictures, versions, uploads, variants, other sources. */
export function picturesOf(id: ItemId): PictureChoice[] {
    const item = ownItem(id);
    if (!item) return [];
    const choices: PictureChoice[] = [];
    const add = (choice: PictureChoice) => {
        if (!choices.some((other) => other.url === choice.url)) choices.push(choice);
    };
    const addPackPictures = (packRow: ReturnType<typeof packRowFor>, groupName: (group: string) => string) => {
        if (!packRow) return;
        for (const [group, src, label] of packRow.row[2] || [])
            add({ group: groupName(packRow.pack.groups?.[group] || 'Pictures'), url: packImageUrl(packRow.pack, src), label: label || '' });
    };

    addPackPictures(packRowFor(item), (group) => group);
    for (const [reference, versionLabel] of item.pkx || []) {
        const packRow = packRowFor({ pk: reference });
        addPackPictures(packRow, (group) => `${versionLabel || packRow?.row[0]}: ${group}`);
    }
    for (const version of item.vars || []) if (version.u) add({ group: 'Versions', url: version.u, label: version.l || '' });
    extraPictures.forEach((picture, key) => {
        if (picture.id === id) choices.push({ group: 'Your pictures', url: picture.url, extraKey: key, label: '' });
    });
    if (state.combinedFamilies[id])
        for (const memberId of familyMembers(id)) {
            const member = ownItem(memberId);
            if (!member) continue;
            const group = 'Variant: ' + member.name;
            if (spriteUrls.has(memberId) && !state.picks[memberId]?.text)
                add({ group, url: spriteSrc(memberId), variantId: memberId, label: 'its picture now' });
            addPackPictures(packRowFor(member), () => group);
            for (const address of member.alts || []) add({ group, url: address, label: sourceLabel(address) });
        }
    for (const address of item.alts || []) add({ group: 'Other sources', url: address, label: sourceLabel(address) });
    return choices;
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupItems(): void {
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && /INPUT|TEXTAREA/.test(target.tagName);
    // paste or drop pictures on the tier list (or the Add items window) to add them as items
    document.addEventListener('paste', (e) => {
        if (e.defaultPrevented || isTyping(e.target) || galleryTarget()) return;
        const files = [...(e.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
        if (!files.length || !(state.view === 'tier' || byId('addm').classList.contains('show'))) return;
        e.preventDefault();
        byId('addm').classList.remove('show');
        void addImageFiles(files);
    });
    byId('main').addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    byId('main').addEventListener('drop', (e) => {
        const files = [...(e.dataTransfer?.files || [])];
        if (!files.length) return;
        e.preventDefault();
        void addImageFiles(files);
    });
}
