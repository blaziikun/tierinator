// src/features/tier-board/pool-order.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The order the pool shows its items in: as they were added, A to Z, Z to A, or
//  shuffled. Only the screen changes; the saved order and the ranking don't.
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolOrder, PoolSortBy } from '../../core/types';

/** What each order is called in the pool's Order menu ('added' reads "Pokédex order" on a Pokémon list). */
export const POOL_SORT_LABELS: Readonly<Record<PoolSortBy, string>> = {
    added: 'Order added',
    az: 'A to Z',
    za: 'Z to A',
    shuffled: 'Shuffled',
};

/**
 * Where an item lands in a shuffle: a well-mixed number from its id and the seed. Giving each item
 * its own place (rather than shuffling the list) keeps the rest still when one item is ranked or comes back.
 */
export function shufflePlace(id: number, seed: number): number {
    let mixed = Math.imul((id ^ seed) >>> 0, 0x9e3779b1) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

/** A new seed for "Shuffled", never the one in use (choosing it again must look different). */
export function nextShuffleSeed(current: number, random: () => number = Math.random): number {
    const seed = Math.floor(random() * 0xffffffff) >>> 0;
    return seed === current ? (seed + 1) >>> 0 : seed;
}

/**
 * The items in the pool's order. Names compare as people read them: case and accents aside,
 * numbers by value ("Item 2" before "Item 10"). Equal names keep the order they were added in.
 */
export function orderPool<T extends { id: number; name: string }>(items: readonly T[], order: PoolOrder): T[] {
    if (order.by === 'added') return items.slice();
    const placed = items.map((item, index) => ({ item, index }));
    if (order.by === 'shuffled') {
        const places = new Map(items.map((item) => [item.id, shufflePlace(item.id, order.seed)]));
        placed.sort((a, b) => places.get(a.item.id)! - places.get(b.item.id)! || a.index - b.index);
    } else {
        const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const direction = order.by === 'za' ? -1 : 1;
        placed.sort((a, b) => direction * names.compare(a.item.name, b.item.name) || a.index - b.index);
    }
    return placed.map(({ item }) => item);
}
