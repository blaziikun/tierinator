// Stream mode's plain logic: the order items come up in, which one is next, and the remembered options.
import { describe, expect, it } from 'vitest';
import { checkStreamOptions, defaultStreamOptions, nextToRank, orderQueue, shuffled } from '../../src/features/stream/stream-queue';

const items = Array.from({ length: 20 }, (_, i) => i + 1);

describe('stream queue order', () => {
    it('keeps the pool order unless shuffled', () => {
        expect(orderQueue(items, 'pool', 42)).toEqual(items);
        expect(orderQueue(items, 'pool', 42)).not.toBe(items);
    });

    it('shuffles the same way for the same seed, and differently for another', () => {
        const once = orderQueue(items, 'shuffled', 1234);
        expect(orderQueue(items, 'shuffled', 1234)).toEqual(once);
        expect(shuffled(items, 1234)).toEqual(once);
        expect(shuffled(items, 99)).not.toEqual(once);
        expect(once).not.toEqual(items);
    });

    it('a shuffle holds every item once and leaves the original alone', () => {
        const original = items.slice();
        const mixed = shuffled(items, 7);
        expect([...mixed].sort((a, b) => a - b)).toEqual(original);
        expect(items).toEqual(original);
        expect(shuffled([], 7)).toEqual([]);
        expect(shuffled(['only'], 7)).toEqual(['only']);
    });

    it('moves every item somewhere over many seeds (no item stuck in place)', () => {
        const firstPlaces = new Set(Array.from({ length: 200 }, (_, seed) => shuffled(items, seed)[0]));
        expect(firstPlaces.size).toBe(items.length);
    });
});

describe('the next item to rank', () => {
    const queue = ['a', 'b', 'c', 'd'];

    it('is the first unranked one after the current, going round for skipped ones', () => {
        const ranked = new Set(['b']);
        const isRanked = (item: string) => ranked.has(item);
        expect(nextToRank(queue, -1, isRanked)).toBe(0);
        expect(nextToRank(queue, 0, isRanked)).toBe(2);
        expect(nextToRank(queue, 3, isRanked)).toBe(0);
    });

    it('comes back to the current one only when it is the last left, and is -1 when all are ranked', () => {
        const ranked = new Set(['a', 'b', 'd']);
        expect(nextToRank(queue, 2, (item) => ranked.has(item))).toBe(2);
        ranked.add('c');
        expect(nextToRank(queue, 2, (item) => ranked.has(item))).toBe(-1);
        expect(nextToRank([], -1, () => false)).toBe(-1);
    });
});

describe('remembered stream options', () => {
    it('keeps good values', () => {
        const saved = { background: 'green', showNames: false, order: 'shuffled', fromScratch: true };
        expect(checkStreamOptions(saved)).toEqual(saved);
        expect(checkStreamOptions({ background: 'magenta' }).background).toBe('magenta');
    });

    it('falls back to the defaults for anything missing, odd or hostile', () => {
        expect(checkStreamOptions(null)).toEqual(defaultStreamOptions());
        expect(checkStreamOptions('green')).toEqual(defaultStreamOptions());
        expect(checkStreamOptions([1, 2])).toEqual(defaultStreamOptions());
        expect(checkStreamOptions({ background: 'red', showNames: 'yes', order: 1, fromScratch: {}, extra: '<b>' })).toEqual(
            defaultStreamOptions(),
        );
        expect(checkStreamOptions(JSON.parse('{"__proto__": {"fromScratch": true}}'))).toEqual(defaultStreamOptions());
    });
});
