// src/features/forms/forms.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Pokémon forms (Mega, Alolan, Gigantamax…): ranked as their own entries, or
//  merged into their species. Set per category in the Forms ▾ panel, or one form
//  at a time from the forms bar above a Pokémon's sprites.
// ─────────────────────────────────────────────────────────────────────────────
import { pushHistory } from '../../core/history';
import { entries, entryById, formsByDex, isRankable } from '../../core/items';
import { autosave } from '../../core/persist';
import { state } from '../../core/state';
import type { FormCategory, ItemId } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, type SafeHtml, setHtml } from '../../lib/html';
import { ask, placePopover, toast } from '../../lib/ui';
import { placeAllTiles, removeFromTiers } from '../tier-board/board';

export const FORM_CATEGORIES: readonly [key: FormCategory, label: string, examples: string][] = [
    ['regional', 'Regional forms', 'Alolan, Galarian, Hisuian, Paldean'],
    ['mega', 'Mega & Primal', 'Mega Charizard X, Primal Kyogre…'],
    ['gmax', 'Gigantamax', 'Gigantamax Charizard…'],
    [
        'battle',
        'Forms that play differently',
        'Different type, stats or ability: Rotom, Castform, Deoxys, Kyurem, Origin Palkia, Necrozma…',
    ],
    ['cosmetic', 'Look-only forms', 'Same Pokémon, different look: Pikachu caps & costumes, Partner Pikachu, Totems, Minior colours…'],
];

const splitListeners: (() => void)[] = [];
/** Runs after forms are split out or merged back (the studio and quick picker redraw). */
export const onFormsChange = (listener: () => void): void => void splitListeners.push(listener);

/** The species a merged form belongs to, or the id itself if it's still ranked on its own. */
export const rankableIdFor = (id: ItemId): ItemId => (isRankable(id) ? id : (entryById.get(id)?.dex ?? id));

// ═════════════════════════════════════════════════════════════════════════════
//  SPLITTING AND MERGING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Applies a change to which forms are separate. Forms that merged back leave the tiers
 * (after asking, if any were ranked). False if you said no; the caller undoes its change.
 */
async function applySplitChange(): Promise<boolean> {
    const lost = state.tiers.flatMap((tier) => tier.items.filter((id) => !isRankable(id)));
    if (lost.length) {
        const names = lost.slice(0, 6).map((id) => entryById.get(id)!.name);
        const message = `${lost.length} ranked form${lost.length > 1 ? 's' : ''} will merge back into the base Pokémon and leave your list: ${names.join(', ')}${lost.length > 6 ? '…' : ''}`;
        if (!(await ask(message, 'Merge'))) return false;
        pushHistory();
    }
    removeFromTiers(lost);
    state.selection.forEach((id) => {
        if (!isRankable(id)) state.selection.delete(id);
    });
    placeAllTiles();
    syncFormPanel();
    splitListeners.forEach((listener) => {
        listener();
    });
    autosave();
    return true;
}

/** Makes one form its own entry (true) or merges it back (false). */
async function setFormOverride(formId: ItemId, separate: boolean): Promise<boolean> {
    const previous = state.formOverrides[formId];
    state.formOverrides[formId] = separate;
    if (!(await applySplitChange())) {
        if (previous == null) delete state.formOverrides[formId];
        else state.formOverrides[formId] = previous;
        return false;
    }
    const form = entryById.get(formId)!;
    toast(separate ? `${form.name} is now its own entry (in the pool)` : `${form.name} merged into ${entryById.get(form.dex!)!.name}`);
    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  FORMS BAR (above a Pokémon's sprites)
// ═════════════════════════════════════════════════════════════════════════════

export function formsBar(id: ItemId): SafeHtml {
    const entry = entryById.get(id)!;
    if (entry.form) {
        const species = entryById.get(entry.dex!)!;
        return html`<div class="fbar"><span class="tbl">Form</span><span>${entry.name} is ranked as its own entry.</span><button class="fmerge" data-fid="${id}">Merge back into ${species.name}</button><button class="fopen" data-id="${species.id}">Open ${species.name}</button></div>`;
    }
    const forms = formsByDex.get(entry.dex ?? -1);
    if (!forms) return html``;
    const chips = forms.map((form) => {
        const separate = isRankable(form.id);
        const title = separate ? `Separate entry. Tap to merge into ${entry.name}` : `Part of ${entry.name}. Tap to split out`;
        return html`<button class="fchip${separate ? ' on' : ''}" data-fid="${form.id}" title="${title}">${separate ? '✓ ' : ''}${form.name}</button>`;
    });
    return html`<div class="fbar"><span class="tbl">Forms</span><span class="note">Tap to make a form its own tier entry, or merge it back:</span><div class="fchips">${chips}</div></div>`;
}

/**
 * A click inside the forms bar. `open` shows another Pokémon (after a merge, or "Open …").
 * True if the click was on the bar's buttons.
 */
export async function onFormsClick(e: Event, open: (id: ItemId) => void): Promise<boolean> {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>('.fchip');
    const merge = target.closest<HTMLElement>('.fmerge');
    const openButton = target.closest<HTMLElement>('.fopen');
    if (!chip && !merge && !openButton) return false;
    e.stopPropagation();
    if (chip) {
        const formId = Number(chip.dataset.fid);
        await setFormOverride(formId, !isRankable(formId));
    } else if (merge) {
        const formId = Number(merge.dataset.fid);
        if (await setFormOverride(formId, false)) open(entryById.get(formId)!.dex!);
    } else open(Number(openButton!.dataset.id));
    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  FORMS PANEL (Forms ▾ in the top bar)
// ═════════════════════════════════════════════════════════════════════════════

export function buildFormPanel(): void {
    const panel = byId('formcats');
    setHtml(
        panel,
        html`${FORM_CATEGORIES.map(([key, label, examples]) => {
            const count = entries.filter((entry) => entry.form === key).length;
            return html`<label class="ck fcat"><input type="checkbox" data-cat="${key}"><span><b>${label}</b> <span class="note">(${count})</span><br><span class="note">${examples}</span></span></label>`;
        })}`,
    );
    panel.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
        input.onchange = async () => {
            const category = input.dataset.cat as FormCategory;
            const previous = state.splitFormCategories[category];
            const previousOverrides = { ...state.formOverrides };
            state.splitFormCategories[category] = input.checked;
            // switching a whole category overrides earlier one-off choices in it
            for (const entry of entries) if (entry.form === category) delete state.formOverrides[entry.id];
            if (!(await applySplitChange())) {
                state.splitFormCategories[category] = previous;
                state.formOverrides = previousOverrides;
                syncFormPanel();
            }
        };
    });
}

export function syncFormPanel(): void {
    byId('formcats')
        .querySelectorAll<HTMLInputElement>('input')
        .forEach((input) => {
            input.checked = !!state.splitFormCategories[input.dataset.cat as FormCategory];
        });
    const separate = entries.filter((entry) => entry.form && isRankable(entry.id)).length;
    byId('formbtn').textContent = `Forms: ${separate} separate ▾`;
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupForms(): void {
    byId('formbtn').onclick = (e) => {
        syncFormPanel();
        placePopover(byId('formpanel'), e.currentTarget as Element);
    };
}
