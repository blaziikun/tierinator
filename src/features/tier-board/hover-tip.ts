// src/features/tier-board/hover-tip.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The hover tip (#tip): an item's picture, number, name, types, sprite, tags
//  and note while the pointer rests on its tile (Hover: On in the top bar).
// ─────────────────────────────────────────────────────────────────────────────
import { dexLabel, entryById } from '../../core/items';
import { state } from '../../core/state';
import type { Entry } from '../../core/types';
import { byId } from '../../lib/dom';
import { describeSpritePath } from '../../pokemon/data';
import { quickPicker } from '../quick-picker/quick-picker';
import { spriteSrc } from '../sprites/sprites';
import { isDragging } from './drag';

let tipVisible = false;

export function hideTip(): void {
    if (!tipVisible) return;
    byId('tip').style.display = 'none';
    tipVisible = false;
}

/** Keeps the tip next to the pointer, flipped to the other side near the window's edges. */
function positionTip(e: MouseEvent): void {
    const tip = byId('tip');
    let x = e.clientX + 16;
    let y = e.clientY + 16;
    if (x + tip.offsetWidth > innerWidth - 8) x = e.clientX - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > innerHeight - 8) y = e.clientY - tip.offsetHeight - 12;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
}

/** "Official artwork" → "official artwork" inside a sentence; names (Pokémon GO, Gen V…) keep their capitals. */
const lowerFirstWord = (text: string): string => text.replace(/^(Official|Default|Custom|Image|Your|Lore)\b/, (word) => word.toLowerCase());

/** "Fire / Flying, Gen 1, official artwork. Tags: starter" (or tags only, for your own items). */
function details(entry: Entry): string {
    const tags = state.tags[entry.id];
    const tagText = tags ? 'Tags: ' + tags.join(', ') : '';
    if (entry.custom) {
        const variants = entry.nvar && state.combinedFamilies[entry.id] ? `${entry.nvar} variants combined` : '';
        return [tagText, variants].filter(Boolean).join('. ');
    }
    const pick = state.picks[entry.id];
    const facts = [entry.types.join(' / '), `Gen ${entry.gen}`, pick && lowerFirstWord(describeSpritePath(pick.path))]
        .filter(Boolean)
        .join(', ');
    return [facts, tagText].filter(Boolean).join('. ');
}

function showTip(e: MouseEvent, entry: Entry): void {
    const tip = byId('tip');
    tip.querySelector('img')!.src = spriteSrc(entry.id);
    tip.querySelector('b')!.textContent = `${dexLabel(entry.id)} ${entry.name}`;
    tip.querySelector('span')!.textContent = details(entry);
    const note = state.notes[entry.id];
    const noteLine = tip.querySelector('i')!;
    noteLine.textContent = note || '';
    noteLine.style.display = note ? '' : 'none';
    tip.style.display = 'flex';
    tipVisible = true;
    positionTip(e);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupHoverTip(): void {
    document.addEventListener('mouseover', (e) => {
        if (!state.showHoverInfo || isDragging() || state.view !== 'tier' || quickPicker.id) return;
        const tile = (e.target as HTMLElement).closest?.<HTMLElement>('.pi');
        const entry = tile && entryById.get(Number(tile.dataset.id));
        if (entry) showTip(e, entry);
        else hideTip();
    });
    document.addEventListener(
        'mousemove',
        (e) => {
            if (tipVisible) positionTip(e);
        },
        { passive: true },
    );
}
