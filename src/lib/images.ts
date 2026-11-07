// src/lib/images.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Working with pictures: is a file really an image, is it animated, trimming
//  empty borders, and showing pictures from files. No app knowledge lives here.
//
//  Pictures come from websites and from files people pick, so nothing here trusts
//  them: the real type is read from the file's first bytes (never its name), and
//  pictures too big to handle safely are left alone instead of crashing the tab.
// ─────────────────────────────────────────────────────────────────────────────

/** Part of a picture to show, in the picture's own pixels (W×H = the whole picture). */
export interface Crop {
    x: number;
    y: number;
    w: number;
    h: number;
    W: number;
    H: number;
}

export const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
};
export const EXT_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
};

/** Largest picture file accepted from an upload or a website (sprites and artwork are far smaller). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Largest picture (in pixels) worked on with a canvas; bigger ones are used as they are. */
const MAX_CANVAS_PIXELS = 40_000_000; // ≈ 6300 × 6300
/** Largest picture (in pixels) accepted at all: decoding one takes 4 bytes a pixel. */
const MAX_PICTURE_PIXELS = 50_000_000; // a 48-megapixel phone photo fits; 200 MB once decoded

/** "dir/25.png?x" → "png". */
export const extensionOf = (path: string): string => (String(path).split('?')[0]!.split('.').pop() || '').toLowerCase();

/** Small pixel-art sprites stay crisp when scaled up (CSS class "px"). */
export function markPixelArt(img: HTMLImageElement): void {
    img.classList.toggle('px', img.naturalWidth > 0 && img.naturalWidth <= 200);
}

/**
 * Picture events for HTML built from templates. Inline handlers (onload="…") are blocked by
 * the site's security policy, so templates mark images with attributes instead:
 *   data-px    small pixel-art sprite: keep it crisp when scaled up
 *   data-miss  hide the card if the picture can't load
 * load/error don't bubble, so these listen in the capture phase.
 */
export function watchImageEvents(): void {
    document.addEventListener(
        'load',
        (e) => {
            if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-px')) markPixelArt(e.target);
        },
        true,
    );
    document.addEventListener(
        'error',
        (e) => {
            if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-miss'))
                e.target.closest('.vc')?.classList.add('missing');
        },
        true,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  WHAT A FILE REALLY IS
// ═════════════════════════════════════════════════════════════════════════════

export type ImageKind = 'png' | 'gif' | 'jpg' | 'bmp' | 'webp' | 'avif' | 'svg';

/**
 * The picture type from a file's first bytes, or null if it isn't a picture.
 * Mirrors sometimes answer "200 OK" with an error page; that must never be saved as a sprite.
 */
export function sniffImageType(bytes: Uint8Array): ImageKind | null {
    if (!bytes || bytes.length < 4) return null;
    const startsWith = (...signature: number[]) => signature.every((b, i) => bytes[i] === b);
    if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'png';
    if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'gif';
    if (startsWith(0xff, 0xd8, 0xff)) return 'jpg';
    if (startsWith(0x42, 0x4d)) return 'bmp';
    if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return 'webp';
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'avif';
    const text = String.fromCharCode(...bytes.subarray(0, 64))
        .replace(/^﻿/, '')
        .trimStart()
        .toLowerCase();
    if (text.startsWith('<svg') || (text.startsWith('<?xml') && !text.includes('<html')) || text.startsWith('<!-- ')) return 'svg';
    return null;
}

/**
 * Width and height from a picture's header, without decoding it, or null if the header doesn't say.
 * A tiny file can claim to be 60,000 pixels square ("decompression bomb"), so size is checked first.
 */
export function headerSize(bytes: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fits = (end: number) => end <= bytes.length;
    switch (kind) {
        case 'png': // IHDR is always the first chunk
            return fits(24) ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
        case 'gif':
            return fits(10) ? { width: view.getUint16(6, true), height: view.getUint16(8, true) } : null;
        case 'bmp':
            return fits(26) ? { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) } : null;
        case 'webp': {
            if (!fits(30)) return null;
            const chunk = String.fromCharCode(...bytes.subarray(12, 16));
            if (chunk === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(26, true) >>> 8) };
            if (chunk === 'VP8L') {
                const bits = view.getUint32(21, true);
                return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
            }
            return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        }
        case 'jpg': // walk the segments to the frame header
            for (let at = 2; fits(at + 9); ) {
                if (bytes[at] !== 0xff) return null;
                const marker = bytes[at + 1]!;
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
                    return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
                at += 2 + view.getUint16(at + 2);
            }
            return null;
        case 'avif': {
            const at = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 4096))).indexOf('ispe');
            return at > 0 && fits(at + 16) ? { width: view.getUint32(at + 8), height: view.getUint32(at + 12) } : null;
        }
        case 'svg':
            return null; // drawn at a fixed size anyway
    }
}

export async function isImageBlob(blob: Blob): Promise<boolean> {
    try {
        return !!sniffImageType(new Uint8Array(await blob.slice(0, 64).arrayBuffer()));
    } catch {
        return false;
    }
}

/** Animated GIF / APNG / WebP: these must never go through a canvas (that keeps only frame 1). */
export async function isAnimatedBlob(blob: Blob): Promise<boolean> {
    try {
        const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
        const text = String.fromCharCode(...bytes);
        if (text.startsWith('GIF8')) return true;
        if (text.startsWith('\x89PNG')) return await hasPngAnimationChunk(blob);
        if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP')
            return (text.slice(12, 16) === 'VP8X' && (bytes[20]! & 2) !== 0) || (text.indexOf('ANIM') > 0 && text.indexOf('ANIM') < 256);
        // an AVIF image sequence says so in its file-type box ("avis")
        if (text.slice(4, 8) === 'ftyp') return text.slice(8, Math.min(text.length, 64)).includes('avis');
    } catch {}
    return false;
}

/** APNG: an animation chunk (acTL) before the first frame. Big metadata can push it well past the start, so walk the chunks. */
async function hasPngAnimationChunk(blob: Blob): Promise<boolean> {
    const view = new DataView(await blob.slice(0, 1024 * 1024).arrayBuffer());
    for (let at = 8; at + 8 <= view.byteLength; ) {
        const length = view.getUint32(at);
        const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
        if (type === 'acTL') return true;
        if (type === 'IDAT') return false;
        at += 12 + length; // length, type, data, checksum
    }
    return false;
}

const MIME_BY_KIND: Record<ImageKind, string> = {
    png: 'image/png',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    bmp: 'image/bmp',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
};

/**
 * A picture from somewhere untrusted (an upload, a paste, a shared file, any website) made
 * safe to keep: null if it isn't really a picture or is too big, otherwise the picture with
 * its real type. SVGs are redrawn as PNGs: an SVG can carry scripts, a PNG can't.
 */
export async function checkedImage(blob: Blob): Promise<Blob | null> {
    if (blob.size > MAX_IMAGE_BYTES) return null;
    let head: Uint8Array;
    try {
        head = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
    } catch {
        return null;
    }
    const kind = sniffImageType(head);
    if (!kind) return null;
    if (kind === 'svg') return svgToPng(blob);
    const size = headerSize(head, kind) ?? (await measuredSize(blob));
    if (!size || size.width * size.height > MAX_PICTURE_PIXELS) return null;
    return blob.type === MIME_BY_KIND[kind] ? blob : new Blob([blob], { type: MIME_BY_KIND[kind] });
}

/**
 * A picture's size from the browser, for the few files whose header I can't read (some AVIFs). An <img>
 * learns its size from the header without decoding the pixels, so a huge picture is caught before it fills memory.
 */
function measuredSize(blob: Blob): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        const finish = (size: { width: number; height: number } | null) => {
            URL.revokeObjectURL(url);
            resolve(size);
        };
        img.onload = () => finish(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
        img.onerror = () => finish(null);
        img.src = url;
    });
}

/** Draws an SVG into a PNG (at most 512 px on its longest side). Shown as an <img>, its scripts never run. */
function svgToPng(svg: Blob, maxSide = 512): Promise<Blob | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        const img = new Image();
        const finish = (result: Blob | null) => {
            URL.revokeObjectURL(url);
            resolve(result);
        };
        img.onerror = () => finish(null);
        img.onload = () => {
            const width = img.naturalWidth || maxSide;
            const height = img.naturalHeight || maxSide;
            const scale = maxSide / Math.max(width, height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(finish, 'image/png');
        };
        img.src = url;
    });
}

/** The pictures among picked, pasted or dropped files, checked as above (anything else is skipped). */
export async function checkedImageFiles(files: Iterable<File>): Promise<Blob[]> {
    const pictures: Blob[] = [];
    for (const file of files) {
        const picture = await checkedImage(file);
        if (picture) pictures.push(picture);
    }
    return pictures;
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMPTY BORDERS
// ═════════════════════════════════════════════════════════════════════════════

/** A picture drawn on a canvas, or null if it can't be decoded or is too big to handle safely. */
async function toCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        return null;
    }
    if (bitmap.width * bitmap.height > MAX_CANVAS_PIXELS) {
        bitmap.close();
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
}

/** The smallest box holding every visible pixel (alpha > 8), or null if the picture is empty. */
function visibleBounds(canvas: HTMLCanvasElement): { x0: number; y0: number; x1: number; y1: number } | null {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (pixels[(y * width + x) * 4 + 3]! > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** The picture with its empty border cut off, centred on a square with 1 px to spare. */
export async function trimTransparentEdges(blob: Blob): Promise<Blob> {
    const canvas = await toCanvas(blob);
    if (!canvas) return blob;
    const box = visibleBounds(canvas);
    if (!box || (box.x0 === 0 && box.y0 === 0 && box.x1 === canvas.width - 1 && box.y1 === canvas.height - 1)) return blob;
    const width = box.x1 - box.x0 + 1;
    const height = box.y1 - box.y0 + 1;
    const side = Math.max(width, height) + 2;
    const square = document.createElement('canvas');
    square.width = side;
    square.height = side;
    square
        .getContext('2d')!
        .drawImage(canvas, box.x0, box.y0, width, height, Math.floor((side - width) / 2), Math.floor((side - height) / 2), width, height);
    return new Promise((resolve) => square.toBlob((trimmed) => resolve(trimmed || blob), 'image/png'));
}

/**
 * Where the visible part of an animated picture's first frame is (2 px padding so later
 * frames that move a little aren't clipped). Used to crop animated sprites on screen.
 */
export async function opaqueBounds(blob: Blob): Promise<Crop | null> {
    const canvas = await toCanvas(blob);
    if (!canvas) return null;
    const box = visibleBounds(canvas);
    if (!box) return null;
    const { width: W, height: H } = canvas;
    const x0 = Math.max(0, box.x0 - 2);
    const y0 = Math.max(0, box.y0 - 2);
    const x1 = Math.min(W - 1, box.x1 + 2);
    const y1 = Math.min(H - 1, box.y1 + 2);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, W, H };
}

// ═════════════════════════════════════════════════════════════════════════════
//  SMALLER COPIES
// ═════════════════════════════════════════════════════════════════════════════

/** The size a picture shrinks to so its longest side is `maxSide` (shape kept), or null if it already fits. */
export function shrunkSize(width: number, height: number, maxSide: number): { width: number; height: number } | null {
    const longest = Math.max(width, height);
    if (!(longest > maxSide)) return null;
    const scale = maxSide / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The picture at most `maxSide` pixels on its longest side, in its own format where the browser can
 * write it (JPEG and WebP stay so, anything else becomes PNG). A 2000 px photo takes 16 MB once
 * decoded, a 1024 px copy 4 MB, and it saves and loads that much faster. Kept as it is when it
 * already fits, is animated (a canvas keeps only frame 1), can't be decoded, or the copy isn't smaller.
 * A phone photo's rotation (EXIF) is applied, as it is on screen.
 */
export async function shrinkPicture(blob: Blob, maxSide: number): Promise<Blob> {
    try {
        const head = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
        const kind = sniffImageType(head);
        const header = kind && headerSize(head, kind);
        if (!kind || kind === 'svg' || (header && !shrunkSize(header.width, header.height, maxSide)) || (await isAnimatedBlob(blob)))
            return blob;
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const size = shrunkSize(bitmap.width, bitmap.height, maxSide);
        if (!size) {
            bitmap.close();
            return blob;
        }
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const g = canvas.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(bitmap, 0, 0, size.width, size.height);
        bitmap.close(); // the full-size pixels go now, not at the next garbage collection
        const type = blob.type === 'image/jpeg' || blob.type === 'image/webp' ? blob.type : 'image/png';
        const smaller = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
        canvas.width = canvas.height = 0; // and the canvas's copy
        return smaller && smaller.size < blob.size ? smaller : blob;
    } catch {
        return blob;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHOWING PICTURES
// ═════════════════════════════════════════════════════════════════════════════

/** An address the page can show a picture file at (free it with URL.revokeObjectURL when done). */
export const objectUrlFor = (blob: Blob): string => URL.createObjectURL(blob);

/**
 * A data: address back into a picture file, without fetch (the security policy lets the
 * site fetch only https). Null if it isn't a base64 data: address.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
    const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl);
    if (!match) return null;
    try {
        const text = atob(match[2]!.replace(/\s/g, ''));
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
        return new Blob([bytes], { type: match[1] });
    } catch {
        return null;
    }
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

/**
 * The first of these addresses that loads as a picture (without downloading it ourselves).
 * Used for sites that let pictures be shown but not copied.
 */
export function firstLoadableUrl(urls: readonly string[], timeoutMs = 9000): Promise<string | null> {
    return new Promise((resolve) => {
        let next = 0;
        const tryNext = () => {
            if (next >= urls.length) return resolve(null);
            const url = urls[next++]!;
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            const timer = setTimeout(() => {
                img.src = '';
                tryNext();
            }, timeoutMs);
            img.onload = () => {
                clearTimeout(timer);
                resolve(url);
            };
            img.onerror = () => {
                clearTimeout(timer);
                tryNext();
            };
            img.src = url;
        };
        tryNext();
    });
}
