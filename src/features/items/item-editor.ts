// src/features/items/item-editor.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The item editor (#ied): right-click one of your own items to rename it, change
//  its picture (upload, paste, web address, text tile, or one of its choices),
//  tag it, note it, or group it with variants. Delete item is delete-items.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { entryById, familyMembers, familyOf, isOwnItem } from '../../core/items';
import { autosave } from '../../core/persist';
import { state, tileById } from '../../core/state';
import type { ItemId, PictureChoice } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { askText, toast } from '../../lib/ui';
import { creditLine } from '../credits/credits';
import { pickFromUrl, pickUpload, spriteSrc } from '../sprites/sprites';
import { refreshTagUI, setTags, tagChip } from '../tags/tags';
import { applyFilters } from '../tier-board/board';
import { hideTip } from '../tier-board/hover-tip';
import { makeFamilyMain, setFamilyCombined, ungroupFamily } from '../variants/variants';
import { createItem, ownItem, picturesOf, useTextTile } from './items';
import { choiceCard, groupChoices, mergeChoices, useChoiceCard, wikiPicturesFor } from './picture-choices';

export const itemEditor: { id: ItemId | null } = { id: null };

/** The picture, and its credit while it's the credited one. */
function showPicture(id: ItemId): void {
    byId<HTMLImageElement>('iedimg').src = spriteSrc(id);
    setHtml(byId('iedcredit'), creditLine(id));
}

// ═════════════════════════════════════════════════════════════════════════════
//  OPENING AND MOVING BETWEEN ITEMS
// ═════════════════════════════════════════════════════════════════════════════

export function openItemEditor(id: ItemId | null): void {
    if (id == null) return;
    itemEditor.id = id;
    hideTip();
    const item = ownItem(id);
    byId<HTMLInputElement>('iedname').value = entryById.get(id)!.name;
    showPicture(id);
    byId<HTMLInputElement>('iedurl').value = '';
    byId<HTMLTextAreaElement>('iednote').value = state.notes[id] || '';
    renderEditorTags();
    const choiceCount = renderEditorPictures(id);
    byId('iedwbtn').classList.toggle('hid', !item?.w);
    const order = editorOrder();
    const position = order.indexOf(id);
    byId('iedpos').textContent = position >= 0 ? `${position + 1} / ${order.length}` : '';
    renderEditorFamily(id);
    byId('ied').classList.add('show');
    // items from a wiki with no other pictures: look on the wiki straight away
    if (item?.w && !item.pk && !choiceCount) void loadWikiPictures();
}

export function closeItemEditor(): void {
    saveEditorNote();
    itemEditor.id = null;
    byId('ied').classList.remove('show');
}

/** Your items in the order they show on screen (tiers, then the visible pool). */
const editorOrder = (): ItemId[] =>
    [...document.querySelectorAll<HTMLElement>('#tsec .pi, #pgrid .pi')]
        .filter((tile) => tile.offsetParent !== null || tile.closest('#tsec'))
        .map((tile) => Number(tile.dataset.id))
        .filter(isOwnItem);

/** ‹ › (and ← → keys): the previous / next item on screen. */
export function stepItemEditor(direction: number): void {
    const order = editorOrder();
    const index = order.indexOf(itemEditor.id!);
    if (index < 0 || !order.length) return;
    saveEditorNote();
    openItemEditor(order[(index + direction + order.length) % order.length]!);
}

function saveEditorNote(): void {
    const id = itemEditor.id;
    if (!id) return;
    const note = byId<HTMLTextAreaElement>('iednote').value.trim().slice(0, 300);
    if (note === (state.notes[id] || '')) return;
    if (note) state.notes[id] = note;
    else delete state.notes[id];
    autosave();
}

// ═════════════════════════════════════════════════════════════════════════════
//  SECTIONS
// ═════════════════════════════════════════════════════════════════════════════

/** The item's picture choices (plus `found`: more from its wiki pages). Returns how many. */
function renderEditorPictures(id: ItemId, found: PictureChoice[] = []): number {
    const currentPath = state.picks[id]?.path;
    const choices = mergeChoices(picturesOf(id), found);
    const groups = groupChoices(choices);
    const showHeadings = groups.size > 1 || !groups.has('Pictures');
    setHtml(
        byId('iedwres'),
        html`${[...groups].map(
            ([group, inGroup]) =>
                html`${showHeadings && html`<h5>${group} (${inGroup.length})</h5>`}<div class="stgrid webres">${inGroup.map((choice) => choiceCard(choice, currentPath))}</div>`,
        )}`,
    );
    byId('iedwiki').classList.toggle('hid', !choices.length && !ownItem(id)?.w);
    byId('iedbox').classList.toggle('wide', choices.length > 0);
    return choices.length;
}

/** "Variant of …" or "3 variants: …", with the buttons that fit. */
function renderEditorFamily(id: ItemId): void {
    const base = familyOf(id);
    const members = familyMembers(id);
    const combined = !!state.combinedFamilies[id];
    let content = html``;
    if (base != null)
        content = html`<span>Variant of <b>${entryById.get(base)?.name || '?'}</b>${state.combinedFamilies[base] ? ' (combined into it)' : ''}</span><button data-f="main">Make this the main one</button><button data-f="open">Open main</button><button data-f="out">Remove from group</button>`;
    else if (members.length) {
        const names = members.slice(0, 4).map((member) => entryById.get(member)?.name || '');
        content = html`<span><b>${members.length}</b> variant${members.length > 1 ? 's' : ''}: ${names.join(', ')}${members.length > 4 ? '…' : ''}</span><button data-f="${combined ? 'split' : 'comb'}">${combined ? 'Split them out' : 'Combine into one'}</button><button data-f="ungroup">Ungroup</button>`;
    }
    setHtml(byId('iedfam'), content);
}

function renderEditorTags(): void {
    const id = itemEditor.id;
    if (!id) return;
    setHtml(
        byId('iedtags'),
        html`${(state.tags[id] || []).map((tag) => tagChip(tag, true))}<input type="text" id="iedtagin" maxlength="24" placeholder="+ tag (Enter)" list="taglist">`,
    );
    const input = byId<HTMLInputElement>('iedtagin');
    input.onkeydown = (e) => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        setTags(id, [...(state.tags[id] || []), input.value]);
        refreshTagUI();
        renderEditorTags();
        autosave();
        byId('iedtagin').focus();
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHANGING THE PICTURE
// ═════════════════════════════════════════════════════════════════════════════

/** Uses a picture file (upload or paste) for the item shown. */
async function useFile(file: Blob): Promise<void> {
    const id = itemEditor.id;
    if (!id) return;
    if (!(await pickUpload(id, file))) return toast("That file isn't a picture this app can use (or it's over 25 MB)");
    showPicture(id);
}

/** Uses a picture's web address for the item shown. */
async function useAddress(url: string): Promise<void> {
    const id = itemEditor.id;
    if (!id) return;
    if (!(await pickFromUrl(id, url)))
        toast("Showing that picture straight from the web (the site blocks copies, so exports can't include it)", 4500);
    showPicture(id);
    autosave();
}

/** More from its wiki page. */
async function loadWikiPictures(): Promise<void> {
    const id = itemEditor.id;
    const item = ownItem(id);
    if (!id || !item?.w) return;
    const button = byId<HTMLButtonElement>('iedwbtn');
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
        const found = await wikiPicturesFor(item);
        if (itemEditor.id !== id) return;
        renderEditorPictures(id, found);
        if (!found.length) toast('No other pictures on those pages');
    } catch {
        toast("Couldn't reach the wiki");
    } finally {
        button.disabled = false;
        button.textContent = 'More from its wiki page';
    }
}

/** Renaming also redraws a text tile, so it shows the new name. */
async function rename(name: string): Promise<void> {
    const id = itemEditor.id;
    const item = ownItem(id);
    if (!id || !item) return;
    item.name = name.trim().slice(0, 80) || item.name;
    const entry = entryById.get(id)!;
    entry.name = item.name;
    entry.lc = item.name.toLowerCase();
    const label = tileById.get(id)?.querySelector('.pname');
    if (label) label.textContent = item.name;
    tileById.get(id)?.setAttribute('aria-label', item.name);
    autosave();
    if (state.picks[id]?.text) {
        await useTextTile(id);
        showPicture(id);
    }
}

// ── wiring (runs once at start-up, from main.ts) ──
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', className: 'hid' });

export function setupItemEditor(): void {
    const editing = () => itemEditor.id;

    document.body.append(fileInput);
    fileInput.onchange = () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) void useFile(file);
    };
    byId('iedup').onclick = () => fileInput.click();
    byId('iedtile').onclick = async () => {
        const id = editing();
        if (!id) return;
        await useTextTile(id);
        showPicture(id);
        autosave();
    };
    byId<HTMLInputElement>('iedurl').onkeydown = (e) => {
        const url = (e.target as HTMLInputElement).value.trim();
        if (e.key === 'Enter' && url) void useAddress(url);
    };
    byId('iedwbtn').onclick = () => void loadWikiPictures();
    byId('iedwres').addEventListener('click', async (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.vc[data-u]');
        const id = editing();
        if (!card || !id) return;
        await useChoiceCard(card, id, byId('iedwres').querySelectorAll('.vc'), useAddress);
        showPicture(id);
        autosave();
    });
    // paste a picture while the editor is open
    document.addEventListener('paste', (e) => {
        const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
        if (!editing() || !file || e.defaultPrevented) return;
        if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        e.preventDefault();
        void useFile(file);
    });

    byId<HTMLInputElement>('iedname').onchange = (e) => void rename((e.target as HTMLInputElement).value);
    byId<HTMLTextAreaElement>('iednote').onchange = saveEditorNote;
    byId('iedtags').addEventListener('click', (e) => {
        const remove = (e.target as HTMLElement).closest<HTMLElement>('[data-untag]');
        const id = editing();
        if (!remove || !id) return;
        setTags(
            id,
            (state.tags[id] || []).filter((tag) => tag !== remove.dataset.untag),
        );
        refreshTagUI();
        renderEditorTags();
        applyFilters();
        autosave();
    });

    byId('iedfam').addEventListener('click', (e) => {
        const action = (e.target as HTMLElement).closest<HTMLElement>('[data-f]')?.dataset.f;
        const id = editing();
        if (!action || !id) return;
        if (action === 'open') {
            saveEditorNote();
            return openItemEditor(familyOf(id));
        }
        if (action === 'main') makeFamilyMain(id);
        else if (action === 'out' || action === 'ungroup') ungroupFamily(id);
        else if (action === 'comb') setFamilyCombined(id, true);
        else if (action === 'split') setFamilyCombined(id, false);
        renderEditorFamily(id);
        renderEditorPictures(id);
    });
    byId('iednewvar').onclick = async () => {
        const id = editing();
        if (!id) return;
        const name = (await askText('Name of the new variant', entryById.get(id)!.name + ' (2)'))?.trim();
        if (!name) return;
        saveEditorNote();
        openItemEditor(await createItem(name, { like: id, familyWith: id }));
        toast('New variant added. Pick its picture below');
    };

    byId('ieddone').onclick = closeItemEditor;
    byId('iedprev').onclick = () => stepItemEditor(-1);
    byId('iednext').onclick = () => stepItemEditor(1);
    byId('ied').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeItemEditor();
    });
}
