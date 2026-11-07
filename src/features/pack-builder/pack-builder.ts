// src/features/pack-builder/pack-builder.ts
// ─────────────────────────────────────────────────────────────────────────────
//  "Build a pack from a wiki": the five-step window (#pbm) that drives the wiki
//  engine (features/wiki/engine.ts).
//
//    1 Wiki        connect, find an example page's info box, choose how to collect pages
//    2 Pages       read them, untick what doesn't belong (by page or by category)
//    3 Tags        info box fields and category groups become filters
//    4 Pictures    how many, gallery pages, which pages are variants of each other
//    5 Build       name it, build it, save it or start a list with it
// ─────────────────────────────────────────────────────────────────────────────

import type { GenericPack } from '../../core/types';
import { byId, downloadBlob } from '../../lib/dom';
import { html, joinHtml, safeUrl, setHtml } from '../../lib/html';
import { ask, closePopovers, hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { renderListMenu } from '../lists/lists';
import { createListFromPack, genericPacks, installPack } from '../packs/packs';
import type { CategoryCount, CategoryWithFacet, Family, FieldSummary, Galleries, Pages, Wiki } from '../wiki/engine';
import * as wikiEngine from '../wiki/engine';

// ═════════════════════════════════════════════════════════════════════════════
//  STATE
// ═════════════════════════════════════════════════════════════════════════════

interface FieldChoice {
    on: boolean;
    /** Filter name shown in the app. */
    name: string;
}
interface CategoryChoice extends FieldChoice {
    cats: CategoryWithFacet[];
    /** Pages in at least one of these categories. */
    cover: number;
}
/** Gallery pages read so far, for one gallery suffix. */
type GalleryCache = Galleries & { suffix: string; done: Set<string> };

/** Everything the builder knows, kept while the window is closed so you can come back to it. */
export const packBuilder = {
    step: 1,
    /** What was typed in the Wiki box when I connected. */
    wikiInput: '',
    wiki: null as Wiki | null,
    pages: null as Pages | null,
    infoboxTemplate: null as string | null,
    titles: [] as string[],
    excludedPages: new Set<string>(),
    /** Pages ticked back on although one of their categories is left out. */
    forcedPages: new Set<string>(),
    excludedCategories: new Set<string>(),
    showAllCategories: false,
    categories: [] as CategoryCount[],
    categoryFacets: [] as CategoryWithFacet[],
    fields: [] as FieldSummary[],
    fieldChoices: new Map<string, FieldChoice>(),
    categoryChoices: new Map<string, CategoryChoice>(),
    dotFacet: '',
    dotColors: {} as Record<string, string>,
    galleryInfo: null as { suffix: string; hits: number; sample: number } | null,
    gallerySuffix: '',
    galleries: null as GalleryCache | null,
    maxPictures: 30,
    minPictureSize: 48,
    variantField: '',
    variantsByName: true,
    families: null as Family[] | null,
    /** Families unticked in step 4 (by base page). */
    familiesOff: new Set<string>(),
    name: '',
    noun: '',
    pack: null as GenericPack | null,
};

/** The pages I've read (only called after step 1, when they exist). */
const pagesRead = (): Pages => packBuilder.pages!;
const pageOf = (title: string) => pagesRead().get(title)!;

// ═════════════════════════════════════════════════════════════════════════════
//  SMALL HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** "Bakugan Bakugans!" → "bakugan-bakugans" (pack ids). */
export const packSlug = (name: string): string =>
    String(name || 'pack')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'pack';

/** "g-power" → "G power" (filter names from info box fields). */
export const displayTitle = (text: string): string => {
    const words = String(text || '')
        .replace(/[-_]+/g, ' ')
        .trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Values named after a colour get that colour ("Red", "Pyrus Red"…). */
const NAMED_COLORS: Record<string, string> = {
    red: '#e5484d',
    blue: '#3e7bfa',
    green: '#30a46c',
    yellow: '#f5d90a',
    purple: '#8e4ec6',
    violet: '#8e4ec6',
    orange: '#f76b15',
    black: '#3a3a3a',
    white: '#e8e8e8',
    gold: '#d4a017',
    silver: '#a8b0b8',
    brown: '#8d5a3b',
    pink: '#e93d82',
    grey: '#8b8d98',
    gray: '#8b8d98',
    cyan: '#05a2c2',
    teal: '#12a594',
};

/** A dot colour for a filter value: a named colour if the value contains one, otherwise a stable hue from its text. */
export function colorForValue(value: string): string {
    for (const word of String(value)
        .toLowerCase()
        .match(/[a-z]+/g) || [])
        if (NAMED_COLORS[word]) return NAMED_COLORS[word];
    let hash = 0;
    for (const c of String(value)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    const hue = (hash % 360) / 360;
    const saturation = 0.72;
    const lightness = 0.58;
    const channel = (n: number) => {
        const k = (n + hue * 12) % 12;
        const a = saturation * Math.min(lightness, 1 - lightness);
        return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
            .toString(16)
            .padStart(2, '0');
    };
    return '#' + channel(0) + channel(8) + channel(4);
}

/** Address of a page on the connected wiki. */
export const wikiLink = (title: string): string => {
    const wiki = packBuilder.wiki;
    return wiki ? wiki.server + wiki.articlepath.replace('$1', encodeURIComponent(String(title).replace(/ /g, '_'))) : '#';
};

class Cancelled extends Error {}

/** Opens the progress window; returns the progress callback the engine reports to (it stops the work on Cancel). */
function showBuilderProgress(title: string): (message: string, fraction?: number) => void {
    showProgress(title, true);
    wikiEngine.setWait((message) => updateProgress(message));
    return (message, fraction) => {
        if (progress.cancelled) throw new Cancelled('Cancelled');
        updateProgress(message, fraction != null ? fraction * 100 : null);
    };
}

async function showBuilderError(error: unknown): Promise<void> {
    hideProgress();
    if (error instanceof Cancelled) {
        toast('Stopped. What was already done is kept');
        return;
    }
    if (error instanceof wikiEngine.WikiError && error.blocked && error.host) {
        if (await ask(error.message, 'Open the wiki')) window.open(error.host, '_blank', 'noopener');
        return;
    }
    await ask(error instanceof Error ? error.message : String(error), 'OK');
}

// ═════════════════════════════════════════════════════════════════════════════
//  WINDOW AND STEPS
// ═════════════════════════════════════════════════════════════════════════════

export function setBuilderStep(step: number): void {
    if (step > 1 && !packBuilder.pages) step = 1;
    packBuilder.step = step;
    document.querySelectorAll<HTMLButtonElement>('#pbsteps button').forEach((button) => {
        button.classList.toggle('on', Number(button.dataset.s) === step);
        button.disabled = Number(button.dataset.s) > 1 && !packBuilder.pages;
    });
    document.querySelectorAll<HTMLElement>('#pbbox section[data-s]').forEach((section) => {
        section.classList.toggle('hid', Number(section.dataset.s) !== step);
    });
    if (step === 2) renderPageList();
    if (step === 3) renderTagSources();
    if (step === 4) renderPictureOptions();
    if (step === 5) renderBuildSummary();
    byId('pbbox').scrollTop = 0;
}

export function openPackBuilder(wikiAddress?: string): void {
    closePopovers();
    byId('addm').classList.remove('show');
    if (wikiAddress && !packBuilder.pages) byId<HTMLInputElement>('pbwiki').value = wikiAddress;
    byId('pbm').classList.add('show');
    setBuilderStep(packBuilder.step || 1);
    if (!packBuilder.pages) setTimeout(() => byId<HTMLInputElement>('pbwiki').focus(), 30);
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 1 · WIKI: connect and choose how to find the pages
// ═════════════════════════════════════════════════════════════════════════════

export async function findSimilarPages(): Promise<void> {
    const wikiInput = byId<HTMLInputElement>('pbwiki').value.trim();
    const example = byId<HTMLInputElement>('pbex').value.trim();
    if (!wikiInput) {
        toast('Type a wiki first');
        return;
    }
    const how = byId('pbhow');
    setHtml(how, html`<div class="note">Looking…</div>`);
    byId<HTMLButtonElement>('pbload').disabled = true;
    try {
        if (!packBuilder.wiki || packBuilder.wikiInput !== wikiInput) {
            packBuilder.wiki = await wikiEngine.connect(wikiInput);
            packBuilder.wikiInput = wikiInput;
        }
        const wiki = packBuilder.wiki;
        const linkedTitle = wiki.title || '';
        const linkedIsCategory = wiki.catNs.some((ns) => linkedTitle.toLowerCase().startsWith(ns.toLowerCase() + ':'));
        const exampleTitle = example || (linkedIsCategory ? '' : linkedTitle);
        const categoryGuess = linkedIsCategory ? linkedTitle.replace(/^[^:]+:\s*/, '') : '';
        let probe: wikiEngine.ProbeResult | null = null;
        let exampleCategories: string[] = [];
        if (exampleTitle) {
            probe = await wikiEngine.probe(wiki, exampleTitle);
            try {
                const read = await wikiEngine.readPages(wiki, [probe.page]);
                exampleCategories = (read.get(probe.page)?.cats || []).filter(
                    (c) => !/stub|pages|articles|images|needing|candidates/i.test(c),
                );
            } catch {}
        }
        const options = (probe?.templates || []).map(
            (t, i) =>
                html`<label class="pbopt"><input type="radio" name="pbhow" value="t:${t.name}"${i === 0 && !categoryGuess ? html` checked` : ''}> Every page with the <b>${t.name}</b> box <span class="note">${t.count} pages</span></label>`,
        );
        options.push(
            html`<label class="pbopt"><input type="radio" name="pbhow" value="c"${categoryGuess || !options.length ? html` checked` : ''}> Every page in the category <input type="text" id="pbcat" value="${categoryGuess || exampleCategories[0] || ''}" placeholder="Category name" style="width:220px"> <select id="pbdepth" title="Also include sub-categories this deep"><option value="0">no sub-categories</option><option value="1" selected>+ 1 level of sub-categories</option><option value="2">+ 2 levels</option><option value="3">+ 3 levels</option></select></label>`,
        );
        const intro = probe
            ? html`<div class="note">${probe.via ? `“${probe.via}” is a list of pages; used “${probe.page}”.` : `Found “${probe.page}” on ${wiki.site}.`} How should I find the rest?</div>`
            : html`<div class="note">Connected to <b>${wiki.site}</b>. Give an example page to find similar ones, or use a category:</div>`;
        const categoryPicks =
            probe && exampleCategories.length
                ? html`<div class="note">Categories “${probe.page}” is in: ${joinHtml(
                      exampleCategories.slice(0, 14).map((c) => html`<button class="chip pbcatpick">${c}</button>`),
                      ' ',
                  )}</div>`
                : '';
        setHtml(how, html`${intro}${options}${categoryPicks}`);
        byId<HTMLButtonElement>('pbload').disabled = false;
    } catch (error) {
        setHtml(how, html`<div class="note" style="color:var(--red)">${error instanceof Error ? error.message : String(error)}</div>`);
        if (error instanceof wikiEngine.WikiError && error.blocked) void showBuilderError(error);
    }
}

/** Reads every page found the chosen way, then works out sensible defaults for steps 2–4. */
export async function readSelectedPages(): Promise<void> {
    const wiki = packBuilder.wiki;
    if (!wiki) return;
    const how = document.querySelector<HTMLInputElement>('input[name=pbhow]:checked')?.value;
    if (!how) return;
    const report = showBuilderProgress('Reading the wiki…');
    try {
        let titles: string[];
        if (how.startsWith('t:')) {
            packBuilder.infoboxTemplate = how.slice(2);
            titles = await wikiEngine.roster(wiki, { mode: 'template', name: packBuilder.infoboxTemplate, onProg: (m) => report(m) });
        } else {
            const category = byId<HTMLInputElement>('pbcat').value.trim();
            if (!category) {
                hideProgress();
                toast('Type a category');
                return;
            }
            titles = await wikiEngine.roster(wiki, {
                mode: 'category',
                name: category,
                depth: Number(byId<HTMLSelectElement>('pbdepth').value),
                onProg: (m) => report(m),
            });
            packBuilder.infoboxTemplate = null;
        }
        if (!titles.length) {
            hideProgress();
            toast('No pages found that way');
            return;
        }
        if (titles.length > 5000) {
            hideProgress();
            if (!(await ask(`That finds ${titles.length} pages, which will take a while to read. Carry on?`, 'Carry on'))) return;
            report('Reading…');
        }
        // pages already read on this wiki are reused
        const pages: Pages = packBuilder.pages && packBuilder.wiki === wiki ? packBuilder.pages : new Map();
        const missing = titles.filter((t) => !pages.has(t));
        const fresh = missing.length ? await wikiEngine.readPages(wiki, missing, report) : new Map();
        for (const [title, page] of fresh) pages.set(title, page);
        packBuilder.pages = pages;
        packBuilder.titles = titles.filter((t) => pages.has(t));
        packBuilder.excludedPages = new Set();
        packBuilder.forcedPages = new Set();
        packBuilder.excludedCategories = new Set();
        packBuilder.families = null;
        packBuilder.familiesOff = new Set();
        packBuilder.pack = null;
        // collected by category: use the info box most of the pages share, if there is one
        if (!packBuilder.infoboxTemplate) {
            const uses = new Map<string, number>();
            for (const title of packBuilder.titles)
                for (const call of wikiEngine.templates(pages.get(title)!.wt || ''))
                    if (/info\s?box/i.test(call.name) && call.n >= 3) uses.set(call.name, (uses.get(call.name) || 0) + 1);
            const best = [...uses].sort((a, b) => b[1] - a[1])[0];
            if (best && best[1] >= packBuilder.titles.length * 0.3) packBuilder.infoboxTemplate = best[0];
        }
        const chosenPages: Pages = new Map(packBuilder.titles.map((t) => [t, pages.get(t)!]));
        report('Sorting categories…');
        packBuilder.categories = wikiEngine.catSummary(chosenPages);
        packBuilder.fields = packBuilder.infoboxTemplate ? wikiEngine.fieldSummary(chosenPages, packBuilder.infoboxTemplate) : [];
        report('Grouping categories into filters…');
        packBuilder.categoryFacets = await wikiEngine.facetGuess(wiki, packBuilder.categories, packBuilder.titles.length);
        report('Looking for gallery pages…');
        packBuilder.galleryInfo = await wikiEngine.galleryPattern(wiki, packBuilder.titles);
        packBuilder.gallerySuffix = packBuilder.galleryInfo?.suffix || '';
        packBuilder.galleries = null;
        chooseDefaults();
        hideProgress();
        // "Infobox Bakugan" → items are "bakugans"
        const kind = packBuilder.infoboxTemplate
            ? packBuilder.infoboxTemplate.replace(/^(info\s?box|character|template)\s*/i, '').trim()
            : how === 'c'
              ? byId<HTMLInputElement>('pbcat').value.trim()
              : '';
        packBuilder.noun = kind ? kind.toLowerCase().replace(/\s*info\s?box$/i, '') : 'items';
        if (packBuilder.noun && !/s$/.test(packBuilder.noun)) packBuilder.noun += 's';
        packBuilder.name = wiki.site.replace(/\s*(wiki|wikia|fandom)$/i, '').trim() + ' ' + packBuilder.noun;
        setBuilderStep(2);
    } catch (error) {
        void showBuilderError(error);
    }
}

/** Fields that relate pages to each other (allies, episodes…) never make good filters. */
const NOT_A_FILTER =
    /variation|form|variant|version|evolution|transform|relative|ally|allies|enem|friend|team|owner|partner|user|guardian|creator|debut|episode|appear/i;
const VARIANT_FIELD = /variation|variant|forms?$|version|evolution|transform|incarnation|alternate|other forms?/i;

/** Sensible starting choices for steps 3 and 4. */
export function chooseDefaults(): void {
    const pageCount = packBuilder.titles.length;
    packBuilder.fieldChoices = new Map();
    for (const f of packBuilder.fields) {
        const mostlyNumbers = f.top.filter((v) => /^[\d\s.,$€£¥円%+-]+$|\d{3,}/.test(v)).length >= f.top.length * 0.5;
        const good =
            f.pages >= pageCount * 0.3 &&
            f.distinct >= 2 &&
            (f.distinct <= 40 || (f.distinct <= 150 && f.distinct <= f.pages * 0.5)) &&
            f.avg <= 3 &&
            !mostlyNumbers &&
            !NOT_A_FILTER.test(f.field);
        packBuilder.fieldChoices.set(f.field, { on: good, name: displayTitle(f.field) });
    }
    // category groups (near-universal ones say nothing)
    const byFacet = new Map<string, CategoryWithFacet[]>();
    for (const c of packBuilder.categoryFacets) {
        if (c.facet === 'Other' || c.count >= pageCount * 0.9) continue;
        if (!byFacet.has(c.facet)) byFacet.set(c.facet, []);
        byFacet.get(c.facet)!.push(c);
    }
    // a category group that just repeats a chosen field ("Pyrus Bakugan" vs the Attribute field) starts off
    const chosenPages: Pages = new Map(packBuilder.titles.map((t) => [t, pageOf(t)]));
    const fieldValueWords = new Set<string>();
    for (const f of packBuilder.fields)
        if (packBuilder.fieldChoices.get(f.field)!.on && packBuilder.infoboxTemplate)
            for (const list of wikiEngine.fieldValues(chosenPages, packBuilder.infoboxTemplate, f.field).values())
                list.forEach((v) => {
                    fieldValueWords.add(v.toLowerCase());
                });
    const repeatsAField = (group: CategoryWithFacet[]) =>
        group.filter((x) =>
            x.cat
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .some((w) => fieldValueWords.has(w)),
        ).length >=
        group.length * 0.5;
    packBuilder.categoryChoices = new Map();
    for (const [facet, group] of byFacet) {
        const covered = new Set<string>();
        for (const title of packBuilder.titles) if (pageOf(title).cats.some((c) => group.some((x) => x.cat === c))) covered.add(title);
        packBuilder.categoryChoices.set(facet, {
            on:
                group.length >= 2 &&
                group.length <= 30 &&
                covered.size >= pageCount * 0.3 &&
                covered.size < pageCount &&
                !repeatsAField(group),
            name: facet,
            cats: group,
            cover: covered.size,
        });
    }
    const variantField = packBuilder.fields.filter((f) => f.links > 0 && VARIANT_FIELD.test(f.field)).sort((a, b) => b.links - a.links)[0];
    packBuilder.variantField = variantField ? variantField.field : '';
    packBuilder.variantsByName = true;
    packBuilder.maxPictures = 30;
    packBuilder.minPictureSize = 48;
    packBuilder.dotFacet = '';
    packBuilder.dotColors = {};
    const smallField = packBuilder.fields.find((f) => packBuilder.fieldChoices.get(f.field)!.on && f.distinct <= 12);
    if (smallField) packBuilder.dotFacet = packBuilder.fieldChoices.get(smallField.field)!.name;
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 2 · PAGES
// ═════════════════════════════════════════════════════════════════════════════

export const isInExcludedCategory = (title: string): boolean => pageOf(title).cats.some((c) => packBuilder.excludedCategories.has(c));
export const isKept = (title: string): boolean =>
    packBuilder.forcedPages.has(title) || (!packBuilder.excludedPages.has(title) && !isInExcludedCategory(title));
export const keptPages = (): string[] => packBuilder.titles.filter(isKept);

export function renderPageList(): void {
    const kept = keptPages();
    setHtml(
        byId('pbcount'),
        html`<b>${kept.length}</b> of ${packBuilder.titles.length} pages kept${packBuilder.infoboxTemplate ? ` (info box: ${packBuilder.infoboxTemplate})` : ''}. Untick anything that isn't one of the things you want to rank (lists, episodes, toys of the wrong kind…).`,
    );
    const categories = packBuilder.categories
        .filter((c) => !c.maint && c.count < packBuilder.titles.length)
        .slice(0, packBuilder.showAllCategories ? 400 : 60);
    const more = packBuilder.categories.filter((c) => !c.maint).length > 60 && !packBuilder.showAllCategories;
    setHtml(
        byId('pbcats'),
        html`${categories.map((c) => {
            const off = packBuilder.excludedCategories.has(c.cat);
            return html`<button class="chip pbx${off ? ' off' : ''}" data-c="${c.cat}" title="${off ? 'Left out: click to bring back' : 'Click to leave out every page in this category'}">${c.cat}<small>${c.count}</small></button>`;
        })}${more && html`<button class="chip" id="pballcats">more…</button>`}`,
    );
    filterPageList();
}

const PAGE_LIST_LIMIT = 3000;

export function filterPageList(): void {
    const query = byId<HTMLInputElement>('pbq').value.trim().toLowerCase();
    const shown = packBuilder.titles.filter((t) => !query || t.toLowerCase().includes(query));
    setHtml(
        byId('pbitems'),
        html`${shown
            .slice(0, PAGE_LIST_LIMIT)
            .map(
                (t) =>
                    html`<label class="${isKept(t) ? '' : 'off'}"><input type="checkbox" data-t="${t}"${isKept(t) ? html` checked` : ''}> <span>${t}</span> <a href="${safeUrl(wikiLink(t))}" target="_blank" rel="noopener" title="Open on the wiki">↗</a></label>`,
            )}${shown.length > PAGE_LIST_LIMIT && html`<div class="note">…and ${shown.length - PAGE_LIST_LIMIT} more. Use the filter.</div>`}`,
    );
}

export function togglePage(title: string, keep: boolean): void {
    if (keep) {
        packBuilder.excludedPages.delete(title);
        if (isInExcludedCategory(title)) packBuilder.forcedPages.add(title);
    } else {
        packBuilder.forcedPages.delete(title);
        packBuilder.excludedPages.add(title);
    }
    packBuilder.families = null;
    packBuilder.pack = null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 3 · TAGS
// ═════════════════════════════════════════════════════════════════════════════

export function renderTagSources(): void {
    const keptCount = keptPages().length;
    const fieldRows = packBuilder.fields
        .filter((f) => f.distinct >= 1)
        .map((f) => {
            const choice = packBuilder.fieldChoices.get(f.field)!;
            return html`<tr class="${choice.on ? '' : 'off'}"><td><input type="checkbox" data-f="${f.field}"${choice.on ? html` checked` : ''}></td><td><b>${f.field}</b></td><td class="note">${f.pages} pages</td><td class="note">${f.top.slice(0, 8).join(', ')}${f.distinct > 8 && html` <i>+${f.distinct - 8} more</i>`}</td><td><input type="text" data-fn="${f.field}" value="${choice.name}"></td></tr>`;
        });
    setHtml(
        byId('pbfields'),
        packBuilder.fields.length
            ? html`<table class="pbtab"><tr><th></th><th>Info box field</th><th>Used on</th><th>Values (most common first)</th><th>Filter name</th></tr>${fieldRows}</table>`
            : html`<div class="note">No info box found on these pages, so tags come from categories only.</div>`,
    );
    const groups = [...packBuilder.categoryChoices].sort((a, b) => Number(b[1].on) - Number(a[1].on) || b[1].cover - a[1].cover);
    setHtml(
        byId('pbcatf'),
        groups.length
            ? html`${groups.map(
                  ([facet, choice]) =>
                      html`<div class="pbcf${choice.on ? '' : ' off'}"><label><input type="checkbox" data-cf="${facet}"${choice.on ? html` checked` : ''}> <input type="text" data-cfn="${facet}" value="${choice.name}"></label><span class="note">${choice.cover} of ${keptCount} pages:</span> ${joinHtml(
                          choice.cats.slice(0, 24).map((c) => html`<span class="chip">${c.cat}<small>${c.count}</small></span>`),
                          ' ',
                      )}${choice.cats.length > 24 && html` <span class="note">+${choice.cats.length - 24}</span>`}</div>`,
              )}`
            : html`<div class="note">No category groups found.</div>`,
    );
    setHtml(
        byId<HTMLSelectElement>('pbdots'),
        html`<option value="">none</option>${facetNames().map((name) => html`<option${name === packBuilder.dotFacet ? html` selected` : ''}>${name}</option>`)}`,
    );
    renderDotColors();
}

/** Names of the filters that are switched on (fields first, then category groups). */
export function facetNames(): string[] {
    const names: string[] = [];
    for (const f of packBuilder.fields) {
        const choice = packBuilder.fieldChoices.get(f.field)!;
        if (choice.on) names.push(choice.name);
    }
    for (const choice of packBuilder.categoryChoices.values()) if (choice.on) names.push(choice.name);
    return [...new Set(names)];
}

/** Every value of one filter across the kept pages, most common first. */
export function facetValues(name: string): string[] {
    const kept = keptPages();
    const keptPagesMap: Pages = new Map(kept.map((t) => [t, pageOf(t)]));
    const counts = new Map<string, number>();
    for (const f of packBuilder.fields) {
        const choice = packBuilder.fieldChoices.get(f.field)!;
        if (!choice.on || choice.name !== name || !packBuilder.infoboxTemplate) continue;
        for (const list of wikiEngine.fieldValues(keptPagesMap, packBuilder.infoboxTemplate, f.field).values())
            list.forEach((v) => {
                counts.set(v, (counts.get(v) || 0) + 1);
            });
    }
    for (const choice of packBuilder.categoryChoices.values()) {
        if (!choice.on || choice.name !== name) continue;
        for (const c of choice.cats)
            for (const title of kept) if (pageOf(title).cats.includes(c.cat)) counts.set(c.cat, (counts.get(c.cat) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

export function renderDotColors(): void {
    const values = packBuilder.dotFacet ? facetValues(packBuilder.dotFacet).slice(0, 24) : [];
    setHtml(
        byId('pbcolors'),
        values.length
            ? html`<span class="note">Dot colours:</span> ${values.map(
                  (v) =>
                      html`<label class="pbcol"><input type="color" data-col="${v}" value="${packBuilder.dotColors[v] || colorForValue(v)}"> ${v}</label>`,
              )}`
            : html``,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 4 · PICTURES AND VARIANTS
// ═════════════════════════════════════════════════════════════════════════════

export function renderPictureOptions(): void {
    byId<HTMLSelectElement>('pbmax').value = String(packBuilder.maxPictures);
    byId<HTMLSelectElement>('pbminpx').value = String(packBuilder.minPictureSize);
    byId<HTMLInputElement>('pbgal').value = packBuilder.gallerySuffix || '';
    byId('pbgalnote').textContent = packBuilder.galleryInfo
        ? `found on ${packBuilder.galleryInfo.hits} of the first ${packBuilder.galleryInfo.sample} pages`
        : packBuilder.gallerySuffix
          ? ''
          : 'none found: pictures come from the pages themselves';
    const linkFields = packBuilder.fields.filter((f) => f.links > 0).sort((a, b) => b.links - a.links);
    setHtml(
        byId<HTMLSelectElement>('pbvf'),
        html`<option value="">no field</option>${linkFields.map(
            (f) =>
                html`<option value="${f.field}"${f.field === packBuilder.variantField ? html` selected` : ''}>${f.field} (${f.links} pages link)</option>`,
        )}`,
    );
    byId<HTMLInputElement>('pbvn').checked = packBuilder.variantsByName;
    renderFamilies();
}

export function computeFamilies(): Family[] {
    packBuilder.families = wikiEngine.families(pagesRead(), keptPages(), {
        tpl: packBuilder.infoboxTemplate || undefined,
        field: packBuilder.variantField,
        byName: packBuilder.variantsByName,
    });
    return packBuilder.families;
}

export function renderFamilies(): void {
    const families = packBuilder.families || computeFamilies();
    const variantCount = families.reduce((sum, f) => sum + f.members.length, 0);
    const noun = packBuilder.noun || 'items';
    setHtml(
        byId('pbfams'),
        families.length
            ? html`<div class="note"><b>${families.length}</b> ${noun} have variants (${variantCount} variant pages). Each variant stays its own item and can be combined later in the app. Untick a row if those pages aren't really the same ${(packBuilder.noun || 'item').replace(/s$/, '')}.</div>${families.map(
                  (f) =>
                      html`<label class="pbfam${packBuilder.familiesOff.has(f.base) ? ' off' : ''}"><input type="checkbox" data-fb="${f.base}"${packBuilder.familiesOff.has(f.base) ? '' : html` checked`}> <b>${f.base}</b> ← ${f.members.join(', ')}</label>`,
              )}`
            : html`<div class="note">No variants found with these settings.</div>`,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 5 · BUILD
// ═════════════════════════════════════════════════════════════════════════════

export function renderBuildSummary(): void {
    byId<HTMLInputElement>('pbname').value = packBuilder.name || '';
    byId<HTMLInputElement>('pbnoun').value = packBuilder.noun || '';
    const keptCount = keptPages().length;
    const max = packBuilder.maxPictures;
    // rough request count → minutes at the engine's pace
    const requests =
        Math.ceil((keptCount * Math.min(max * 1.25, max + 8)) / 50) + Math.ceil(keptCount / 50) * (packBuilder.gallerySuffix ? 3 : 1);
    const withVariants = (packBuilder.families || []).filter((f) => !packBuilder.familiesOff.has(f.base)).length;
    setHtml(
        byId('pbsum'),
        html`<b>${keptCount}</b> ${packBuilder.noun || 'items'}, up to ${max} picture${max > 1 ? 's' : ''} each${packBuilder.gallerySuffix ? ` (incl. “${packBuilder.gallerySuffix}” pages)` : ''}, ${withVariants} with variants. Tags: ${facetNames().join(', ') || 'none'}.<br><span class="note">About ${Math.max(1, Math.round((requests * 0.3) / 60))} min: the builder asks the wiki slowly so it doesn't get blocked.</span>`,
    );
    showBuildResult();
}

export async function buildPack(): Promise<void> {
    const wiki = packBuilder.wiki!;
    packBuilder.name = byId<HTMLInputElement>('pbname').value.trim() || packBuilder.name;
    packBuilder.noun = byId<HTMLInputElement>('pbnoun').value.trim() || 'items';
    const kept = keptPages();
    if (!kept.length) {
        toast('No pages ticked');
        return;
    }
    const report = showBuilderProgress('Building the pack…');
    try {
        // gallery pages: read the ones I haven't yet (a different suffix starts over)
        const suffix = packBuilder.gallerySuffix;
        if (suffix) {
            let cache = packBuilder.galleries;
            if (!cache || cache.suffix !== suffix) cache = null;
            const missing = kept.filter((t) => !cache?.done.has(t));
            if (missing.length) {
                const read = await wikiEngine.readGalleries(wiki, missing, suffix, report);
                if (!cache) {
                    cache = Object.assign(new Map<string, string>(), {
                        subs: new Map<string, [string, string][]>(),
                        suffix,
                        done: new Set<string>(),
                    });
                    packBuilder.galleries = cache;
                }
                for (const [title, wikitext] of read) cache.set(title, wikitext);
                for (const [title, subPages] of read.subs || []) cache.subs!.set(title, subPages);
                missing.forEach((t) => {
                    cache!.done.add(t);
                });
            }
        }
        const families = (packBuilder.families || computeFamilies()).filter((f) => !packBuilder.familiesOff.has(f.base));
        const fields: string[] = [];
        for (const f of packBuilder.fields) if (packBuilder.fieldChoices.get(f.field)!.on) fields.push(f.field);
        const categoryTags = new Set<string>();
        for (const choice of packBuilder.categoryChoices.values())
            if (choice.on)
                choice.cats.forEach((c) => {
                    categoryTags.add(c.cat);
                });
        const facets: Record<string, string[]> = {};
        for (const name of facetNames()) {
            const values = facetValues(name);
            if (values.length) facets[name] = values;
        }
        const dropBrackets = byId<HTMLInputElement>('pbtidy').checked;
        const dotFacet = packBuilder.dotFacet && facets[packBuilder.dotFacet] ? packBuilder.dotFacet : undefined;
        const pack = await wikiEngine.build(
            wiki,
            pagesRead(),
            {
                titles: kept,
                gal: suffix ? packBuilder.galleries : null,
                tpl: packBuilder.infoboxTemplate || undefined,
                fields,
                catFacet: categoryTags,
                facets,
                fams: families,
                id: packSlug(packBuilder.name),
                name: packBuilder.name,
                noun: packBuilder.noun,
                maxPics: packBuilder.maxPictures,
                minPx: packBuilder.minPictureSize,
                dots: dotFacet,
                rename: dropBrackets ? (t) => t.replace(/\s*\([^)]*\)\s*$/, '').trim() || t : null,
            },
            report,
        );
        if (dotFacet) {
            pack.colors = {};
            for (const value of facets[dotFacet]!.slice(0, 24)) pack.colors[value] = packBuilder.dotColors[value] || colorForValue(value);
        }
        packBuilder.pack = pack;
        hideProgress();
        showBuildResult();
    } catch (error) {
        void showBuilderError(error);
    }
}

export function showBuildResult(): void {
    const pack = packBuilder.pack;
    const result = byId('pbres');
    if (!pack) {
        setHtml(result, html``);
        return;
    }
    const rows = pack.items;
    const pictureCount = rows.reduce((sum, row) => sum + row[2].length, 0);
    const withoutPicture = rows.filter((row) => !row[2].length);
    const tagged = rows.filter((row) => row[1].length).length;
    const variants = rows.filter((row) => Number.isInteger(row[4])).length;
    const pictureUrl = (source: string) => (/^(data:|https?:)/.test(source) ? source : (pack.base || '') + source);
    const sizeKb = Math.round(JSON.stringify(pack).length / 1024);
    const sample = rows
        .filter((row) => row[2].length)
        .slice(0, 60)
        .map((row) => {
            const [name, tags, pictures, title, baseRow] = row;
            const variantOf = Number.isInteger(baseRow) ? 'Variant of ' + rows[baseRow!]![0] : '';
            return html`<a class="vc" href="${safeUrl(wikiLink(title || name))}" target="_blank" rel="noopener" title="${[tags.join(', '), variantOf].filter(Boolean).join('. ')}"><div class="vimg"><img alt="" loading="lazy" referrerpolicy="no-referrer" src="${safeUrl(pictureUrl(pictures[0]![1]))}"></div><div class="vl"><b>${name}</b><br>${pictures.length} pic${pictures.length > 1 ? 's' : ''}</div></a>`;
        });
    setHtml(
        result,
        html`<div class="pbok"><b>${pack.name}</b>: ${rows.length} ${pack.noun}, ${pictureCount} pictures, ${variants} variants, ${tagged} tagged, ${sizeKb} KB</div>${
            withoutPicture.length > 0 &&
            html`<div class="note">${withoutPicture.length} without a picture (they get a text tile; you can add one later): ${withoutPicture
                .slice(0, 30)
                .map((row) => row[0])
                .join(', ')}${withoutPicture.length > 30 ? '…' : ''}</div>`
        }<div class="note">Spot-check (click one to open its wiki page):</div><div class="stgrid pbgrid">${sample}</div><div class="edbtns"><button id="pbstart" class="accent">Start a tier list with it</button><button id="pbsave">Save pack file</button><button id="pbinst">Keep in this browser only</button></div>`,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  WIRING (runs once at start-up, from main.ts)
// ═════════════════════════════════════════════════════════════════════════════

export function setupPackBuilder(): void {
    byId('pbx').onclick = () => byId('pbm').classList.remove('show');
    byId('pbsteps').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (button && !button.disabled) setBuilderStep(Number(button.dataset.s));
    });

    // step 1
    byId('pbfind').onclick = () => void findSimilarPages();
    byId<HTMLInputElement>('pbex').onkeydown = byId<HTMLInputElement>('pbwiki').onkeydown = (e) => {
        if (e.key === 'Enter') void findSimilarPages();
    };
    byId('pbwiki').oninput = () => (byId<HTMLButtonElement>('pbload').disabled = true);
    byId('pbhow').addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('.pbcatpick');
        if (!chip) return;
        byId<HTMLInputElement>('pbcat').value = chip.textContent || '';
        const byCategory = document.querySelector<HTMLInputElement>('input[name=pbhow][value=c]');
        if (byCategory) byCategory.checked = true;
    });
    byId('pbload').onclick = () => void readSelectedPages();

    // step 2
    byId('pbcats').addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.id === 'pballcats') {
            packBuilder.showAllCategories = true;
            renderPageList();
            return;
        }
        const chip = target.closest<HTMLElement>('.pbx');
        if (!chip) return;
        const category = chip.dataset.c!;
        if (packBuilder.excludedCategories.has(category)) packBuilder.excludedCategories.delete(category);
        else {
            packBuilder.excludedCategories.add(category);
            for (const title of [...packBuilder.forcedPages])
                if (pageOf(title).cats.includes(category)) packBuilder.forcedPages.delete(title);
        }
        packBuilder.families = null;
        packBuilder.pack = null;
        renderPageList();
    });
    byId('pbitems').addEventListener('change', (e) => {
        const box = e.target as HTMLInputElement;
        const title = box.dataset.t;
        if (title == null) return;
        togglePage(title, box.checked);
        box.parentElement!.classList.toggle('off', !box.checked);
        byId('pbcount').querySelector('b')!.textContent = String(keptPages().length);
    });
    byId('pbq').oninput = filterPageList;
    const tickShown = (keep: boolean) => {
        byId('pbitems')
            .querySelectorAll<HTMLInputElement>('input[data-t]')
            .forEach((box) => {
                togglePage(box.dataset.t!, keep);
            });
        renderPageList();
    };
    byId('pball').onclick = () => tickShown(true);
    byId('pbnone').onclick = () => tickShown(false);

    // step 3
    byId('pbtags').addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const data = input.dataset;
        if (data.f != null) {
            packBuilder.fieldChoices.get(data.f)!.on = input.checked;
            renderTagSources();
        } else if (data.fn != null) {
            packBuilder.fieldChoices.get(data.fn)!.name = input.value.trim() || displayTitle(data.fn);
            renderTagSources();
        } else if (data.cf != null) {
            packBuilder.categoryChoices.get(data.cf)!.on = input.checked;
            renderTagSources();
        } else if (data.cfn != null) {
            packBuilder.categoryChoices.get(data.cfn)!.name = input.value.trim() || data.cfn;
            renderTagSources();
        } else if (input.id === 'pbdots') {
            packBuilder.dotFacet = input.value;
            renderDotColors();
        } else if (data.col != null) packBuilder.dotColors[data.col] = input.value;
        packBuilder.pack = null;
    });

    // step 4
    byId<HTMLSelectElement>('pbmax').onchange = (e) => {
        packBuilder.maxPictures = Number((e.target as HTMLSelectElement).value);
        packBuilder.pack = null;
    };
    byId<HTMLSelectElement>('pbminpx').onchange = (e) => {
        packBuilder.minPictureSize = Number((e.target as HTMLSelectElement).value);
        packBuilder.pack = null;
    };
    byId<HTMLInputElement>('pbgal').onchange = (e) => {
        const input = e.target as HTMLInputElement;
        let suffix = input.value.trim();
        if (suffix && !suffix.startsWith('/')) suffix = '/' + suffix;
        packBuilder.gallerySuffix = suffix;
        input.value = suffix;
        packBuilder.galleryInfo = null;
        byId('pbgalnote').textContent = suffix ? '' : 'pictures come from the pages themselves';
        packBuilder.pack = null;
    };
    const variantSettingsChanged = () => {
        packBuilder.families = null;
        packBuilder.familiesOff = new Set();
        renderFamilies();
    };
    byId<HTMLSelectElement>('pbvf').onchange = (e) => {
        packBuilder.variantField = (e.target as HTMLSelectElement).value;
        variantSettingsChanged();
    };
    byId<HTMLInputElement>('pbvn').onchange = (e) => {
        packBuilder.variantsByName = (e.target as HTMLInputElement).checked;
        variantSettingsChanged();
    };
    byId('pbfams').addEventListener('change', (e) => {
        const box = e.target as HTMLInputElement;
        const base = box.dataset.fb;
        if (base == null) return;
        if (box.checked) packBuilder.familiesOff.delete(base);
        else packBuilder.familiesOff.add(base);
        box.parentElement!.classList.toggle('off', !box.checked);
        packBuilder.pack = null;
    });
    document.querySelectorAll<HTMLElement>('#pbbox [data-next]').forEach((button) => {
        button.onclick = () => setBuilderStep(Number(button.dataset.next));
    });

    // step 5
    byId('pbbuild').onclick = () => void buildPack();
    byId('pbres').addEventListener('click', async (e) => {
        const pack = packBuilder.pack;
        if (!pack) return;
        const id = (e.target as HTMLElement).id;
        if (id === 'pbsave') {
            downloadBlob(new Blob([JSON.stringify(pack)], { type: 'application/json' }), pack.id + '-pack.json');
            toast('Saved. Open it in any browser with File → Load…', 5000);
        }
        if (id === 'pbinst' || id === 'pbstart') {
            const existing = genericPacks.get(pack.id);
            if (
                existing &&
                existing !== pack &&
                !(await ask(
                    `You already have a pack called “${existing.name}”. Replace it? Lists made from the old one keep working.`,
                    'Replace',
                ))
            )
                return;
            await installPack(pack);
            renderListMenu();
            if (id === 'pbstart') {
                byId('pbm').classList.remove('show');
                await createListFromPack(pack.id);
            } else toast(`${pack.name} is in the list menu (top left), under Packs`);
        }
    });

    // ways in
    byId('pbopen').onclick = () => openPackBuilder();
    byId('wkpack').onclick = () => openPackBuilder(byId<HTMLInputElement>('wkurl').value.trim());
}
