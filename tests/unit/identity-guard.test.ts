// The identity guard (scripts/identity-guard.ts): private words are found however they're written, in files,
// picture metadata, file names, commits and the history, and the report never prints them. The names here are invented.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { compileWords, findInText, jpegMetadata, parsePrivateWords, pngMetadata, runGuard, WORDS_FILE } from '../../scripts/identity-guard';

/** #1 and #2: two invented names, each with an accent. */
const PRIVATE_WORDS = 'Zoë Quistwater, Ignác Whistlebrook';
/** Anything in a report that would give either word away. */
const GIVES_AWAY = /zo[eë]|quist|ign[aá]c|whistle/i;

const { words } = compileWords(parsePrivateWords(PRIVATE_WORDS));
const found = (text: string): number[] => [...new Set(findInText(text, words).map((hit) => hit.word))];

const folders: string[] = [];
afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function newFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'identity-guard-'));
    folders.push(folder);
    return folder;
}

function writeFiles(root: string, files: Record<string, string | Uint8Array>): void {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
    }
}

/** The guard over a folder, with my words from PRIVATE_WORDS and an empty home folder. */
function guard(root: string, changes: { env?: Record<string, string>; home?: string; checkBuiltSite?: boolean } = {}) {
    const result = runGuard({
        root,
        env: changes.env ?? { PRIVATE_WORDS },
        home: changes.home ?? newFolder(),
        checkBuiltSite: changes.checkBuiltSite ?? false,
    });
    expect(result.lines.join('\n')).not.toMatch(GIVES_AWAY);
    return { ...result, findings: result.lines.filter((line) => / {2}matches private word #\d+$/.test(line)) };
}

// ── pictures, made byte by byte ──

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 'latin1');
    chunk.set(data, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
    return chunk;
}

/** A 1×1 PNG with these extra chunks before its picture data. */
function png(...extra: Uint8Array[]): Uint8Array {
    const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        ...extra,
        pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
        pngChunk('IEND', new Uint8Array()),
    ]);
}

const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([head, data]);
}

/** A JPEG's outline: start, these segments, then picture data (which can hold anything) and the end. */
const jpeg = (...segments: Uint8Array[]): Uint8Array =>
    Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);

function git(root: string, ...args: string[]): void {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
        cwd: root,
        encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
}

/** Commits everything in the folder as this author. */
function commit(root: string, message: string, author = 'Sayel <sayel@users.noreply.example>'): void {
    const [, name, email] = author.match(/^(.*) <(.*)>$/)!;
    git(root, 'add', '-A');
    git(root, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', message);
}

describe('the list of words', () => {
    it('one per line or comma-separated; blank lines and # comments are skipped', () => {
        expect(parsePrivateWords('Zoë Quistwater, zq77\r\n# my old handle\n\n  Ignác Whistlebrook  \n')).toEqual([
            'Zoë Quistwater',
            'zq77',
            'Ignác Whistlebrook',
        ]);
    });

    it('refuses words so short they would match everywhere', () => {
        expect(compileWords(['Zoë Quistwater', 'Li', 'Al']).unusable).toEqual([2, 3]);
    });
});

describe('matching', () => {
    it('ignores case, accents and how the letters are encoded', () => {
        for (const text of ['ZOE QUISTWATER', 'zoe quistwater', 'Zoë Quistwater', 'Zoë Quistwater', 'Ｚｏｅ Ｑｕｉｓｔｗａｔｅｒ']) {
            expect(found(text), text).toEqual([1]);
        }
        expect(found('by IGNAC WHISTLEBROOK')).toEqual([2]);
    });

    it('sees through separators and invisible characters', () => {
        for (const text of [
            'zoe.quistwater@mail.example',
            'zoe_quistwater',
            'ZoeQuistwater',
            'zoequistwater',
            'Zoe Quistwater',
            'Zo​e Quist­water',
            'Z. o. e. Q-u-i-s-t-w-a-t-e-r',
            'ignac-whistlebrook',
        ]) {
            expect(found(text).length, text).toBe(1);
        }
    });

    it('finds a name split across a line break, even in a comment, on the line where it starts', () => {
        const hits = findInText('first line\n// made by Zoë\n//   Quistwater, 2026\n', words);
        expect(hits).toEqual([{ word: 1, line: 2 }]);
        expect(findInText('<p>Ignác\n      Whistlebrook</p>', words)).toEqual([{ word: 2, line: 1 }]);
    });

    it('matches whole words only', () => {
        for (const text of ['zoe quistwaters', 'xzoe quistwater', 'Zoey Quistwater', 'Zoe Q. Quistwater', 'zoequistwaterfall']) {
            expect(found(text), text).toEqual([]);
        }
    });
});

describe('picture metadata', () => {
    it('reads PNG text chunks: tEXt, zTXt and compressed iTXt', () => {
        const picture = png(
            pngChunk('tEXt', latin1('Author\0Zoë Quistwater')),
            pngChunk('zTXt', Buffer.concat([latin1('Comment\0\0'), deflateSync(Buffer.from('drawn by Ignác Whistlebrook'))])),
            pngChunk('iTXt', Buffer.concat([Buffer.from('Copyright\0\x01\0en\0\0'), deflateSync(Buffer.from('© Zoë Quistwater'))])),
        );
        const pieces = pngMetadata(picture).map((piece) => piece.where);
        expect(pieces).toEqual(expect.arrayContaining(['PNG tEXt chunk', 'PNG zTXt chunk (unpacked)', 'PNG iTXt chunk (unpacked)']));
        expect(pieces).not.toContain('PNG IDAT chunk');
    });

    it('reads JPEG Exif (with Windows’ UTF-16 author), XMP and comments, but not the picture data', () => {
        const picture = jpeg(
            jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('Ignác Whistlebrook\0', 'utf16le')])),
            jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<dc:creator>Zoë</dc:creator>')),
            jpegSegment(0xfe, latin1('Zoë Quistwater')), // Latin-1, as old cameras wrote it
        );
        expect(jpegMetadata(picture).map((piece) => piece.where)).toEqual(['JPEG Exif metadata', 'JPEG XMP metadata', 'JPEG comment']);
    });

    it('reports each picture’s metadata by where it is, and an SVG’s metadata and comments by line', () => {
        const root = newFolder();
        writeFiles(root, {
            'public/png-text.png': png(pngChunk('tEXt', latin1('Author\0Zoë Quistwater'))),
            'public/png-ztxt.png': png(
                pngChunk('zTXt', Buffer.concat([latin1('Comment\0\0'), deflateSync(Buffer.from('Ignác Whistlebrook'))])),
            ),
            'public/photo.jpg': jpeg(
                jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0II*\0'), Buffer.from('Zoë Quistwater\0', 'utf16le')])),
            ),
            'public/scan.jpg': jpeg(jpegSegment(0xfe, Buffer.from('Ignác Whistlebrook'))),
            'public/clean.png': png(pngChunk('tEXt', latin1('Software\0a drawing program'))),
            'public/icon.svg': [
                '<svg xmlns="http://www.w3.org/2000/svg">',
                '  <!-- drawn by Ignác Whistlebrook -->',
                '  <metadata><dc:creator>Zoë Quistwater</dc:creator></metadata>',
                '</svg>',
            ].join('\n'),
        });
        expect(guard(root).findings).toEqual([
            'public/icon.svg:2  matches private word #2',
            'public/icon.svg:3  matches private word #1',
            'public/photo.jpg: JPEG Exif metadata  matches private word #1',
            'public/png-text.png: PNG tEXt chunk  matches private word #1',
            'public/png-ztxt.png: PNG zTXt chunk (unpacked)  matches private word #2',
            'public/scan.jpg: JPEG comment  matches private word #2',
        ]);
    });
});

describe('files', () => {
    it('a clean folder passes', () => {
        const root = newFolder();
        writeFiles(root, { 'README.md': '# Tierinator\n\nBy sayel.\n', 'src/main.ts': 'export const answer = 42;\n' });
        const result = guard(root);
        expect(result.exitCode).toBe(0);
        expect(result.lines.at(-1)).toBe('No private words in 2 files.');
    });

    it('checks binary files and file names, and hides the matching part of a path', () => {
        const root = newFolder();
        writeFiles(root, {
            'fonts/odd.woff': Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('Copyright Ignac Whistlebrook', 'utf16le')]),
            'photos/zoe-quistwater/one.txt': 'nothing here',
            'old/Zoe Quistwater.txt': 'nothing here',
            'zoe/quistwater/two.txt': 'nothing here',
        });
        const result = guard(root);
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            'fonts/odd.woff: in its binary content  matches private word #2',
            'old/[hidden]: its name  matches private word #1',
            'photos/[hidden]/one.txt: its name  matches private word #1',
            '[hidden path]: its name  matches private word #1',
        ]);
    });

    it('reads big files a chunk at a time without losing a word cut in two by a chunk', () => {
        const root = newFolder();
        const line = `${'x'.repeat(99)}\n`;
        const chunk = 4 * 1024 * 1024;
        // a name that straddles the first chunk's end, and one on the very last line
        const before = line.repeat(Math.floor(chunk / 100) - 1) + 'y'.repeat((chunk % 100) + 95);
        const text = `${before} Zoë Quistwater\n${line.repeat(50_000)}Ignác Whistlebrook`;
        writeFiles(root, { 'big.txt': text });
        const lineOf = (index: number) => text.slice(0, index).split('\n').length;
        expect(guard(root).findings).toEqual([
            `big.txt:${lineOf(before.length)}  matches private word #1`,
            `big.txt:${lineOf(text.length)}  matches private word #2`,
        ]);
    });

    it('skips node_modules and dist (unless asked), and never follows a symbolic link', () => {
        const root = newFolder();
        const outside = newFolder();
        writeFiles(outside, { 'notes.txt': 'Zoë Quistwater' });
        writeFiles(root, {
            'node_modules/some-package/README.md': 'Zoë Quistwater',
            'dist/assets/app.js': 'const by = "Ignác Whistlebrook";',
            'src/main.ts': 'export {};',
        });
        symlinkSync(join(outside, 'notes.txt'), join(root, 'notes-link.txt'));
        symlinkSync(outside, join(root, 'folder-link'));
        expect(guard(root).exitCode).toBe(0);
        expect(guard(root, { checkBuiltSite: true }).findings).toEqual(['dist/assets/app.js:1  matches private word #2']);
    });

    it('asks for a build when the built site is to be checked and there is none', () => {
        const result = guard(newFolder(), { checkBuiltSite: true });
        expect(result.exitCode).toBe(1);
        expect(result.lines.at(-1)).toMatch(/no dist\/.*pnpm build/);
    });
});

describe('git', () => {
    it('checks every commit’s author, committer and message, every branch name, and files deleted since', () => {
        const root = newFolder();
        git(root, 'init', '-q');
        writeFiles(root, { 'README.md': 'Thanks to Ignác Whistlebrook for the idea.\n' });
        commit(root, 'Start', 'Zoë Quistwater <zoe.quistwater@mail.example>');
        writeFiles(root, { 'README.md': 'Thanks to a friend for the idea.\n' });
        commit(root, 'Keep it anonymous\n\nCo-authored-by: Ignác Whistlebrook <i@mail.example>');
        git(root, 'branch', 'zoe-quistwater-test');

        const result = guard(root);
        expect(result.exitCode).toBe(1);
        const places = result.findings.map((line) => line.replace(/\b[0-9a-f]{7,40}\b/g, '<id>'));
        expect(places).toEqual(
            expect.arrayContaining([
                'commit <id>: author name  matches private word #1',
                'commit <id>: author email  matches private word #1',
                'commit <id>: committer name  matches private word #1',
                'commit <id>: message, line 3  matches private word #2',
                'a branch or tag name (refs/heads/[hidden])  matches private word #1',
                'README.md (blob <id>, in an earlier commit):1  matches private word #2',
            ]),
        );
        // the README as it is now is clean, and isn't reported twice
        expect(places.filter((line) => line.startsWith('README.md:'))).toEqual([]);
    });

    it('a clean repository passes, history and all', () => {
        const root = newFolder();
        git(root, 'init', '-q');
        writeFiles(root, { 'README.md': '# Tierinator\n' });
        commit(root, 'Start');
        writeFiles(root, { 'README.md': '# Tierinator\n\nTier lists.\n' });
        commit(root, 'Say what it is');
        const result = guard(root);
        expect(result.exitCode).toBe(0);
        expect(result.lines.at(-1)).toBe('No private words in 1 file, 2 commits and every file in them.');
    });
});

describe('where the words come from', () => {
    it('without words, a contributor’s check is skipped with a warning, but CI fails', () => {
        const root = newFolder();
        writeFiles(root, { 'README.md': 'Zoë Quistwater' });
        const local = guard(root, { env: {} });
        expect(local.exitCode).toBe(0);
        expect(local.lines).toEqual([expect.stringMatching(/^Warning: identity guard skipped/)]);

        const ci = guard(root, { env: { CI: 'true', PRIVATE_WORDS: '' } });
        expect(ci.exitCode).toBe(1);
        expect(ci.lines[0]).toMatch(/PRIVATE_WORDS repository secret/);
    });

    it('reads the file in my home folder too, numbering its words after those from PRIVATE_WORDS', () => {
        const root = newFolder();
        const home = newFolder();
        writeFiles(home, { [WORDS_FILE]: '# my words\nIgnác Whistlebrook\n' });
        writeFiles(root, { 'notes.md': 'Ignác Whistlebrook' });
        const result = guard(root, { env: { PRIVATE_WORDS: 'Zoë Quistwater' }, home });
        expect(result.lines[0]).toBe(
            'Identity guard: looking for 2 private words (1 from PRIVATE_WORDS, 1 from ~/.config/sayel/private-words).',
        );
        expect(result.findings).toEqual(['notes.md:1  matches private word #2']);
    });
});
