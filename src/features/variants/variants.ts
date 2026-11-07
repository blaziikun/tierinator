// src/features/variants/variants.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Variants of your own items: "Four Arms", "Four Arms (Omniverse)" and
//  "Ultimate Four Arms" grouped as one family. A family is either kept as separate
//  entries (like Pokémon forms) or combined into its main item, whose pictures
//  then include every variant's.
//
//  Grouped from the selection (Group), by name (Find by name…, Find duplicates),
//  and managed in Variants ▾ or the item editor.
// ─────────────────────────────────────────────────────────────────────────────
import { asOneUndoStep, pushHistory } from '../../core/history';
import { entryById, familyBases, familyMembers, familyOf, isOwnItem, rebuildAliases } from '../../core/items';
import { autosave } from '../../core/persist';
import { isPokemonList, state } from '../../core/state';
import type { ItemId, OwnItem } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { askChoice, placePopover, toast } from '../../lib/ui';
import { spriteSrc } from '../sprites/sprites';
import { renderCustomStudio } from '../studio/custom-studio';
import { refreshTagUI } from '../tags/tags';
import { clearSelection, placeAllTiles, rankedIds, removeFromTiers, selectedInOrder, updateFamilyBadges } from '../tier-board/board';

/** "Four Arms (Omniverse)" → "Four Arms". */
export const baseName = (name: string): string => name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim() || name;

/** Redraws everything that shows families, and saves. */
export function afterFamilyChange(): void {
    rebuildAliases();
    updateFamilyBadges();
    clearSelection();
    placeAllTiles();
    refreshTagUI();
    autosave();
    if (state.view === 'studio' && !isPokemonList()) renderCustomStudio();
    if (byId('varpop').classList.contains('open')) renderVariantsPopover();
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHANGING FAMILIES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Combine: the main item takes the place of the first ranked variant and the variants leave
 * the tiers. Split: the variants come back to the pool.
 */
export function setFamilyCombined(base: ItemId, combined: boolean, { quiet = false } = {}): void {
    const members = familyMembers(base);
    if (!members.length) return;
    pushHistory();
    if (combined) {
        if (!rankedIds().has(base))
            for (const tier of state.tiers) {
                const index = tier.items.findIndex((id) => members.includes(id));
                if (index >= 0) {
                    tier.items.splice(index, 0, base);
                    break;
                }
            }
        removeFromTiers(members);
        state.combinedFamilies[base] = true;
    } else delete state.combinedFamilies[base];
    afterFamilyChange();
    if (quiet) return;
    const name = entryById.get(base)!.name;
    toast(
        combined
            ? `${name}: ${members.length} variant${members.length > 1 ? 's' : ''} combined into one (Ctrl/⌘+Z to undo)`
            : `${name}: variants split out into the pool`,
    );
}

/** Makes these items variants of `base` (their own variants move along), optionally combined. */
function groupAsFamily(ids: readonly ItemId[], base: ItemId, combine: boolean): void {
    asOneUndoStep(() => {
        for (const id of ids) {
            if (id === base) continue;
            for (const key of Object.keys(state.familyOf)) if (Number(state.familyOf[key]) === id) state.familyOf[key] = base;
            state.familyOf[id] = base;
            delete state.combinedFamilies[id];
        }
        delete state.familyOf[base];
        if (combine) setFamilyCombined(base, true, { quiet: true });
        else afterFamilyChange();
    });
}

/** A variant leaves its family; a main item ungroups its whole family. */
export function ungroupFamily(id: ItemId): void {
    pushHistory();
    const base = familyOf(id);
    if (base == null) {
        for (const member of familyMembers(id)) delete state.familyOf[member];
        delete state.combinedFamilies[id];
    } else {
        delete state.familyOf[id];
        if (!familyMembers(base).length) delete state.combinedFamilies[base];
    }
    afterFamilyChange();
}

/** A variant becomes its family's main item (taking its place in the tiers if combined). */
export function makeFamilyMain(id: ItemId): void {
    const base = familyOf(id);
    if (base == null) return;
    pushHistory();
    const wasCombined = !!state.combinedFamilies[base];
    for (const member of familyMembers(base)) state.familyOf[member] = id;
    state.familyOf[base] = id;
    delete state.familyOf[id];
    delete state.combinedFamilies[base];
    if (wasCombined) {
        state.combinedFamilies[id] = true;
        for (const tier of state.tiers) tier.items = tier.items.map((item) => (item === base ? id : item));
    }
    afterFamilyChange();
}

/** Combines (or splits) every family at once. */
function setAllCombined(combined: boolean): void {
    const bases = familyBases().filter((base) => !!state.combinedFamilies[base] !== combined);
    if (!bases.length) return;
    asOneUndoStep(() =>
        bases.forEach((base) => {
            setFamilyCombined(base, combined, { quiet: true });
        }),
    );
    toast(`${combined ? 'Combined' : 'Split'} ${bases.length} characters`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  FINDING FAMILIES BY NAME
// ═════════════════════════════════════════════════════════════════════════════

const isUngrouped = (item: OwnItem): boolean => !state.familyOf[item.id] && !familyMembers(item.id).length;

/**
 * Families by name: "Four Arms (Omniverse)" goes with "Four Arms" (same name before brackets),
 * and "Hammer Gorem" with "Gorem" (a name ending in another item's name). Returns [main, variants].
 */
function suggestFamilies(): [ItemId, ItemId[]][] {
    const ungrouped = state.ownItems.filter(isUngrouped);
    const mains = state.ownItems.filter((item) => !state.familyOf[item.id]);
    const suggestions = new Map<ItemId, ItemId[]>();

    const byBaseName = new Map<string, OwnItem[]>();
    for (const item of mains) {
        const key = baseName(item.name).toLowerCase();
        byBaseName.set(key, [...(byBaseName.get(key) || []), item]);
    }
    for (const [key, group] of byBaseName) {
        if (group.length < 2) continue;
        const main =
            group.find((item) => familyMembers(item.id).length) || group.find((item) => item.name.toLowerCase() === key) || group[0]!;
        const variants = group.filter((item) => item !== main && ungrouped.includes(item)).map((item) => item.id);
        if (variants.length) suggestions.set(main.id, variants);
    }

    const byExactName = new Map(mains.map((item) => [item.name.toLowerCase(), item]));
    const alreadySuggested = (id: ItemId) => suggestions.has(id) || [...suggestions.values()].some((variants) => variants.includes(id));
    for (const item of ungrouped) {
        if (alreadySuggested(item.id)) continue;
        const words = item.name.split(/\s+/);
        for (let start = 1; start < words.length; start++) {
            const tail = words.slice(start).join(' ').toLowerCase();
            const main = byExactName.get(tail);
            if (main && main !== item && tail.length >= 4) {
                suggestions.set(main.id, [...(suggestions.get(main.id) || []), item.id]);
                break;
            }
        }
    }
    return [...suggestions].filter(([, variants]) => variants.length);
}

/** Ungrouped items whose names only differ by brackets, accents or spacing. */
function duplicateGroups(): OwnItem[][] {
    const groups = new Map<string, OwnItem[]>();
    for (const item of state.ownItems.filter(isUngrouped)) {
        const key = baseName(item.name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
        groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.values()].filter((group) => group.length > 1);
}

/** Find duplicates: lists items with the same name to group them (ticked ones). */
export async function findDuplicates(): Promise<void> {
    const groups = duplicateGroups();
    if (!groups.length) return toast('No duplicate names in this list');
    setHtml(
        byId('dupbody'),
        html`${groups.map(
            (group, index) =>
                html`<label class="duprow"><input type="checkbox" data-g="${index}" checked><span class="dupimgs">${group.slice(0, 6).map((item) => html`<img src="${spriteSrc(item.id)}" alt="">`)}</span><span><b>${baseName(group[0]!.name)}</b> ×${group.length}<br><span class="note">${group.map((item) => item.name).join(', ')}</span></span></label>`,
        )}`,
    );
    byId('dupm').classList.add('show');
    const groupTicked = (combine: boolean) => {
        const ticked = [...byId('dupbody').querySelectorAll<HTMLInputElement>('input:checked')].map(
            (box) => groups[Number(box.dataset.g)]!,
        );
        byId('dupm').classList.remove('show');
        if (!ticked.length) return;
        asOneUndoStep(() => {
            for (const group of ticked) {
                const main = group.find((item) => item.name.toLowerCase() === baseName(item.name).toLowerCase()) || group[0]!;
                for (const item of group) if (item !== main) state.familyOf[item.id] = main.id;
                if (combine) setFamilyCombined(main.id, true, { quiet: true });
            }
        });
        afterFamilyChange();
        toast(`${ticked.length} group${ticked.length > 1 ? 's' : ''} of variants ${combine ? 'combined' : 'made (still separate)'}`);
    };
    byId('dupgo').onclick = () => groupTicked(false);
    byId('dupgo2').onclick = () => groupTicked(true);
}

// ═════════════════════════════════════════════════════════════════════════════
//  VARIANTS ▾ POPOVER
// ═════════════════════════════════════════════════════════════════════════════

function renderVariantsPopover(): void {
    const query = byId<HTMLInputElement>('varq').value.toLowerCase();
    const name = (id: ItemId) => entryById.get(id)!.name;
    const bases = familyBases().sort((a, b) => name(a).localeCompare(name(b)));
    if (!bases.length) {
        setHtml(
            byId('varrows'),
            html`<div class="empty roomy">No variants yet. Try “Find by name…”, or select items and press Group.</div>`,
        );
        return;
    }
    const matches = (id: ItemId) => entryById.get(id)!.lc.includes(query);
    const rows = bases
        .filter((base) => !query || matches(base) || familyMembers(base).some(matches))
        .map((base) => {
            const members = familyMembers(base);
            const combined = !!state.combinedFamilies[base];
            return html`<div class="vrow"><img alt="" src="${spriteSrc(base)}"><span class="vn"><b>${name(base)}</b><small>${members.length} variant${members.length > 1 ? 's' : ''}: ${members.map(name).join(', ')}</small></span><button class="chip${combined ? ' on' : ''}" data-vb="${base}" title="${combined ? 'Combined into one entry: click to split' : 'Separate entries: click to combine'}">${combined ? 'Combined' : 'Separate'}</button><button data-vu="${base}" title="Ungroup">✕</button></div>`;
        });
    setHtml(byId('varrows'), html`${rows}`);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupVariants(): void {
    // Group: the selected items become one family
    byId('selmerge').onclick = async () => {
        const ids = selectedInOrder().filter(isOwnItem);
        if (ids.length < 2) return;
        const main = ids.find((id) => familyMembers(id).length) || ids[0]!;
        const choice = await askChoice(
            `Group these ${ids.length} as variants of “${entryById.get(main)!.name}”? Keep them as separate entries (the default, like Pokémon forms), or combine them into one entry whose pictures include every variant. You can switch any time.`,
            'Keep separate',
            'Combine into one',
        );
        if (choice == null) return;
        groupAsFamily(ids, main, choice === 'alt');
        toast(
            choice === 'alt'
                ? 'Combined into one (Ctrl/⌘+Z to undo)'
                : 'Grouped as variants. Combine them any time (Variants ▾ or right-click)',
            4500,
        );
    };

    byId('varbtn').onclick = (e) => {
        renderVariantsPopover();
        placePopover(byId('varpop'), e.currentTarget as Element);
    };
    byId('varq').oninput = renderVariantsPopover;
    byId('varrows').addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const toggle = target.closest<HTMLElement>('[data-vb]');
        const ungroup = target.closest<HTMLElement>('[data-vu]');
        if (toggle) {
            const base = Number(toggle.dataset.vb);
            setFamilyCombined(base, !state.combinedFamilies[base]);
        }
        if (ungroup) ungroupFamily(Number(ungroup.dataset.vu));
    });
    byId('varall1').onclick = () => setAllCombined(true);
    byId('varall0').onclick = () => setAllCombined(false);
    byId('varauto').onclick = async () => {
        const suggestions = suggestFamilies();
        if (!suggestions.length) return toast('No matching names found');
        const examples = suggestions
            .slice(0, 3)
            .map(([base, variants]) => `${entryById.get(base)!.name} + ${variants.length}`)
            .join(', ');
        const choice = await askChoice(
            `Found ${suggestions.length} characters with variants by name (${examples}${suggestions.length > 3 ? '…' : ''}). Group them?`,
            'Group, keep separate',
            'Group and combine',
        );
        if (choice == null) return;
        asOneUndoStep(() => {
            for (const [base, variants] of suggestions) for (const id of variants) state.familyOf[id] = base;
            if (choice === 'alt') for (const [base] of suggestions) setFamilyCombined(base, true, { quiet: true });
        });
        afterFamilyChange();
        toast(`Grouped ${suggestions.length} characters`);
    };
}
