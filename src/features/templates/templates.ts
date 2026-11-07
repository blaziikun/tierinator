// src/features/templates/templates.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The template gallery (#tplm): ready-made lists from public/templates, found by
//  search and category. Opening one makes a new list of your own with its items,
//  then fetches their pictures (wiki-pictures.ts). Loaded the first time it's opened,
//  or by a template link (template-link.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_SWATCHES } from '../../core/defaults';
import { autosave } from '../../core/persist';
import { spriteBlobs, state } from '../../core/state';
import {
    isTemplateId,
    readTemplate,
    readTemplateIndex,
    type Template,
    type TemplateEntry,
    type TemplateItem,
} from '../../core/template-format';
import type { PictureCredit } from '../../core/types';
import { byId, randomId } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { getJSON } from '../../lib/net';
import { closePopovers, hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { wikimediaFileOf } from '../credits/credits';
import { findPictureCredits } from '../credits/wiki-credits';
import { addItem, useTextTile } from '../items/items';
import { createList } from '../lists/lists';
import { closeStartScreen } from '../start/start';
import { placeAllTiles, renderTiers } from '../tier-board/board';
import { POKEMON_PACK, SUGGEST_TEMPLATE_ADDRESS } from './template-addresses';
import { findFreePictures, type LeadPicture, WIKIPEDIA_API } from './wiki-pictures';

const gallery = {
    /** The catalogue once it has loaded (null before, or after it failed). */
    entries: null as TemplateEntry[] | null,
    /** Where focus was before the window opened: it goes back there on close. */
    opener: null as HTMLElement | null,
    /** A template is being opened: other clicks wait. */
    busy: false,
    /** setupTemplates has run (from a button, or from a template link). */
    ready: false,
};

const isOpen = (): boolean => byId('tplm').classList.contains('show');
const isStartScreenShowing = (): boolean => !byId('start').classList.contains('hid');

// ═════════════════════════════════════════════════════════════════════════════
//  THE WINDOW
// ═════════════════════════════════════════════════════════════════════════════

function buildWindow(): void {
    const modal = document.createElement('div');
    modal.id = 'tplm';
    modal.className = 'modal';
    setHtml(
        modal,
        html`<div class="mbox" id="tplbox" role="dialog" aria-modal="true" aria-labelledby="tpltitle">
  <div class="addhead"><h3 id="tpltitle">Templates</h3><button id="tplx" aria-label="Close" title="Close (Esc)">✕</button></div>
  <p class="note">Ready-made lists to rank yourself. Opening one makes a new list of your own; pictures come from Wikipedia.</p>
  <div class="tplfilters"><input type="search" id="tplq" aria-label="Search templates" placeholder="Search templates…" autocomplete="off" spellcheck="false"><select id="tplcat" aria-label="Category"><option value="">All categories</option></select></div>
  <div class="tplstatus"><div id="tplcount" class="note" role="status" aria-live="polite"></div><span class="note">Missing one? <a href="${SUGGEST_TEMPLATE_ADDRESS}" target="_blank" rel="noopener">Suggest a template</a></span></div>
  <div id="tplgrid"></div>
</div>`,
    );
    document.body.append(modal);
}

/** Loads the catalogue (once; again after a failure). */
async function loadCatalogue(): Promise<void> {
    if (gallery.entries) return;
    setHtml(byId('tplgrid'), html`<div class="empty">Loading templates…</div>`);
    byId('tplcount').textContent = '';
    try {
        gallery.entries = readTemplateIndex(await getJSON('/templates/index.json', {}, 10_000));
    } catch {
        gallery.entries = null;
    }
    if (!gallery.entries) {
        setHtml(
            byId('tplgrid'),
            html`<div class="empty">Couldn't load the templates. Check your connection, then <button id="tplretry" class="link">try again</button>.</div>`,
        );
        byId('tplretry').onclick = () => void loadCatalogue();
        return;
    }
    const categories = [...new Set([POKEMON_PACK.category, ...gallery.entries.map((entry) => entry.category)])].sort();
    setHtml(
        byId('tplcat'),
        html`<option value="">All categories</option>${categories.map((category) => html`<option value="${category}">${category}</option>`)}`,
    );
    renderCards();
}

/** The cards that match the search box and the category. */
function renderCards(): void {
    if (!gallery.entries) return;
    const query = byId<HTMLInputElement>('tplq').value.trim().toLowerCase();
    const category = byId<HTMLSelectElement>('tplcat').value;
    const fits = (entryCategory: string, text: string) => (!category || entryCategory === category) && text.toLowerCase().includes(query);
    const entries = gallery.entries.filter((entry) =>
        fits(entry.category, [entry.title, entry.category, entry.description || ''].join(' ')),
    );
    const showPokemon = fits(POKEMON_PACK.category, POKEMON_PACK.searchText);
    // the Pokémon pack comes first: it opens the way the start screen's Pokémon button does
    const pokemonCard = html`<button class="tplcard tplfeatured" data-pack="pokemon"><span class="tpltop"><b>${POKEMON_PACK.title}</b><span class="tplbadge">Featured</span></span><span class="tpldesc">${POKEMON_PACK.description}</span><span class="tplmeta"><span class="tplcat">${POKEMON_PACK.category}</span><span>Pack</span></span></button>`;
    const cards = entries.map(
        (entry) =>
            html`<button class="tplcard" data-tpl="${entry.id}"><span class="tpltop"><b>${entry.title}</b></span>${entry.description && html`<span class="tpldesc">${entry.description}</span>`}<span class="tplmeta"><span class="tplcat">${entry.category}</span><span>${entry.count} items</span></span></button>`,
    );
    const total = entries.length + (showPokemon ? 1 : 0);
    setHtml(
        byId('tplgrid'),
        total
            ? html`${showPokemon && pokemonCard}${cards}`
            : html`<div class="empty">No templates match. Try another word, or All categories.</div>`,
    );
    byId('tplcount').textContent = total ? `${total} template${total > 1 ? 's' : ''}` : '';
}

export function openTemplateGallery(): void {
    const focused = document.activeElement;
    gallery.opener = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    closePopovers();
    byId('tplm').classList.add('show');
    // with a mouse, straight into search; on a touch screen that would cover the cards with the keyboard
    if (matchMedia('(pointer: fine)').matches) byId('tplq').focus();
    else byId('tplm').querySelector<HTMLElement>('button')?.focus();
    void loadCatalogue();
}

function closeTemplateGallery(): void {
    byId('tplm').classList.remove('show');
    // back where you were; if that's gone (a menu that closed), to the list menu's button
    const target = gallery.opener?.isConnected && gallery.opener.offsetParent ? gallery.opener : byId('listbtn');
    if (target.offsetParent) target.focus();
    gallery.opener = null;
}

/** Tab and Shift+Tab stay inside the window while it's open; Escape closes it. */
function handleWindowKeys(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // the app's own Escape (clear selection, show the bar) is for the screen behind
        closeTemplateGallery();
        return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...byId('tplbox').querySelectorAll<HTMLElement>('button, input, select, a[href]')].filter(
        (element) => element.offsetParent,
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
}

// ═════════════════════════════════════════════════════════════════════════════
//  OPENING A TEMPLATE
// ═════════════════════════════════════════════════════════════════════════════

/** The template's own tier labels, coloured from the usual palette. */
function useTemplateTiers(labels: readonly string[]): void {
    state.tiers = labels.map((label, index) => ({
        id: randomId(),
        label,
        subtitle: '',
        color: DEFAULT_SWATCHES[index % DEFAULT_SWATCHES.length]!,
        items: [],
    }));
    renderTiers();
}

/** The file behind an item's picture, if English Wikipedia can say who made it: its lead picture, or its own Wikimedia picture. */
function creditedFile(item: TemplateItem, pictures: Map<string, LeadPicture>): string | undefined {
    if (!item.image) return item.wiki ? pictures.get(item.wiki)?.file : undefined;
    const shown = wikimediaFileOf(item.image);
    return shown && /^(commons\.wikimedia|en\.wikipedia)\.org$/.test(shown.home) ? shown.file : undefined;
}

/** Who made each picture. Cancel stops asking: the rest keep just a link to their picture's page. */
async function findCredits(files: string[]): Promise<Map<string, PictureCredit>> {
    if (!files.length) return new Map();
    showProgress('Finding who made the pictures…', true);
    updateProgress(`0 / ${files.length}`, 0);
    return findPictureCredits(
        WIKIPEDIA_API,
        files,
        () => progress.cancelled,
        (lookedUp) => updateProgress(`${lookedUp} / ${files.length}`, (lookedUp / files.length) * 100),
    );
}

/**
 * Adds the template's items with their pictures: an item's own https picture, else its
 * Wikipedia page's free lead picture (with its credit), else a text tile. Cancel gives the rest text tiles.
 */
async function addTemplateItems(template: Template): Promise<void> {
    const titles = template.items.filter((item) => !item.image && item.wiki).map((item) => item.wiki!);
    let pictures = new Map<string, LeadPicture>();
    let reachedWikipedia = true;
    if (titles.length) {
        // Cancel here stops looking: items found so far keep their pictures, the rest get text tiles
        showProgress('Finding pictures on Wikipedia…', true);
        updateProgress(`0 / ${titles.length}`, 0);
        ({ pictures, reachedWikipedia } = await findFreePictures(
            titles,
            (lookedUp) => updateProgress(`${lookedUp} / ${titles.length}`, (lookedUp / titles.length) * 100),
            () => progress.cancelled,
        ));
    }
    const credits = await findCredits(template.items.flatMap((item) => creditedFile(item, pictures) ?? []));
    const total = template.items.length;
    showProgress('Adding items…', true);
    let withoutPicture = 0;
    for (const [index, item] of template.items.entries()) {
        const url = progress.cancelled ? undefined : item.image || (item.wiki ? pictures.get(item.wiki)?.address : undefined);
        const file = creditedFile(item, pictures);
        const credit = file ? credits.get(file) : undefined;
        const id = await addItem({
            name: item.name,
            url,
            ...(item.wiki ? { w: { a: WIKIPEDIA_API, t: item.wiki } } : {}),
            ...(credit ? { credit } : {}),
        });
        // a picture that couldn't be downloaded would show as a broken image: a text tile reads better
        if (url && !spriteBlobs.has(id)) await useTextTile(id);
        if (state.picks[id]?.text) withoutPicture++;
        updateProgress(`${index + 1} / ${total}`, ((index + 1) / total) * 100);
    }
    hideProgress();
    placeAllTiles();
    autosave();
    const added = `Added ${total} item${total > 1 ? 's' : ''} to the pool.`;
    if (progress.cancelled) toast(`${added} The ones after you pressed Cancel got text tiles.`, 5000);
    else if (!reachedWikipedia)
        toast(`${added} Couldn't reach Wikipedia, so they got text tiles. Right-click one to give it a picture.`, 6000);
    else if (withoutPicture)
        toast(`${added} ${withoutPicture} had no free picture, so ${withoutPicture > 1 ? 'they' : 'it'} got a text tile.`, 5000);
    else toast(added);
}

/** Opens a template as a new list. False if it couldn't be read (the toast says so). */
async function openTemplate(id: string): Promise<boolean> {
    if (gallery.busy || !isTemplateId(id)) return false;
    gallery.busy = true;
    try {
        let template: Template | null = null;
        try {
            template = readTemplate(await getJSON(`/templates/${id}.json`, {}, 10_000));
        } catch {}
        if (template?.id !== id) {
            toast("Couldn't open that template. Check your connection and try again.", 4000);
            return false;
        }
        const fromStartScreen = isStartScreenShowing();
        if (isOpen()) closeTemplateGallery(); // a template link opens one without the window
        await createList('custom', template.title);
        if (template.tiers) useTemplateTiers(template.tiers);
        await addTemplateItems(template);
        if (fromStartScreen) closeStartScreen();
        return true;
    } finally {
        gallery.busy = false;
    }
}

async function openPokemonPack(): Promise<void> {
    if (isOpen()) closeTemplateGallery();
    if (isStartScreenShowing()) closeStartScreen();
    await createList('pokemon', 'My Pokémon tier list');
}

/**
 * A template link (/?template=<id>): opens that template, or the Pokémon pack, as its card would.
 * False if there's no such template or it couldn't be read; a toast has said so.
 */
export async function openLinkedTemplate(id: string): Promise<boolean> {
    setupTemplates();
    if (id === POKEMON_PACK.id) {
        await openPokemonPack();
        return true;
    }
    await loadCatalogue();
    // without the catalogue (offline), trying the template itself still says what went wrong
    if (gallery.entries && !gallery.entries.some((entry) => entry.id === id)) {
        toast("That template link doesn't match any template. Pick one from Browse templates instead.", 5000);
        return false;
    }
    return openTemplate(id);
}

// ── wiring (runs the first time the gallery is opened, main.ts → loadOnFirstUse, or by a template link) ──
export function setupTemplates(): void {
    if (gallery.ready) return;
    gallery.ready = true;
    buildWindow();
    byId('startgal').onclick = openTemplateGallery;
    byId('ltpl').onclick = openTemplateGallery;
    byId('tplx').onclick = closeTemplateGallery;
    byId('tplm').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeTemplateGallery();
    });
    byId('tplm').addEventListener('keydown', handleWindowKeys);
    byId('tplq').addEventListener('input', renderCards);
    byId('tplcat').addEventListener('change', renderCards);
    byId('tplgrid').addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.tplcard');
        if (!card || !isOpen()) return;
        if (card.dataset.pack === 'pokemon') void openPokemonPack();
        else if (card.dataset.tpl) void openTemplate(card.dataset.tpl);
    });
}
