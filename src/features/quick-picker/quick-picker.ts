// src/features/quick-picker/quick-picker.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The quick picker (#qp): right-click a Pokémon to see every version of its
//  sprite and pick one, plus its tags and note, without leaving the tier list.
// ─────────────────────────────────────────────────────────────────────────────
import { dexLabel, entryById } from '../../core/items';
import { autosave } from '../../core/persist';
import { onListReset, state, tileById } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { describeSpritePath, pokedex } from '../../pokemon/data';
import { onLocalSpritesChange } from '../../pokemon/local-source';
import { renderNetState } from '../../pokemon/sprite-urls';
import { onFormsChange, onFormsClick, rankableIdFor } from '../forms/forms';
import { resetToDefault, spriteSrc } from '../sprites/sprites';
import { applyCollapsed, hydrateImages, onFiltersChange, pickCard, toggleFavourite, versionSections } from '../sprites/versions';
import { onGalleryClick } from '../studio/gallery';
import { openStudio, renderStudio, studio, uploadSprite, visibleStudioIds } from '../studio/studio';
import { refreshTagUI, setTags, tagChip } from '../tags/tags';
import { applyFilters, orderedIds } from '../tier-board/board';
import { hideTip } from '../tier-board/hover-tip';

export const quickPicker: { id: ItemId | null } = { id: null };

export function openQuickPicker(id: ItemId): void {
    quickPicker.id = id;
    hideTip();
    byId<HTMLTextAreaElement>('qpnote').value = state.notes[id] || '';
    byId('qp').classList.add('show');
    renderQuickPicker();
    byId('qpbox').scrollTop = 0;
}

export function closeQuickPicker(): void {
    const wasOpen = quickPicker.id != null;
    quickPicker.id = null;
    byId('qp').classList.remove('show');
    byId('qpbody').replaceChildren();
    // picks made here show up in My sprites / By Style behind it
    if (wasOpen && state.view === 'studio' && studio.mode !== 'pokemon') renderStudio();
}

/** Shows another Pokémon in the open picker. */
function showInPicker(id: ItemId): void {
    quickPicker.id = id;
    renderQuickPicker();
    byId('qpbox').scrollTop = 0;
}

/** The big sprite, "Using: …" and Default for the Pokémon shown. */
function renderCurrentPick(id: ItemId): void {
    byId<HTMLImageElement>('qpbig').src = spriteSrc(id);
    byId('qpcur').textContent = 'Using: ' + describeSpritePath(state.picks[id]?.path);
    byId<HTMLButtonElement>('qpreset').disabled = !state.picks[id] && !pokedex.pack?.defaults?.[id];
}

export function renderQuickPicker(): void {
    const id = quickPicker.id;
    if (!id) return;
    const entry = entryById.get(id)!;
    const sections = versionSections(id);
    byId('qpname').textContent = `${dexLabel(id)} ${entry.name}`;
    byId('qpmeta').textContent = `${entry.types.join(' / ')}, Gen ${entry.gen}, ${sections.count} sprite versions. Click one to use it`;
    renderCurrentPick(id);
    const body = byId('qpbody');
    setHtml(body, sections.html);
    hydrateImages(body);
    applyCollapsed(body);
    renderNetState();
    renderPickerTags();
}

/** ‹ ›: the previous / next Pokémon in the studio list, or in the tier or pool the tile is in. */
export function stepQuickPicker(direction: number): void {
    let ids: ItemId[];
    if (state.view === 'studio') ids = visibleStudioIds();
    else {
        const tile = quickPicker.id != null ? tileById.get(quickPicker.id) : undefined;
        if (!tile) return;
        ids = orderedIds(tile.dataset.src!);
    }
    if (ids.length < 2) return;
    const index = ids.indexOf(quickPicker.id!);
    showInPicker(ids[(index < 0 ? 0 : index + direction + ids.length) % ids.length]!);
}

function renderPickerTags(): void {
    const id = quickPicker.id;
    if (!id) return;
    setHtml(
        byId('qptags'),
        html`${(state.tags[id] || []).map((tag) => tagChip(tag, true))}<input type="text" id="qptagin" maxlength="24" placeholder="+ tag (Enter)" list="taglist">`,
    );
    const input = byId<HTMLInputElement>('qptagin');
    input.onkeydown = (e) => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        setTags(id, [...(state.tags[id] || []), input.value]);
        refreshTagUI();
        renderPickerTags();
        autosave();
        byId('qptagin').focus();
    };
}

async function onPickerClick(e: MouseEvent): Promise<void> {
    const id = quickPicker.id;
    if (!id) return;
    if (toggleFavourite(e, id)) return renderQuickPicker();
    if (await onFormsClick(e, showInPicker)) return;
    if (await onGalleryClick(e, id)) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.vc');
    if (card && (await pickCard(card, id, byId('qpbody').querySelectorAll('.vc.chosen')))) renderCurrentPick(id);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupQuickPicker(): void {
    onListReset(() => {
        quickPicker.id = null; // forget it first, so closing doesn't redraw the studio mid-switch
        closeQuickPicker();
    });
    for (const onChange of [onFiltersChange, onLocalSpritesChange])
        onChange(() => {
            if (quickPicker.id) renderQuickPicker();
        });
    onFormsChange(() => {
        if (quickPicker.id) showInPicker(rankableIdFor(quickPicker.id));
    });

    byId('qpbody').addEventListener('click', (e) => void onPickerClick(e));
    byId('qptags').addEventListener('click', (e) => {
        const remove = (e.target as HTMLElement).closest<HTMLElement>('[data-untag]');
        const id = quickPicker.id;
        if (!remove || !id) return;
        setTags(
            id,
            (state.tags[id] || []).filter((tag) => tag !== remove.dataset.untag),
        );
        refreshTagUI();
        renderPickerTags();
        applyFilters();
        autosave();
    });
    byId<HTMLTextAreaElement>('qpnote').onchange = () => {
        const id = quickPicker.id;
        if (!id) return;
        const note = byId<HTMLTextAreaElement>('qpnote').value.trim().slice(0, 300);
        if (note) state.notes[id] = note;
        else delete state.notes[id];
        autosave();
    };
    byId('qpprev').onclick = () => stepQuickPicker(-1);
    byId('qpnext').onclick = () => stepQuickPicker(1);
    byId('qpdone').onclick = closeQuickPicker;
    byId('qp').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeQuickPicker();
    });
    byId('qpup').onclick = () => {
        if (quickPicker.id) uploadSprite(quickPicker.id);
    };
    byId('qpreset').onclick = async () => {
        if (!quickPicker.id) return;
        await resetToDefault(quickPicker.id);
        renderQuickPicker();
    };
    byId('qpstudio').onclick = () => {
        const id = quickPicker.id;
        closeQuickPicker();
        openStudio(id);
    };
    byId('qpfiltbtn').onclick = () => {
        const chips = byId('qpchips');
        chips.classList.toggle('hid');
        byId('qpfiltbtn').classList.toggle('on', !chips.classList.contains('hid'));
    };
}
