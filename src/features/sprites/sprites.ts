// src/features/sprites/sprites.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The picture each item shows: the built-in default, or the one you picked.
//
//  A pick is fetched once, checked to really be a picture, trimmed (or, if animated,
//  cropped on screen), saved in the browser's database and shown everywhere the item
//  appears. Pictures that stop showing repair themselves; picks from older versions
//  of the app are fetched again so they look right.
// ─────────────────────────────────────────────────────────────────────────────
import { dexLabel, entryById, isOwnItem } from '../../core/items';
import { autosave } from '../../core/persist';
import { session, spriteBlobs, spriteUrls, state, studioRowById, tileById } from '../../core/state';
import { deleteImage, saveImage } from '../../core/storage';
import type { Crop, ItemId, Pick } from '../../core/types';
import { byId, findById, setStatus } from '../../lib/dom';
import {
    checkedImage,
    firstLoadableUrl,
    isAnimatedBlob,
    isImageBlob,
    MAX_IMAGE_BYTES,
    MIME_BY_EXT,
    objectUrlFor,
    opaqueBounds,
    shrinkPicture,
    sniffImageType,
    trimTransparentEdges,
} from '../../lib/images';
import { getBytes, sleep } from '../../lib/net';
import { forEachLimited, toast } from '../../lib/ui';
import { describeSpritePath, extensionOfSpritePath, pokedex } from '../../pokemon/data';
import { readLocalSprite } from '../../pokemon/local-source';
import { mirrorOrder, recordNetResult, spriteUrlsFor } from '../../pokemon/sprite-urls';
import { applyPackDefaultSprite } from '../lists/lists';
import { quickPicker } from '../quick-picker/quick-picker';
import { extraPictures, gallery } from '../studio/gallery';
import { studio } from '../studio/studio';
import { setTileImage, showRankedCount } from '../tier-board/board';

/** "Dex 25 Pikachu" for toasts. */
const itemLabel = (id: ItemId): string => `${dexLabel(id)} ${entryById.get(id)?.name ?? ''}`;

/** A picture site that hasn't answered by now isn't going to: give up and try the next address. */
const PICTURE_TIMEOUT_MS = 20_000;
// ═════════════════════════════════════════════════════════════════════════════
//  BUILT-IN SPRITES
// ═════════════════════════════════════════════════════════════════════════════

/** Which default sprite an item uses: its own (forms have one) or its species', or null if neither. */
function defaultKey(id: ItemId): number | null {
    const hasDefault = (key: number | null | undefined): key is number =>
        key != null && !!(pokedex.defaultSprites[key] || pokedex.defaultCrops[key]);
    if (hasDefault(id)) return id;
    const dex = entryById.get(id)?.dex;
    return hasDefault(dex) ? dex : null;
}

export function defaultSpriteUrl(id: ItemId): string {
    const key = defaultKey(id);
    if (key == null) return '';
    const embedded = pokedex.defaultSprites[key];
    return embedded ? 'data:image/png;base64,' + embedded : spriteUrlsFor(`${key}.png`)[0]!;
}

/** A default sprite failed to load: try the next mirror. False when there are none left. */
export function tryNextDefaultMirror(img: HTMLImageElement, id: ItemId): boolean {
    const key = defaultKey(id);
    if (key == null || pokedex.defaultSprites[key]) return false;
    const urls = spriteUrlsFor(`${key}.png`);
    const next = Number(img.dataset.mirror || 0) + 1;
    if (next >= urls.length) return false;
    img.dataset.mirror = String(next);
    img.src = urls[next]!;
    return true;
}

/**
 * The part of an item's picture to show. Animated picks keep their first-frame crop box;
 * default sprites from PokeAPI (96×96 with an empty border) use the pack's crop boxes, so
 * they look the same as pre-trimmed ones.
 */
export function spriteCrop(id: ItemId): Crop | null {
    if (spriteUrls.has(id)) return state.picks[id]?.crop || null;
    const key = defaultKey(id);
    const box = key != null && !pokedex.defaultSprites[key] ? pokedex.defaultCrops[key] : null;
    if (!box) return null;
    const size = pokedex.defaultCropSize;
    return { x: box[0], y: box[1], w: box[2], h: box[3], W: size, H: size };
}

/** The address of the picture an item shows right now. */
export const spriteSrc = (id: ItemId): string => spriteUrls.get(id) || defaultSpriteUrl(id);

// ═════════════════════════════════════════════════════════════════════════════
//  SHOWING A PICK
// ═════════════════════════════════════════════════════════════════════════════

/** Points an item at a new picture address (or none), freeing the old one. */
function replaceSpriteUrl(id: ItemId, url: string | null): void {
    const old = spriteUrls.get(id);
    if (old && old !== url && old.startsWith('blob:')) URL.revokeObjectURL(old);
    if (url) spriteUrls.set(id, url);
    else spriteUrls.delete(id);
}

/** Updates every place an item's picture is shown: its tile, studio row, quick picker and studio preview. */
export function refreshSprite(id: ItemId): void {
    const url = spriteSrc(id);
    setTileImage(id);
    const row = studioRowById.get(id);
    if (row) {
        row.querySelector('img')!.src = url;
        row.classList.toggle('picked', !!state.picks[id]);
    }
    if (quickPicker.id === id) byId<HTMLImageElement>('qpbig').src = url;
    if (state.view === 'studio' && studio.mode === 'pokemon' && studio.currentId === id) {
        const preview = findById<HTMLImageElement>('stbig');
        if (preview) preview.src = url;
        const caption = findById('stcurlbl');
        if (caption) caption.textContent = 'Using: ' + describeSpritePath(state.picks[id]?.path);
    }
}

interface SetPickOptions {
    /** Also store the picture in the database (false when it's already there). */
    save?: boolean;
    /** session.generation when the work started; if the list changed since, nothing happens. */
    generation?: number;
}

export async function setPick(
    id: ItemId,
    blob: Blob,
    pick: Pick,
    { save = true, generation = session.generation }: SetPickOptions = {},
): Promise<void> {
    if (generation !== session.generation) return; // the list changed while this was downloading
    if (save) await saveImage(id, blob);
    if (generation !== session.generation) return;
    spriteBlobs.set(id, blob);
    replaceSpriteUrl(id, objectUrlFor(blob));
    state.picks[id] = pick;
    refreshSprite(id);
    showRankedCount();
}

export async function clearPick(id: ItemId): Promise<void> {
    delete state.picks[id];
    spriteBlobs.delete(id);
    replaceSpriteUrl(id, null);
    await deleteImage(id);
    refreshSprite(id);
    showRankedCount();
}

/** Shows a picture straight from the web (the site lets it be shown but not copied). */
async function showRemotePick(id: ItemId, path: string, url: string): Promise<void> {
    spriteBlobs.delete(id);
    await deleteImage(id).catch(() => {});
    state.picks[id] = { path, ck: 1, remote: url };
    replaceSpriteUrl(id, url);
}

// ═════════════════════════════════════════════════════════════════════════════
//  FETCHING
// ═════════════════════════════════════════════════════════════════════════════

/** The picture behind a sprite path: from your gallery, your pokemon.zip, or the web (each mirror in turn). */
export async function fetchSpriteBlob(path: string): Promise<Blob> {
    if (path.startsWith('gal:')) {
        const picture = gallery.get(path.slice(4));
        if (picture) return picture.blob;
        throw new Error('That gallery picture was deleted');
    }
    if (path.startsWith('xp:')) {
        const picture = extraPictures.get(path.slice(3));
        if (picture) return picture.blob;
        throw new Error('That picture was deleted');
    }
    if (!/^(https?|go|lore):/.test(path)) {
        const local = await readLocalSprite(path);
        if (local) return local;
    }
    const isPokeApiPath = !/^(https?|lore):/.test(path);
    const urls = spriteUrlsFor(path);
    let lastError: unknown;
    for (let k = 0; k < urls.length; k++) {
        try {
            const { bytes, contentType } = await getBytes(urls[k]!, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: PICTURE_TIMEOUT_MS });
            const kind = sniffImageType(bytes.subarray(0, 64));
            if (!kind) throw new Error('not a picture');
            if (isPokeApiPath) recordNetResult(true, mirrorOrder()[k]);
            const blob = new Blob([bytes], { type: MIME_BY_EXT[extensionOfSpritePath(path)] || contentType || 'image/png' });
            if (!/^https?:/.test(path) && kind !== 'svg') return blob;
            // a picture from any website, or any SVG: checked like an upload (SVGs become PNGs)
            const checked = await checkedImage(blob);
            if (!checked) throw new Error('not a picture');
            return checked;
        } catch (error) {
            lastError = error;
        }
    }
    if (!path.startsWith('lore:')) recordNetResult(false);
    throw lastError || new Error('unreachable');
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICKING
// ═════════════════════════════════════════════════════════════════════════════

/** Picks a sprite path for an item: fetches it, trims or crops it, saves it and shows it. */
export async function pickSprite(id: ItemId, path: string, { quiet = false } = {}): Promise<void> {
    const generation = session.generation;
    let blob: Blob;
    try {
        blob = await fetchSpriteBlob(path);
    } catch (error) {
        // Lore art the browser can show but not copy: use it straight from the web (exports fall back to the default sprite)
        if (!path.startsWith('lore:')) throw error;
        const url = await firstLoadableUrl(spriteUrlsFor(path));
        if (!url || generation !== session.generation) throw error;
        await showRemotePick(id, path, url);
        setTileImage(id);
        studioRowById.get(id)?.classList.add('picked');
        if (!quiet) {
            autosave();
            toast(`${itemLabel(id)} → ${describeSpritePath(path)} (shown from the web)`);
        }
        return;
    }
    if (generation !== session.generation) return;
    const prepared = await preparePicture(blob, path, ['png', 'webp'].includes(extensionOfSpritePath(path)));
    await setPick(id, prepared.blob, prepared.pick, { generation });
    if (!quiet) {
        autosave();
        toast(`${itemLabel(id)} → ${describeSpritePath(path)}`);
    }
}

/**
 * Gets a new pick's picture ready: its empty border trimmed (when "Trim" is on), or, if it's
 * animated, never re-encoded (that would keep only the first frame) but cropped on screen instead.
 */
async function preparePicture(blob: Blob, path: string, trimmable: boolean): Promise<{ blob: Blob; pick: Pick }> {
    const pick: Pick = { path, trim: false, ck: 1 };
    if (await isAnimatedBlob(blob)) {
        pick.anim = true;
        if (state.trimSprites) {
            const crop = await opaqueBounds(blob);
            if (crop && (crop.w < crop.W || crop.h < crop.H)) pick.crop = crop;
        }
    } else if (state.trimSprites && trimmable) {
        blob = await trimTransparentEdges(blob);
        pick.trim = true;
    }
    return { blob, pick };
}

/**
 * Uploaded pictures are kept at most this big: the largest export detail (1024 px a sprite), and more
 * than the board or studio ever shows (cards up to 256 px, so 768 device pixels on a 3× phone).
 */
const LARGEST_UPLOAD_SIDE = 1024;

/** Uses a picture file you chose as an item's sprite. False if the file isn't a picture (or is too big). */
export async function pickUpload(id: ItemId, file: Blob): Promise<boolean> {
    const picture = await checkedImage(file);
    if (!picture) return false;
    const prepared = await preparePicture(picture, 'custom', /png|webp/.test(picture.type));
    // after trimming, so the part kept is still up to LARGEST_UPLOAD_SIDE across (animated ones are never redrawn: their crop box stays true)
    if (!prepared.pick.anim) prepared.blob = await shrinkPicture(prepared.blob, LARGEST_UPLOAD_SIDE);
    await setPick(id, prepared.blob, prepared.pick);
    autosave();
    return true;
}

/** Fetches a pick again from where it came from (your own items' pictures are kept as they are). */
async function refetchPick(id: ItemId, pick: Pick, generation: number): Promise<void> {
    if (isOwnItem(id)) await setPick(id, await fetchSpriteBlob(pick.path), { ...pick }, { generation });
    else await pickSprite(id, pick.path, { quiet: true });
}

/**
 * Uses a picture from a web address. If the site won't let it be copied, it's shown straight
 * from the web instead (exports can't include it): then this returns false.
 */
export async function pickFromUrl(id: ItemId, url: string): Promise<boolean> {
    try {
        await setPick(id, await fetchSpriteBlob(url), { path: url, ck: 1 });
        return true;
    } catch {
        await showRemotePick(id, url, url);
        refreshSprite(id);
        return false;
    }
}

/** "Default": your pack's default for this Pokémon if it has one, otherwise the built-in sprite. */
export async function resetToDefault(id: ItemId): Promise<void> {
    const packDefault = pokedex.pack?.defaults?.[id];
    if (packDefault && state.picks[id]?.path !== packDefault.path) {
        try {
            await applyPackDefaultSprite(id, packDefault);
            autosave();
            toast('Back to the pack default');
            return;
        } catch {}
    }
    await clearPick(id);
    autosave();
    toast('Back to default sprite');
}

/** Gives one item the same picture as another. */
export async function copyPick(to: ItemId, from: ItemId): Promise<void> {
    const blob = spriteBlobs.get(from);
    const pick = state.picks[from];
    const webAddress = pick && /^https:/.test(pick.path) ? pick.path : null;
    if (blob) await setPick(to, blob, { ...pick, path: webAddress || 'custom', ck: 1 });
    else if (webAddress) await pickFromUrl(to, webAddress);
    autosave();
}

// ═════════════════════════════════════════════════════════════════════════════
//  REPAIRS
// ═════════════════════════════════════════════════════════════════════════════

/** Picks matching a test, as [id, pick] pairs. */
const picksWhere = (test: (id: ItemId, pick: Pick) => boolean): [ItemId, Pick][] =>
    Object.entries(state.picks)
        .map(([key, pick]): [ItemId, Pick] => [Number(key), pick])
        .filter(([id, pick]) => !!pick?.path && test(id, pick));

/** Picks whose picture lives somewhere it can be fetched from again (not your own uploads). */
const isRefetchable = (path: string): boolean => path !== 'custom' && !/^(gal|xp):/.test(path);

const HEALING = -1;
/** Sprites that failed to show: id → attempts so far (HEALING while one is running). */
const healAttempts = new Map<ItemId, number>();
const healed = { count: 0, toastTimer: 0 };

/** A sprite that fails to show: rebuild its picture, or fetch it again. Never leave a blank square. */
export async function healSprite(id: ItemId): Promise<void> {
    const pick = state.picks[id];
    const attempts = healAttempts.get(id) || 0;
    if (attempts >= 2 || attempts === HEALING) return showFallbackSprite(id);
    healAttempts.set(id, HEALING);
    const generation = session.generation;
    try {
        const blob = spriteBlobs.get(id);
        // first try: the saved picture is fine, only its address went stale
        if (blob && attempts === 0 && (await isImageBlob(blob))) {
            if (generation !== session.generation) return;
            replaceSpriteUrl(id, objectUrlFor(blob));
            refreshSprite(id);
            return;
        }
        if (!pick?.path || !isRefetchable(pick.path)) {
            if (blob && !(await isImageBlob(blob))) {
                spriteBlobs.delete(id);
                replaceSpriteUrl(id, null); // frees its blob: address too
                await deleteImage(id);
            }
            return showFallbackSprite(id);
        }
        await refetchPick(id, pick, generation);
        if (generation !== session.generation) return;
        healed.count++;
        clearTimeout(healed.toastTimer);
        healed.toastTimer = window.setTimeout(() => {
            if (healed.count) toast(`Repaired ${healed.count} sprite${healed.count > 1 ? 's' : ''} that had stopped showing`);
            healed.count = 0;
        }, 1500);
        autosave();
    } catch {
        showFallbackSprite(id);
        addEventListener(
            'online',
            () => {
                healAttempts.delete(id);
                void healSprite(id);
            },
            { once: true },
        );
    } finally {
        if (healAttempts.get(id) === HEALING) healAttempts.set(id, attempts + 1);
    }
}

/** Can't load right now: show the built-in sprite (your pick is kept and retried later). */
export function showFallbackSprite(id: ItemId): void {
    const img = tileById.get(id)?.querySelector('img');
    const fallback = defaultSpriteUrl(id);
    if (img && fallback && img.src !== fallback) {
        img.dataset.fb = '1';
        img.classList.remove('crop');
        img.style.cssText = '';
        img.src = fallback;
    }
}

/**
 * A list opened from a file has its picks but not their pictures yet. Show each pick straight
 * from where it lives while a copy is fetched, so the default sprite never flashes up first.
 * (A trimmed pick looks a touch smaller once its trimmed copy arrives.)
 */
export function showPicksWhileTheyLoad(): void {
    for (const [key, pick] of Object.entries(state.picks)) {
        const id = Number(key) as ItemId;
        if (spriteBlobs.has(id) || spriteUrls.has(id) || !entryById.has(id)) continue;
        if (!isRefetchable(pick.path) || /^(lore|https?):/.test(pick.path)) continue;
        spriteUrls.set(id, spriteUrlsFor(pick.path)[0]!);
    }
}

/** After opening a list: fetch picked sprites whose saved picture is missing. */
export async function restorePickedSprites(): Promise<void> {
    const todo = picksWhere((id, pick) => !spriteBlobs.has(id) && isRefetchable(pick.path) && entryById.has(id));
    if (!todo.length) return;
    let restored = 0;
    const generation = session.generation;
    setStatus(`Restoring ${todo.length} picked sprites…`);
    // a few at a time, each tried up to three times: big lists shouldn't trip the sprite sites' limits
    const refetchWithRetries = async (id: ItemId, pick: Pick): Promise<void> => {
        for (let attempt = 1; ; attempt++) {
            try {
                return await refetchPick(id, pick, generation);
            } catch (error) {
                if (attempt === 3 || generation !== session.generation) throw error;
                await sleep(1500 * attempt);
            }
        }
    };
    await forEachLimited(todo, 4, async ([id, pick]) => {
        if (generation !== session.generation) return;
        try {
            await refetchWithRetries(id, pick);
            restored++;
        } catch {
            if (/^https?:/.test(pick.path) || pick.remote) {
                spriteUrls.set(id, pick.remote || pick.path);
                setTileImage(id);
            }
        }
    });
    if (generation !== session.generation) return;
    showRankedCount();
    if (restored) {
        autosave();
        toast(`Restored ${restored} picked sprites`);
    }
}

/** The old background-removal feature is gone: picks it changed are fetched again as the original. */
export async function undoBackgroundRemoval(): Promise<void> {
    const generation = session.generation;
    const todo = picksWhere(
        (id, pick) => !!(pick.bg || pick.keepbg || pick.bgck) && !isOwnItem(id) && !/^(gal:|custom|https?:)/.test(pick.path),
    );
    if (!todo.length) return;
    await forEachLimited(todo, 4, async ([id, pick]) => {
        if (generation !== session.generation) return;
        const { bg, keepbg: _keepbg, bgck: _bgck, ...cleaned } = pick;
        if (!bg) {
            state.picks[id] = cleaned;
            return;
        }
        try {
            await pickSprite(id, pick.path, { quiet: true });
        } catch {
            state.picks[id] = cleaned;
        }
    });
    if (generation !== session.generation) return;
    autosave();
}

/** Older versions flattened animated picks (GIF, APNG, WebP, Showdown sprites) when trimming; fetch those again so they move. */
export async function repairAnimatedPicks(): Promise<void> {
    const todo = picksWhere(
        (id, pick) =>
            !pick.ck &&
            !isOwnItem(id) &&
            !!pick.trim &&
            !/^(gal:|custom|https?:)/.test(pick.path) &&
            (/\/(animated|showdown)\//.test(pick.path) || /\.(webp|gif)$/.test(pick.path)),
    );
    if (!todo.length) return;
    let repaired = 0;
    const generation = session.generation;
    await forEachLimited(todo, 4, async ([id, pick]) => {
        if (generation !== session.generation) return;
        try {
            await pickSprite(id, pick.path, { quiet: true });
            if (state.picks[id]?.anim) repaired++;
        } catch {}
    });
    autosave();
    if (repaired) toast(`Restored animation for ${repaired} sprite${repaired > 1 ? 's' : ''}`);
}
