// src/features/tier-board/tier-editor.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The tier editor pop-up (#ted): rename a tier, give it a second line, change its
//  colours. Changes preview live and are undone if you close without saving.
//  Also the colour palette (shared by every list, saved straight away).
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_SWATCHES } from '../../core/defaults';
import { pushHistory, redoStack, undoStack } from '../../core/history';
import { autosave } from '../../core/persist';
import { findTier, itemWord, state } from '../../core/state';
import type { Tier } from '../../core/types';
import { isHexColor } from '../../lib/color';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { ask, closePopovers, onPopoversClose, placePopover, toast } from '../../lib/ui';
import { labelTextColor, rowBackground } from '../appearance/theme';
import { renderTiers } from './board';

/** The tier being edited and how it looked before (to undo an unsaved preview). */
export const tierEditor: { editingId: string | null; before: Tier | null } = { editingId: null, before: null };
/** The whole tier list when the editor opened, for undo. */
let tiersBeforeEdit: string | null = null;

/** Redraws one tier's label and row colours without rebuilding the board. */
export function paintTier(tier: Tier): void {
    const row = document.querySelector(`.trow[data-tid="${CSS.escape(tier.id)}"]`);
    if (!row) return;
    const label = row.querySelector<HTMLElement>('.tlbl')!;
    label.style.background = tier.color;
    label.style.color = labelTextColor(tier);
    label.querySelector('.tlbl-main')!.textContent = tier.label;
    let subtitle = label.querySelector<HTMLElement>('.tlbl-sub');
    if (tier.subtitle) {
        if (!subtitle) {
            subtitle = document.createElement('div');
            subtitle.className = 'tlbl-sub';
            label.append(subtitle);
        }
        subtitle.textContent = tier.subtitle;
    } else subtitle?.remove();
    row.querySelector<HTMLElement>('.tcont')!.style.background = rowBackground(tier.color);
}

/** Applies what's in the editor to the tier on screen (not saved yet). */
export function previewTierEdit(): void {
    const tier = tierEditor.editingId ? findTier(tierEditor.editingId) : undefined;
    if (!tier) return;
    tier.label = byId<HTMLInputElement>('edlbl').value.trim() || tierEditor.before!.label;
    tier.subtitle = byId<HTMLInputElement>('edsub').value.trim();
    tier.color = byId<HTMLInputElement>('edcol').value;
    tier.textColor = byId<HTMLInputElement>('edauto').checked ? '' : byId<HTMLInputElement>('edtxt').value;
    paintTier(tier);
}

export function openTierEditor(tierId: string, anchor: Element): void {
    const tier = findTier(tierId);
    if (!tier) return;
    closePopovers();
    tierEditor.editingId = tierId;
    tierEditor.before = { ...tier, items: tier.items };
    tiersBeforeEdit = JSON.stringify(state.tiers);
    byId<HTMLInputElement>('edlbl').value = tier.label;
    byId<HTMLInputElement>('edsub').value = tier.subtitle || '';
    byId<HTMLInputElement>('edcol').value = tier.color;
    const swatch = palette.findIndex((c) => c.toLowerCase() === tier.color.toLowerCase());
    selectedSwatch = swatch < 0 ? null : swatch;
    renderSwatches();
    byId<HTMLInputElement>('edauto').checked = !isHexColor(tier.textColor);
    byId<HTMLInputElement>('edtxt').value = labelTextColor(tier);
    placePopover(byId('ted'), anchor);
    byId<HTMLInputElement>('edlbl').focus();
    byId<HTMLInputElement>('edlbl').select();
}

export function saveTierEdit(): void {
    const tier = tierEditor.editingId ? findTier(tierEditor.editingId) : undefined;
    if (!tier) return;
    previewTierEdit();
    if (tiersBeforeEdit && tiersBeforeEdit !== JSON.stringify(state.tiers)) {
        undoStack.push(tiersBeforeEdit);
        redoStack.length = 0;
    }
    tierEditor.before = null;
    tiersBeforeEdit = null;
    closePopovers();
    renderTiers();
    autosave();
}

/** Closing without saving puts the tier back how it was. */
function discardUnsavedEdit(): void {
    if (tierEditor.before) {
        const tier = findTier(tierEditor.before.id);
        if (tier) {
            Object.assign(tier, tierEditor.before);
            paintTier(tier);
        }
        tierEditor.before = null;
    }
    tierEditor.editingId = null;
}

// ── palette: click a swatch, then pick a custom colour to replace it ──
export let palette: string[] = [];
let selectedSwatch: number | null = null;
let paletteSaveTimer: ReturnType<typeof setTimeout> | undefined;

export function loadPalette(): void {
    let saved: unknown = null;
    try {
        saved = JSON.parse(localStorage.getItem('pt_palette') || 'null');
    } catch {}
    if (Array.isArray(saved) && saved.length && saved.every(isHexColor)) {
        palette = saved as string[];
        return;
    }
    const seen = new Set<string>();
    palette = [...state.tiers.map((t) => t.color), ...DEFAULT_SWATCHES]
        .map((c) => c.toLowerCase())
        .filter((c) => isHexColor(c) && !seen.has(c) && !!seen.add(c))
        .slice(0, 20);
}

const savePalette = (): void => {
    try {
        localStorage.setItem('pt_palette', JSON.stringify(palette));
    } catch {}
};
const savePaletteSoon = (): void => {
    clearTimeout(paletteSaveTimer);
    paletteSaveTimer = setTimeout(savePalette, 250);
};

function renderSwatches(): void {
    byId<HTMLButtonElement>('edswdel').disabled = selectedSwatch == null;
    setHtml(
        byId('swatches'),
        html`${palette.map(
            (color, i) =>
                html`<div class="sw${i === selectedSwatch ? ' act' : ''}" data-i="${i}" style="background:${color}" title="${color} (right-click to remove)"></div>`,
        )}<div class="sw swadd" title="Add the custom colour as a new swatch">+</div>`,
    );
}

function removeSwatch(index: number): void {
    if (palette.length < 2) return;
    palette.splice(index, 1);
    selectedSwatch = null;
    savePalette();
    renderSwatches();
    toast('Colour removed from your palette');
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupTierEditor(): void {
    onPopoversClose(discardUnsavedEdit);
    byId('edtxt').addEventListener('input', () => {
        byId<HTMLInputElement>('edauto').checked = false;
        previewTierEdit();
    });
    for (const id of ['edlbl', 'edsub']) byId(id).addEventListener('input', previewTierEdit);
    byId('edauto').addEventListener('change', previewTierEdit);
    byId('swatches').addEventListener('click', (e) => {
        const swatch = (e.target as HTMLElement).closest<HTMLElement>('.sw');
        if (!swatch) return;
        if (swatch.classList.contains('swadd')) {
            palette.push(byId<HTMLInputElement>('edcol').value);
            selectedSwatch = palette.length - 1;
            savePalette();
            renderSwatches();
            toast('Colour added to your palette');
            return;
        }
        selectedSwatch = Number(swatch.dataset.i);
        byId<HTMLInputElement>('edcol').value = palette[selectedSwatch]!;
        renderSwatches();
        previewTierEdit();
    });
    byId('swatches').addEventListener('contextmenu', (e) => {
        const swatch = (e.target as HTMLElement).closest<HTMLElement>('.sw[data-i]');
        if (!swatch) return;
        e.preventDefault();
        removeSwatch(Number(swatch.dataset.i));
    });
    byId<HTMLInputElement>('edcol').oninput = (e) => {
        const color = (e.target as HTMLInputElement).value;
        if (selectedSwatch != null) {
            palette[selectedSwatch] = color;
            const swatch = byId('swatches').querySelector<HTMLElement>(`.sw[data-i="${selectedSwatch}"]`);
            if (swatch) swatch.style.background = color;
            savePaletteSoon();
        }
        previewTierEdit();
    };
    byId('edswdel').onclick = () => {
        if (selectedSwatch != null) removeSwatch(selectedSwatch);
    };
    byId('edpalreset').onclick = (e) => {
        e.preventDefault();
        palette = [...DEFAULT_SWATCHES];
        selectedSwatch = null;
        savePalette();
        renderSwatches();
        toast('Palette reset');
    };
    byId('edsave').onclick = saveTierEdit;
    byId('edclose').onclick = closePopovers;
    byId<HTMLInputElement>('edlbl').onkeydown = byId<HTMLInputElement>('edsub').onkeydown = (e) => {
        if (e.key === 'Enter') saveTierEdit();
    };
    byId('eddel').onclick = async () => {
        const tierId = tierEditor.editingId;
        const tier = tierId ? findTier(tierId) : undefined;
        if (!tier) return;
        closePopovers();
        if (
            !(await ask(
                `Delete tier "${tier.label}"? Its ${tier.items.length} ${itemWord(tier.items.length)} ${tier.items.length === 1 ? 'goes' : 'go'} back to the pool.`,
                'Delete',
                true,
            ))
        )
            return;
        pushHistory();
        state.tiers = state.tiers.filter((t) => t.id !== tierId);
        renderTiers();
        autosave();
        toast('Tier deleted. Ctrl/⌘+Z to undo');
    };
}
