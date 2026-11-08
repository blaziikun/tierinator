// src/features/appearance/panel.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The Appearance drawer (#appear, Style ▾): pick a saved theme, edit colours,
//  fonts and sizes live, save variations to your theme library (per browser).
// ─────────────────────────────────────────────────────────────────────────────
import { BUILT_IN_THEME, makePresetTiers, myDefaultTiers, saveMyDefaultTiers, THEME_KEYS } from '../../core/defaults';
import { onHistoryRestore, pushHistory } from '../../core/history';
import { autosave } from '../../core/persist';
import { state } from '../../core/state';
import type { Theme } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId, randomId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { ask, closePopovers, toast } from '../../lib/ui';
import { renderTopBarList } from '../layout/top-bar';
import { renderTiers } from '../tier-board/board';
import {
    applyTheme,
    FONT_CATEGORIES,
    FONTS,
    type FontCategory,
    fontStack,
    fontWeights,
    loadFont,
    nearestWeight,
    sanitizeTheme,
    WEIGHT_NAMES,
} from './theme';

/** The editable part of a theme (everything except its name and preset). */
type ThemeFields = Omit<Theme, 'preset' | 'name'>;
interface SavedTheme {
    id: string;
    name: string;
    t: Partial<ThemeFields>;
}

/** Your saved themes ("pt_themes") and your edits to the built-in one ("pt_theme_default"), per browser. */
export let themeLibrary: SavedTheme[] = [];
let defaultThemeOverride: Partial<ThemeFields> | null = null;

const saveThemeLibrary = (): void => {
    try {
        localStorage.setItem('pt_themes', JSON.stringify(themeLibrary));
        localStorage.setItem('pt_theme_default', JSON.stringify(defaultThemeOverride));
    } catch {}
};

const themeFields = (theme: Theme): ThemeFields => Object.fromEntries(THEME_KEYS.map((key) => [key, theme[key]])) as ThemeFields;

function themeById(id: string | undefined): SavedTheme | undefined {
    if (id === 'default') return { id: 'default', name: 'Tierinator', t: { ...BUILT_IN_THEME, ...(defaultThemeOverride || {}) } };
    return themeLibrary.find((t) => t.id === id);
}

/** True when the open list's look differs from the theme it started from. */
const themeIsEdited = (): boolean => {
    const base = themeById(state.theme.preset);
    if (!base) return true;
    const saved = themeFields(sanitizeTheme(base.t));
    const current = themeFields(state.theme);
    return THEME_KEYS.some((key) => String(saved[key]) !== String(current[key]));
};

function useTheme(id: string): void {
    const base = themeById(id);
    if (!base) return;
    pushHistory();
    state.theme = sanitizeTheme({ ...base.t, name: state.theme.name, preset: id });
    applyTheme();
    syncAppearancePanel();
    autosave();
}

/** What the name row is for: saving a new theme, or renaming one ("rename:<id>"). */
let nameRowMode: 'new' | `rename:${string}` | null = null;

function renderThemeCards(): void {
    const themes = [themeById('default')!, ...themeLibrary];
    setHtml(
        byId('presets'),
        html`${themes.map((saved) => {
            const look = sanitizeTheme(saved.t);
            loadFont(look.fHead);
            const current = saved.id === state.theme.preset;
            const actions =
                saved.id === 'default'
                    ? defaultThemeOverride &&
                      html`<span class="pact"><button class="trestore" title="Restore the original default">↺</button></span>`
                    : html`<span class="pact"><button class="tren" title="Rename">✎</button><button class="tdel" title="Delete theme">✕</button></span>`;
            return html`<div class="preset${current ? ' on' : ''}" data-id="${saved.id}"><div class="pv" style="background:${look.bg};color:${look.text}"><span class="aa" style="font-family:${fontStack(look.fHead)};font-weight:${look.wHead}">Aa</span><span class="dots"><i style="background:${look.accent}"></i><i style="background:${look.hi}"></i><i style="background:${look.muted}"></i><i style="background:${look.panel};outline:1px solid ${look.muted}55"></i></span></div><span class="pn">${saved.name}${current && themeIsEdited() && html` <em>(edited)</em>`}</span>${actions}</div>`;
        })}`,
    );
    const base = themeById(state.theme.preset);
    const update = byId('thupd');
    update.classList.toggle('hid', !(base && themeIsEdited()));
    if (base) update.textContent = `Save changes to “${base.name}”`;
}

function showNameRow(mode: NonNullable<typeof nameRowMode>, value = ''): void {
    nameRowMode = mode;
    byId('thname').classList.remove('hid');
    const input = byId<HTMLInputElement>('thnamein');
    input.value = value;
    input.focus();
    input.select();
}

/** The editor's controls are wired once; data-t="<theme field>" on each control says what it edits. */
export function buildAppearancePanel(): void {
    byId('presets').addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const card = target.closest<HTMLElement>('.preset');
        if (!card) return;
        const id = card.dataset.id!;
        if (target.closest('.tdel')) {
            if (!(await ask(`Delete the theme “${themeById(id)!.name}”? Your current look stays as it is.`, 'Delete', true))) return;
            themeLibrary = themeLibrary.filter((t) => t.id !== id);
            saveThemeLibrary();
            if (state.theme.preset === id) state.theme.preset = 'default';
            renderThemeCards();
            autosave();
            return;
        }
        if (target.closest('.tren')) {
            showNameRow(`rename:${id}`, themeById(id)!.name);
            return;
        }
        if (target.closest('.trestore')) {
            if (!(await ask('Restore the original built-in default theme?', 'Restore'))) return;
            defaultThemeOverride = null;
            saveThemeLibrary();
            useTheme('default');
            return;
        }
        useTheme(id);
    });
    byId('thsave').onclick = () => showNameRow('new', `My theme ${themeLibrary.length + 1}`);
    const hideNameRow = () => {
        nameRowMode = null;
        byId('thname').classList.add('hid');
    };
    byId('thnamex').onclick = hideNameRow;
    byId('thnamein').onkeydown = (e) => {
        if (e.key === 'Enter') byId('thnameok').click();
        if (e.key === 'Escape') hideNameRow();
    };
    byId('thnameok').onclick = () => {
        const name = byId<HTMLInputElement>('thnamein').value.trim().slice(0, 30) || 'Untitled theme';
        if (nameRowMode === 'new') {
            const id = 't' + randomId();
            themeLibrary.push({ id, name, t: themeFields(state.theme) });
            state.theme.preset = id;
            toast(`Saved theme “${name}”`);
        } else if (nameRowMode?.startsWith('rename:')) {
            const saved = themeLibrary.find((t) => t.id === nameRowMode!.slice(7));
            if (saved) saved.name = name;
        }
        saveThemeLibrary();
        hideNameRow();
        renderThemeCards();
        autosave();
    };
    byId('thupd').onclick = () => {
        const id = state.theme.preset;
        if (id === 'default') defaultThemeOverride = themeFields(state.theme);
        else {
            const saved = themeLibrary.find((t) => t.id === id);
            if (saved) saved.t = themeFields(state.theme);
        }
        saveThemeLibrary();
        renderThemeCards();
        toast(`Updated “${themeById(id)?.name}”`);
    };

    // font pickers, grouped by kind
    const fontsByCategory = new Map<FontCategory, string[]>();
    for (const [font, info] of Object.entries(FONTS)) {
        if (!fontsByCategory.has(info.c)) fontsByCategory.set(info.c, []);
        fontsByCategory.get(info.c)!.push(font);
    }
    const fontOptions = html`${[...fontsByCategory].map(
        ([category, fonts]) =>
            html`<optgroup label="${FONT_CATEGORIES[category]}">${fonts.map((f) => html`<option value="${f}">${f}</option>`)}</optgroup>`,
    )}`;
    document.querySelectorAll('#appear .fontsel').forEach((select) => {
        setHtml(select, fontOptions);
    });

    // every control edits one theme field live
    const theme = (): Record<string, string | number | boolean> => state.theme as unknown as Record<string, string | number | boolean>;
    // one undo step per change: a whole slider drag or colour-picker session counts once
    let editing = false;
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#appear [data-t]').forEach((control) => {
        const key = control.dataset.t!;
        if (control.tagName !== 'SELECT')
            control.addEventListener('change', () => {
                editing = false;
            });
        control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
            if (!editing) pushHistory();
            editing = control.tagName !== 'SELECT';
            const isNumber = control.type === 'range' || /^w/.test(key);
            const value = isNumber ? Number(control.value) : control.value;
            theme()[key] = value;
            if (key === 'fHead') {
                for (const weight of ['wLogo', 'wLabel', 'wHead'] as const)
                    state.theme[weight] = nearestWeight(String(value), state.theme[weight]);
                loadFont(String(value));
            }
            if (key === 'fUi') {
                state.theme.wUi = nearestWeight(String(value), state.theme.wUi);
                loadFont(String(value));
            }
            applyTheme();
            if (key === 'lblColor') renderTiers();
            syncAppearancePanel(control);
            autosave();
        });
    });
    // "Same as page" / "Auto" boxes clear a colour back to automatic
    document.querySelectorAll<HTMLInputElement>('#appear [data-autofor]').forEach((box) => {
        box.addEventListener('change', () => {
            pushHistory();
            const key = box.dataset.autofor!;
            theme()[key] = box.checked ? '' : document.querySelector<HTMLInputElement>(`#appear input[data-t="${key}"]`)!.value;
            applyTheme();
            renderTiers();
            syncAppearancePanel();
            autosave();
        });
    });
    byId<HTMLInputElement>('ap-tagdots').onchange = (e) => {
        pushHistory();
        state.theme.tagDots = (e.target as HTMLInputElement).checked;
        applyTheme();
        autosave();
    };
    byId('apclose').onclick = byId('apdone').onclick = closeAppearance;
    // undo / redo can put back an earlier look
    onHistoryRestore(() => {
        applyTheme();
        syncAppearancePanel();
    });
    byId('apreset').onclick = () => {
        useTheme(themeById(state.theme.preset) ? state.theme.preset! : 'default');
        toast('Edits undone');
    };
}

/** Shows the open list's theme in every control (except `skip`, the one being dragged). */
export function syncAppearancePanel(skip?: Element): void {
    const theme = state.theme;
    const value = (key: string) => (theme as unknown as Record<string, string | number | boolean>)[key];
    document.querySelectorAll<HTMLSelectElement>('#appear select[data-f]').forEach((select) => {
        setHtml(
            select,
            html`${fontWeights(String(value(select.dataset.f!))).map((w) => html`<option value="${w}">${w} (${WEIGHT_NAMES[w]})</option>`)}`,
        );
    });
    const automaticShows: Record<string, string> = { rowBg: theme.bg, lblColor: '#111111' };
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#appear [data-t]').forEach((control) => {
        const key = control.dataset.t!;
        if (control !== skip || control.tagName === 'SELECT')
            control.value = String(control.dataset.auto && !value(key) ? automaticShows[key] : value(key));
    });
    document.querySelectorAll<HTMLInputElement>('#appear [data-autofor]').forEach((box) => {
        box.checked = !value(box.dataset.autofor!);
    });
    document.querySelectorAll<HTMLElement>('#appear [data-v]').forEach((label) => {
        const key = label.dataset.v!;
        const v = Number(value(key));
        label.textContent = key === 'ls' ? (v > 0 ? '+' : '') + v.toFixed(2) + 'em' : key === 'tint' ? Math.round(v * 100) + '%' : v + 'px';
    });
    renderThemeCards();
    byId<HTMLInputElement>('ap-tagdots').checked = theme.tagDots;
    const headingSample = byId('ap-hsample').style;
    headingSample.fontFamily = fontStack(theme.fHead);
    headingSample.fontWeight = String(theme.wLabel);
    headingSample.letterSpacing = theme.ls + 'em';
    headingSample.textTransform = theme.tt;
    const uiSample = byId('ap-usample').style;
    uiSample.fontFamily = fontStack(theme.fUi);
    uiSample.fontWeight = String(theme.wUi);
}

export function openAppearance(): void {
    closePopovers();
    syncAppearancePanel();
    renderTopBarList();
    byId('appear').classList.add('open');
}
export function closeAppearance(): void {
    byId('appear').classList.remove('open');
}

/** Saved themes from this browser, checked (a malformed entry is skipped, not trusted). */
function loadThemeLibrary(): void {
    let saved: unknown = [];
    try {
        saved = JSON.parse(localStorage.getItem('pt_themes') || '[]');
    } catch {}
    themeLibrary = (Array.isArray(saved) ? saved : [])
        .filter((t): t is SavedTheme => isRecord(t) && typeof t.id === 'string' && typeof t.name === 'string' && isRecord(t.t))
        .map((t) => ({ id: t.id, name: t.name.slice(0, 30), t: t.t }));
    try {
        const override: unknown = JSON.parse(localStorage.getItem('pt_theme_default') || 'null');
        defaultThemeOverride = isRecord(override) ? (override as Partial<ThemeFields>) : null;
    } catch {}
}

/** "Forget my default" only shows when there is one. */
const syncMyTiersButtons = (): void => {
    byId('mytiersx').classList.toggle('hid', !myDefaultTiers());
};

// ── wiring (runs once at start-up, from main.ts) ──
export function setupPanel(): void {
    loadThemeLibrary();
    // Firefox-based browsers, reopening tabs after a restart, replay old form values as input events: on this
    // closed panel's untouched controls (black colours, sliders at half way) that rewrote the whole look and the
    // layout. Only someone using the open panel can change anything in it.
    for (const type of ['input', 'change'])
        byId('appear').addEventListener(
            type,
            (e) => {
                if (!byId('appear').classList.contains('open')) e.stopImmediatePropagation();
            },
            true,
        );
    byId('stylebtn').onclick = () => (byId('appear').classList.contains('open') ? closeAppearance() : openAppearance());
    byId('presetbtn').onclick = async () => {
        const preset = myDefaultTiers() ? 'your default tiers' : 'the default tiers (SS → U)';
        if (!(await ask(`Reset this list's tiers to ${preset}, names and colours? Ranked items stay in place by row.`, 'Reset'))) return;
        pushHistory();
        const ranked = state.tiers.map((t) => t.items);
        state.tiers = makePresetTiers();
        ranked.forEach((items, i) => {
            state.tiers[Math.min(i, state.tiers.length - 1)]!.items.push(...items);
        });
        renderTiers();
        autosave();
        toast('Tiers reset');
    };
    byId('mytiersbtn').onclick = () => {
        saveMyDefaultTiers(state.tiers);
        syncMyTiersButtons();
        toast(`New lists will start with these ${state.tiers.length} tiers`);
    };
    byId('mytiersx').onclick = () => {
        saveMyDefaultTiers(null);
        syncMyTiersButtons();
        toast('New lists will start with SS → U again');
    };
    syncMyTiersButtons();
}
