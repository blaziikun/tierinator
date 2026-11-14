// src/features/tier-board/placement.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Where moved items land in a tier while the Focus bar hides some of it. Only
//  what's shown can be pointed at, so the rule is: next to the shown item you
//  dropped against, and when dropped between two shown ones, straight after the
//  left one. With nothing hidden this is the ordinary before / after.
// ─────────────────────────────────────────────────────────────────────────────
import type { ItemId } from '../../core/types';

export interface Anchor {
    /** The shown item dropped against; none: the tier's empty space. */
    nextTo?: ItemId;
    after?: boolean;
}

/** The index in `items` (which no longer holds the moved items) to insert at. */
export function insertionIndex(items: readonly ItemId[], shown: (id: ItemId) => boolean, anchor: Anchor): number {
    const lastShownBefore = (end: number): number => {
        for (let i = end - 1; i >= 0; i--) if (shown(items[i]!)) return i;
        return -1;
    };
    if (anchor.nextTo == null) {
        const last = lastShownBefore(items.length);
        return last < 0 ? items.length : last + 1;
    }
    const at = items.indexOf(anchor.nextTo);
    if (at < 0) return items.length;
    if (anchor.after) return at + 1;
    const left = lastShownBefore(at);
    return left < 0 ? at : left + 1;
}

/** `items` with the shown ones put in `order` (each into a slot a shown one had), the hidden ones where they were. */
export function reorderShown(items: readonly ItemId[], order: readonly ItemId[]): ItemId[] {
    const sorted = new Set(order);
    const queue = order.filter((id) => items.includes(id));
    let next = 0;
    return items.map((id) => (sorted.has(id) ? queue[next++]! : id));
}
