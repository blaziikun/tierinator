// The pool's order on screen: names as people read them, Z to A, and a shuffle that
// stays put when items come and go, but is new each time Shuffled is chosen.
import { describe, expect, it } from 'vitest';
import { nextShuffleSeed, orderPool, shufflePlace } from '../../src/features/tier-board/pool-order';

const items = ['Pretzel', 'apple pie', 'Éclair', 'Brownie', 'Muffin 10', 'Muffin 2', 'eclair'].map((name, index) => ({
    id: 100 + index,
    name,
}));
const names = (list: readonly { name: string }[]): string[] => list.map((item) => item.name);

describe('the pool order', () => {
    it('keeps the order items were added in, as a copy', () => {
        const ordered = orderPool(items, { by: 'added', seed: 0 });
        expect(ordered).toEqual(items);
        expect(ordered).not.toBe(items);
    });

    it('sorts A to Z ignoring case and accents, numbers by value, ties in the order added', () => {
        expect(names(orderPool(items, { by: 'az', seed: 0 }))).toEqual([
            'apple pie',
            'Brownie',
            'Éclair',
            'eclair',
            'Muffin 2',
            'Muffin 10',
            'Pretzel',
        ]);
    });

    it('sorts Z to A the other way round, ties still in the order added', () => {
        expect(names(orderPool(items, { by: 'za', seed: 0 }))).toEqual([
            'Pretzel',
            'Muffin 10',
            'Muffin 2',
            'Éclair',
            'eclair',
            'Brownie',
            'apple pie',
        ]);
    });

    it('shuffles the same way for the same seed, and differently for another', () => {
        const many = Array.from({ length: 40 }, (_, index) => ({ id: 2_000_000 + index, name: 'Item ' + index }));
        const once = orderPool(many, { by: 'shuffled', seed: 7 });
        expect(orderPool(many, { by: 'shuffled', seed: 7 })).toEqual(once);
        expect(once).not.toEqual(many);
        expect([...once].sort((a, b) => a.id - b.id)).toEqual(many);
        expect(orderPool(many, { by: 'shuffled', seed: 8 })).not.toEqual(once);
    });

    it("doesn't reshuffle the rest when an item leaves the pool or comes back", () => {
        const many = Array.from({ length: 30 }, (_, index) => ({ id: 2_000_000 + index, name: 'Item ' + index }));
        const all = orderPool(many, { by: 'shuffled', seed: 12345 });
        const ranked = many[13]!;
        const without = orderPool(
            many.filter((item) => item !== ranked),
            { by: 'shuffled', seed: 12345 },
        );
        expect(without).toEqual(all.filter((item) => item !== ranked));
    });

    it('gives every id its own place, from any seed', () => {
        const places = new Set(Array.from({ length: 1000 }, (_, id) => shufflePlace(id, 0xdeadbeef)));
        expect(places.size).toBe(1000);
        expect(shufflePlace(5, 1)).toBe(shufflePlace(5, 1));
    });

    it('never deals the same shuffle twice in a row', () => {
        expect(nextShuffleSeed(41, () => 41 / 0xffffffff)).not.toBe(41);
        expect(nextShuffleSeed(41, () => 0.5)).toBe(Math.floor(0.5 * 0xffffffff));
    });
});
