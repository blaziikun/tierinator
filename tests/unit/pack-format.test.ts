// Pack files are read safely: real packs come through whole, crafted ones lose what's dangerous.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGenericPack, readPokemonPack } from '../../src/core/pack-format';

const load = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../public/packs/${name}`, import.meta.url), 'utf8'));

describe('real packs', () => {
    it('the Pokémon pack comes through unchanged', () => {
        const raw = load('pokemon.json') as Record<string, unknown>;
        const pack = readPokemonPack(raw);
        expect(pack).not.toBeNull();
        expect(pack!.roster).toEqual(raw.roster);
        expect(pack!.forms).toEqual(raw.forms);
        expect(pack!.index).toEqual(raw.index);
        expect(pack!.go).toEqual(raw.go);
        expect(pack!.pmd).toEqual(raw.pmd);
        expect(pack!.lore).toEqual(raw.lore);
        expect(pack!.defCrop).toEqual(raw.defCrop);
    });

    it('a pack using every field comes through unchanged', () => {
        const raw = {
            type: 'tierpack',
            format: 2,
            id: 'robots',
            name: 'Robots',
            noun: 'robots',
            version: '2026-11-03',
            about: 'Every robot from a made-up show.',
            source: { name: 'Robot Wiki', url: 'https://robots.example/wiki/', api: 'https://robots.example/api.php' },
            base: 'https://images.robots.example/',
            thumb: '/scale/500',
            groups: ['Main', 'Toy', 'Other'],
            facets: { Series: ['First', 'Second'], Colour: ['Red', 'Blue'] },
            dots: 'Colour',
            colors: { Red: '#e8432f', Blue: '#2f8fe8' },
            items: [
                [
                    'Boltz',
                    ['First', 'Red'],
                    [
                        [0, 'a/ab/Boltz.png'],
                        [1, 'c/cd/Boltz_toy.jpg', 'Boltz toy'],
                    ],
                ],
                ['Gearo', ['Second', 'Blue'], [[0, 'https://other.example/gearo.png']]],
            ],
        };
        expect(readGenericPack(raw)).toEqual(raw);
    });
});

describe('crafted packs', () => {
    const pack = (changes: Record<string, unknown>) => ({
        type: 'tierpack',
        format: 2,
        id: 'test',
        name: 'Test',
        items: [['A', [], []]],
        ...changes,
    });

    it('pictures only point at https, embedded pictures or the pack server', () => {
        const read = readGenericPack(
            pack({
                base: 'javascript:alert(1)//',
                items: [
                    [
                        'A',
                        [],
                        [
                            [0, 'javascript:alert(1)'],
                            [0, '//evil.example/x.png'],
                            [0, 'http://insecure.example/x.png'],
                            [0, 'https://ok.example/a.png'],
                            [0, 'a/ab/File.png'],
                            [0, 'data:text/html,<script>'],
                        ],
                    ],
                ],
            }),
        )!;
        expect(read.base).toBeUndefined();
        expect(read.items[0]![2].map((picture) => picture[1])).toEqual(['https://ok.example/a.png', 'a/ab/File.png']);
    });

    it('drops colours that could smuggle CSS, and cleans the id', () => {
        const read = readGenericPack(
            pack({ id: 'My Pack!/../x', colors: { Fire: '#ff0000', Evil: 'red;background:url(https://evil.example)' } }),
        )!;
        expect(read.colors).toEqual({ Fire: '#ff0000' });
        expect(read.id).toBe('my-pack-x');
    });

    it("refuses packs that aren't, and broken rows", () => {
        expect(readGenericPack(pack({ id: 'pokemon' }))).toBeNull();
        expect(readGenericPack(pack({ items: 'lots' }))).toBeNull();
        expect(readGenericPack(pack({ items: [['A', [], []], { name: 'B' }] }))).toBeNull();
        expect(readGenericPack('{"type":"tierpack"}')).toBeNull();
    });

    it('variant links can only point at rows that exist', () => {
        const read = readGenericPack(
            pack({
                items: [
                    ['A', [], []],
                    ['B', [], [], 'B page', 0],
                    ['C', [], [], undefined, 99],
                ],
            }),
        )!;
        expect(read.items[1]).toEqual(['B', [], [], 'B page', 0]);
        expect(read.items[2]).toEqual(['C', [], []]);
    });

    it('a Pokémon pack with a broken roster is refused', () => {
        const raw = load('pokemon.json') as Record<string, unknown>;
        expect(readPokemonPack({ ...raw, roster: [[1, '<b>', 'one', []]] })).toBeNull();
        expect(readPokemonPack({ ...raw, index: { dirs: 'x' } })).toBeNull();
    });

    it('pack default sprites can only be embedded pictures or sprite paths', () => {
        const raw = load('pokemon.json') as Record<string, unknown>;
        const read = readPokemonPack({
            ...raw,
            defaults: {
                1: { img: 'https://evil.example/x.png' },
                4: { img: 'data:image/png;base64,AAAA' },
                7: { path: 'other/official-artwork/7.png' },
            },
        })!;
        expect(read.defaults).toEqual({ 4: { img: 'data:image/png;base64,AAAA' }, 7: { path: 'other/official-artwork/7.png' } });
    });
});

describe("a pack's default pictures", () => {
    it('refuses a default path that walks out of the sprite collection', () => {
        const raw = load('pokemon.json') as Record<string, unknown>;
        const pack = readPokemonPack({ ...raw, defaults: { 25: { path: '../../evil.png' }, 26: { path: 'other/home/26.png' } } });
        expect(pack!.defaults).toEqual({ 26: { path: 'other/home/26.png' } });
    });
});
