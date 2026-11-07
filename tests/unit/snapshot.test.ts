// Lists must survive saving and loading, old files must keep loading, and nothing
// harmful or broken in a file may get into a list.
import { describe, expect, it } from 'vitest';
import { createListState } from '../../src/core/defaults';
import { isPicturePath, readOwnItems, readStored, readTiers, toStored } from '../../src/core/snapshot';

const exists = (id: number) => (id >= 1 && id <= 2000) || id >= 2_000_000;
let n = 0;
const makeId = () => 'new' + n++;

describe('saving and loading a list', () => {
    it("keeps the pool's order, and old files without one show the pool as added", () => {
        const state = createListState();
        state.poolOrder = { by: 'shuffled', seed: 987654321 };
        const stored = JSON.parse(JSON.stringify(toStored(state, 'Snacks')));
        expect(stored).toMatchObject({ psort: 'shuffled', pseed: 987654321 });
        expect(readStored(stored, exists, makeId).poolOrder).toEqual({ by: 'shuffled', seed: 987654321 });

        // a list saved before the pool had an order
        const old = { app: 'tierlist', v: 10, tiers: [{ id: 'a', label: 'S', color: '#ff7f7f', items: [] }], sz: 88 };
        expect(readStored(old, exists, makeId).poolOrder).toBeUndefined();
    });

    it("checks the pool's order from a file: unknown orders dropped, odd seeds made whole", () => {
        expect(readStored({ psort: 'by-colour', pseed: 3 }, exists, makeId).poolOrder).toBeUndefined();
        expect(readStored({ psort: 'az' }, exists, makeId).poolOrder).toEqual({ by: 'az', seed: 1 });
        expect(readStored({ psort: 'shuffled', pseed: 'x' }, exists, makeId).poolOrder).toEqual({ by: 'shuffled', seed: 1 });
        expect(readStored({ psort: 'shuffled', pseed: 1.5 }, exists, makeId).poolOrder).toEqual({ by: 'shuffled', seed: 1 });
        expect(readStored({ psort: 'shuffled', pseed: -1 }, exists, makeId).poolOrder).toEqual({ by: 'shuffled', seed: 4294967295 });
        expect(readStored({ psort: 'za', pseed: 2 ** 40 }, exists, makeId).poolOrder).toEqual({ by: 'za', seed: 0 });
    });

    it('round-trips every saved setting through the stored format', () => {
        const state = createListState();
        state.tiers = [{ id: 't1', label: 'S', subtitle: 'best', color: '#ff0000', textColor: '#ffffff', items: [6, 25] }];
        state.tileSize = 100;
        state.labelMode = 'both';
        state.exportOptions = {
            labelMode: 'name',
            imageSize: 256,
            includeEmptyTiers: true,
            includeNotes: true,
            includeTitle: false,
            includeUnranked: true,
            includeCredit: false,
        };
        state.tileShape = 'portrait';
        state.tileFit = 'cover';
        state.familyOf = { '2000001': 2000000 };
        state.picks = { 25: { path: 'other/home/25.png', ck: 1, trim: true } };
        const stored = JSON.parse(JSON.stringify(toStored(state, 'My list')));
        expect(stored.tiers[0]).toEqual({ id: 't1', label: 'S', sub: 'best', color: '#ff0000', text: '#ffffff', items: [6, 25] });
        expect(stored.exp).toEqual({ lbl: 'name', px: 256, empty: true, notes: true, title: false, pool: true, credit: false });
        expect(stored).toMatchObject({ shape: 'portrait', fit: 'cover' });

        const read = readStored(stored, exists, makeId);
        expect(read.tiers).toEqual(state.tiers);
        expect(read.tileSize).toBe(100);
        expect(read.labelMode).toBe('both');
        expect(read.exportOptions).toEqual(state.exportOptions);
        expect(read).toMatchObject({ tileShape: 'portrait', tileFit: 'cover' });
        expect(read.familyOf).toEqual(state.familyOf);
        expect(read.picks).toEqual(state.picks);
    });

    it('loads a list file in the oldest saved format', () => {
        const old = {
            app: 'tierlist',
            v: 10,
            tiers: [{ id: 'a', label: 'SS', sub: '', color: '#fbdf46', items: [1, 4] }],
            sz: 88,
            lbl: 'off',
            names: true,
            bg: '#000000',
        };
        const read = readStored(old, exists, makeId);
        expect(read.tiers?.[0]).toMatchObject({ label: 'SS', items: [1, 4] });
        expect(read.labelMode).toBe('off');
    });

    it('opens a list file saved before charts existed as tier rows', () => {
        const old = { app: 'tierlist', v: 10, tiers: [{ id: 'a', label: 'S', sub: '', color: '#65e3f9', items: [25] }], sz: 88 };
        const read = readStored(old, exists, makeId);
        expect(read.layout).toBeUndefined();
        expect(read.chartColumns).toBeUndefined();
        expect(createListState()).toMatchObject({ layout: 'tiers', chartColumns: 3 });
    });

    it('round-trips a chart and its column count', () => {
        const state = createListState();
        state.tiers = [
            { id: 'c1', label: 'Lawful good', subtitle: '', color: '#74b9ff', textColor: '', items: [1] },
            { id: 'c2', label: 'Chaotic evil', subtitle: '', color: '#d60003', textColor: '', items: [] },
        ];
        state.layout = 'chart';
        state.chartColumns = 4;
        const stored = JSON.parse(JSON.stringify(toStored(state, 'Chart')));
        expect(stored).toMatchObject({ lay: 'chart', cols: 4 });
        const read = readStored(stored, exists, makeId);
        expect(read).toMatchObject({ layout: 'chart', chartColumns: 4, tiers: state.tiers });
    });

    it('opens a list saved before tile shapes and export titles exactly as before', () => {
        // a file from before tile shapes: square tiles, whole pictures, and only the four old export options
        const old = {
            app: 'tierlist',
            v: 10,
            tiers: [{ id: 'a', label: 'S', sub: '', color: '#65e3f9', items: [25] }],
            sz: 88,
            exp: { lbl: 'off', px: 128, empty: false, notes: true },
            lay: 'tiers',
            cols: 3,
        };
        const read = readStored(old, exists, makeId);
        expect(read.tileShape).toBeUndefined();
        expect(read.tileFit).toBeUndefined();
        expect(read.exportOptions).toEqual({ labelMode: 'off', imageSize: 128, includeEmptyTiers: false, includeNotes: true });
        // what it opens with: the defaults for everything it doesn't say
        const opened = createListState();
        Object.assign(opened.exportOptions, read.exportOptions);
        expect(opened).toMatchObject({ tileShape: 'square', tileFit: 'contain' });
        expect(opened.exportOptions).toMatchObject({ includeNotes: true, includeTitle: true, includeUnranked: false, includeCredit: true });
    });

    it('ignores an unknown tile shape or fit and odd export switches', () => {
        const odd = readStored({ shape: 'hexagon', fit: 'stretch', exp: { title: 'yes', pool: 1, credit: null } }, exists, makeId);
        expect(odd.tileShape).toBeUndefined();
        expect(odd.tileFit).toBeUndefined();
        expect(odd.exportOptions).toEqual({});
        expect(readStored({ shape: 'toString' }, exists, makeId).tileShape).toBeUndefined();
        expect(readStored({ shape: 'landscape', fit: 'contain' }, exists, makeId)).toMatchObject({
            tileShape: 'landscape',
            tileFit: 'contain',
        });
    });

    it('round-trips picture credits on your own items', () => {
        const state = createListState();
        state.ownItems = [
            {
                id: 2_000_000,
                name: 'Comet',
                w: { a: 'https://en.wikipedia.org/w/api.php', t: 'Comet' },
                credit: { file: 'Comet trail (1).jpg', by: 'Sky Watcher', licence: 'CC BY-SA 4.0' },
            },
            { id: 2_000_001, name: 'Moon', credit: { file: 'Old moon.png' } },
        ];
        const stored = JSON.parse(JSON.stringify(toStored(state, 'Sky')));
        expect(readOwnItems(stored.items, 2_000_000)).toEqual(state.ownItems);
    });

    it('opens a list saved before picture credits exactly as before', () => {
        const old = {
            app: 'tierlist',
            v: 10,
            kind: 'custom',
            listName: 'Planets',
            items: [{ id: 2000000, name: 'Mercury', w: { a: 'https://en.wikipedia.org/w/api.php', t: 'Mercury (planet)' } }],
            nextId: 2000001,
            tiers: [{ id: 'a', label: 'S', sub: '', color: '#65e3f9', items: [2000000] }],
            picks: { 2000000: { path: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Mercury.png/256px-Mercury.png', ck: 1 } },
        };
        const items = readOwnItems(old.items, 2_000_000);
        expect(items).toEqual(old.items);
        expect(items[0]).not.toHaveProperty('credit');
        expect(readStored(old, exists, makeId).picks).toEqual(old.picks);
    });

    it('understands the very old "names" switch and background colour', () => {
        const read = readStored({ names: true, bg: '#123456' }, exists, makeId);
        expect(read.labelMode).toBe('name');
        expect(read.backgroundColor).toBe('#123456');
    });
});

describe('files cannot break or attack a list', () => {
    it('drops unknown items, duplicates and bad colours from tiers', () => {
        const tiers = readTiers(
            [{ label: 'x'.repeat(99), color: 'red;background:url(x)', items: [1, 1, 999999, '2'] }, 'junk'],
            exists,
            makeId,
        );
        expect(tiers).toHaveLength(1);
        expect(tiers[0]!.label).toHaveLength(40);
        expect(tiers[0]!.color).toBe('#888888');
        expect(tiers[0]!.items).toEqual([1, 2]);
    });
    it('keeps only https picture addresses on your own items', () => {
        const items = readOwnItems(
            [{ id: 2000000, name: 'A', alts: ['https://ok.example/a.png', 'javascript:alert(1)', 'http://plain.example/b.png'] }],
            2_000_000,
        );
        expect(items[0]!.alts).toEqual(['https://ok.example/a.png']);
    });
    it('keeps picture credits only as plain, short text, and drops broken ones', () => {
        const items = readOwnItems(
            [
                {
                    id: 2000000,
                    name: 'A',
                    credit: { file: 'A.jpg', by: `  Sky\n\tWatcher ${'x'.repeat(300)}`, licence: 42, extra: 'dropped' },
                },
                { id: 2000001, name: 'B', credit: { file: 'B|<script>.jpg', by: 'Someone' } },
                { id: 2000002, name: 'C', credit: 'File:C.jpg' },
                { id: 2000003, name: 'D', credit: { by: 'No file' } },
                { id: 2000004, name: 'E', credit: { file: '   ' } },
            ],
            2_000_000,
        );
        expect(items[0]!.credit).toEqual({ file: 'A.jpg', by: `Sky Watcher ${'x'.repeat(108)}` });
        expect(items.slice(1).map((item) => item.credit)).toEqual([undefined, undefined, undefined, undefined]);
    });
    it('ignores items numbered like Pokémon in the own-items list', () => {
        expect(readOwnItems([{ id: 25, name: 'Fake' }], 2_000_000)).toEqual([]);
    });
    it('keeps only the known parts of a pick', () => {
        const read = readStored(
            { picks: { 25: { path: 'x.png', remote: 'javascript:alert(1)', onload: 'alert(1)', crop: { x: 'a' } } } },
            exists,
            makeId,
        );
        expect(read.picks[25]).toEqual({ path: 'x.png' });
    });
    it('refuses picture paths that walk out of the sprite collections', () => {
        const paths = {
            1: 'other/home/1.png',
            2: 'go:2.fFALL',
            3: 'lore:ab/Venusaur artwork.png',
            4: 'https://upload.wikimedia.org/a.png',
            5: '../../../evil/repo/x.svg',
            6: 'pmd:../../other/x',
            7: 'versions\\..\\x.png',
            8: '/absolute.png',
            9: 'javascript://x',
            10: 'a.png?x=1',
        };
        const picks = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, { path }]));
        const read = readStored({ picks, chosenSprites: { 11: '../x.png', 12: 'other/home/12.png' } }, exists, makeId);
        expect(Object.keys(read.picks)).toEqual(['1', '2', '3', '4']);
        expect(read.chosenSprites).toEqual({ 12: 'other/home/12.png' });
    });
    it('clamps sizes and survives garbage', () => {
        expect(readStored({ sz: 99999, psz: -5 }, exists, makeId)).toMatchObject({ tileSize: 160, poolTileSize: 24 });
        expect(readStored({ poolH: 1e9, poolW: -3, vc: 1e6, exp: { px: 1e9 } }, exists, makeId)).toMatchObject({
            poolHeight: 4000,
            poolWidth: 0,
            studioCardSize: 256,
            exportOptions: { imageSize: 1024 },
        });
        expect(() => readStored(null, exists, makeId)).not.toThrow();
        expect(() => readStored('nonsense', exists, makeId)).not.toThrow();
    });
    it('ignores an unknown layout and keeps a chart between 2 and 6 columns', () => {
        const odd = readStored({ lay: 'spiral', cols: 'many' }, exists, makeId);
        expect(odd.layout).toBeUndefined();
        expect(odd.chartColumns).toBe(3);
        expect(readStored({ lay: 'chart', cols: 99 }, exists, makeId)).toMatchObject({ layout: 'chart', chartColumns: 6 });
        expect(readStored({ cols: -4 }, exists, makeId).chartColumns).toBe(2);
        expect(readStored({ cols: 3.6 }, exists, makeId).chartColumns).toBe(4);
    });
    it('flattens variant chains and ignores self-references', () => {
        const read = readStored({ fam: { 2000002: 2000001, 2000001: 2000000, 2000005: 2000005 } }, exists, makeId);
        expect(read.familyOf).toEqual({ 2000002: 2000000, 2000001: 2000000 });
    });
});

describe('hostile list files', () => {
    it('gives a repeated tier id a fresh one, so two rows never answer to one id', () => {
        const tiers = readTiers(
            [
                { id: 'same', label: 'S', items: [] },
                { id: 'same', label: 'A', items: [] },
            ],
            exists,
            makeId,
        );
        expect(tiers[0]!.id).toBe('same');
        expect(tiers[1]!.id).not.toBe('same');
    });

    it('keeps at most 100 tiers', () => {
        const many = Array.from({ length: 500 }, (_, i) => ({ id: 't' + i, label: String(i), items: [] }));
        expect(readTiers(many, exists, makeId)).toHaveLength(100);
    });

    it('keeps the first of two own items with the same id', () => {
        const items = readOwnItems(
            [
                { id: 2_000_000, name: 'First' },
                { id: 2_000_000, name: 'Second' },
            ],
            2_000_000,
        );
        expect(items.map((item) => item.name)).toEqual(['First']);
    });
});

describe('picture paths', () => {
    it('refuses a sprite path that would climb out of its collection, written plainly or encoded', () => {
        expect(isPicturePath('other/home/25.png')).toBe(true);
        expect(isPicturePath('../../someone/x.png')).toBe(false);
        expect(isPicturePath('%2e%2e/%2E%2E/someone/x.png')).toBe(false);
        expect(isPicturePath('other%2f..%2fx.png')).toBe(false);
    });
});
