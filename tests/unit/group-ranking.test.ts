// Group ranking in Tierinator: reading people's lists (old and hostile ones too), matching their items
// (Pokémon by id, pack items by row, the rest by name) and writing the group's list. The maths is
// tier-engine/core's and tested there.
import { describe, expect, it } from 'vitest';
import {
    combineProblem,
    combineRankings,
    type GroupRanking,
    type RankedList,
    readRankedList,
    toGroupList,
} from '../../src/core/group-ranking';

const COLOURS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#bfff7f', '#7fbfff'];

/**
 * A list as it's saved, from tiers of item names: each name becomes one of your own items.
 * `pool` items exist but aren't in a tier.
 */
function savedList(title: string, tiers: Record<string, string[]>, pool: string[] = [], extra: Record<string, unknown> = {}) {
    let id = 2_000_000;
    const items: { id: number; name: string }[] = [];
    const add = (name: string) => {
        items.push({ id, name });
        return id++;
    };
    const stored = Object.entries(tiers).map(([label, names], index) => ({
        id: 't' + index,
        label,
        sub: '',
        color: COLOURS[index % COLOURS.length],
        text: '',
        items: names.map(add),
    }));
    pool.forEach(add);
    return { app: 'tierlist', v: 10, kind: 'custom', listName: title, items, nextId: id, tiers: stored, ...extra };
}

/** Reads a saved list that must be fine. */
function ranked(raw: unknown, pokemonName?: (id: number) => string | undefined): RankedList {
    const list = readRankedList(raw, pokemonName);
    if (typeof list === 'string') throw new Error('expected a list, got: ' + list);
    return list;
}

/** Each group tier's label with the names in it, in order. */
const placements = (group: GroupRanking): Record<string, string[]> =>
    Object.fromEntries(
        group.tiers.map((tier, index) => [tier.label, group.items.filter((item) => item.tier === index).map((item) => item.name)]),
    );

const itemNamed = (group: GroupRanking, name: string) => group.items.find((item) => item.name === name)!;

describe('reading a person’s list', () => {
    it('keeps only what’s in a tier, with its score', () => {
        const list = ranked(savedList('Fruit', { S: ['Apple'], A: ['Pear'], B: [] }, ['Kiwi']));
        expect(list.title).toBe('Fruit');
        expect(list.items.map((item) => [item.name, item.score])).toEqual([
            ['Apple', 1],
            ['Pear', 0.5],
        ]);
        expect(list.tiers.map((tier) => tier.label)).toEqual(['S', 'A', 'B']);
    });

    it('counts the same thing ranked twice once, at its higher place', () => {
        const list = ranked(savedList('Fruit', { S: ['Mango'], A: ['Pear'], B: ['mangó '] }));
        expect(list.items.map((item) => [item.name, item.score])).toEqual([
            ['Mango', 1],
            ['Pear', 0.5],
        ]);
    });

    it('says what’s wrong with things that aren’t a ranked list', () => {
        expect(readRankedList(null)).toBe('not a list');
        expect(readRankedList('a string')).toBe('not a list');
        expect(readRankedList([1, 2, 3])).toBe('not a list');
        expect(readRankedList({ listName: 'No tiers' })).toBe('not a list');
        expect(readRankedList({ app: 'tierlist', type: 'backup', lists: [] })).toBe('backup');
        expect(readRankedList({ type: 'tierpack', format: 2, id: 'x', items: [] })).toBe('pack');
        expect(readRankedList(savedList('Chart', { 'Lawful good': ['Knight'] }, [], { lay: 'chart' }))).toBe('chart');
        expect(readRankedList(savedList('Empty', { S: [], A: [] }, ['Pear']))).toBe('nothing ranked');
    });

    it('drops junk inside a list instead of failing: bad tiers, unknown ids, hostile names', () => {
        const raw = {
            kind: 'custom',
            listName: '<img src=x onerror=alert(1)>',
            items: [{ id: 2_000_000, name: 'Real' }, { id: 5, name: 'Below the own-item range' }, 'junk', { id: 'NaN' }],
            tiers: [
                { label: 'S', color: 'red; background:url(x)', items: [2_000_000, 2_000_000, 5, 999_999_999, 'x', null] },
                'not a tier',
                { label: { evil: true }, items: 'nope' },
            ],
            picks: { 2000000: { path: 'https://example.com/\\..\\x.png' } },
        };
        const list = ranked(raw);
        expect(list.items.map((item) => item.name)).toEqual(['Real']);
        expect(list.items[0]!.pick).toBeUndefined();
        expect(list.tiers[0]!.color).toBe('#888888');
        expect(list.title).toBe('<img src=x onerror=alert(1)>'); // kept as text; the window escapes it
    });

    it('reads Pokémon by id, named by the installed pack; ids it doesn’t know are left out', () => {
        const names: Record<number, string> = { 25: 'Pikachu', 133: 'Eevee' };
        const raw = {
            kind: 'pokemon',
            listName: 'Mine',
            tiers: [
                { label: 'S', items: [25, 9999] },
                { label: 'A', items: [133] },
            ],
        };
        const list = ranked(raw, (id) => names[id]);
        expect(list.kind).toBe('pokemon');
        expect(list.items.map((item) => [item.key, item.name, item.score])).toEqual([
            ['pokemon:25', 'Pikachu', 1],
            ['pokemon:133', 'Eevee', 0],
        ]);
        // without the pack nothing can be named, so nothing counts
        expect(readRankedList(raw)).toBe('nothing ranked');
    });

    it('opens a list file in the oldest saved format (no kind, poketier app, no listName)', () => {
        const old = {
            app: 'poketier',
            v: 10,
            tiers: [{ id: 'a', label: 'SS', sub: '', color: '#fbdf46', items: [1, 4] }],
            sz: 88,
            names: true,
        };
        const list = ranked(old, (id) => (id === 1 ? 'Bulbasaur' : id === 4 ? 'Charmander' : undefined));
        expect(list.kind).toBe('pokemon');
        expect(list.title).toBe('');
        expect(list.items.map((item) => item.name)).toEqual(['Bulbasaur', 'Charmander']);
    });
});

describe('combining', () => {
    const fruit = (title: string, tiers: Record<string, string[]>) => ranked(savedList(title, tiers));

    it('averages scores and places each item in the nearest group tier, best first', () => {
        const group = combineRankings([
            fruit('Fruit', { S: ['Mango', 'Pear'], A: ['Apple'], B: ['Kiwi'] }),
            fruit('Fruit', { S: ['Mango'], A: ['Kiwi', 'Pear'], B: ['Apple'] }),
            fruit('Fruit', { S: ['Mango', 'Apple'], A: [], B: ['Pear', 'Kiwi'] }),
        ]);
        expect(itemNamed(group, 'Mango')).toMatchObject({ mean: 1, spread: 0, votes: 3, tier: 0 });
        expect(itemNamed(group, 'Pear').mean).toBeCloseTo(0.5);
        // Apple and Pear tie on score and votes, so they're in name order
        expect(placements(group)).toEqual({ S: ['Mango'], A: ['Apple', 'Pear'], B: ['Kiwi'] });
        expect(itemNamed(group, 'Kiwi').mean).toBeCloseTo(1 / 6);
    });

    it('matches names whatever their case, accents or spacing, and names the item as the first list did', () => {
        const group = combineRankings([fruit('A', { S: ['Crème brûlée'], B: [] }), fruit('B', { S: [' CREME  BRULEE'], B: [] })]);
        expect(group.items).toHaveLength(1);
        expect(group.items[0]).toMatchObject({ name: 'Crème brûlée', votes: 2, mean: 1 });
    });

    it('matches pack items by their pack row and name, and keeps the pack only if every list used it', () => {
        const packList = (title: string, pk: string, name: string, pack: string) => ({
            kind: 'custom',
            pack,
            listName: title,
            items: [{ id: 2_000_000, name, pk }],
            tiers: [{ label: 'S', items: [2_000_000] }],
        });
        const same = combineRankings([
            ranked(packList('A', 'tops:3', 'Dragon', 'tops')),
            ranked(packList('B', 'tops:3', 'dragon', 'tops')),
        ]);
        expect(same.items).toHaveLength(1);
        expect(same.packId).toBe('tops');
        // a newer pack numbered its rows differently: same row, different thing
        const moved = combineRankings([
            ranked(packList('A', 'tops:3', 'Dragon', 'tops')),
            ranked(packList('B', 'tops:3', 'Pegasus', 'other')),
        ]);
        expect(moved.items).toHaveLength(2);
        expect(moved.packId).toBeNull();
    });

    it('says when lists can’t be combined: too few, too many, Pokémon mixed with other things', () => {
        const one = fruit('A', { S: ['Mango'] });
        expect(combineProblem([one])).toBe('too few');
        expect(combineProblem([one, one])).toBeNull();
        expect(combineProblem(Array(30).fill(one))).toBeNull();
        expect(combineProblem(Array(31).fill(one))).toBe('too many');
        const pokemon = ranked({ kind: 'pokemon', tiers: [{ label: 'S', items: [25] }] }, () => 'Pikachu');
        expect(combineProblem([one, pokemon])).toBe('mixed kinds');
    });
});

describe('the group list', () => {
    it('is a list in the stored format: own items numbered afresh, tiers in group order', () => {
        const group = combineRankings([
            ranked(savedList('Fruit', { S: ['Mango'], A: ['Pear'] }, ['Kiwi'])),
            ranked(savedList('Fruit', { S: ['Pear'], A: ['Fig'] })),
        ]);
        const { stored, idOf } = toGroupList(group, 'Fruit (group)');
        expect(stored).toMatchObject({ app: 'tierlist', v: 10, kind: 'custom', listName: 'Fruit (group)' });
        // Pear is halfway (one S, one A): it goes up, below Mango's full score
        expect(stored.items!.map((item) => item.name)).toEqual(['Mango', 'Pear', 'Fig']);
        expect(stored.items!.map((item) => item.id)).toEqual([2_000_000, 2_000_001, 2_000_002]);
        expect(stored.nextId).toBe(2_000_003);
        expect(stored.tiers!.map((tier) => tier.items)).toEqual([[2_000_000, 2_000_001], [2_000_002]]);
        expect(idOf.get('name:fig')).toBe(2_000_002);
        expect(stored.pack).toBeUndefined();
    });

    it('keeps Pokémon ids, and takes the first picture that can travel', () => {
        const names: Record<number, string> = { 25: 'Pikachu', 6: 'Charizard' };
        const list = (picks: Record<number, unknown>) =>
            ranked(
                {
                    kind: 'pokemon',
                    tiers: [
                        { label: 'S', items: [25] },
                        { label: 'A', items: [6] },
                    ],
                    picks,
                },
                (id) => names[id],
            );
        const group = combineRankings([
            list({ 25: { path: 'custom' }, 6: { path: 'https://tracker.example/c.png' } }),
            list({ 25: { path: 'other/home/25.png', ck: 1, trim: true, bg: 1 }, 6: { path: 'go:6' } }),
        ]);
        const { stored } = toGroupList(group, 'Pokémon (group)');
        expect(stored.kind).toBe('pokemon');
        expect(stored.items).toEqual([]);
        expect(stored.tiers!.map((tier) => tier.items)).toEqual([[25], [6]]);
        expect(stored.picks).toEqual({ 25: { path: 'other/home/25.png', ck: 1, trim: true }, 6: { path: 'go:6' } });
    });

    it('leaves out pictures from unknown sites, uploads and text tiles, and keeps those from trusted sites', () => {
        const withPicture = (pick: unknown) =>
            ranked({
                kind: 'custom',
                items: [{ id: 2_000_000, name: 'Moon' }],
                tiers: [{ label: 'S', items: [2_000_000] }],
                picks: { 2000000: pick },
            });
        const pictureOf = (...picks: unknown[]) => toGroupList(combineRankings(picks.map(withPicture)), 'x').stored.picks![2_000_000];
        expect(pictureOf({ path: 'custom', text: 1 }, { path: 'gal:abc' })).toBeUndefined();
        expect(pictureOf({ path: 'https://tracker.example/moon.png' }, { path: 'http://upload.wikimedia.org/moon.png' })).toBeUndefined();
        expect(pictureOf({ path: 'https://upload.wikimedia.org/moon.png', remote: 'https://tracker.example/x' })).toBeUndefined();
        expect(pictureOf({ path: 'xp:1' }, { path: 'https://upload.wikimedia.org/moon.png' })).toEqual({
            path: 'https://upload.wikimedia.org/moon.png',
        });
    });

    it('keeps the pack, the pack row and the wiki page of your own items', () => {
        const raw = {
            kind: 'custom',
            pack: 'tops',
            items: [{ id: 2_000_005, name: 'Dragon', pk: 'tops:3', w: { a: 'https://en.wikipedia.org/w/api.php', t: 'Dragon' } }],
            tiers: [{ label: 'S', items: [2_000_005] }],
        };
        const { stored } = toGroupList(combineRankings([ranked(raw), ranked(raw)]), 'Tops (group)');
        expect(stored.pack).toBe('tops');
        expect(stored.items).toEqual([
            { id: 2_000_000, name: 'Dragon', pk: 'tops:3', w: { a: 'https://en.wikipedia.org/w/api.php', t: 'Dragon' } },
        ]);
    });
});
