// src/features/stream/stream-queue.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The parts of stream mode that are plain logic: the order items come up in
//  (shuffled from a seed, so the same seed gives the same order), which one comes
//  next, and the options remembered from last time, checked.
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../../lib/checks';

export type StreamBackground = 'theme' | 'green' | 'magenta';
export type StreamOrder = 'pool' | 'shuffled';

export interface StreamOptions {
    background: StreamBackground;
    showNames: boolean;
    order: StreamOrder;
    /** Rank everything again from empty tiers, not only what's still in the pool. */
    fromScratch: boolean;
}

export const defaultStreamOptions = (): StreamOptions => ({ background: 'theme', showNames: true, order: 'pool', fromScratch: false });

/** Options saved in this browser: anything missing or odd falls back to the default. */
export function checkStreamOptions(saved: unknown): StreamOptions {
    const options = defaultStreamOptions();
    if (!isRecord(saved)) return options;
    if (saved.background === 'theme' || saved.background === 'green' || saved.background === 'magenta')
        options.background = saved.background;
    if (typeof saved.showNames === 'boolean') options.showNames = saved.showNames;
    if (saved.order === 'pool' || saved.order === 'shuffled') options.order = saved.order;
    if (typeof saved.fromScratch === 'boolean') options.fromScratch = saved.fromScratch;
    return options;
}

/** A small, fast random number source (mulberry32): numbers from 0 up to 1, the same run for the same seed. */
function seededRandom(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(value ^ (value >>> 15), value | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** A shuffled copy (Fisher–Yates); the original is left alone. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
    const random = seededRandom(seed);
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
}

/** The items to go through, in the order they'll come up. */
export const orderQueue = <T>(items: readonly T[], order: StreamOrder, seed: number): T[] =>
    order === 'shuffled' ? shuffled(items, seed) : items.slice();

/**
 * The position of the next item still to rank after `from`, going round to the start for skipped ones;
 * `from` itself comes last. -1 when everything is ranked.
 */
export function nextToRank<T>(queue: readonly T[], from: number, isRanked: (item: T) => boolean): number {
    for (let step = 1; step <= queue.length; step++) {
        const position = (from + step) % queue.length;
        if (!isRanked(queue[position]!)) return position;
    }
    return -1;
}
