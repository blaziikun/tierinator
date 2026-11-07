// src/features/head-to-head/head-to-head.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ⇅ Head to head (#h2h): sorts a tier by asking "this or that?". Each item is
//  slotted into the sorted part by binary search, so a tier of n items takes
//  about n·log₂n questions. Stopping leaves the tier as it was.
// ─────────────────────────────────────────────────────────────────────────────
import { pushHistory } from '../../core/history';
import { entryById } from '../../core/items';
import { autosave } from '../../core/persist';
import { findTier } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { toast } from '../../lib/ui';
import { spriteSrc } from '../sprites/sprites';
import { placeAllTiles } from '../tier-board/board';

/** 'first' = the left one is better, null = stopped. */
type Answer = 'first' | 'second' | null;

const headToHead = {
    questionsAsked: 0,
    expectedQuestions: 0,
    /** Answers the question on screen. */
    answer: null as ((answer: Answer) => void) | null,
};

/** Shows two items and waits for the answer. */
function askWhichIsBetter(first: ItemId, second: ItemId): Promise<Answer> {
    headToHead.questionsAsked++;
    byId('h2hprog').textContent =
        `${headToHead.questionsAsked} of about ${Math.max(headToHead.questionsAsked, headToHead.expectedQuestions)}`;
    for (const [button, id] of [
        ['h2ha', first],
        ['h2hb', second],
    ] as const) {
        byId(button).querySelector('img')!.src = spriteSrc(id);
        byId(button).querySelector('b')!.textContent = entryById.get(id)!.name;
    }
    return new Promise((resolve) => {
        headToHead.answer = (answer) => {
            headToHead.answer = null;
            resolve(answer);
        };
    });
}

/** Binary insertion sort, asking at each step. Null if stopped. */
async function sortByAsking(items: readonly ItemId[]): Promise<ItemId[] | null> {
    const sorted = items.slice(0, 1);
    for (const item of items.slice(1)) {
        let low = 0;
        let high = sorted.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            const answer = await askWhichIsBetter(item, sorted[middle]!);
            if (answer === null) return null;
            if (answer === 'first') high = middle;
            else low = middle + 1;
        }
        sorted.splice(low, 0, item);
    }
    return sorted;
}

export async function startHeadToHead(tierId: string): Promise<void> {
    const tier = findTier(tierId);
    if (!tier || tier.items.length < 3) return toast('Put at least 3 in a tier to sort it');
    headToHead.questionsAsked = 0;
    headToHead.expectedQuestions = tier.items.slice(1).reduce((total, _, k) => total + Math.ceil(Math.log2(k + 2)), 0);
    byId('h2htitle').textContent = `Which is better? (${tier.label})`;
    byId('h2h').classList.add('show');
    const sorted = await sortByAsking(tier.items);
    if (!sorted) return;
    byId('h2h').classList.remove('show');
    const current = findTier(tierId);
    if (!current) return;
    pushHistory();
    // anything added to the tier meanwhile stays, after the sorted ones
    const inSorted = new Set(sorted);
    current.items = [...sorted, ...current.items.filter((id) => !inSorted.has(id))];
    placeAllTiles();
    autosave();
    toast(`${current.label} sorted in ${headToHead.questionsAsked} questions. Ctrl/⌘ Z undoes it`, 4000);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupHeadToHead(): void {
    byId('h2ha').onclick = () => headToHead.answer?.('first');
    byId('h2hb').onclick = () => headToHead.answer?.('second');
    // "about the same": counts as the second, so the item goes after it (keeps the earlier order)
    byId('h2heq').onclick = () => headToHead.answer?.('second');
    byId('h2hx').onclick = () => {
        byId('h2h').classList.remove('show');
        headToHead.answer?.(null);
        toast('Stopped. The order is unchanged');
    };
}
