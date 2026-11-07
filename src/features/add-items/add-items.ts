// src/features/add-items/add-items.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The Add items window (#addm):
//
//    Upload    picture files (or drop them) → one item each
//    Type      names, one per line → text tiles, or the first web picture for each;
//              or a CSV file (csv-import.ts)
//    Search    a web source (web-sources.ts) → pick results to add
//    Links     picture addresses ("Name | https://…" or just the address)
//    Wiki      a wiki category (wiki/category-import.ts)
// ─────────────────────────────────────────────────────────────────────────────
import { byId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { addImageFiles, addItems, type NewItem } from '../items/items';
import { importCsvFile } from './csv-import';
import { WEB_SOURCES, type WebResults, type WebSource } from './web-sources';

type AddTab = 'up' | 'txt' | 'web' | 'url' | 'wiki';

/** The last search's results (cards point into it by index). */
let webResults: WebResults = [];

const closeAddItems = (): void => void byId('addm').classList.remove('show');
const chosenSource = (): WebSource => WEB_SOURCES[byId<HTMLSelectElement>('websrc').value] ?? WEB_SOURCES.wiki!;

export function openAddItems(tab: AddTab = 'up'): void {
    byId('addm').classList.add('show');
    showTab(tab);
}

function showTab(tab: string): void {
    document.querySelectorAll<HTMLElement>('#addtabs button').forEach((button) => {
        button.classList.toggle('on', button.dataset.t === tab);
    });
    document.querySelectorAll<HTMLElement>('#addbox [data-p]').forEach((panel) => {
        panel.classList.toggle('hid', panel.dataset.p !== tab);
    });
    if (tab === 'web') byId('webq').focus();
    if (tab === 'wiki') byId('wkurl').focus();
}

// ── Type ──
const typedNames = (): string[] =>
    byId<HTMLTextAreaElement>('addtxt')
        .value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

/** Each typed name gets the first picture the chosen source finds (its other pictures become choices). */
async function addTypedWithPictures(): Promise<void> {
    const names = typedNames();
    if (!names.length) return;
    const source = chosenSource();
    closeAddItems();
    showProgress(`Finding pictures (${source.name})…`, true);
    const items: NewItem[] = [];
    let withoutPicture = 0;
    for (const [index, name] of names.entries()) {
        if (progress.cancelled) break;
        let best: WebResults[number] | undefined;
        try {
            best = (await source.search(name))[0];
        } catch {}
        if (!best) withoutPicture++;
        items.push({ name, url: best?.img, alts: best?.imgs });
        updateProgress(`${index + 1} / ${names.length}`, ((index + 1) / names.length) * 60);
    }
    hideProgress();
    await addItems(items);
    byId<HTMLTextAreaElement>('addtxt').value = '';
    if (withoutPicture) toast(`${withoutPicture} had no picture, so they got text tiles`);
}

// ── Search ──
async function runWebSearch(): Promise<void> {
    const query = byId<HTMLInputElement>('webq').value.trim();
    const sourceKey = byId<HTMLSelectElement>('websrc').value;
    if (!query && sourceKey !== 'countries') return;
    const results = byId('webres');
    setHtml(results, html`<div class="empty">Searching…</div>`);
    try {
        webResults = await chosenSource().search(query);
    } catch {
        setHtml(results, html`<div class="empty">Couldn't reach ${chosenSource().name}. Check your connection.</div>`);
        return;
    }
    const cards = webResults.map(
        (result, index) =>
            html`<div class="vc" data-i="${index}" title="${result.name}"><div class="vimg"><img alt="" loading="lazy" src="${result.img}" referrerpolicy="no-referrer"></div><div class="vl"><b>${result.name}</b>${result.sub && html`<br>${result.sub}`}${result.badge && html`<br><small class="srcb">${result.badge}</small>`}</div></div>`,
    );
    setHtml(
        results,
        html`${webResults.note && html`<div class="note webnote">${webResults.note}</div>`}${cards.length ? cards : html`<div class="empty">No results with pictures.</div>`}`,
    );
    syncAddSelected();
}

function syncAddSelected(): void {
    const chosen = byId('webres').querySelectorAll('.vc.chosen').length;
    const button = byId<HTMLButtonElement>('webadd');
    button.disabled = !chosen;
    button.textContent = chosen ? `Add ${chosen} selected` : 'Add selected';
}

// ── Links ──
/** "Name | https://…" or a bare address (named after its file). Only https addresses are fetched. */
function readLinkLine(line: string): NewItem {
    const [first = '', ...rest] = line.split('|');
    const url = rest.length ? rest.join('|').trim() : line;
    let name = rest.length ? first.trim() : '';
    if (!name)
        try {
            name = decodeURIComponent(url.split('/').pop()!.split('?')[0]!).replace(/\.[a-z0-9]+$/i, '');
        } catch {}
    return { name: name || 'Image', url: /^https:\/\//.test(url) ? url : undefined };
}

// ── wiring (runs once at start-up, from main.ts) ──
const uploadInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, className: 'hid' });

export function setupAddItems(): void {
    byId('addtabs').addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.t;
        if (tab) showTab(tab);
    });
    byId('addbtn').onclick = () => openAddItems('up');
    byId('addx').onclick = closeAddItems;
    byId('addm').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAddItems();
    });

    // Upload
    document.body.append(uploadInput);
    uploadInput.onchange = () => {
        const files = [...(uploadInput.files || [])];
        uploadInput.value = '';
        closeAddItems();
        void addImageFiles(files);
    };
    byId('addup').onclick = () => uploadInput.click();
    const dropZone = byId('addzone');
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dov');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dov'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dov');
        closeAddItems();
        void addImageFiles(e.dataTransfer?.files || []);
    });

    // Type
    byId('addtxtgo').onclick = () => {
        const names = typedNames();
        if (!names.length) return;
        closeAddItems();
        void addItems(
            names.map((name) => ({ name })),
            'Adding text items…',
        );
        byId<HTMLTextAreaElement>('addtxt').value = '';
    };
    byId('addtxtweb').onclick = () => void addTypedWithPictures();
    const csvInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,text/csv,text/plain', className: 'hid' });
    document.body.append(csvInput);
    byId('addcsv').onclick = () => csvInput.click();
    csvInput.onchange = () => {
        const file = csvInput.files?.[0];
        csvInput.value = '';
        if (!file) return;
        closeAddItems();
        void importCsvFile(file);
    };

    // Search
    const sourceMenu = byId<HTMLSelectElement>('websrc');
    setHtml(sourceMenu, html`${Object.entries(WEB_SOURCES).map(([key, source]) => html`<option value="${key}">${source.name}</option>`)}`);
    const syncSourceName = () => {
        byId('srcname').textContent = chosenSource().name;
    };
    syncSourceName();
    sourceMenu.onchange = syncSourceName;
    byId('webgo').onclick = () => void runWebSearch();
    byId<HTMLInputElement>('webq').onkeydown = (e) => {
        if (e.key === 'Enter') void runWebSearch();
    };
    byId('webres').addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('.vc');
        if (!card) return;
        card.classList.toggle('chosen');
        syncAddSelected();
    });
    byId('weball').onclick = () => {
        byId('webres')
            .querySelectorAll('.vc')
            .forEach((card) => {
                card.classList.add('chosen');
            });
        syncAddSelected();
    };
    byId('webadd').onclick = () => {
        const chosen = [...byId('webres').querySelectorAll<HTMLElement>('.vc.chosen')]
            .map((card) => webResults[Number(card.dataset.i)]!)
            .filter(Boolean);
        closeAddItems();
        void addItems(
            chosen.map((result) => ({ name: result.name, url: result.img, alts: result.imgs })),
            'Downloading pictures…',
        );
    };

    // Links
    byId('addurlgo').onclick = () => {
        const field = byId<HTMLTextAreaElement>('addurl');
        const items = field.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map(readLinkLine);
        if (!items.length) return;
        closeAddItems();
        void addItems(items, 'Downloading pictures…');
        field.value = '';
    };
}
