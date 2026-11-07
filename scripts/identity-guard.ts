// scripts/identity-guard.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The identity guard: fails if any of my private words (names, old usernames,
//  personal addresses: anything I keep apart from "sayel") shows up where it
//  would become public: the repository's files and every earlier version of them,
//  file names, names and emails on commits and tags, commit messages, branch and
//  tag names, picture metadata, and the built site. The words never live in the
//  repository: they come from PRIVATE_WORDS (CI's secret) and from
//  ~/.config/sayel/private-words on my own computer. It never prints a word.
//      pnpm guard            the repository and its history
//      pnpm guard --dist     the built site too (after pnpm build)
//  What it matches and what it can't catch: docs/security.md {8}.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

/** My words on my own computer, one per line: outside the repository, so they can't be committed by mistake. */
export const WORDS_FILE = join('.config', 'sayel', 'private-words');
const WORDS_FILE_SHOWN = '~/.config/sayel/private-words';
/** Fewer letters than this would match all over the place ("Li" is in every <li>). */
const SHORTEST_WORD = 3;
/** Longer than any name; keeps every possible match well inside OVERLAP. */
const LONGEST_WORD = 200;
/** Files are read this much at a time, so a big one never has to fit in memory at once. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Each window of text repeats this much of the last one, so a match cut in two by a chunk is whole in one window. */
const OVERLAP = 2048;
/** Pictures up to this size are taken apart for their metadata; bigger ones are read like any other binary file. */
const PICTURE_PARSE_LIMIT = 64 * 1024 * 1024;
/** A compressed metadata chunk may unpack to this much at most (a tiny chunk can claim gigabytes). */
const INFLATE_LIMIT = 16 * 1024 * 1024;
/** Blobs in the history bigger than this are reported as unchecked rather than read. */
const HISTORY_BLOB_LIMIT = 256 * 1024 * 1024;
/** History is read from git this many bytes at a time. */
const BLOB_BATCH_BYTES = 64 * 1024 * 1024;
/** Never the repository's own files, when there's no git to ask (anywhere for the first two, at the top for the rest). */
const NEVER_OURS = new Set(['.git', 'node_modules']);
const NOT_OURS_AT_TOP = new Set(['dist', 'test-results', 'playwright-report', '.wrangler']);

// ═════════════════════════════════════════════════════════════════════════════
//  THE WORDS AND HOW THEY'RE MATCHED
// ═════════════════════════════════════════════════════════════════════════════

/** "a, b\nc" → ['a', 'b', 'c']: one per line or comma-separated; blank lines and lines starting with # are skipped. */
export function parsePrivateWords(text: string): string[] {
    return text
        .split(/[\n,]/)
        .map((word) => word.trim())
        .filter((word) => word && !word.startsWith('#'));
}

interface WordList {
    words: string[];
    /** Where they came from, with how many from each: for the first line of the report. */
    sources: string[];
}

/** The words from PRIVATE_WORDS, then those from the file in my home folder (numbered in that order). */
export function readPrivateWords(env: Record<string, string | undefined>, home: string): WordList {
    const fromEnvironment = parsePrivateWords(env.PRIVATE_WORDS ?? '');
    const file = join(home, WORDS_FILE);
    const fromFile = existsSync(file) ? parsePrivateWords(readFileSync(file, 'utf8')) : [];
    const sources = [
        ...(fromEnvironment.length ? [`${fromEnvironment.length} from PRIVATE_WORDS`] : []),
        ...(fromFile.length ? [`${fromFile.length} from ${WORDS_FILE_SHOWN}`] : []),
    ];
    return { words: [...fromEnvironment, ...fromFile], sources };
}

/** Letters that keep their own identity through Unicode decomposition, as people type them without the accent. */
const PLAIN_LETTERS: Record<string, string> = {
    ß: 'ss',
    æ: 'ae',
    œ: 'oe',
    ø: 'o',
    ł: 'l',
    đ: 'd',
    ð: 'd',
    þ: 'th',
    ı: 'i',
    ħ: 'h',
    ŧ: 't',
};

/**
 * Text as the matcher sees it: one way of writing each letter. Line breaks survive, so line numbers
 * still count; lengths don't, so positions in the result aren't positions in the original.
 */
export function foldText(text: string): string {
    return text
        .normalize('NFKC') // full-width letters, ligatures and no-break spaces become their plain forms
        .replace(/\p{Cf}/gu, '') // zero-width spaces and soft hyphens can hide inside a word
        .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2') // camelCase: janeDoe is two words
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '') // accents off: é → e, so "Jose" and "José" are the same word
        .replace(/[ßæœøłđðþıħŧ]/g, (letter) => PLAIN_LETTERS[letter]!);
}

/** What may sit between two letters of one word: j.o.h.n, Smith-Jones, O'Brien. A few at most. */
const INSIDE_A_WORD = "[\\s._'’\\u2010-\\u2015-]{0,3}";
/** What may sit between the words of a phrase: nothing, spaces, a line break and the next line's comment marker, an email's @. */
const BETWEEN_WORDS = "[\\s._'’\\u2010-\\u2015@+/#*>-]{0,40}";
/** Scripts written without spaces between words: a name in them has no word boundary to look for. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/**
 * The pattern for one private word or phrase, matched against folded text: its letters in order, whole
 * words only (so "Ann" doesn't match "annual"), with separators allowed inside and between words.
 * Undefined when it's too short to match safely, or too long to be a name.
 */
export function wordPattern(word: string): RegExp | undefined {
    const parts = foldText(word)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .map((part) => [...part]);
    const letters = parts.flat();
    if (letters.length < SHORTEST_WORD || letters.length > LONGEST_WORD) return undefined;
    // only letters and digits are left, so nothing needs escaping
    const body = parts.map((part) => part.join(INSIDE_A_WORD)).join(BETWEEN_WORDS);
    const before = UNSPACED_SCRIPT.test(letters[0]!) ? '' : '(?<![\\p{L}\\p{N}])';
    const after = UNSPACED_SCRIPT.test(letters.at(-1)!) ? '' : '(?![\\p{L}\\p{N}])';
    return new RegExp(`${before}(?:${body})${after}`, 'gu');
}

interface PrivateWord {
    /** Its place in the list, counted from 1: the only thing ever printed about it. */
    number: number;
    pattern: RegExp;
}

/** Every private word number found in a short piece of text (a name, an email, a path). */
function wordsIn(text: string, words: PrivateWord[]): number[] {
    const folded = foldText(text);
    return words.filter((word) => folded.search(word.pattern) !== -1).map((word) => word.number);
}

const countLineBreaks = (text: string, end: number): number => {
    let count = 0;
    for (let at = text.indexOf('\n'); at !== -1 && at < end; at = text.indexOf('\n', at + 1)) count++;
    return count;
};

interface Hit {
    word: number;
    line: number;
}

/**
 * Finds private words in text that arrives in pieces (a big file, a chunk at a time). Each window is the
 * end of the last one plus the new piece; a match near the end waits for the next window, where it's whole.
 */
function textScanner(words: PrivateWord[]): { add(piece: string): void; end(): Hit[] } {
    let carried = '';
    let carriedLine = 1;
    let firstWindow = true;
    const hits = new Map<string, Hit>();
    const look = (window: string, last: boolean): void => {
        // a carried window's first character was looked at last time; it's only here as the boundary before the next
        const from = firstWindow ? 0 : 1;
        const until = last ? window.length : window.length - OVERLAP;
        for (const word of words) {
            for (const match of window.matchAll(word.pattern)) {
                if (match.index < from || match.index >= until) continue;
                const line = carriedLine + countLineBreaks(window, match.index);
                hits.set(`${word.number}:${line}`, { word: word.number, line });
            }
        }
    };
    return {
        add(piece) {
            const window = carried + foldText(piece);
            if (window.length <= OVERLAP + 1) {
                carried = window;
                return;
            }
            look(window, false);
            const keep = window.length - OVERLAP - 1;
            carriedLine += countLineBreaks(window, keep);
            carried = window.slice(keep);
            firstWindow = false;
        },
        end() {
            look(carried, true);
            return [...hits.values()].sort((a, b) => a.line - b.line || a.word - b.word);
        },
    };
}

/** Private words in one string, by line. */
export function findInText(text: string, words: PrivateWord[]): Hit[] {
    const scanner = textScanner(words);
    scanner.add(text);
    return scanner.end();
}

/** The numbered patterns, or the numbers of words that can't be matched safely. */
export function compileWords(list: string[]): { words: PrivateWord[]; unusable: number[] } {
    const words: PrivateWord[] = [];
    const unusable: number[] = [];
    list.forEach((word, index) => {
        const pattern = wordPattern(word);
        if (pattern) words.push({ number: index + 1, pattern });
        else unusable.push(index + 1);
    });
    return { words, unusable };
}

// ═════════════════════════════════════════════════════════════════════════════
//  READING FILES: TEXT, PICTURES, ANYTHING ELSE
// ═════════════════════════════════════════════════════════════════════════════

/** Where the bytes come from: a file read a chunk at a time, or a blob already in memory. Can be read more than once. */
type Bytes = { size: number; chunks(): Iterable<Uint8Array>; all(): Uint8Array };

function fileBytes(path: string, size: number): Bytes {
    return {
        size,
        *chunks() {
            const file = openSync(path, 'r');
            try {
                const buffer = Buffer.alloc(CHUNK_BYTES);
                for (let read = readSync(file, buffer); read > 0; read = readSync(file, buffer)) yield buffer.subarray(0, read);
            } finally {
                closeSync(file);
            }
        },
        all: () => readFileSync(path),
    };
}

function memoryBytes(data: Uint8Array): Bytes {
    return {
        size: data.length,
        *chunks() {
            for (let start = 0; start < data.length; start += CHUNK_BYTES) yield data.subarray(start, start + CHUNK_BYTES);
        },
        all: () => data,
    };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (data: Uint8Array, signature: number[]): boolean => signature.every((byte, index) => data[index] === byte);

/** A piece of a picture's metadata, still as bytes: its text could be in any encoding. */
interface MetadataPiece {
    where: string;
    data: Uint8Array;
}

const latin1 = (data: Uint8Array): string => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('latin1');

/** Unpacks a compressed chunk, refusing to grow past INFLATE_LIMIT (docs/security.md {8} lists that as a limit). */
function inflated(data: Uint8Array): Uint8Array | undefined {
    try {
        return inflateSync(data, { maxOutputLength: INFLATE_LIMIT });
    } catch {
        return undefined;
    }
}

/**
 * A PNG's metadata: every chunk except the picture itself (IDAT, and APNG's frames), with the compressed
 * ones unpacked as well: zTXt and compressed iTXt text, and the colour profile in iCCP (which has a copyright line).
 */
export function pngMetadata(png: Uint8Array): MetadataPiece[] {
    const pieces: MetadataPiece[] = [];
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    for (let at = 8; at + 12 <= png.length; ) {
        const length = view.getUint32(at);
        const type = latin1(png.subarray(at + 4, at + 8));
        const data = png.subarray(at + 8, Math.min(at + 8 + length, png.length));
        at += 12 + length;
        if (type === 'IDAT' || type === 'fdAT') continue;
        if (type === 'IEND') break;
        const where = `PNG ${type} chunk`;
        pieces.push({ where, data });
        const keywordEnd = data.indexOf(0);
        if (keywordEnd === -1) continue;
        // zTXt and iCCP: keyword, 0, method, compressed data. iTXt: keyword, 0, compressed?, method, language, 0, translated keyword, 0, text
        let compressed: Uint8Array | undefined;
        if (type === 'zTXt' || type === 'iCCP') compressed = data.subarray(keywordEnd + 2);
        if (type === 'iTXt' && data[keywordEnd + 1] === 1) {
            const languageEnd = data.indexOf(0, keywordEnd + 3);
            const translatedEnd = languageEnd === -1 ? -1 : data.indexOf(0, languageEnd + 1);
            if (translatedEnd !== -1) compressed = data.subarray(translatedEnd + 1);
        }
        const unpacked = compressed && inflated(compressed);
        if (unpacked) pieces.push({ where: `${where} (unpacked)`, data: unpacked });
    }
    return pieces;
}

/** What each kind of JPEG segment usually holds, for the report. */
function jpegSegmentName(marker: number, data: Uint8Array): string {
    if (marker === 0xfe) return 'JPEG comment';
    const start = latin1(data.subarray(0, 32));
    if (marker === 0xe1 && start.startsWith('Exif')) return 'JPEG Exif metadata';
    if (marker === 0xe1 && start.startsWith('http://ns.adobe.com/xap/')) return 'JPEG XMP metadata';
    if (marker === 0xed) return 'JPEG IPTC metadata';
    return `JPEG APP${marker - 0xe0} segment`;
}

/** A JPEG's metadata: its APP segments (Exif, XMP, IPTC, …) and comments, up to where the picture data starts. */
export function jpegMetadata(jpeg: Uint8Array): MetadataPiece[] {
    const pieces: MetadataPiece[] = [];
    for (let at = 2; at + 4 <= jpeg.length; ) {
        if (jpeg[at] !== 0xff) break; // not a segment: a broken file, so the generic reading below covers it
        const marker = jpeg[at + 1]!;
        if (marker === 0xff) {
            at++; // padding
            continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            at += 2; // markers without a length
            continue;
        }
        if (marker === 0xda || marker === 0xd9) break; // the picture data, or the end
        const length = (jpeg[at + 2]! << 8) | jpeg[at + 3]!;
        const data = jpeg.subarray(at + 4, Math.min(at + 2 + length, jpeg.length));
        if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) pieces.push({ where: jpegSegmentName(marker, data), data });
        at += 2 + length;
    }
    return pieces;
}

/**
 * Bytes whose encoding isn't known, read every way text is usually stored: Latin-1, UTF-8, and UTF-16
 * from both even and odd bytes (Windows keeps a picture's author as UTF-16). Other bytes break a word apart.
 */
function binaryHits(bytes: Iterable<Uint8Array>, words: PrivateWord[]): Hit[] {
    const readings = [
        { decoder: new TextDecoder('latin1'), skip: 0 },
        { decoder: new TextDecoder('utf-8'), skip: 0 },
        { decoder: new TextDecoder('utf-16le'), skip: 0 },
        { decoder: new TextDecoder('utf-16le'), skip: 1 },
    ].map((reading) => ({ ...reading, scanner: textScanner(words) }));
    let first = true;
    for (const chunk of bytes) {
        for (const reading of readings) {
            reading.scanner.add(reading.decoder.decode(first ? chunk.subarray(reading.skip) : chunk, { stream: true }));
        }
        first = false;
    }
    const found = new Set<number>();
    for (const reading of readings) {
        reading.scanner.add(reading.decoder.decode());
        for (const hit of reading.scanner.end()) found.add(hit.word);
    }
    return [...found].sort((a, b) => a - b).map((word) => ({ word, line: 0 }));
}

/** Text in one encoding, a chunk at a time; undefined if it turns out not to be valid in that encoding. */
function textHits(bytes: Bytes, encoding: 'utf-8' | 'latin1', words: PrivateWord[]): Hit[] | undefined {
    const decoder = new TextDecoder(encoding, { fatal: true });
    const scanner = textScanner(words);
    try {
        for (const chunk of bytes.chunks()) scanner.add(decoder.decode(chunk, { stream: true }));
        scanner.add(decoder.decode());
    } catch {
        return undefined;
    }
    return scanner.end();
}

interface Place {
    /** e.g. "src/main.ts:12", "public/og.png: PNG tEXt chunk", or "commit 1a2b3c4: author email". */
    where: string;
    word: number;
}

/**
 * Every private word in one file's content: by line for text, by metadata piece for PNG and JPEG
 * pictures, and anywhere in the bytes for other binary files (fonts, icons, GIF and WebP metadata…).
 */
function contentPlaces(name: string, bytes: Bytes, words: PrivateWord[]): Place[] {
    const head = firstChunk(bytes);
    const isPicture = startsWith(head, PNG_SIGNATURE) || startsWith(head, [0xff, 0xd8, 0xff]);
    if (isPicture && bytes.size <= PICTURE_PARSE_LIMIT) {
        const data = bytes.all();
        const pieces = startsWith(head, PNG_SIGNATURE) ? pngMetadata(data) : jpegMetadata(data);
        return pieces.flatMap((piece) =>
            binaryHits([piece.data], words).map((hit) => ({ where: `${name}: ${piece.where}`, word: hit.word })),
        );
    }
    // a zero byte near the start means binary; text files never have one
    if (head.subarray(0, 8000).includes(0) || isPicture) {
        return binaryHits(bytes.chunks(), words).map((hit) => ({ where: `${name}: in its binary content`, word: hit.word }));
    }
    // UTF-8 almost always; an old file in Latin-1 (Windows-1252) isn't valid UTF-8, so it's read that way instead
    const hits = textHits(bytes, 'utf-8', words) ?? textHits(bytes, 'latin1', words) ?? [];
    return hits.map((hit) => ({ where: `${name}:${hit.line}`, word: hit.word }));
}

/** The start of the content, closing the file again straight away. */
function firstChunk(bytes: Bytes): Uint8Array {
    const chunks = bytes.chunks()[Symbol.iterator]();
    try {
        return chunks.next().value ?? new Uint8Array();
    } finally {
        chunks.return?.();
    }
}

/**
 * A path for the report, with any part that matches a private word hidden: the path itself mustn't print the word.
 * A phrase split over folders ("jane/doe") matches no single part, so then the whole path is hidden.
 */
function shownPath(path: string, words: PrivateWord[]): string {
    const shown = path
        .split('/')
        .map((part) => (wordsIn(part, words).length ? '[hidden]' : part))
        .join('/');
    return wordsIn(shown, words).length ? '[hidden path]' : shown;
}

/** The places a private word appears in a file's name: the whole path, so a word split over two folders counts too. */
function pathPlaces(path: string, words: PrivateWord[]): Place[] {
    return wordsIn(path, words).map((word) => ({ where: `${shownPath(path, words)}: its name`, word }));
}

/** Git's id for these bytes, to recognise the same content in the history without reading it twice. */
function gitBlobId(bytes: Bytes): string {
    const hash = createHash('sha1').update(`blob ${bytes.size}\0`);
    for (const chunk of bytes.chunks()) hash.update(chunk);
    return hash.digest('hex');
}

/** One file or symbolic link on disk. Links are never followed; where they point is checked as text. */
function filePlaces(root: string, path: string, words: PrivateWord[], blobIds?: Set<string>): Place[] {
    const full = join(root, ...path.split('/'));
    let stats: ReturnType<typeof lstatSync>;
    try {
        stats = lstatSync(full);
    } catch {
        return []; // listed by git but deleted since
    }
    const shown = shownPath(path, words);
    const named = pathPlaces(path, words);
    if (stats.isSymbolicLink()) {
        const target = readlinkSync(full);
        blobIds?.add(gitBlobId(memoryBytes(Buffer.from(target))));
        return [...named, ...wordsIn(target, words).map((word) => ({ where: `${shown}: where the link points`, word }))];
    }
    if (!stats.isFile()) return named;
    const bytes = fileBytes(full, stats.size);
    blobIds?.add(gitBlobId(bytes));
    return [...named, ...contentPlaces(shown, bytes, words)];
}

/** Every file under a folder, as '/'-separated paths relative to `root`; no links followed, no folders that aren't ours. */
function filesUnder(root: string, folder: string, skipNotOurs: boolean): string[] {
    const paths: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const full = join(directory, entry.name);
            const path = relative(root, full).split(sep).join('/');
            if (skipNotOurs && (NEVER_OURS.has(entry.name) || (directory === root && NOT_OURS_AT_TOP.has(entry.name)))) continue;
            if (entry.isDirectory()) visit(full);
            else paths.push(path);
        }
    };
    visit(folder);
    return paths.sort();
}

// ═════════════════════════════════════════════════════════════════════════════
//  GIT: WHO MADE EACH COMMIT, AND EVERYTHING EVER COMMITTED
// ═════════════════════════════════════════════════════════════════════════════

function git(root: string, args: string[], input?: string): Buffer | undefined {
    const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
        cwd: root,
        input,
        maxBuffer: 2 * HISTORY_BLOB_LIMIT,
        stdio: ['pipe', 'pipe', 'ignore'],
    });
    return result.status === 0 ? result.stdout : undefined;
}

const gitText = (root: string, args: string[], input?: string): string | undefined => git(root, args, input)?.toString('utf8');

/** Names, emails and messages on every commit and tag, and every branch and tag name. */
function commitPlaces(root: string, words: PrivateWord[]): { places: Place[]; commits: number } {
    const places: Place[] = [];
    const fields = ['author name', 'author email', 'committer name', 'committer email'];
    const log = gitText(root, ['log', '--all', '-z', '--format=%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B']) ?? '';
    const commits = log.split('\0').filter(Boolean);
    for (const commit of commits) {
        const [id, ...values] = commit.split('\x1f');
        const message = values.pop() ?? '';
        values.forEach((value, index) => {
            for (const word of wordsIn(value, words)) places.push({ where: `commit ${id}: ${fields[index]}`, word });
        });
        for (const hit of findInText(message, words)) places.push({ where: `commit ${id}: message, line ${hit.line}`, word: hit.word });
    }
    const tags =
        gitText(root, ['for-each-ref', '--format=%(refname:short)%1f%(taggername)%1f%(taggeremail)%1f%(contents)%00', 'refs/tags']) ?? '';
    for (const tag of tags.split('\0').filter((entry) => entry.trim())) {
        const [name = '', tagger = '', email = '', message = ''] = tag.replace(/^\n/, '').split('\x1f');
        const shown = shownPath(name, words);
        for (const word of wordsIn(tagger, words)) places.push({ where: `tag ${shown}: tagger name`, word });
        for (const word of wordsIn(email, words)) places.push({ where: `tag ${shown}: tagger email`, word });
        for (const hit of findInText(message, words)) places.push({ where: `tag ${shown}: message, line ${hit.line}`, word: hit.word });
    }
    for (const ref of (gitText(root, ['for-each-ref', '--format=%(refname)']) ?? '').split('\n').filter(Boolean)) {
        for (const word of wordsIn(ref, words)) places.push({ where: `a branch or tag name (${shownPath(ref, words)})`, word });
    }
    return { places, commits: commits.length };
}

/**
 * Every file in every commit, as git keeps it (a blob), except those the same as a file already
 * checked on disk: a word deleted last week is still in the history anyone can clone.
 */
function historyPlaces(root: string, words: PrivateWord[], checked: Set<string>): { places: Place[]; warnings: string[] } {
    const places: Place[] = [];
    const warnings: string[] = [];
    const pathOf = new Map<string, string>();
    for (const line of (gitText(root, ['rev-list', '--all', '--objects']) ?? '').split('\n')) {
        const space = line.indexOf(' ');
        if (space !== -1 && !pathOf.has(line.slice(0, space))) pathOf.set(line.slice(0, space), line.slice(space + 1));
    }
    const kinds =
        gitText(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], [...pathOf.keys()].join('\n')) ?? '';
    const blobs = kinds
        .split('\n')
        .map((line) => line.split(' '))
        .filter(([id, type]) => type === 'blob' && !checked.has(id!))
        .map(([id = '', , size]) => {
            const path = pathOf.get(id) ?? '';
            return { id, size: Number(size), path, shown: `${shownPath(path, words)} (blob ${id.slice(0, 10)}, in an earlier commit)` };
        });
    // read in batches of up to BLOB_BATCH_BYTES: one git process per batch rather than per blob
    let batch: typeof blobs = [];
    let batchBytes = 0;
    const readBatch = (): void => {
        const contents = blobContents(
            root,
            batch.map((blob) => blob.id),
        );
        for (const blob of batch) {
            const data = contents.get(blob.id);
            if (data) places.push(...contentPlaces(blob.shown, memoryBytes(data), words));
            else warnings.push(`${blob.shown} couldn't be read from git`);
        }
        batch = [];
        batchBytes = 0;
    };
    for (const blob of blobs) {
        places.push(...wordsIn(blob.path, words).map((word) => ({ where: `${blob.shown}: its name`, word })));
        if (blob.size > HISTORY_BLOB_LIMIT) {
            warnings.push(`${blob.shown} is too big to check (${Math.round(blob.size / 1e6)} MB)`);
            continue;
        }
        if (batch.length && batchBytes + blob.size > BLOB_BATCH_BYTES) readBatch();
        batch.push(blob);
        batchBytes += blob.size;
    }
    if (batch.length) readBatch();
    return { places, warnings };
}

/** The contents of these blobs, from one `git cat-file --batch`: a "<id> blob <size>" line, the bytes, a line break, for each. */
function blobContents(root: string, ids: string[]): Map<string, Buffer> {
    const contents = new Map<string, Buffer>();
    const output = git(root, ['cat-file', '--batch'], ids.join('\n') + '\n');
    for (let at = 0; output && at < output.length; ) {
        const headerEnd = output.indexOf(10, at);
        if (headerEnd === -1) break;
        const [id = '', type, size] = output.toString('latin1', at, headerEnd).split(' ');
        if (type !== 'blob') break;
        const end = headerEnd + 1 + Number(size);
        contents.set(id, output.subarray(headerEnd + 1, end));
        at = end + 1;
    }
    return contents;
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE WHOLE CHECK
// ═════════════════════════════════════════════════════════════════════════════

interface GuardOptions {
    /** The repository's folder. */
    root: string;
    /** PRIVATE_WORDS, and CI (GitHub Actions sets CI=true). */
    env: Record<string, string | undefined>;
    /** Where ~/.config/sayel/private-words is looked for. */
    home: string;
    /** Check dist/ too (pnpm guard --dist). */
    checkBuiltSite: boolean;
}

interface GuardResult {
    exitCode: 0 | 1;
    lines: string[];
}

const HOW_TO_SET_UP = 'docs/hosting.md {2.3} says how to set them up';

/** 1 file, 2 files. */
const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function runGuard({ root, env, home, checkBuiltSite }: GuardOptions): GuardResult {
    const inCi = env.CI === 'true';
    let list: WordList;
    try {
        list = readPrivateWords(env, home);
    } catch {
        return { exitCode: 1, lines: [`Identity guard: ${WORDS_FILE_SHOWN} couldn't be read. Check that it's a readable text file.`] };
    }
    if (!list.words.length) {
        if (inCi) {
            return {
                exitCode: 1,
                lines: [
                    `Identity guard: no private words, so nothing can be checked. Add the PRIVATE_WORDS repository secret (${HOW_TO_SET_UP}).`,
                ],
            };
        }
        return {
            exitCode: 0,
            lines: [
                `Warning: identity guard skipped: PRIVATE_WORDS is empty and there's no ${WORDS_FILE_SHOWN}. That's fine unless you're the owner.`,
            ],
        };
    }
    const { words, unusable } = compileWords(list.words);
    if (unusable.length) {
        return {
            exitCode: 1,
            lines: unusable.map(
                (number) =>
                    `Identity guard: private word #${number} has fewer than ${SHORTEST_WORD} or more than ${LONGEST_WORD} letters and digits. ` +
                    'Write a short one as part of a longer phrase.',
            ),
        };
    }

    const lines = [`Identity guard: looking for ${counted(words.length, 'private word')} (${list.sources.join(', ')}).`];
    const places: Place[] = [];
    const warnings: string[] = [];
    const inGit = gitText(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';

    // the repository's files: git's list (tracked, plus new files not ignored) or, outside a checkout, the folder
    const listed = inGit ? gitText(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) : undefined;
    const files = listed === undefined ? filesUnder(root, root, true) : [...new Set(listed.split('\0').filter(Boolean))].sort();
    const blobIds = new Set<string>();
    for (const path of files) places.push(...filePlaces(root, path, words, blobIds));
    let summary = counted(files.length, 'file');

    if (inGit) {
        if (gitText(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true') {
            const message = "this is a shallow clone, so older commits weren't checked (CI needs fetch-depth: 0)";
            if (inCi) return { exitCode: 1, lines: [...lines, `Identity guard: ${message}.`] };
            warnings.push(message);
        }
        const commits = commitPlaces(root, words);
        const history = historyPlaces(root, words, blobIds);
        places.push(...commits.places, ...history.places);
        warnings.push(...history.warnings);
        summary += `, ${counted(commits.commits, 'commit')} and every file in them`;
    } else {
        warnings.push("not a git checkout, so commits and the files' history weren't checked");
    }

    if (checkBuiltSite) {
        const dist = join(root, 'dist');
        if (!existsSync(dist))
            return { exitCode: 1, lines: [...lines, 'Identity guard: there is no dist/ to check. Run pnpm build first.'] };
        const built = filesUnder(root, dist, false);
        for (const path of built) places.push(...filePlaces(root, path, words));
        summary += `, ${counted(built.length, 'file')} of the built site`;
    }

    lines.push(...warnings.map((warning) => `Warning: ${warning}.`));
    if (!places.length) return { exitCode: 0, lines: [...lines, `No private words in ${summary}.`] };
    lines.push(...places.map((place) => `${place.where}  matches private word #${place.word}`));
    lines.push(
        `Found private words in ${counted(places.length, 'place')} (checked ${summary}). Take them out; ` +
            'if they are in commits, the history has to be rewritten before it is pushed (docs/security.md {8}).',
    );
    return { exitCode: 1, lines };
}

function main(): void {
    const result = runGuard({ root: process.cwd(), env: process.env, home: homedir(), checkBuiltSite: process.argv.includes('--dist') });
    for (const line of result.lines) (result.exitCode ? console.error : console.log)(line);
    process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
