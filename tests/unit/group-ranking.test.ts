// Group ranking: reading people's lists (old and hostile ones too), matching their items,
// and the maths that places each item in the group's list.
import { describe, expect, it } from 'vitest';
import {
    agreementExtremes,
    closestPerson,
    combineProblem,
    combineRankings,
    foldName,
    type GroupRanking,
    inTiers,
    nearestTier,
    type RankedList,
    readRankedList,
    tierScore,
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

describe('scores and tiers', () => {
    it('spaces tier scores evenly from 1 at the top to 0 at the bottom; a lone tier scores 1', () => {
        expect([0, 1, 2, 3, 4].map((index) => tierScore(index, 5))).toEqual([1, 0.75, 0.5, 0.25, 0]);
        expect(tierScore(0, 2)).toBe(1);
        expect(tierScore(1, 2)).toBe(0);
        expect(tierScore(0, 1)).toBe(1);
    });

    it('puts a mean in the nearest tier, and one exactly halfway in the higher tier', () => {
        expect(nearestTier(1, 5)).toBe(0);
        expect(nearestTier(0, 5)).toBe(4);
        expect(nearestTier(0.8, 5)).toBe(1);
        expect(nearestTier(0.875, 5)).toBe(0); // halfway between S (1) and A (0.75)
        expect(nearestTier(0.625, 5)).toBe(1); // halfway between A and B
        expect(nearestTier((1 + 0 + 0.75) / 3, 5)).toBe(2);
        expect(nearestTier(0.4, 1)).toBe(0);
        // a third, which floating point can't hold exactly, still lands on the right side
        expect(nearestTier(1 / 3, 4)).toBe(2);
        expect(nearestTier(0.5, 2)).toBe(0);
    });

    it('turns score differences into tiers of the group list', () => {
        expect(inTiers(0.25, 5)).toBe(1);
        expect(inTiers(0.5, 3)).toBe(1);
        expect(inTiers(0.3, 1)).toBe(0.3);
    });

    it('folds names: case, accents and spacing don’t matter', () => {
        expect(foldName('  Café   Noir ')).toBe('cafe noir');
        expect(foldName('POKÉMON')).toBe(foldName('pokemon'));
        expect(foldName('Ångström')).toBe('angstrom');
    });
});

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

    it('counts items only some people ranked, with fewer votes', () => {
        const group = combineRankings([
            fruit('A', { S: ['Mango', 'Durian'], B: ['Pear'] }),
            fruit('B', { S: ['Mango'], B: ['Pear'] }),
            fruit('C', { S: ['Pear'], B: ['Mango'] }),
        ]);
        expect(itemNamed(group, 'Durian')).toMatchObject({ votes: 1, mean: 1, spread: 0, tier: 0 });
        expect(itemNamed(group, 'Mango')).toMatchObject({ votes: 3, tier: 0 });
        expect(placements(group)).toEqual({ S: ['Durian', 'Mango'], B: ['Pear'] });
    });

    it('orders equal scores by votes', () => {
        const group = combineRankings([fruit('A', { S: ['Lone', 'Shared'], B: [] }), fruit('B', { S: ['Shared'], B: [] })]);
        expect(placements(group).S).toEqual(['Shared', 'Lone']);
    });

    it('measures disagreement as the standard deviation of the scores', () => {
        const group = combineRankings([fruit('A', { S: ['Olive'], B: [] }), fruit('B', { S: [], B: ['Olive'] })]);
        expect(itemNamed(group, 'Olive')).toMatchObject({ mean: 0.5, spread: 0.5, tier: 0 });
        const three = combineRankings([
            fruit('A', { S: ['Fig'], A: [], B: [] }),
            fruit('B', { S: [], A: ['Fig'], B: [] }),
            fruit('C', { S: [], A: [], B: ['Fig'] }),
        ]);
        expect(itemNamed(three, 'Fig').spread).toBeCloseTo(Math.sqrt(1 / 6));
    });

    it('scores lists with different numbers of tiers on the same 0–1 scale, in the tiers most lists share', () => {
        const group = combineRankings([
            fruit('A', { Love: ['Mango'], Hate: ['Kiwi'] }),
            fruit('B', { S: ['Kiwi'], A: [], B: [], C: [], D: ['Mango'] }),
            fruit('C', { S: [], A: ['Mango'], B: [], C: [], D: ['Kiwi'] }),
        ]);
        expect(group.tiers.map((tier) => tier.label)).toEqual(['S', 'A', 'B', 'C', 'D']);
        expect(itemNamed(group, 'Mango').mean).toBeCloseTo((1 + 0 + 0.75) / 3);
        expect(placements(group)).toMatchObject({ B: ['Mango'], C: ['Kiwi'] });
    });

    it('uses the first list’s tiers when no two lists share theirs, and keeps its colours', () => {
        const group = combineRankings([fruit('A', { Top: ['Mango'], Low: [] }), fruit('B', { S: ['Mango'], A: [], B: [] })]);
        expect(group.tiers).toEqual([
            { label: 'Top', subtitle: '', color: COLOURS[0], textColor: '' },
            { label: 'Low', subtitle: '', color: COLOURS[1], textColor: '' },
        ]);
    });

    it('treats tier labels that differ only in case as the same tiers', () => {
        const group = combineRankings([
            fruit('A', { top: ['Mango'], low: [] }),
            fruit('B', { Best: ['Mango'], Worst: [] }),
            fruit('C', { TOP: ['Mango'], LOW: [] }),
        ]);
        expect(group.tiers.map((tier) => tier.label)).toEqual(['top', 'low']);
    });

    it('puts everything in a single tier when the group’s tiers are just one', () => {
        const group = combineRankings([fruit('A', { All: ['Mango', 'Kiwi'] }), fruit('B', { All: ['Kiwi'] })]);
        expect(group.tiers).toHaveLength(1);
        expect(placements(group)).toEqual({ All: ['Kiwi', 'Mango'] });
        expect(group.items.every((item) => item.mean === 1 && item.spread === 0)).toBe(true);
    });

    it('takes the title most lists share, else the first list’s', () => {
        expect(combineRankings([fruit('Fruit', { S: ['A'] }), fruit('Snacks', { S: ['A'] }), fruit('fruit', { S: ['A'] })]).title).toBe(
            'Fruit',
        );
        expect(combineRankings([fruit('', { S: ['A'] }), fruit('Snacks', { S: ['A'] })]).title).toBe('Snacks');
        expect(combineRankings([fruit('', { S: ['A'] }), fruit('', { S: ['A'] })]).title).toBe('');
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

describe('how close each person was', () => {
    const fruit = (title: string, tiers: Record<string, string[]>) => ranked(savedList(title, tiers));

    it('measures each person’s mean distance from the group, only over items others ranked too', () => {
        const group = combineRankings([
            fruit('Sam', { S: ['Mango', 'Pear'], A: [], B: ['Kiwi'] }),
            fruit('Ola', { S: ['Mango'], A: ['Pear'], B: ['Kiwi'] }),
            fruit('Ren', { S: ['Kiwi', 'Solo'], A: [], B: ['Mango', 'Pear'] }),
        ]);
        const [sam, ola, ren] = group.people;
        expect(sam).toMatchObject({ ranked: 3, compared: 3 });
        expect(ren).toMatchObject({ ranked: 4, compared: 3 }); // Solo is Ren's alone
        expect(ola!.distance).toBeLessThan(sam!.distance!);
        expect(sam!.distance).toBeLessThan(ren!.distance!);
        expect(closestPerson(group.people)?.list).toBe(1);
    });

    it('has no distance for someone who shares nothing with the others, and no closest when nobody does', () => {
        const group = combineRankings([fruit('A', { S: ['Mango'] }), fruit('B', { S: ['Kiwi'] })]);
        expect(group.people.map((person) => person.distance)).toEqual([null, null]);
        expect(closestPerson(group.people)).toBeNull();
    });

    it('gives the first of equally close people', () => {
        const group = combineRankings([fruit('A', { S: ['Mango'], B: [] }), fruit('B', { S: [], B: ['Mango'] })]);
        expect(group.people.map((person) => person.distance)).toEqual([0.5, 0.5]);
        expect(closestPerson(group.people)?.list).toBe(0);
    });

    it('lists the most agreed and most disagreed items, leaving out ones only one person ranked', () => {
        const group = combineRankings([
            fruit('A', { S: ['Mango', 'Olive', 'Solo'], A: [], B: ['Kiwi'] }),
            fruit('B', { S: ['Mango'], A: ['Kiwi'], B: ['Olive'] }),
        ]);
        const names = (items: { name: string }[]) => items.map((item) => item.name);
        const { agreed, disagreed } = agreementExtremes(group.items, 5);
        // three shared items: two agreed on, and what's left, if people placed it differently
        expect(names(agreed)).toEqual(['Mango', 'Kiwi']);
        expect(names(disagreed)).toEqual(['Olive']);
        expect(names(agreementExtremes(group.items, 1).agreed)).toEqual(['Mango']);
        expect(names(agreementExtremes(group.items, 1).disagreed)).toEqual(['Olive']);
    });

    it('never puts an item in both lists, and leaves out of "disagreed" what everyone placed alike', () => {
        const many = combineRankings([
            fruit('A', { S: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], B: ['i', 'j', 'k', 'l'] }),
            fruit('B', { S: ['a', 'b', 'c', 'd', 'i', 'j'], B: ['e', 'f', 'g', 'h', 'k', 'l'] }),
        ]);
        const { agreed, disagreed } = agreementExtremes(many.items, 5);
        // a–d and k–l were placed alike (best first), e–j differently
        expect(agreed.map((item) => item.name)).toEqual(['a', 'b', 'c', 'd', 'k']);
        expect(disagreed.map((item) => item.name)).toEqual(['e', 'f', 'g', 'h', 'i']);
        const alike = combineRankings([fruit('A', { S: ['a', 'b'], B: [] }), fruit('B', { S: ['a', 'b'], B: [] })]);
        expect(agreementExtremes(alike.items, 5)).toEqual({ agreed: [alike.items[0]], disagreed: [] });
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
