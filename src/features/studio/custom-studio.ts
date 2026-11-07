// src/features/studio/custom-studio.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The studio for lists of your own items: every picture each item could show
//  (from its pack, wiki page, the web, your uploads, its variants), and All picks.
// ─────────────────────────────────────────────────────────────────────────────
import { onHistoryRestore } from '../../core/history';
import { entryById, familyMembers, familyOf, isRankable } from '../../core/items';
import { autosave } from '../../core/persist';
import { isPokemonList, state } from '../../core/state';
import type { ItemId, PictureChoice } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { checkedImageFiles } from '../../lib/images';
import { askText, toast } from '../../lib/ui';
import { WEB_SOURCES } from '../add-items/web-sources';
import { openItemEditor } from '../items/item-editor';
import { createItem, ownItem, picturesOf } from '../items/items';
import { choiceCard, groupChoices, mergeChoices, useChoiceCard, wikiPicturesFor } from '../items/picture-choices';
import { pickFromUrl, spriteSrc } from '../sprites/sprites';
import { applyCollapsed } from '../sprites/versions';
import { baseName, findDuplicates } from '../variants/variants';
import { addExtraPicture } from './gallery';
import { studio } from './studio';

type ShowFilter = 'all' | 'multi' | 'merged' | 'text';

export const customStudio = {
    mode: 'pick' as 'pick' | 'all',
    /** The item shown in Pick pictures. */
    currentId: null as ItemId | null,
    /** Pictures found this session (wiki, web search) per item, on top of its own. */
    found: new Map<ItemId, PictureChoice[]>(),
    show: 'all' as ShowFilter,
};

/** Items that pass the search box and the Show menu. */
function customStudioIds(): ItemId[] {
    const query = studio.query.trim().toLowerCase();
    return state.ownItems
        .filter((item) => {
            if (query && !item.name.toLowerCase().includes(query)) return false;
            if (customStudio.show === 'multi') return picturesOf(item.id).length > 1;
            if (customStudio.show === 'merged') return (item.vars || []).length > 1 || (item.pkx || []).length > 0;
            if (customStudio.show === 'text') return !!state.picks[item.id]?.text;
            return true;
        })
        .map((item) => item.id);
}

/** Items in list order, but with each family's variants straight after its main item. */
function familyOrder(ids: readonly ItemId[]): ItemId[] {
    const shown = new Set(ids);
    const ordered: ItemId[] = [];
    const placed = new Set<ItemId>();
    const place = (id: ItemId) => {
        ordered.push(id);
        placed.add(id);
    };
    for (const id of ids) {
        if (placed.has(id)) continue;
        const base = familyOf(id);
        if (base != null && shown.has(base) && !placed.has(base)) continue; // comes with its main item
        place(id);
        for (const member of familyMembers(id)) if (shown.has(member) && !placed.has(member)) place(member);
    }
    for (const id of ids) if (!placed.has(id)) ordered.push(id);
    return ordered;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DRAWING
// ═════════════════════════════════════════════════════════════════════════════

export function renderCustomStudio(): void {
    if (state.view !== 'studio' || isPokemonList()) return;
    if (!state.ownItems.length) {
        byId('strows').replaceChildren();
        byId('stprog').textContent = '';
        setHtml(byId('stmain'), html`<div class="empty">No items yet. Add some with Add items on the tier list.</div>`);
        return;
    }
    const ids = familyOrder(customStudioIds());
    if (!ownItem(customStudio.currentId)) customStudio.currentId = ids[0] ?? state.ownItems[0]!.id;
    // each item's pictures counted once: working them out walks the item's packs and finds
    const pictureCount = new Map(state.ownItems.map((item) => [item.id, picturesOf(item.id).length]));
    const withChoices = [...pictureCount.values()].filter((count) => count > 1).length;
    byId('stprog').textContent = `${ids.length} of ${state.ownItems.length} items, ${withChoices} with picture choices`;
    setHtml(
        byId('strows'),
        html`${ids.map((id) => {
            const count = pictureCount.get(id) ?? 0;
            const family = familyMembers(id).length ? (state.combinedFamilies[id] ? 'combined' : 'variants') : '';
            return html`<div class="sr${id === customStudio.currentId ? ' cur' : ''}${familyOf(id) != null ? ' var' : ''}${!isRankable(id) ? ' hidv' : ''}" data-cid="${id}"><img alt="" loading="lazy" src="${spriteSrc(id)}"><span class="srname">${ownItem(id)!.name}</span><span class="srpc">${[count > 1 ? String(count) : '', family].filter(Boolean).join(', ')}</span></div>`;
        })}`,
    );
    byId('cvm-pick').classList.toggle('on', customStudio.mode === 'pick');
    byId('cvm-all').classList.toggle('on', customStudio.mode === 'all');
    if (customStudio.mode === 'all') renderAllPicks(ids);
    else renderPickPictures();
}

/** All picks: every item with the picture it shows now. */
function renderAllPicks(ids: readonly ItemId[]): void {
    const cards = ids.map(
        (id) =>
            html`<div class="vc" data-cid="${id}"><div class="vimg"><img alt="" loading="lazy" src="${spriteSrc(id)}"></div><div class="vl">${entryById.get(id)!.name}</div></div>`,
    );
    setHtml(
        byId('stmain'),
        html`<div class="sthead"><div><h2>All picks</h2><div class="meta">${ids.length} items with the picture each one shows now. Click one to see its choices</div></div></div><div class="stgrid mine spaced">${cards}</div>`,
    );
}

/** "Tags: starter, cute. Variant of Pikachu. 3 variants combined into it" */
function itemSummary(id: ItemId): string {
    const base = familyOf(id);
    const members = familyMembers(id);
    const tags = state.tags[id] || [];
    return [
        tags.length ? 'Tags: ' + tags.join(', ') : 'No tags',
        base != null && `Variant of ${entryById.get(base)?.name || ''}`,
        members.length && `${members.length} variants${state.combinedFamilies[id] ? ' combined into it' : ''}`,
    ]
        .filter(Boolean)
        .join('. ');
}

/** Pick pictures: every picture the current item could show, grouped by where it came from. */
function renderPickPictures(): void {
    const id = customStudio.currentId;
    const item = ownItem(id);
    if (!item || id == null) return;
    const currentPath = state.picks[id]?.path;
    const choices = mergeChoices(picturesOf(id), customStudio.found.get(id) || []);
    const sections = [...groupChoices(choices)].map(
        ([group, groupChoices]) =>
            html`<div class="stsec"><h4>${group}<em>${groupChoices.length}</em></h4><div class="stgrid">${groupChoices.map((choice) => choiceCard(choice, currentPath))}</div></div>`,
    );
    const wikiPages = (item.vars || []).filter((version) => version.t).length;
    setHtml(
        byId('stmain'),
        html`<div class="sthead"><img class="big" alt="" src="${spriteSrc(id)}"><div><h2>${item.name}</h2><div class="meta">${itemSummary(id)}</div>${state.notes[id] && html`<div class="cur">${state.notes[id]}</div>`}</div>
            <div class="acts"><button data-act="prev" title="Previous (←)">‹</button><button data-act="next" title="Next (→)">›</button><button data-act="edit">Edit</button></div></div>
            ${choices.length ? sections : html`<div class="empty">Only one picture so far. Find more on the web, add your own, or load its wiki page${item.w ? '' : ' (items from a wiki import or pack have one)'}.</div>`}
            <div class="cstmore">${item.w && html`<button data-act="wiki">Pictures from its wiki page${wikiPages > 1 ? 's' : ''}</button>`}<button data-act="web">Search the web for “${baseName(item.name)}”</button><button data-act="add">Add your own</button></div>`,
    );
    applyCollapsed(byId('stmain'));
    byId('strows').querySelector(`.sr[data-cid="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

export function stepCustomStudio(direction: number): void {
    const ids = customStudioIds();
    if (!ids.length) return;
    const index = ids.indexOf(customStudio.currentId!);
    customStudio.currentId = ids[(index + direction + ids.length) % ids.length]!;
    renderCustomStudio();
}

function showItem(id: ItemId): void {
    customStudio.currentId = id;
    customStudio.mode = 'pick';
    renderCustomStudio();
}

// ═════════════════════════════════════════════════════════════════════════════
//  MORE PICTURES
// ═════════════════════════════════════════════════════════════════════════════

/** its wiki pages, or the web source chosen in Add items. */
async function findMorePictures(where: 'wiki' | 'web'): Promise<void> {
    const id = customStudio.currentId;
    const item = ownItem(id);
    if (!item || id == null) return;
    const button = byId('stmain').querySelector<HTMLButtonElement>(`[data-act="${where}"]`);
    if (button) {
        button.disabled = true;
        button.textContent = 'Loading…';
    }
    let found: PictureChoice[] = [];
    try {
        if (where === 'wiki') found = await wikiPicturesFor(item);
        else {
            const source = WEB_SOURCES[byId<HTMLSelectElement>('websrc').value]!;
            const results = await source.search(baseName(item.name));
            found = results.flatMap((result) =>
                (result.imgs || [result.img]).map((url) => ({ group: 'Search: ' + source.name, url, label: result.name })),
            );
        }
    } catch {
        toast("Couldn't reach that source");
    }
    customStudio.found.set(id, [...(customStudio.found.get(id) || []), ...found]);
    if (customStudio.currentId === id) renderPickPictures();
    if (!found.length) toast('Nothing new found');
}

const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, className: 'hid' });

/** Adds your own pictures (picked, pasted or dropped) as choices for the current item. */
async function addPictureChoices(files: Iterable<File>): Promise<void> {
    const id = customStudio.currentId;
    if (id == null) return;
    const pictures = await checkedImageFiles(files);
    if (!pictures.length) return toast("Those files aren't pictures this app can use (or they're over 25 MB)");
    for (const picture of pictures) await addExtraPicture(id, picture);
    renderCustomStudio();
    toast(`Added ${pictures.length} picture${pictures.length > 1 ? 's' : ''}. Click one to use it`);
}

async function onCustomStudioClick(e: MouseEvent): Promise<void> {
    if (isPokemonList()) return;
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (action) {
        if (action === 'prev') stepCustomStudio(-1);
        else if (action === 'next') stepCustomStudio(1);
        else if (action === 'edit') openItemEditor(customStudio.currentId);
        else if (action === 'add') fileInput.click();
        else if (action === 'wiki' || action === 'web') await findMorePictures(action);
        return;
    }
    const itemCard = target.closest<HTMLElement>('.vc[data-cid]');
    if (itemCard) return showItem(Number(itemCard.dataset.cid));
    const choice = target.closest<HTMLElement>('.vc[data-u]');
    const id = customStudio.currentId;
    if (!choice || id == null) return;
    await useChoiceCard(choice, id, byId('stmain').querySelectorAll('.vc'), (url) => pickFromUrl(id, url));
    autosave();
    const preview = byId('stmain').querySelector<HTMLImageElement>('.sthead .big');
    if (preview) preview.src = spriteSrc(id);
    const rowPicture = byId('strows').querySelector<HTMLImageElement>(`.sr[data-cid="${id}"] img`);
    if (rowPicture) rowPicture.src = spriteSrc(id);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupCustomStudio(): void {
    onHistoryRestore(renderCustomStudio);
    document.body.append(fileInput);
    fileInput.onchange = () => {
        const files = [...(fileInput.files || [])];
        fileInput.value = '';
        void addPictureChoices(files);
    };
    byId('stmain').addEventListener('click', (e) => void onCustomStudioClick(e));
    byId('strows').addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.sr[data-cid]');
        if (row) showItem(Number(row.dataset.cid));
    });
    // drop or paste pictures as choices for the item shown
    const isOwnStudio = () => state.view === 'studio' && !isPokemonList();
    byId('stmain').addEventListener('dragover', (e) => {
        if (isOwnStudio() && e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    byId('stmain').addEventListener('drop', (e) => {
        const files = [...(e.dataTransfer?.files || [])];
        if (!isOwnStudio() || !files.length) return;
        e.preventDefault();
        void addPictureChoices(files);
    });
    document.addEventListener('paste', (e) => {
        if (state.view !== 'studio' || isPokemonList() || e.defaultPrevented) return;
        if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        const files = [...(e.clipboardData?.files || [])];
        if (!files.length) return;
        e.preventDefault();
        void addPictureChoices(files);
    });

    byId('cvm-pick').onclick = () => {
        customStudio.mode = 'pick';
        renderCustomStudio();
    };
    byId('cvm-all').onclick = () => {
        customStudio.mode = 'all';
        renderCustomStudio();
    };
    byId<HTMLSelectElement>('cststat').onchange = (e) => {
        customStudio.show = (e.target as HTMLSelectElement).value as ShowFilter;
        renderCustomStudio();
    };
    byId('cstdups').onclick = () => void findDuplicates();
    byId('cstnew').onclick = async () => {
        const name = (await askText('Name of the new item', ''))?.trim();
        if (!name) return;
        showItem(await createItem(name));
        toast('Added to the pool. Give it a picture: add your own, search the web, or paste one');
    };
    byId('cstweb').onclick = () => {
        customStudio.mode = 'pick';
        renderCustomStudio();
        void findMorePictures('web');
    };
    byId('cstadd').onclick = () => fileInput.click();
}
