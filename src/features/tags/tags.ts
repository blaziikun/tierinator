// src/features/tags/tags.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Tags: your own labels on items ("starter", "cute"…), or a pack's categories.
//  Shown as coloured dots on tiles, filtered with the tag menu, and set for the
//  selection with Tag.
// ─────────────────────────────────────────────────────────────────────────────
import { autosave } from '../../core/persist';
import { state, tileById } from '../../core/state';
import type { ItemId } from '../../core/types';
import { isHexColor } from '../../lib/color';
import { byId, findById } from '../../lib/dom';
import { html, type SafeHtml, setHtml } from '../../lib/html';
import { placePopover, toast } from '../../lib/ui';
import { applyTheme } from '../appearance/theme';
import { genericPacks } from '../packs/packs';
import { applyFilters } from '../tier-board/board';

const currentPack = () => (state.packId ? genericPacks.get(state.packId) : undefined);

/** A tag's colour: the pack's own (if it's a valid colour), otherwise one worked out from its name. */
export function tagColor(tag: string): string {
    const packColor = currentPack()?.colors?.[tag];
    if (isHexColor(packColor)) return packColor;
    let hash = 0;
    for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 72% 58%)`;
}

/** Every tag in the list with how many items have it, A–Z. */
export function allTags(): [tag: string, count: number][] {
    const counts = new Map<string, number>();
    for (const tags of Object.values(state.tags)) for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Replaces an item's tags (trimmed, without repeats). */
export function setTags(id: ItemId, tags: readonly string[]): void {
    const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    if (unique.length) state.tags[id] = unique;
    else delete state.tags[id];
    updateTagDots(id);
}

/** Adds a tag to each item, or (if they all have it) removes it from each. */
function toggleTagOn(ids: readonly ItemId[], tag: string): void {
    const everyoneHasIt = ids.every((id) => (state.tags[id] || []).includes(tag));
    for (const id of ids) {
        const tags = state.tags[id] || [];
        setTags(id, everyoneHasIt ? tags.filter((other) => other !== tag) : [...tags, tag]);
    }
}

/**
 * Tags that get a dot on the tile. With a pack that groups its tags (Attribute, Rarity…),
 * only the dot group's tags (and your own) show, so tiles don't fill with dots.
 */
function tagsWithDots(id: ItemId): string[] {
    const tags = state.tags[id] || [];
    const facets = currentPack()?.facets;
    if (!facets) return tags;
    const dotFacet = currentPack()?.dots || (facets.Attribute ? 'Attribute' : null);
    const packTags = new Set(Object.values(facets).flat());
    const dotTags = new Set(dotFacet ? facets[dotFacet] || [] : []);
    return tags.filter((tag) => dotTags.has(tag) || !packTags.has(tag));
}

const tagDot = (tag: string): SafeHtml => html`<i style="background:${tagColor(tag)}"></i>`;

/** The coloured dots in a tile's corner. */
export function updateTagDots(id: ItemId): void {
    const tile = tileById.get(id);
    if (!tile) return;
    let dots = tile.querySelector<HTMLElement>('.ptags');
    const tags = tagsWithDots(id);
    if (!tags.length) {
        dots?.remove();
        return;
    }
    if (!dots) {
        dots = document.createElement('span');
        dots.className = 'ptags';
        tile.append(dots);
    }
    setHtml(dots, html`${tags.slice(0, 4).map(tagDot)}`);
    tile.title = (state.tags[id] || []).join(', ');
}

/** A tag as a chip (with ✕ to remove it when `removable`). */
export const tagChip = (tag: string, removable: boolean): SafeHtml =>
    html`<span class="tchip">${tagDot(tag)}${tag}${removable && html`<button data-untag="${tag}" title="Remove tag">✕</button>`}</span>`;

/** The tag suggestions and the tag filter menu (grouped by the pack's categories, if it has them). */
export function refreshTagUI(): void {
    const tags = allTags();
    setHtml(byId('taglist'), html`${tags.map(([tag]) => html`<option value="${tag}">`)}`);
    const menu = byId<HTMLSelectElement>('tagsel');
    menu.classList.toggle('hid', !tags.length);
    if (state.tagFilter !== 'all' && !tags.some(([tag]) => tag === state.tagFilter)) state.tagFilter = 'all';
    const facets = currentPack()?.facets;
    const option = ([tag, count]: [string, number]) => html`<option value="${tag}">${tag} (${count})</option>`;
    if (facets) {
        const grouped = new Set<string>();
        const groups = Object.entries(facets).map(([facet, values]) => {
            const inFacet = tags.filter(([tag]) => values.includes(tag));
            inFacet.forEach(([tag]) => {
                grouped.add(tag);
            });
            return inFacet.length ? html`<optgroup label="${facet}">${inFacet.map(option)}</optgroup>` : '';
        });
        const rest = tags.filter(([tag]) => !grouped.has(tag));
        setHtml(
            menu,
            html`<option value="all">All</option>${groups}${rest.length > 0 && html`<optgroup label="Your tags">${rest.map(option)}</optgroup>`}`,
        );
    } else setHtml(menu, html`<option value="all">All tags</option>${tags.map(option)}`);
    menu.value = state.tagFilter;
}

/** Tag popover: every tag, lit up when the whole selection has it (half when some do). */
function renderTagPopover(): void {
    const ids = [...state.selection];
    const chips = allTags().map(([tag]) => {
        const count = ids.filter((id) => (state.tags[id] || []).includes(tag)).length;
        return html`<span class="tchip tog${count === ids.length ? ' on' : count ? ' part' : ''}" data-tag="${tag}">${tagDot(tag)}${tag}</span>`;
    });
    setHtml(byId('tagpoplist'), chips.length ? html`${chips}` : html`<span class="note">No tags yet.</span>`);
}

export const syncTagDotsButton = (): void => void byId('tagdotbtn').classList.toggle('on', state.theme.tagDots !== false);

/** After tags change: menus, filters and the save. */
function afterTagChange(): void {
    refreshTagUI();
    applyFilters();
    autosave();
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupTags(): void {
    byId('tagdotbtn').onclick = () => {
        state.theme.tagDots = state.theme.tagDots === false;
        applyTheme();
        syncTagDotsButton();
        const appearanceBox = findById<HTMLInputElement>('ap-tagdots');
        if (appearanceBox) appearanceBox.checked = state.theme.tagDots;
        autosave();
        toast(state.theme.tagDots ? 'Tag dots on' : 'Tag dots off');
    };
    byId('seltag').onclick = (e) => {
        renderTagPopover();
        placePopover(byId('tagpop'), e.currentTarget as Element);
        const input = byId<HTMLInputElement>('tagpopin');
        input.value = '';
        input.focus();
    };
    byId('tagpoplist').addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-tag]');
        if (!chip) return;
        toggleTagOn([...state.selection], chip.dataset.tag!);
        renderTagPopover();
        afterTagChange();
    });
    const input = byId<HTMLInputElement>('tagpopin');
    input.onkeydown = (e) => {
        const tag = input.value.trim();
        if (e.key !== 'Enter' || !tag) return;
        for (const id of state.selection) setTags(id, [...(state.tags[id] || []), tag]);
        input.value = '';
        renderTagPopover();
        afterTagChange();
        toast(`Tagged ${state.selection.size} with “${tag}”`);
    };
    byId<HTMLSelectElement>('tagsel').onchange = (e) => {
        state.tagFilter = (e.target as HTMLSelectElement).value;
        applyFilters();
    };
}
