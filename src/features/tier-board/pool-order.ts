// src/features/tier-board/pool-order.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What the pool's Order menu calls each order. The ordering itself (as added,
//  A to Z, Z to A, shuffled) is the engine's (tier-engine/board orderPool).
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolSortBy } from '../../core/types';

/** What each order is called in the pool's Order menu ('added' reads "Pokédex order" on a Pokémon list). */
export const POOL_SORT_LABELS: Readonly<Record<PoolSortBy, string>> = {
    added: 'Order added',
    az: 'A to Z',
    za: 'Z to A',
    shuffled: 'Shuffled',
};
