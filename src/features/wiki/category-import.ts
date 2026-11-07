// src/features/wiki/category-import.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Add items → From a wiki: every page of a wiki category (or every link on a
//  list page) as an item, with its lead picture. Works on any MediaWiki site:
//  Fandom, Wikipedia, Bulbapedia… Talks to the wiki through engine.ts (paced
//  requests, back-off), so busy wikis aren't hammered.
//
//  For a full pack with picture galleries, variants and filters, see the pack builder.
// ─────────────────────────────────────────────────────────────────────────────
import { state } from '../../core/state';
import type { ItemId, PictureCredit } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, type SafeHtml, setHtml } from '../../lib/html';
import { showProgress, toast, updateProgress } from '../../lib/ui';
import { wikimediaFileOf } from '../credits/credits';
import { findPictureCredits } from '../credits/wiki-credits';
import { addItems } from '../items/items';
import { removeFromTiers } from '../tier-board/board';
import { afterFamilyChange, baseName } from '../variants/variants';
import { type ApiQuery, connect, queryAll, setWait, type Wiki } from './engine';

/** One page found, shown as a card. */
interface FoundPage {
    title: string;
    name: string;
    picture: string | null;
    /** Sub-categories it was found in (they become tags). */
    categories: string[];
    selected: boolean;
}

const wikiImport = {
    wiki: null as Wiki | null,
    found: [] as FoundPage[],
    /** Sub-categories with their page counts (or, for a whole wiki, its biggest categories). */
    categories: [] as [name: string, count: number][],
    shownCategories: new Set<string>(),
};

const MAX_PAGES = 4000;
const showStatus = (message: SafeHtml | string): void => setHtml(byId('wkstat'), typeof message === 'string' ? html`${message}` : message);

/** "Four Arms (Classic)" → "Four Arms" when "Remove (…)" is ticked. */
const cleanName = (title: string): string =>
    byId<HTMLInputElement>('wkparen').checked ? title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title : title;

const categoryPrefix = (wiki: Wiki) =>
    new RegExp('^\\s*(' + wiki.catNs.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*:', 'i');

/** The page title a batch answer means, following "normalized" and redirect steps back (up to 3). */
function originalTitles(query: ApiQuery): (title: string) => string {
    const back = new Map<string, string>();
    for (const step of [...(query.normalized || []), ...(query.redirects || [])]) back.set(step.to, step.from);
    return (title) => {
        let original = title;
        for (let k = 0; k < 3 && back.has(original); k++) original = back.get(original)!;
        return original;
    };
}

/** The picture file on a page that most likely shows its subject (its name in the file name, not an icon). */
function bestPictureFile(title: string, files: string[]): string | null {
    const words = title
        .toLowerCase()
        .replace(/\([^)]*\)/g, '')
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2);
    const pictures = files.filter(
        (file) =>
            !/\.(svg|ogg|mp3|wav|webm|mp4|pdf)$/i.test(file) &&
            !/(icon|symbol|logo|stub|placeholder|button|signature|flag|banner|wiki|sprite_ball|navbox|template)/i.test(file),
    );
    return pictures.find((file) => words.some((word) => file.toLowerCase().includes(word))) || pictures[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  READING THE WIKI
// ═════════════════════════════════════════════════════════════════════════════

/** Every page in a category (and its sub-categories, down to the chosen depth): title → sub-categories. */
async function readCategory(wiki: Wiki, category: string): Promise<Map<string, Set<string>>> {
    const pages = new Map<string, Set<string>>();
    const depth = byId<HTMLInputElement>('wksub').checked ? Number(byId<HTMLSelectElement>('wkdepth').value) : 0;
    const localCategory = wiki.catNs[0] || 'Category';
    const queue: [string, number][] = [[category.replace(/^[^:]+:/, localCategory + ':'), 0]];
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    while (queue.length && pages.size < MAX_PAGES) {
        const [current, level] = queue.shift()!;
        if (seen.has(current)) continue;
        seen.add(current);
        const shortName = current.replace(/^[^:]+:/, '');
        let found = 0;
        showStatus(html`Reading <b>${shortName}</b>… ${pages.size} pages so far`);
        await queryAll(
            wiki,
            { list: 'categorymembers', cmtitle: current, cmlimit: 'max', cmtype: level < depth ? 'page|subcat' : 'page' },
            (query) => {
                for (const member of query.categorymembers || []) {
                    if (member.ns === 14) {
                        if (level < depth) queue.push([member.title, level + 1]);
                    } else if (member.ns === 0) {
                        if (!pages.has(member.title)) pages.set(member.title, new Set());
                        if (level > 0) pages.get(member.title)!.add(shortName);
                        found++;
                    }
                }
            },
            40,
        );
        if (level > 0 && found) counts.set(shortName, found);
    }
    wikiImport.categories = [...counts].sort((a, b) => b[1] - a[1]);
    return pages;
}

/** Every article a list page links to. */
async function readLinks(wiki: Wiki, title: string): Promise<Map<string, Set<string>>> {
    const pages = new Map<string, Set<string>>();
    showStatus(html`Reading the links on <b>${title}</b>…`);
    await queryAll(
        wiki,
        { prop: 'links', titles: title, plnamespace: '0', pllimit: 'max', redirects: '1' },
        (query) => {
            for (const page of query.pages || [])
                for (const link of page.links || []) if (!pages.has(link.title)) pages.set(link.title, new Set());
        },
        40,
    );
    return pages;
}

/** Each page's lead picture; pages without one get the best-looking picture on the page. */
async function findPictures(wiki: Wiki, titles: string[]): Promise<Map<string, { title: string; picture?: string }>> {
    const info = new Map<string, { title: string; picture?: string }>();
    for (let i = 0; i < titles.length; i += 50) {
        showStatus(`Finding pictures… ${Math.min(i + 50, titles.length)} / ${titles.length}`);
        await queryAll(
            wiki,
            {
                titles: titles.slice(i, i + 50).join('|'),
                prop: 'pageimages',
                piprop: 'thumbnail|name',
                pithumbsize: '400',
                pilimit: '50',
                redirects: '1',
            },
            (query) => {
                const original = originalTitles(query);
                for (const page of query.pages || []) {
                    if (page.missing || page.invalid) continue;
                    const entry = info.get(original(page.title)) || { title: page.title };
                    if (page.thumbnail?.source) entry.picture = page.thumbnail.source;
                    info.set(original(page.title), entry);
                }
            },
            10,
        );
    }

    const withoutPicture = titles.filter((title) => !info.get(title)?.picture);
    const fileOf = new Map<string, string>();
    for (let i = 0; i < withoutPicture.length; i += 50) {
        showStatus(
            `Looking closer at ${withoutPicture.length} pages without a main picture… ${Math.min(i + 50, withoutPicture.length)} / ${withoutPicture.length}`,
        );
        const filesOn = new Map<string, string[]>();
        try {
            await queryAll(
                wiki,
                { titles: withoutPicture.slice(i, i + 50).join('|'), prop: 'images', imlimit: 'max', redirects: '1' },
                (query) => {
                    const original = originalTitles(query);
                    for (const page of query.pages || []) {
                        const files = filesOn.get(original(page.title)) || [];
                        for (const image of page.images || []) files.push(image.title);
                        filesOn.set(original(page.title), files);
                    }
                },
                10,
            );
        } catch {}
        filesOn.forEach((files, title) => {
            const best = bestPictureFile(
                title,
                files.map((file) => file.replace(/^[^:]+:/, '')),
            );
            const file = best && files.find((full) => full.endsWith(best));
            if (file) fileOf.set(title, file);
        });
    }

    const files = [...new Set(fileOf.values())];
    const urlOf = new Map<string, string>();
    for (let i = 0; i < files.length; i += 50) {
        try {
            await queryAll(
                wiki,
                { titles: files.slice(i, i + 50).join('|'), prop: 'imageinfo', iiprop: 'url', iiurlwidth: '400' },
                (query) => {
                    const original = originalTitles(query);
                    for (const page of query.pages || []) {
                        const image = page.imageinfo?.[0];
                        if (!image) continue;
                        urlOf.set(page.title, image.thumburl || image.url);
                        urlOf.set(original(page.title), image.thumburl || image.url);
                    }
                },
                5,
            );
        } catch {}
    }
    fileOf.forEach((file, title) => {
        const url = urlOf.get(file);
        if (url) info.set(title, { ...(info.get(title) || { title }), picture: url });
    });
    return info;
}

/** Reads the wiki address typed in: a category, a list page, or a whole wiki (shows its biggest categories). */
async function loadWiki(): Promise<void> {
    setHtml(byId('wkres'), html``);
    setHtml(byId('wkcats'), html``);
    byId('wkbar').classList.add('hid');
    wikiImport.found = [];
    wikiImport.categories = [];
    wikiImport.shownCategories.clear();
    syncAddButton();
    showStatus('Connecting to the wiki…');
    setWait(showStatus);
    let wiki: Wiki;
    try {
        wiki = await connect(byId<HTMLInputElement>('wkurl').value);
    } catch {
        return showStatus("Couldn't reach a wiki there. Check the address, or paste the link of a page on that wiki.");
    }
    wikiImport.wiki = wiki;
    const title = wiki.title;
    const site = wiki.site.toLowerCase();
    try {
        if (!title || /^(main page|home)$/i.test(title) || [site, site + ' wiki'].includes(title.toLowerCase()))
            return await showCatalog(wiki);
        const isCategory = categoryPrefix(wiki).test(title);
        const pages = isCategory ? await readCategory(wiki, title) : await readLinks(wiki, title);
        if (!pages.size)
            return showStatus(
                html`Found nothing in <b>${title}</b>. ${isCategory ? "Check the category name (it's case-sensitive)." : 'Try a category page instead.'}`,
            );
        const titles = [...pages.keys()];
        const info = await findPictures(wiki, titles);
        // redirects that land on the same page count once
        const seen = new Set<string>();
        for (const pageTitle of titles) {
            if (info.size && !info.has(pageTitle)) continue;
            const entry = info.get(pageTitle) || { title: pageTitle };
            if (seen.has(entry.title)) continue;
            seen.add(entry.title);
            const picture = entry.picture && /^https:\/\//.test(entry.picture) ? entry.picture : null;
            wikiImport.found.push({
                title: entry.title,
                name: cleanName(entry.title),
                picture,
                categories: [...pages.get(pageTitle)!],
                selected: !!picture,
            });
        }
        renderResults();
    } catch (error) {
        showStatus(
            `The wiki stopped answering (${error instanceof Error ? error.message : 'error'}). Try again, or pick a smaller category.`,
        );
    }
}

/** A whole wiki: its biggest categories, to pick one. */
async function showCatalog(wiki: Wiki): Promise<void> {
    showStatus(html`Reading the categories on <b>${wiki.site}</b>…`);
    const categories: [string, number][] = [];
    await queryAll(
        wiki,
        { list: 'allcategories', acprop: 'size', acmin: '6', aclimit: 'max' },
        (query) => {
            for (const category of query.allcategories || []) categories.push([category.category, category.pages ?? category.size ?? 0]);
        },
        12,
    );
    wikiImport.categories = categories.sort((a, b) => b[1] - a[1]).slice(0, 150);
    setHtml(
        byId('wkcats'),
        html`${wikiImport.categories.map(([name, count]) => html`<button class="chip" data-load="${name}">${name}<small>${count}</small></button>`)}`,
    );
    showStatus(
        categories.length
            ? html`<b>${wiki.site}</b>: pick a category to load (biggest first), or paste a category link.`
            : html`<b>${wiki.site}</b> has no categories to list. Paste a category or list page link instead.`,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═════════════════════════════════════════════════════════════════════════════

function renderResults(): void {
    const { found, categories } = wikiImport;
    const withPicture = found.filter((page) => page.picture).length;
    const manyCategories = categories.length > 1;
    setHtml(
        byId('wkcats'),
        html`${manyCategories && categories.map(([name, count]) => html`<button class="chip${wikiImport.shownCategories.has(name) ? ' on' : ''}" data-cat="${name}">${name}<small>${count}</small></button>`)}`,
    );
    setHtml(
        byId('wkres'),
        html`${found.map(
            (page, index) =>
                html`<div class="vc${page.selected ? ' chosen' : ''}${page.picture ? '' : ' nopic'}" data-i="${index}" title="${page.title}${page.categories.length ? '\n' + page.categories.join(', ') : ''}"><div class="vimg">${page.picture ? html`<img alt="" loading="lazy" src="${page.picture}" referrerpolicy="no-referrer">` : 'no picture'}</div><div class="vl"><b>${page.name}</b></div></div>`,
        )}`,
    );
    byId('wkbar').classList.toggle('hid', !found.length);
    byId<HTMLInputElement>('wkq').value = '';
    showStatus(
        html`Found <b>${found.length}</b> pages${manyCategories && ` in ${categories.length} categories`}, ${withPicture} with pictures (selected). ${manyCategories && 'Click categories to show only those. '}Click pictures to select or unselect.`,
    );
    syncAddButton();
}

/** Whether a page passes the search box and the chosen categories. */
function isShown(page: FoundPage): boolean {
    const query = byId<HTMLInputElement>('wkq').value.trim().toLowerCase();
    if (query && !page.name.toLowerCase().includes(query) && !page.title.toLowerCase().includes(query)) return false;
    return !wikiImport.shownCategories.size || page.categories.some((category) => wikiImport.shownCategories.has(category));
}

const filterResults = (): void =>
    byId('wkres')
        .querySelectorAll<HTMLElement>('.vc')
        .forEach((card) => {
            card.classList.toggle('hid', !isShown(wikiImport.found[Number(card.dataset.i)]!));
        });

function syncAddButton(): void {
    const selected = wikiImport.found.filter((page) => page.selected).length;
    const button = byId<HTMLButtonElement>('wkadd');
    button.disabled = !selected;
    button.textContent = selected ? `Add ${selected} selected` : 'Add selected';
}

/** Select all / none, of the pages shown. */
function selectShown(selected: boolean): void {
    byId('wkres')
        .querySelectorAll<HTMLElement>('.vc:not(.hid)')
        .forEach((card) => {
            wikiImport.found[Number(card.dataset.i)]!.selected = selected;
            card.classList.toggle('chosen', selected);
        });
    syncAddButton();
}

/** Wikipedia and its sister wikis: their pictures are on Wikimedia's servers, with credits it can tell. */
const isWikimediaWiki = (wiki: Wiki): boolean =>
    /\.(wikipedia|wikimedia|wiktionary|wikibooks|wikiquote|wikisource|wikinews|wikiversity|wikivoyage)\.org$/.test(
        new URL(wiki.api).hostname,
    );

/** The file behind each chosen page's picture, and who made it, on a Wikimedia wiki (other wikis have no common way to say). */
async function findCredits(wiki: Wiki, chosen: readonly FoundPage[]): Promise<Map<FoundPage, PictureCredit>> {
    const fileOfPage = new Map<FoundPage, string>();
    if (isWikimediaWiki(wiki))
        for (const page of chosen) {
            const file = page.picture ? wikimediaFileOf(page.picture)?.file : undefined;
            if (file) fileOfPage.set(page, file);
        }
    const creditOfPage = new Map<FoundPage, PictureCredit>();
    if (!fileOfPage.size) return creditOfPage;
    const files = [...new Set(fileOfPage.values())];
    showProgress('Finding who made the pictures…');
    updateProgress(`0 / ${files.length}`, 0);
    const credits = await findPictureCredits(wiki.api, files, undefined, (lookedUp) =>
        updateProgress(`${lookedUp} / ${files.length}`, (lookedUp / files.length) * 100),
    );
    fileOfPage.forEach((file, page) => {
        const credit = credits.get(file);
        if (credit) creditOfPage.set(page, credit);
    });
    return creditOfPage;
}

/** Adds the selected pages; pages sharing a name ("Four Arms (Classic)", "Four Arms (Omniverse)") become variants. */
async function addSelected(): Promise<void> {
    const wiki = wikiImport.wiki;
    const chosen = wikiImport.found.filter((page) => page.selected);
    if (!wiki || !chosen.length) return;
    const tagWithCategories = byId<HTMLInputElement>('wktag').checked;
    const combine = byId<HTMLInputElement>('wkmerge').checked;
    byId('addm').classList.remove('show');
    const credits = await findCredits(wiki, chosen);
    const ids = await addItems(
        chosen.map((page) => ({
            name: page.name,
            url: page.picture || undefined,
            tags: tagWithCategories ? page.categories : undefined,
            w: { a: wiki.api, t: page.title },
            credit: credits.get(page),
        })),
        'Downloading pictures from the wiki…',
        5,
    );

    const byBaseName = new Map<string, number[]>();
    chosen.forEach((page, index) => {
        if (ids[index] == null) return;
        const key = baseName(page.name).toLowerCase();
        byBaseName.set(key, [...(byBaseName.get(key) || []), index]);
    });
    let families = 0;
    for (const [key, indexes] of byBaseName) {
        if (indexes.length < 2) continue;
        const mainIndex = indexes.find((index) => chosen[index]!.name.toLowerCase() === key) ?? indexes[0]!;
        const main = ids[mainIndex]!;
        const variants: ItemId[] = indexes.filter((index) => index !== mainIndex).map((index) => ids[index]!);
        for (const variant of variants) state.familyOf[variant] = main;
        if (combine) {
            state.combinedFamilies[main] = true;
            removeFromTiers(variants);
        }
        families++;
    }
    if (families) {
        afterFamilyChange();
        toast(
            `${families} character${families > 1 ? 's' : ''} with several pages grouped as variants${combine ? ' (combined)' : ''}. Change it under Variants ▾`,
            4500,
        );
    }
    for (const page of wikiImport.found) page.selected = false;
    byId('wkres')
        .querySelectorAll('.vc.chosen')
        .forEach((card) => {
            card.classList.remove('chosen');
        });
    syncAddButton();
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupCategoryImport(): void {
    byId('wkgo').onclick = () => void loadWiki();
    byId<HTMLInputElement>('wkurl').onkeydown = (e) => {
        if (e.key === 'Enter') void loadWiki();
    };
    byId('wkq').oninput = filterResults;
    byId('wkcats').addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
        const wiki = wikiImport.wiki;
        if (!chip || !wiki) return;
        if (chip.dataset.load != null) {
            // a category from the whole-wiki list: load it
            const category = (wiki.catNs[0] || 'Category') + ':' + chip.dataset.load;
            byId<HTMLInputElement>('wkurl').value =
                wiki.server + wiki.articlepath.replace('$1', encodeURIComponent(category.replace(/ /g, '_')).replace(/%3A/gi, ':'));
            void loadWiki();
            return;
        }
        const category = chip.dataset.cat!;
        if (!wikiImport.shownCategories.delete(category)) wikiImport.shownCategories.add(category);
        chip.classList.toggle('on');
        filterResults();
    });
    byId('wkres').addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.vc');
        if (!card) return;
        const page = wikiImport.found[Number(card.dataset.i)]!;
        page.selected = !page.selected;
        card.classList.toggle('chosen', page.selected);
        syncAddButton();
    });
    byId('wkall').onclick = () => selectShown(true);
    byId('wknone').onclick = () => selectShown(false);
    byId('wkadd').onclick = () => void addSelected();
}
