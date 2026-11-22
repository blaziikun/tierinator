// src/lib/zip.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Reading and writing .zip files (list bundles, sprite packs, sprite folders).
//
//  Reading is lazy: only the zip's table of contents is read up front, and each
//  file is unpacked when asked for. A 500 MB sprite zip costs almost no memory
//  until you open a sprite from it.
//
//  Safety rules (zips are untrusted files people choose):
//    - a file that claims to unpack to more than MAX_ENTRY_BYTES is refused (zip bomb)
//    - paths with "..", a leading "/" or a drive letter are skipped (path traversal)
//    - anything malformed throws a ZipError with a plain-English message
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // one picture or JSON file: 64 MB is plenty
const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

export class ZipError extends Error {}

interface Entry {
    method: number; // 0 = stored, 8 = deflated
    packedSize: number;
    size: number;
    headerOffset: number;
}

export interface ZipArchive {
    /** Every file path in the zip (folders left out), in the zip's order. */
    readonly paths: string[];
    has(path: string): boolean;
    readBytes(path: string): Promise<Uint8Array>;
    readText(path: string): Promise<string>;
    readBlob(path: string, type: string): Promise<Blob>;
}

/** Opens a zip without unpacking anything yet. */
export async function openZipArchive(file: Blob): Promise<ZipArchive> {
    const { inflateSync } = await import('fflate'); // the zip library downloads the first time a zip is used
    // 1. Find the "end of central directory" record in the last 64 KB
    const tailStart = Math.max(0, file.size - 65_557);
    const tail = new DataView(await file.slice(tailStart).arrayBuffer());
    let end = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === END_OF_DIRECTORY) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new ZipError('That file is not a zip, or it is damaged.');
    const count = tail.getUint16(end + 10, true);
    const dirSize = tail.getUint32(end + 12, true);
    const dirOffset = tail.getUint32(end + 16, true);
    if (dirOffset === 0xffffffff) throw new ZipError('Zips over 4 GB are not supported.');

    // 2. Read the table of contents
    const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
    const names = new TextDecoder();
    const entries = new Map<string, Entry>();
    let at = 0;
    for (let n = 0; n < count && at + 46 <= dir.byteLength; n++) {
        if (dir.getUint32(at, true) !== DIRECTORY_ENTRY) throw new ZipError('The zip is damaged.');
        const nameLength = dir.getUint16(at + 28, true);
        const extraLength = dir.getUint16(at + 30, true);
        const commentLength = dir.getUint16(at + 32, true);
        const path = names.decode(new Uint8Array(dir.buffer, at + 46, nameLength));
        const entry: Entry = {
            method: dir.getUint16(at + 10, true),
            packedSize: dir.getUint32(at + 20, true),
            size: dir.getUint32(at + 24, true),
            headerOffset: dir.getUint32(at + 42, true),
        };
        at += 46 + nameLength + extraLength + commentLength;
        if (path.endsWith('/') || !isSafePath(path)) continue;
        entries.set(path.replace(/\\/g, '/'), entry);
    }

    // 3. Unpack one file on demand
    async function readBytes(path: string): Promise<Uint8Array> {
        const entry = entries.get(path);
        if (!entry) throw new ZipError(`"${path}" is not in the zip.`);
        if (entry.size > MAX_ENTRY_BYTES) throw new ZipError(`"${path}" is too big to open.`);
        const header = new DataView(await file.slice(entry.headerOffset, entry.headerOffset + 30).arrayBuffer());
        if (header.getUint32(0, true) !== LOCAL_HEADER) throw new ZipError('The zip is damaged.');
        const dataStart = entry.headerOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const packed = new Uint8Array(await file.slice(dataStart, dataStart + entry.packedSize).arrayBuffer());
        if (entry.method === 0) return packed;
        if (entry.method === 8) return inflateSync(packed, { out: new Uint8Array(entry.size) });
        throw new ZipError(`"${path}" uses a compression this app can't read.`);
    }

    return {
        paths: [...entries.keys()],
        has: (path) => entries.has(path),
        readBytes,
        readText: async (path) => new TextDecoder().decode(await readBytes(path)),
        readBlob: async (path, type) => new Blob([(await readBytes(path)) as Uint8Array<ArrayBuffer>], { type }),
    };
}

/** Builds a zip. Pictures are stored as-is (already compressed), text is deflated. */
export async function createZip(files: Record<string, Blob | string>): Promise<Blob> {
    const { strToU8, zipSync } = await import('fflate');
    const input: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
    for (const [path, data] of Object.entries(files)) {
        input[path] = typeof data === 'string' ? [strToU8(data), { level: 6 }] : [new Uint8Array(await data.arrayBuffer()), { level: 0 }];
    }
    return new Blob([zipSync(input)], { type: 'application/zip' });
}

// ".." segments, "/abs/path" or "C:\" would point outside the zip
function isSafePath(path: string): boolean {
    return !/(^|[\\/])\.\.([\\/]|$)/.test(path) && !/^([\\/]|[a-z]:)/i.test(path);
}
