// src/features/layout/top-bar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The top bar's layout: which groups show, in what order, how big, and whether
//  it wraps or scrolls. Set in Style ▾ → Top bar; saved per browser ("pt_bar").
// ─────────────────────────────────────────────────────────────────────────────
import { currentListMeta, state } from '../../core/state';
import { isRecord } from '../../lib/checks';
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { toast } from '../../lib/ui';
import { logoParts } from '../appearance/theme';
import { measureRowWidth } from '../tier-board/board';

/** Each group of buttons in the bar (its data-bar name) and what the settings call it. */
export const TOP_BAR_ITEMS: readonly [key: string, label: string][] = [
    ['logo', 'Site name (logo)'],
    ['list', 'List menu'],
    ['file', 'File: save, load, share, export'],
    ['tabs', 'Tier list and Studio tabs'],
    ['size', 'Tier sprite size'],
    ['labels', 'Labels'],
    ['hover', 'Hover'],
    ['undo', 'Undo / redo'],
    ['tier', 'Add tier'],
    ['stream', 'Stream mode'],
    ['style', 'Style'],
    ['keys', '⌨ Shortcuts'],
    ['pool', 'Pool: beside, below or hidden'],
    ['hidebar', 'Hide bar'],
];
const KNOWN = TOP_BAR_ITEMS.map(([key]) => key);

/** Groups that were split up: a layout saved before keeps them where they were, shown or hidden as they were. */
const SPLIT_GROUPS: Readonly<Record<string, readonly string[]>> = { view: ['pool', 'hidebar'] };
const withSplitGroups = (keys: unknown[]): unknown[] => keys.flatMap((key) => SPLIT_GROUPS[String(key)] ?? [key]);

interface TopBarLayout {
    order: string[];
    hide: string[];
    size: 's' | 'm' | 'l';
    wrap: 'scroll' | 'wrap';
}
const defaultLayout = (): TopBarLayout => ({ order: [...KNOWN], hide: ['logo', 'stream'], size: 'm', wrap: 'scroll' });

/** The saved layout, checked: unknown groups dropped, new groups added at the end, Style never hidden. */
function loadLayout(): TopBarLayout {
    let saved: unknown = null;
    try {
        saved = JSON.parse(localStorage.getItem('pt_bar') || 'null');
    } catch {}
    const layout = defaultLayout();
    if (!isRecord(saved)) return layout;
    const order = Array.isArray(saved.order) ? withSplitGroups(saved.order).filter((k): k is string => KNOWN.includes(k as string)) : [];
    layout.order = [...new Set([...order, ...KNOWN])];
    if (Array.isArray(saved.hide))
        layout.hide = withSplitGroups(saved.hide).filter((k): k is string => KNOWN.includes(k as string) && k !== 'style');
    if (saved.size === 's' || saved.size === 'm' || saved.size === 'l') layout.size = saved.size;
    if (saved.wrap === 'scroll' || saved.wrap === 'wrap') layout.wrap = saved.wrap;
    return layout;
}

export let topBar: TopBarLayout = loadLayout();

const saveTopBar = (): void => {
    try {
        localStorage.setItem('pt_bar', JSON.stringify(topBar));
    } catch {}
};

export function applyTopBar(): void {
    topBar.order.forEach((key, i) => {
        const group = document.querySelector<HTMLElement>(`#toolbar [data-bar="${key}"]`);
        if (!group) return;
        group.style.setProperty('--o', String(i));
        group.classList.toggle('barhid', topBar.hide.includes(key));
    });
    const body = document.body.classList;
    body.remove('bar-s', 'bar-m', 'bar-l');
    body.add('bar-' + topBar.size);
    body.toggle('bar-wrap', topBar.wrap === 'wrap');
    renderListButton();
    setTimeout(measureRowWidth, 60);
}

/** The list menu button; with the logo hidden it shows the list name in the logo style instead. */
export function renderListButton(): void {
    const meta = currentListMeta();
    const button = byId('listbtn');
    const asLogo = topBar.hide.includes('logo');
    button.classList.toggle('aslogo', asLogo);
    const name = meta ? meta.name : 'Tier list';
    const badge = meta?.kind === 'pokemon' && html` <span class="kbadge">Pokémon</span>`;
    setHtml(
        button,
        asLogo
            ? html`<span class="logo ${state.theme.logo}">${logoParts(name)}</span>${badge}<span class="caret">▾</span>`
            : html`${name}${badge} ▾`,
    );
}

export function renderTopBarList(): void {
    byId<HTMLSelectElement>('barsize').value = topBar.size;
    byId<HTMLSelectElement>('barwrap').value = topBar.wrap;
    const last = topBar.order.length - 1;
    setHtml(
        byId('barlist'),
        html`${topBar.order.map((key, i) => {
            const label = TOP_BAR_ITEMS.find(([k]) => k === key)?.[1] ?? key;
            const hidden = topBar.hide.includes(key);
            return html`<div class="barrow${hidden ? ' off' : ''}" data-k="${key}"><input type="checkbox" aria-label="Show ${label}"${hidden ? '' : html` checked`}${key === 'style' && html` disabled title="Always shown (this menu lives here). Press S to open it."`}><span class="bn">${label}</span><button data-mv="-1" aria-label="Move ${label} up"${i ? '' : html` disabled`}>↑</button><button data-mv="1" aria-label="Move ${label} down"${i < last ? '' : html` disabled`}>↓</button></div>`;
        })}`,
    );
}

function layoutChanged(): void {
    saveTopBar();
    applyTopBar();
    renderTopBarList();
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupTopBar(): void {
    byId('barlist').addEventListener('change', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.barrow');
        if (!row) return;
        const key = row.dataset.k!;
        topBar.hide = topBar.hide.filter((k) => k !== key);
        if (!(e.target as HTMLInputElement).checked) topBar.hide.push(key);
        layoutChanged();
    });
    byId('barlist').addEventListener('click', (e) => {
        const move = (e.target as HTMLElement).closest<HTMLElement>('[data-mv]');
        if (!move) return;
        const key = move.closest<HTMLElement>('.barrow')!.dataset.k!;
        const from = topBar.order.indexOf(key);
        const to = from + Number(move.dataset.mv);
        if (to < 0 || to >= topBar.order.length) return;
        topBar.order.splice(from, 1);
        topBar.order.splice(to, 0, key);
        layoutChanged();
    });
    byId<HTMLSelectElement>('barsize').onchange = (e) => {
        topBar.size = (e.target as HTMLSelectElement).value as TopBarLayout['size'];
        saveTopBar();
        applyTopBar();
    };
    byId<HTMLSelectElement>('barwrap').onchange = (e) => {
        topBar.wrap = (e.target as HTMLSelectElement).value as TopBarLayout['wrap'];
        saveTopBar();
        applyTopBar();
    };
    byId('barreset').onclick = () => {
        topBar = defaultLayout();
        layoutChanged();
        toast('Top bar reset');
    };
}
