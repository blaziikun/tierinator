// src/features/group/group.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Combine rankings (#grpm): friends rank the same list and send their share
//  links or list files; this makes a new list of the group's ranking (the maths
//  is core/group-ranking.ts), then shows who agreed on what (#grpres). Nothing
//  leaves the browser. Loaded the first time it's opened (main.ts, loadOnFirstUse).
// ─────────────────────────────────────────────────────────────────────────────
import {
    agreementExtremes,
    closestPerson,
    combineProblem,
    combineRankings,
    foldName,
    GROUP_SIZE,
    type GroupItem,
    type GroupRanking,
    inTiers,
    type ListProblem,
    type RankedList,
    readRankedList,
    toGroupList,
} from '../../core/group-ranking';
import { isOwnItem } from '../../core/items';
import { saveNow, toSnapshot } from '../../core/persist';
import { addListMeta, saveListIndex, session, spriteBlobs, state } from '../../core/state';
import type { ItemId } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId } from '../../lib/dom';
import { html, type SafeHtml, setHtml } from '../../lib/html';
import { checkedImage } from '../../lib/images';
import { closePopovers, hideProgress, showProgress, toast, updateProgress } from '../../lib/ui';
import { openZipArchive, ZipError } from '../../lib/zip';
import { pokedex } from '../../pokemon/data';
import { labelTextColor } from '../appearance/theme';
import { MAX_JSON_BYTES } from '../files/files';
import { readListZip } from '../files/sprite-packs';
import { useTextTile } from '../items/items';
import { dropEmptyStartingList, forgetList, openList, renderListMenu } from '../lists/lists';
import { installPokemonPackIfAvailable } from '../packs/packs';
import { listInLink } from '../share/share';
import { setPick } from '../sprites/sprites';

/** One person's ranking, added to the window. */
interface Person {
    /** Stays the same when others are removed (the rows' buttons use it). */
    id: number;
    list: RankedList;
    /** Where it came from, as shown: "a link", the file's name, "your open list". */
    from: string;
    /** What a link, file or list it came from is called, so the same one isn't added twice. */
    source: string;
    name: string;
    /** The name was typed in, so it's kept as it is. */
    named: boolean;
    mine: boolean;
    /** Uploaded pictures that came with it (your open list, a list .zip), by item id. Checked again before use. */
    pictures: Map<ItemId, Blob>;
}

const group = {
    people: [] as Person[],
    nextPersonId: 1,
    /** What went wrong with the last things added, in plain words. */
    problems: [] as string[],
    /** Where focus was before a window opened: it goes back there on close. */
    opener: null as HTMLElement | null,
    /** Rankings are being added or combined: other clicks wait. */
    busy: false,
};

/** How many of each to show in the results. */
const RESULTS_SHOWN = 5;

const isShowing = (id: string): boolean => byId(id).classList.contains('show');
const plural = (count: number, one: string, many = one + 's'): string => `${count} ${count === 1 ? one : many}`;
/** "0.4 tiers": one decimal, enough to tell people apart without pretending to precision. */
const tiersText = (tiers: number): string => {
    const rounded = Math.round(tiers * 10) / 10;
    return `${rounded.toLocaleString('en', { maximumFractionDigits: 1 })} ${rounded === 1 ? 'tier' : 'tiers'}`;
};

// ═════════════════════════════════════════════════════════════════════════════
//  THE WINDOWS
// ═════════════════════════════════════════════════════════════════════════════

function buildWindows(): void {
    const adding = document.createElement('div');
    adding.id = 'grpm';
    adding.className = 'modal';
    setHtml(
        adding,
        html`<div class="mbox grpbox" id="grpbox" role="dialog" aria-modal="true" aria-labelledby="grptitle">
  <div class="addhead"><h3 id="grptitle">Combine rankings</h3><button id="grpx" class="grpclose" aria-label="Close" title="Close (Esc)">✕</button></div>
  <p class="note">Everyone ranks the same list, then sends you their share link or list file. Add them here to get a new list with the group's ranking. Nothing is sent anywhere.</p>
  <label class="grplabel" for="grplinks">Share links, one per line</label>
  <textarea id="grplinks" rows="3" spellcheck="false" autocomplete="off" placeholder="https://…/#l=…"></textarea>
  <div class="grpadd"><button id="grpaddlinks">Add links</button><button id="grpfiles" title="Lists saved with File → Save list (.json, or .zip with pictures)">Add list files…</button><button id="grpmine">Include my current list</button></div>
  <input type="file" id="grpinp" class="hid" multiple accept=".json,.zip,application/json,application/zip" aria-label="List files">
  <div id="grpmsg" class="grpmsg hid" role="status" aria-live="polite"></div>
  <h4 class="grphead" id="grppeoplehead">Rankings added</h4>
  <ol id="grppeople" class="grppeople" aria-labelledby="grppeoplehead"></ol>
  <div class="mbtns"><button id="grpgo" class="accent" disabled>Combine rankings</button><button id="grpcancel">Close</button></div>
</div>`,
    );
    const results = document.createElement('div');
    results.id = 'grpres';
    results.className = 'modal';
    setHtml(
        results,
        html`<div class="mbox grpbox" id="grpresbox" role="dialog" aria-modal="true" aria-labelledby="grprestitle">
  <div class="addhead"><h3 id="grprestitle">The group's ranking</h3><button id="grpresx" class="grpclose" aria-label="Close" title="Close (Esc)">✕</button></div>
  <div id="grpresbody" class="grpresbody"></div>
  <div class="mbtns"><button id="grpdone" class="accent">Done</button></div>
</div>`,
    );
    document.body.append(adding, results);
}

function openWindow(id: string, firstFocus: string): void {
    const focused = document.activeElement;
    group.opener = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    closePopovers();
    byId(id).classList.add('show');
    byId(firstFocus).focus();
}

function closeWindow(id: string): void {
    byId(id).classList.remove('show');
    // back where you were; if that's gone (a menu that closed), to the list menu's button
    const target = group.opener?.isConnected && group.opener.offsetParent ? group.opener : byId('listbtn');
    if (target.offsetParent) target.focus();
    group.opener = null;
}

function openCombineWindow(): void {
    renderPeople();
    // with a mouse, straight into the links box; on a touch screen that would cover the window with the keyboard
    openWindow('grpm', matchMedia('(pointer: fine)').matches ? 'grplinks' : 'grpx');
}

/** Tab and Shift+Tab stay inside the window while it's open; Escape closes it. */
function trapKeys(box: string, close: () => void): (e: KeyboardEvent) => void {
    return (e) => {
        if (isShowing('progmod') || isShowing('cconf')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation(); // the app's own Escape (clear selection, show the bar) is for the screen behind
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusable = [...byId(box).querySelectorAll<HTMLElement>('button, input, textarea, select')].filter(
            (element) => element.offsetParent && !(element as HTMLButtonElement).disabled,
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ADDING RANKINGS
// ═════════════════════════════════════════════════════════════════════════════

/** Names for people nobody named: the list's title if it's theirs alone, otherwise "Person 2"… */
function nameUnnamedPeople(): void {
    const titleCount = new Map<string, number>();
    for (const person of group.people) {
        const title = foldName(person.list.title);
        if (title) titleCount.set(title, (titleCount.get(title) ?? 0) + 1);
    }
    group.people.forEach((person, index) => {
        if (person.named) return;
        // everyone ranked the same template, so titles are often all alike and tell nobody apart
        const ownTitle = titleCount.get(foldName(person.list.title)) === 1;
        person.name = person.mine ? 'You' : ownTitle ? person.list.title : `Person ${index + 1}`;
    });
}

/** What to tell someone about a list that can't be combined. */
function problemText(label: string, problem: ListProblem): string {
    switch (problem) {
        case 'backup':
            return `${label} is a backup of many lists. Ask for just the one list (File → Save list).`;
        case 'pack':
            return `${label} is a pack, not a ranking. Ask for the ranked list instead (File → Save list or Copy share link).`;
        case 'chart':
            return `${label} is a chart, not a ranking, so it can't be combined. Only tier lists can.`;
        case 'nothing ranked':
            return `${label} has nothing in its tiers yet. Ask for it again once it's ranked.`;
        default:
            return `${label} isn't a tier list. Ask for a share link (File → Copy share link) or a list file (File → Save list).`;
    }
}

let pokemonNames: Map<ItemId, string> | null = null;
/** A Pokémon's name from the installed pack (forms too). */
const pokemonName = (id: ItemId): string | undefined => {
    if (!pokemonNames && pokedex.pack)
        pokemonNames = new Map([
            ...pokedex.roster.map(([rosterId, name]): [ItemId, string] => [rosterId, name]),
            ...pokedex.forms.map(([formId, , name]): [ItemId, string] => [formId, name]),
        ]);
    return pokemonNames?.get(id);
};

/** Where a ranking came from (see Person). */
interface Origin {
    from: string;
    source: string;
    mine?: boolean;
    pictures?: Map<ItemId, Blob>;
}

/** Checks one list and adds it, or says (in group.problems) why it can't be. */
async function addRanking(raw: unknown, label: string, { from, source, mine = false, pictures = new Map() }: Origin): Promise<void> {
    if (group.people.some((person) => person.source === source)) {
        group.problems.push(`${label} is already added.`);
        return;
    }
    if (group.people.length >= GROUP_SIZE.max) {
        group.problems.push(`${label} wasn't added: ${GROUP_SIZE.max} rankings is the most that can be combined. Remove one first.`);
        return;
    }
    // a Pokémon list names its Pokémon only once the pack is here (the first Pokémon list fetches it from the site)
    if (isRecord(raw) && raw.kind === 'pokemon' && !pokedex.pack && !(await installPokemonPackIfAvailable())) {
        group.problems.push(
            `${label} is a Pokémon list, and the Pokémon pack couldn't be downloaded. Check your connection and try again.`,
        );
        return;
    }
    const list = readRankedList(raw, pokemonName);
    if (typeof list === 'string') {
        group.problems.push(problemText(label, list));
        return;
    }
    const others = group.people[0]?.list.kind;
    if (others && others !== list.kind) {
        group.problems.push(
            list.kind === 'pokemon'
                ? `${label} is a Pokémon list and the others aren't. Only rankings of the same things can be combined.`
                : `${label} isn't a Pokémon list and the others are. Only rankings of the same things can be combined.`,
        );
        return;
    }
    group.people.push({ id: group.nextPersonId++, list, from, source, name: '', named: false, mine, pictures });
}

async function addLinks(): Promise<void> {
    const box = byId<HTMLTextAreaElement>('grplinks');
    const lines = box.value.split(/\s+/).filter(Boolean);
    group.problems = [];
    if (!lines.length) {
        group.problems.push('Paste at least one share link first, one per line.');
        return renderPeople();
    }
    const kept: string[] = [];
    for (const [index, line] of lines.entries()) {
        const before = group.problems.length;
        const label = lines.length > 1 ? `Link ${index + 1}` : 'That link';
        if (!line.includes('#l=')) {
            const shown = line.length > 40 ? line.slice(0, 40) + '…' : line;
            group.problems.push(`“${shown}” isn't a share link. Paste whole links; they have #l= in them.`);
        } else {
            const list = await listInLink(line);
            if (list === null) group.problems.push(`${label} is broken or cut short. Ask for it again, or for the list file instead.`);
            else await addRanking(list, label, { from: 'a link', source: 'link ' + line.slice(line.indexOf('#l=')) });
        }
        // links that didn't go in stay in the box, to fix or remove
        if (group.problems.length > before) kept.push(line);
    }
    box.value = kept.join('\n');
    renderPeople();
}

/** A list file: a .json from Save list, or a .zip from Save list with its pictures. */
async function addFile(file: File): Promise<void> {
    const label = `“${file.name}”`;
    const source = `file ${file.name} ${file.size} ${file.lastModified}`;
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
        try {
            const zip = await openZipArchive(file);
            if (!zip.has('list.json')) {
                group.problems.push(`${label} isn't a saved list. Ask for the file from File → Save list.`);
                return;
            }
            const bundle = await readListZip(zip);
            if (typeof bundle === 'string') group.problems.push(`${label}: ${bundle}. Ask for it again, or for a share link.`);
            else await addRanking(bundle.list, label, { from: file.name, source, pictures: new Map(bundle.pictures) });
        } catch (error) {
            group.problems.push(`${label}: ${error instanceof ZipError ? error.message : 'not a valid zip'}. Ask for it again.`);
        }
        return;
    }
    if (file.size > MAX_JSON_BYTES) {
        group.problems.push(`${label} is too big to be a tier list. Ask for the file from File → Save list.`);
        return;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        group.problems.push(`${label} isn't a list file (it isn't JSON). Ask for the file from File → Save list.`);
        return;
    }
    await addRanking(parsed, label, { from: file.name, source });
}

async function addFiles(files: readonly File[]): Promise<void> {
    group.problems = [];
    showProgress('Reading list files…');
    for (const [index, file] of files.entries()) {
        updateProgress(`${index + 1} / ${files.length}`, ((index + 1) / files.length) * 100);
        await addFile(file);
    }
    hideProgress();
    renderPeople();
}

/** The list open in this browser, with your uploaded pictures (they can't come any other way). */
async function addMine(): Promise<void> {
    group.problems = [];
    if (session.needsPack)
        group.problems.push("Your open list needs the Pokémon pack, which couldn't be downloaded. Check your connection and try again.");
    else {
        saveNow();
        const pictures = new Map<ItemId, Blob>();
        for (const [id, blob] of spriteBlobs) {
            const pick = state.picks[id];
            // uploads only: the rest come back from their addresses, and text tiles are drawn again
            if (pick?.path === 'custom' && !pick.text) pictures.set(id, blob);
        }
        await addRanking(toSnapshot(), 'Your open list', { from: 'your open list', source: 'mine', mine: true, pictures });
    }
    renderPeople();
}

function removePerson(id: number): void {
    const index = group.people.findIndex((person) => person.id === id);
    if (index < 0) return;
    group.people.splice(index, 1);
    group.problems = [];
    renderPeople();
    // focus moves to the next row's Remove (or the one before, or the add buttons), not lost to the page
    const buttons = byId('grppeople').querySelectorAll<HTMLElement>('[data-remove]');
    (buttons[Math.min(index, buttons.length - 1)] ?? byId('grpaddlinks')).focus();
}

/** Names typed or cleared: updated in place, so focus (already on its way to the next field) isn't lost. */
function syncNames(): void {
    nameUnnamedPeople();
    for (const person of group.people) {
        const input = byId('grppeople').querySelector<HTMLInputElement>(`[data-name="${person.id}"]`);
        if (input && input !== document.activeElement) input.value = person.name;
        byId('grppeople').querySelector(`[data-remove="${person.id}"]`)?.setAttribute('aria-label', `Remove ${person.name}`);
    }
}

function renderPeople(): void {
    nameUnnamedPeople();
    const message = byId('grpmsg');
    message.classList.toggle('hid', !group.problems.length);
    setHtml(message, html`<ul>${group.problems.map((problem) => html`<li>${problem}</li>`)}</ul>`);
    const count = group.people.length;
    setHtml(
        byId('grppeople'),
        count
            ? html`${group.people.map(
                  (person, index) =>
                      html`<li class="grpperson"><input type="text" maxlength="40" value="${person.name}" data-name="${person.id}" aria-label="Name for ranking ${index + 1}"><span class="note grpfrom">${person.list.title ? `“${person.list.title}”, ` : ''}${plural(person.list.items.length, 'item')} ranked, from ${person.from}</span><button data-remove="${person.id}" aria-label="Remove ${person.name}">Remove</button></li>`,
              )}`
            : html`<li class="grpnone note">None yet. Add at least two: share links, list files, or your own list.</li>`,
    );
    byId<HTMLButtonElement>('grpmine').disabled = group.people.some((person) => person.mine);
    const go = byId<HTMLButtonElement>('grpgo');
    go.disabled = count < GROUP_SIZE.min;
    go.textContent = count >= GROUP_SIZE.min ? `Combine ${count} rankings` : 'Combine rankings';
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMBINING
// ═════════════════════════════════════════════════════════════════════════════

/** The first uploaded picture anyone sent along for this item, checked like any upload. */
async function uploadedPicture(item: GroupItem, people: readonly Person[]): Promise<Blob | null> {
    for (const copy of item.copies) {
        const blob = people[copy.list]?.pictures.get(copy.item.id);
        const picture = blob && (await checkedImage(blob).catch(() => null));
        if (picture) return picture;
    }
    return null;
}

async function combine(): Promise<void> {
    const people = [...group.people];
    const lists = people.map((person) => person.list);
    if (combineProblem(lists)) return;
    const ranking = combineRankings(lists);
    const listName = `${(ranking.title || 'Group ranking').slice(0, 52)} (group)`;
    const { stored, idOf } = toGroupList(ranking, listName);
    saveNow();
    const meta = addListMeta(listName, ranking.kind);
    if (ranking.packId) meta.pack = ranking.packId;
    saveListIndex();
    try {
        localStorage.setItem('ptl_' + meta.id, JSON.stringify(stored));
    } catch {
        await forgetList(meta.id);
        toast('Browser storage is full. Delete a list you no longer need, then try again.', 5000);
        return;
    }
    closeWindow('grpm');
    await openList(meta.id);
    await dropEmptyStartingList(meta.id);
    await givePictures(ranking, idOf, people);
    renderListMenu();
    group.people = [];
    group.problems = [];
    showResults(ranking, people);
}

/** Uploaded pictures people sent along; your own items with no picture at all get a text tile. */
async function givePictures(ranking: GroupRanking, idOf: Map<string, ItemId>, people: readonly Person[]): Promise<void> {
    const generation = session.generation;
    const hasUpload = (item: GroupItem) => item.copies.some((copy) => people[copy.list]?.pictures.has(copy.item.id));
    const todo = ranking.items.filter((item) => !state.picks[idOf.get(item.key)!] && (isOwnItem(idOf.get(item.key)!) || hasUpload(item)));
    if (!todo.length) return;
    showProgress('Making the group list…');
    for (const [index, item] of todo.entries()) {
        if (generation !== session.generation) break;
        const id = idOf.get(item.key)!;
        const picture = await uploadedPicture(item, people);
        if (picture) await setPick(id, picture, { path: 'custom', ck: 1 }, { generation });
        else if (isOwnItem(id) && generation === session.generation) await useTextTile(id);
        updateProgress(`${index + 1} / ${todo.length}`, ((index + 1) / todo.length) * 100);
    }
    hideProgress();
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE RESULTS
// ═════════════════════════════════════════════════════════════════════════════

function tierChip(tierIndex: number, ranking: GroupRanking): SafeHtml {
    // the open list is the group list, so its tiers are the group's, in the theme's own text colour
    const tier = state.tiers[tierIndex];
    const label = tier?.label ?? ranking.tiers[tierIndex]?.label ?? '';
    return tier
        ? html`<span class="grptier" style="background:${tier.color};color:${labelTextColor(tier)}">${label}</span>`
        : html`<span class="grptier">${label}</span>`;
}

function itemTable(caption: string, items: readonly GroupItem[], ranking: GroupRanking, people: number): SafeHtml {
    const tierCount = ranking.tiers.length;
    return html`<table class="grptable"><caption>${caption}</caption><thead><tr><th scope="col">Item</th><th scope="col">Group tier</th><th scope="col" class="num">Ranked by</th><th scope="col" class="num">Spread</th></tr></thead><tbody>${items.map(
        (item) =>
            html`<tr><th scope="row">${item.name}</th><td>${tierChip(item.tier, ranking)}</td><td class="num">${item.votes} of ${people}</td><td class="num">${tiersText(inTiers(item.spread, tierCount))}</td></tr>`,
    )}</tbody></table>`;
}

function showResults(ranking: GroupRanking, people: readonly Person[]): void {
    const tierCount = ranking.tiers.length;
    const { agreed, disagreed } = agreementExtremes(ranking.items, RESULTS_SHOWN);
    const partial = ranking.items.filter((item) => item.votes < people.length).length;
    const closest = closestPerson(ranking.people);
    const byCloseness = [...ranking.people].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    const nameOf = (list: number) => people[list]?.name || `Person ${list + 1}`;

    const summary = html`<p>${plural(people.length, 'ranking')} combined into a new list of ${plural(ranking.items.length, 'item')}${
        partial ? html`; ${partial} of them only some people ranked, so they count with fewer votes` : ''
    }. It's open behind this window.</p>`;
    const closestLine = closest
        ? html`<p class="grpclosest">Closest to the group: <b>${nameOf(closest.list)}</b>, on average ${tiersText(inTiers(closest.distance!, tierCount))} away.</p>`
        : html`<p class="grpclosest">Nobody ranked the same things as anyone else, so there's nothing to compare.</p>`;
    const peopleTable = html`<table class="grptable"><caption>How close each person was to the group</caption><thead><tr><th scope="col">Person</th><th scope="col" class="num">Ranked</th><th scope="col" class="num">Distance</th></tr></thead><tbody>${byCloseness.map(
        (person) =>
            html`<tr><th scope="row">${nameOf(person.list)}</th><td class="num">${person.ranked}</td><td class="num">${
                person.distance === null ? 'Nothing shared' : tiersText(inTiers(person.distance, tierCount))
            }</td></tr>`,
    )}</tbody></table>`;

    setHtml(
        byId('grpresbody'),
        html`${summary}${closestLine}<div class="grptables">${
            agreed.length
                ? itemTable('Most agreed on', agreed, ranking, people.length)
                : html`<p class="note">No item was ranked by more than one person.</p>`
        }${
            disagreed.length
                ? itemTable('Most disagreed on', disagreed, ranking, people.length)
                : agreed.length
                  ? html`<p class="note">No disagreements: everyone put every shared item in the same tier.</p>`
                  : ''
        }${peopleTable}</div><p class="note">Spread is how far apart people placed an item (the standard deviation, in tiers): 0 means everyone chose the same tier. Distance is how far, on average, a person's places were from the group's, counting only items someone else ranked too.</p>`,
    );
    openWindow('grpres', 'grpdone');
}

/** Runs one thing at a time: a second click while links are unpacking would add them twice. */
async function oneAtATime(task: () => Promise<void>): Promise<void> {
    if (group.busy) return;
    group.busy = true;
    try {
        await task();
    } finally {
        group.busy = false;
    }
}

// ── wiring (runs the first time the window is opened: main.ts, loadOnFirstUse) ──
export function setupGroup(): void {
    buildWindows();
    byId('lgroup').onclick = openCombineWindow;
    const closeAdding = () => closeWindow('grpm');
    const closeResults = () => closeWindow('grpres');
    byId('grpx').onclick = closeAdding;
    byId('grpcancel').onclick = closeAdding;
    byId('grpresx').onclick = closeResults;
    byId('grpdone').onclick = closeResults;
    for (const [id, close] of [
        ['grpm', closeAdding],
        ['grpres', closeResults],
    ] as const) {
        byId(id).addEventListener('click', (e) => {
            if (e.target === e.currentTarget && !group.busy) close();
        });
        byId(id).addEventListener('keydown', trapKeys(id === 'grpm' ? 'grpbox' : 'grpresbox', close));
    }
    byId('grpaddlinks').onclick = () => void oneAtATime(addLinks);
    byId('grpmine').onclick = () => void oneAtATime(addMine);
    byId('grpgo').onclick = () => void oneAtATime(combine);
    const input = byId<HTMLInputElement>('grpinp');
    byId('grpfiles').onclick = () => input.click();
    input.onchange = () => {
        const files = [...(input.files ?? [])];
        input.value = '';
        if (files.length) void oneAtATime(() => addFiles(files));
    };
    byId('grppeople').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
        if (button) removePerson(Number(button.dataset.remove));
    });
    byId('grppeople').addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const person = group.people.find((other) => other.id === Number(input.dataset.name));
        if (!person) return;
        person.name = input.value.trim().slice(0, 40);
        person.named = !!person.name;
        syncNames();
    });
}
