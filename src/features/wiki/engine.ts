// src/features/wiki/engine.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Wiki engine: turns a MediaWiki wiki (Fandom, Wikipedia, Bulbapedia…) into a pack.
//  The pack builder (features/pack-builder) drives it step by step:
//
//    connect → probe (which info box an example page uses) → roster (every page using it)
//    → readPages → catSummary / fieldSummary / facetGuess (filters)
//    → galleryPattern / readGalleries (pictures) → families (variants) → build (the pack)
//
//  Everything talks to the wiki's public API from the browser. Requests are paced
//  (one every ~260 ms, slower when the wiki pushes back) because Fandom blocks bursts.
// ─────────────────────────────────────────────────────────────────────────────
import type { GenericPack, PackPicture, PackRow } from '../../core/types';

// ═════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════════════════════

/** A wiki I'm connected to. */
export interface Wiki {
    api: string;
    site: string;
    server: string;
    articlepath: string;
    /** Page title from the address the person typed, if any. */
    title: string;
    /** Local names of the File, Category and Template namespaces (plus the English ones). */
    fileNs: string[];
    catNs: string[];
    tplNs: string[];
}

/** One article: its wikitext, visible categories and lead picture. */
export interface WikiPage {
    title: string;
    cats: string[];
    img: string | null;
    wt?: string;
}
export type Pages = Map<string, WikiPage>;

/** One {{template call}} in wikitext. `n` = how many named fields it has. */
export interface TemplateCall {
    name: string;
    params: Record<string, string>;
    n: number;
}

export interface CategoryCount {
    cat: string;
    count: number;
    /** Housekeeping category ("Stubs", "Images"…) rather than a real grouping. */
    maint: boolean;
}
export interface CategoryWithFacet extends CategoryCount {
    /** The filter this category belongs to. */
    facet: string;
}

export interface FieldSummary {
    field: string;
    /** Pages that fill this field. */
    pages: number;
    distinct: number;
    top: string[];
    /** Average number of values per page. */
    avg: number;
    /** Pages whose value is a link or template (kept even when it has no plain values). */
    links: number;
}

/** A picture mentioned in wikitext. */
interface PictureMention {
    /** File name in database form ("Drago_anime.png"). */
    f: string;
    /** Headings it sits under. */
    path: string[];
    cap: string;
    /** From a gallery page. */
    g: boolean;
    /** From an info box field. */
    ib?: boolean;
    /** The page's lead picture. */
    main?: boolean;
    /** 0 lead/info box · 1 article · 2 gallery page · 3 gallery sub-page */
    tier: number;
}

/** Gallery pages by article title, plus their sub-pages ([name, wikitext]). */
export type Galleries = Map<string, string> & { subs?: Map<string, [string, string][]> };

interface FileInfo {
    url: string;
    w: number;
    h: number;
    mime: string;
}

export interface Family {
    base: string;
    members: string[];
}

export type Progress = (message: string, fraction?: number) => void;

export interface BuildOptions {
    titles: string[];
    gal: Galleries | null;
    maxPics?: number;
    width?: number;
    minPx?: number;
    fields?: string[];
    tpl?: string;
    /** Categories that become tags. */
    catFacet?: Set<string>;
    rename?: ((title: string) => string) | null;
    fams?: Family[];
    facets?: Record<string, string[]>;
    id: string;
    name: string;
    noun?: string;
    dots?: string;
}

/** The parts of MediaWiki API answers this engine reads. */
interface ApiPage {
    title: string;
    missing?: boolean;
    invalid?: boolean;
    revisions?: { slots?: { main?: { content?: string } } }[];
    categories?: { title: string }[];
    pageimage?: string;
    thumbnail?: { source: string };
    images?: { title: string }[];
    links?: { title: string }[];
    imageinfo?: { url: string; thumburl?: string; width: number; height: number; mime: string }[];
}
interface ApiAnswer {
    query?: {
        general?: { sitename: string; server?: string; articlepath?: string };
        namespaces?: Record<string, { name?: string; canonical?: string }>;
        namespacealiases?: { id: number; alias: string }[];
        pages?: ApiPage[];
        embeddedin?: { title: string }[];
        categorymembers?: { ns: number; title: string }[];
        allpages?: { title: string }[];
        allcategories?: { category: string; size?: number; pages?: number }[];
        normalized?: { from: string; to: string }[];
        redirects?: { from: string; to: string }[];
    };
    continue?: Record<string, string>;
    error?: { info?: string };
}
export type ApiQuery = NonNullable<ApiAnswer['query']>;

/** The wiki stopped answering (`blocked` = probably a bot check) or answered with an error. */
export class WikiError extends Error {
    constructor(
        message: string,
        readonly blocked = false,
        readonly host = '',
    ) {
        super(message);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TALKING TO THE WIKI (paced, with back-off)
// ═════════════════════════════════════════════════════════════════════════════

const BASE_GAP_MS = 260;
let gapMs = BASE_GAP_MS;
let lastRequestAt = 0;
let onWait: ((message: string) => void) | null = null;

/** Where to show "the wiki asked me to slow down" messages. */
export function setWait(show: ((message: string) => void) | null): void {
    onWait = show;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for my turn: requests go out one every `gapMs`. */
async function waitForTurn(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, lastRequestAt + gapMs);
    lastRequestAt = at;
    if (at > now) await sleep(at - now);
}

async function getJson(url: string, tries = 6): Promise<ApiAnswer> {
    let lastError: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
        await waitForTurn();
        try {
            const response = await fetch(url);
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error('HTTP ' + response.status);
                gapMs = Math.min(1500, gapMs * 2);
                const waitMs = Math.min(60_000, 2000 * 2 ** attempt);
                onWait?.(`The wiki asked us to slow down. Waiting ${Math.round(waitMs / 1000)}s…`);
                await sleep(waitMs);
                continue;
            }
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const answer = (await response.json()) as ApiAnswer;
            if (gapMs > BASE_GAP_MS) gapMs = Math.max(BASE_GAP_MS, gapMs * 0.95);
            return answer;
        } catch (error) {
            lastError = error;
            if (/HTTP 4/.test(errorMessage(error))) break;
            gapMs = Math.min(1500, gapMs * 2);
            const waitMs = Math.min(60_000, 1500 * 2 ** attempt);
            onWait?.(`Connection hiccup. Retrying in ${Math.round(waitMs / 1000)}s…`);
            await sleep(waitMs);
        }
    }
    const blocked = /fetch|network|load failed/i.test(errorMessage(lastError));
    let host = '';
    try {
        host = new URL(url).origin;
    } catch {}
    throw new WikiError(
        blocked
            ? `The wiki stopped answering. It may be checking that you're not a bot: open ${host} in a new tab, let it load normally, then press the button again. Work already done is kept.`
            : errorMessage(lastError),
        blocked,
        host,
    );
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** An API address with these query parameters. */
const apiUrl = (api: string, params: Record<string, string>): string =>
    api + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });

/** Runs a query and every continuation of it (up to `maxPages` answers), handing each answer to `each`. */
export async function queryAll(
    wiki: Pick<Wiki, 'api'>,
    params: Record<string, string>,
    each: (query: ApiQuery) => void,
    maxPages = 400,
): Promise<void> {
    let continueFrom: Record<string, string> = {};
    for (let page = 0; page < maxPages; page++) {
        const answer = await getJson(apiUrl(wiki.api, { action: 'query', ...params, ...continueFrom }));
        if (answer.error) throw new WikiError(answer.error.info || 'wiki error');
        each(answer.query || {});
        if (!answer.continue) return;
        continueFrom = answer.continue;
    }
}

/** Runs `work` on every item, at most `limit` at a time. */
async function inParallel<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const index = next++;
                await work(items[index]!, index);
            }
        }),
    );
}

/** Splits titles into batches the API accepts: at most 50 per request and a URL under ~5.5 KB. */
function batches<T>(list: T[], maxCount = 50, maxLength = 5500): T[][] {
    const out: T[][] = [];
    let current: T[] = [];
    let length = 0;
    for (const item of list) {
        const itemLength = encodeURIComponent(String(item)).length + 3;
        if (current.length && (current.length >= maxCount || length + itemLength > maxLength)) {
            out.push(current);
            current = [];
            length = 0;
        }
        current.push(item);
        length += itemLength;
    }
    if (current.length) out.push(current);
    return out;
}

const pageText = (page: ApiPage | undefined): string => page?.revisions?.[0]?.slots?.main?.content || '';

// ═════════════════════════════════════════════════════════════════════════════
//  WIKITEXT
// ═════════════════════════════════════════════════════════════════════════════

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** Wikitext → plain text: links become their label, references, markup and templates go. */
const plainText = (wikitext: string): string =>
    String(wikitext || '')
        .replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/gi, '')
        .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
        .replace(/'{2,}/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/** Housekeeping categories: never filters. */
const MAINTENANCE =
    /stub|pages? (with|using|needing|that)|images?$|^images|articles|candidates|deletion|cleanup|clean-up|needs?|broken|maintenance|templates|disambig|hidden|wanted|redirect|navbox|galler(y|ies)|file|blog|policy|help|community|unreleased images|spoiler|copyright|infobox/i;

/** Matches "Namespace:" at the start of a title, for any of these namespace names. */
const namespacePrefix = (names: Iterable<string>): RegExp =>
    new RegExp('^\\s*(?:' + [...new Set(names)].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*:\\s*', 'i');

/** A file name in the form the API uses: no namespace, underscores, first letter capital. */
export function dbk(wiki: Pick<Wiki, 'fileNs'>, file: string): string {
    let name = String(file).replace(namespacePrefix(wiki.fileNs), '').replace(/_/g, ' ').trim();
    try {
        name = decodeURIComponent(name);
    } catch {}
    name = name.replace(/ /g, '_');
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Template names compare like the wiki does: spaces for underscores, first letter capital. */
const templateName = (name: string): string =>
    String(name || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (c) => c.toUpperCase());

/** Splits on | that are not inside {{…}} or [[…]]. */
function splitTopLevel(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const two = text.slice(i, i + 2);
        if (two === '{{' || two === '[[') {
            depth++;
            current += two;
            i++;
            continue;
        }
        if ((two === '}}' || two === ']]') && depth > 0) {
            depth--;
            current += two;
            i++;
            continue;
        }
        if (text[i] === '|' && depth === 0) {
            out.push(current);
            current = '';
            continue;
        }
        current += text[i];
    }
    out.push(current);
    return out;
}

/** Every template call in the text. */
export function templates(wikitext: string): TemplateCall[] {
    const out: TemplateCall[] = [];
    for (let start = wikitext.indexOf('{{'); start >= 0; start = wikitext.indexOf('{{', start)) {
        let depth = 0;
        let end = start;
        for (; end < wikitext.length; end++) {
            if (wikitext.startsWith('{{', end)) {
                depth++;
                end++;
            } else if (wikitext.startsWith('}}', end)) {
                depth--;
                end++;
                if (depth === 0) break;
            }
        }
        const parts = splitTopLevel(wikitext.slice(start + 2, end - 1));
        const name = templateName(parts[0]!.replace(/<!--[\s\S]*?-->/g, ''));
        if (name && !/^[#:!]/.test(name) && !name.includes('{')) {
            const params: Record<string, string> = {};
            let named = 0;
            parts.slice(1).forEach((part, k) => {
                const eq = part.indexOf('=');
                if (eq > 0 && !/[[{]/.test(part.slice(0, eq))) {
                    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
                    named++;
                } else params[String(k + 1)] = part.trim();
            });
            out.push({ name, params, n: named });
        }
        start += 2;
    }
    return out;
}

const infoboxCache = new Map<string, Map<string, TemplateCall | null>>();

/** The call of info box template `template` in this page's text (cached: pages are read many times). */
export function infobox(wikitext: string, template: string): TemplateCall | null {
    const name = templateName(template);
    let byText = infoboxCache.get(name);
    if (!byText) {
        byText = new Map();
        infoboxCache.set(name, byText);
    }
    if (byText.has(wikitext)) return byText.get(wikitext)!;
    const call = templates(wikitext).find((x) => x.name === name) || null;
    if (byText.size > 20_000) byText.clear();
    byText.set(wikitext, call);
    return call;
}

/** A field's value as plain values: "[[Pyrus]]<br>[[Darkus]]" → ["Pyrus", "Darkus"]. */
export function values(value: string | undefined): string[] {
    if (!value) return [];
    const out: string[] = [];
    let text = String(value)
        .replace(/<ref[\s\S]*?(<\/ref>|\/>)/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    for (const link of text.matchAll(/\[\[([^|\]]+)(?:\|([^\]]*))?\]\]/g)) {
        if (namespacePrefix(['File', 'Image', 'Category']).test(link[1]!)) continue;
        out.push((link[2] || link[1]!).trim());
    }
    if (!out.length) {
        text = plainText(text);
        for (const part of text.split(/\s*(?:,|;|\/|\band\b|•|·|\n)\s*/)) if (part) out.push(part);
    }
    return [...new Set(out.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x && x.length <= 40 && !IMAGE_FILE.test(x)))];
}

/**
 * Every page's values for one info box field, tidied: one spelling per value, and
 * "Pyrus Darkus" split into two when both words are values on their own elsewhere.
 */
export function fieldValues(pages: Pages, template: string, field: string): Map<string, string[]> {
    const raw = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const [title, page] of pages) {
        let value = infobox(page.wt || '', template)?.params[field];
        if (!value) continue;
        value = value.replace(/\[\[\s*(File|Image)\s*:[^\]]*\]\]/gi, ' ');
        const list = values(value).filter((x) => !/^\d+px\b/i.test(x) && !/^(none|n\/a|unknown|\?|-|tba|tbd)$/i.test(x));
        raw.set(title, list);
        list.forEach((x) => {
            counts.set(x.toLowerCase(), (counts.get(x.toLowerCase()) || 0) + 1);
        });
    }
    const spelling = new Map<string, string>();
    for (const list of raw.values())
        for (const x of list) {
            const key = x.toLowerCase();
            const current = spelling.get(key);
            if (!current || (/^[A-Z]/.test(x) && !/^[A-Z]/.test(current))) spelling.set(key, x);
        }
    const singleWords = new Set([...counts].filter(([key, n]) => n >= 3 && !key.includes(' ')).map(([key]) => key));
    const out = new Map<string, string[]>();
    for (const [title, list] of raw) {
        const tidy: string[] = [];
        for (const x of list) {
            const words = x.toLowerCase().split(/\s+/);
            if (words.length > 1 && words.every((w) => singleWords.has(w)))
                words.forEach((w) => {
                    tidy.push(spelling.get(w)!);
                });
            else tidy.push(spelling.get(x.toLowerCase()) || x);
        }
        out.set(title, [...new Set(tidy)]);
    }
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CONNECTING
// ═════════════════════════════════════════════════════════════════════════════

/** What the person typed ("bakugan", a wiki link, a page link) → origin, path prefix, page title. */
export function parseInput(input: string): { origin: string; prefix: string; title: string } | null {
    let text = String(input || '').trim();
    if (!text) return null;
    if (!/[./]/.test(text)) text = text.toLowerCase().replace(/[^a-z0-9-]+/g, '') + '.fandom.com';
    if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    let prefix = '';
    let title = '';
    const article = url.pathname.match(/^(.*?)\/wiki\/(.+)$/);
    if (article) {
        prefix = article[1]!;
        try {
            title = decodeURIComponent(article[2]!);
        } catch {
            title = article[2]!;
        }
    } else if (url.searchParams.get('title')) {
        title = url.searchParams.get('title')!;
        prefix = url.pathname.replace(/\/index\.php$/, '');
    } else prefix = url.pathname.replace(/\/+$/, '').replace(/\/(api|index)\.php$/, '');
    return {
        origin: url.origin,
        prefix: prefix.replace(/\/w$/, ''),
        title: title.replace(/_/g, ' ').replace(/#.*/, '').trim(),
    };
}

/** Finds the wiki's API (it lives at /api.php or /w/api.php) and reads its namespaces. */
export async function connect(input: string): Promise<Wiki> {
    const place = parseInput(input);
    if (!place) throw new WikiError('That is not a wiki address');
    const candidates = [place.origin + place.prefix + '/api.php', place.origin + place.prefix + '/w/api.php'];
    if (place.prefix) candidates.push(place.origin + '/w/api.php', place.origin + '/api.php');
    for (const api of candidates) {
        try {
            const answer = await getJson(
                apiUrl(api, { action: 'query', meta: 'siteinfo', siprop: 'general|namespaces|namespacealiases' }),
                2,
            );
            const general = answer.query?.general;
            if (!general) continue;
            const namespaces = answer.query!.namespaces || {};
            const aliases = answer.query!.namespacealiases || [];
            const namesOf = (id: number): string[] =>
                [namespaces[id]?.name, namespaces[id]?.canonical, ...aliases.filter((x) => x.id === id).map((x) => x.alias)].filter(
                    (x): x is string => !!x,
                );
            return {
                api,
                site: general.sitename,
                server: String(general.server || '').replace(/^\/\//, 'https://'),
                articlepath: general.articlepath || '/wiki/$1',
                title: place.title,
                fileNs: namesOf(6).concat(['File', 'Image']),
                catNs: namesOf(14).concat(['Category']),
                tplNs: namesOf(10).concat(['Template']),
            };
        } catch {}
    }
    throw new WikiError("Couldn't find a wiki there");
}

// ═════════════════════════════════════════════════════════════════════════════
//  FINDING THE ITEMS
// ═════════════════════════════════════════════════════════════════════════════

export interface ProbeResult {
    page: string;
    /** Info box templates on the example page that other pages use too. */
    templates: { name: string; count: number }[];
    /** Set when the example was a disambiguation page and I followed its first entry. */
    via?: string;
}

/**
 * The info box an example page uses: the template call with the most named fields
 * (names like "Infobox …" first). A disambiguation page leads to its first entry.
 */
export async function probe(wiki: Wiki, example: string, followed = false): Promise<ProbeResult> {
    const title = String(example || wiki.title || '').trim();
    if (!title) throw new WikiError('Type an example page');
    const answer = await getJson(
        apiUrl(wiki.api, { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title, redirects: '1' }),
    );
    const page = answer.query?.pages?.[0];
    if (!page || page.missing) throw new WikiError(`No page called “${title}” on this wiki`);
    const wikitext = pageText(page);
    const calls = templates(wikitext)
        .filter((x) => x.n >= 3 && !/disambig|^(quote|cite|ref|nav)/i.test(x.name))
        .sort((a, b) => Number(/info\s?box/i.test(b.name)) - Number(/info\s?box/i.test(a.name)) || b.n - a.n);
    const names: string[] = [];
    for (const call of calls) {
        if (names.includes(call.name)) continue;
        names.push(call.name);
        if (names.length >= 4) break;
    }
    if (!names.some((n) => /info\s?box/i.test(n))) {
        // maybe a disambiguation page: "Ben Tennyson (Classic)", "Ben Tennyson (Omniverse)"…
        let entries = [...wikitext.matchAll(/\[\[\s*([^|\]#]+?)\s*(?:\||\]\])/g)]
            .map((m) => templateName(m[1]!))
            .filter((x) => x.toLowerCase().startsWith(page.title.toLowerCase() + ' ('));
        if (!entries.length) {
            try {
                const all = await getJson(
                    apiUrl(wiki.api, { action: 'query', list: 'allpages', apprefix: page.title + ' (', aplimit: '20' }),
                );
                entries = (all.query?.allpages || []).map((p) => p.title).filter((x) => !x.includes('/'));
            } catch {}
        }
        if (entries.length && !followed) {
            const result = await probe(wiki, entries[0]!, true);
            if (result.templates.length) return { ...result, via: page.title };
        }
    }
    const used: { name: string; count: number }[] = [];
    for (const name of names) {
        let count = 0;
        try {
            await queryAll(
                wiki,
                { list: 'embeddedin', eititle: wiki.tplNs[0] + ':' + name, einamespace: '0', eilimit: 'max' },
                (q) => {
                    count += (q.embeddedin || []).length;
                },
                30,
            );
        } catch {}
        if (count > 1) used.push({ name, count });
    }
    return { page: page.title, templates: used };
}

/** Every article that uses a template, or that is in a category (and its sub-categories down to `depth`). */
export async function roster(
    wiki: Wiki,
    { mode, name, depth = 1, onProg }: { mode: 'template' | 'category'; name: string; depth?: number; onProg?: (message: string) => void },
): Promise<string[]> {
    const titles = new Set<string>();
    if (mode === 'template') {
        await queryAll(
            wiki,
            { list: 'embeddedin', eititle: wiki.tplNs[0] + ':' + templateName(name), einamespace: '0', eilimit: 'max' },
            (q) => {
                for (const p of q.embeddedin || []) titles.add(p.title);
                onProg?.(`${titles.size} pages…`);
            },
            60,
        );
        return [...titles];
    }
    const catPrefix = namespacePrefix(wiki.catNs);
    const start = wiki.catNs[0] + ':' + String(name).replace(catPrefix, '');
    const seen = new Set<string>();
    const queue: [string, number][] = [[start, 0]];
    while (queue.length && titles.size < 6000) {
        const [category, level] = queue.shift()!;
        if (seen.has(category)) continue;
        seen.add(category);
        await queryAll(
            wiki,
            { list: 'categorymembers', cmtitle: category, cmlimit: 'max', cmtype: level < depth ? 'page|subcat' : 'page' },
            (q) => {
                for (const member of q.categorymembers || []) {
                    if (member.ns === 14) {
                        if (level < depth) queue.push([member.title, level + 1]);
                    } else if (member.ns === 0) titles.add(member.title);
                }
            },
            40,
        );
        onProg?.(`${titles.size} pages…`);
    }
    return [...titles];
}

// ═════════════════════════════════════════════════════════════════════════════
//  READING PAGES
// ═════════════════════════════════════════════════════════════════════════════

/** Text, visible categories and lead picture of every page. */
export async function readPages(wiki: Wiki, titles: string[], onProg?: Progress): Promise<Pages> {
    const pages: Pages = new Map();
    const catPrefix = namespacePrefix(wiki.catNs);
    let done = 0;
    await inParallel(batches(titles), 3, async (batch) => {
        const answer = await getJson(
            apiUrl(wiki.api, { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: batch.join('|') }),
        );
        for (const page of answer.query?.pages || []) {
            if (page.missing) continue;
            const entry = pages.get(page.title) || { title: page.title, cats: [], img: null };
            entry.wt = pageText(page);
            pages.set(page.title, entry);
        }
        await queryAll(
            wiki,
            { prop: 'categories|pageimages', titles: batch.join('|'), cllimit: 'max', clshow: '!hidden', piprop: 'name' },
            (q) => {
                for (const page of q.pages || []) {
                    const entry = pages.get(page.title);
                    if (!entry) continue;
                    for (const c of page.categories || []) {
                        const category = c.title.replace(catPrefix, '');
                        if (!entry.cats.includes(category)) entry.cats.push(category);
                    }
                    if (page.pageimage) entry.img = page.pageimage;
                }
            },
            20,
        );
        done += batch.length;
        onProg?.(`Reading pages… ${done} / ${titles.length}`, done / titles.length);
    });
    return pages;
}

/** How many pages are in each category, biggest first. */
export function catSummary(pages: Pages): CategoryCount[] {
    const counts = new Map<string, number>();
    for (const page of pages.values()) for (const c of page.cats) counts.set(c, (counts.get(c) || 0) + 1);
    return [...counts].map(([cat, count]) => ({ cat, count, maint: MAINTENANCE.test(cat) })).sort((a, b) => b.count - a.count);
}

/** Info box fields: how many pages fill them and with how many different values. */
export function fieldSummary(pages: Pages, template: string): FieldSummary[] {
    const skip =
        /^(image\d*|img|picture|photo|caption\d*|name|title|quote|cry|bgcolor|bordercolor|fontcolor|color text|.*colou?r|voice.*|voiced by|first|last|debut|appearance|description|size|width|height|\d+)$/i;
    const used = new Map<string, number>();
    for (const page of pages.values()) {
        const call = infobox(page.wt || '', template);
        if (call) for (const key of Object.keys(call.params)) if (!skip.test(key)) used.set(key, (used.get(key) || 0) + 1);
    }
    const out: FieldSummary[] = [];
    for (const [field, n] of used) {
        if (n < 2) continue;
        const perPage = fieldValues(pages, template, field);
        const valueCounts = new Map<string, number>();
        let filled = 0;
        for (const list of perPage.values()) {
            if (list.length) filled++;
            list.forEach((x) => {
                valueCounts.set(x, (valueCounts.get(x) || 0) + 1);
            });
        }
        const links = [...perPage.keys()].filter((title) =>
            /\[\[|\{\{/.test(infobox(pages.get(title)!.wt || '', template)?.params[field] || ''),
        ).length;
        if (!filled && !links) continue;
        out.push({
            field,
            pages: filled,
            distinct: valueCounts.size,
            top: [...valueCounts]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map((x) => x[0]),
            avg: [...perPage.values()].reduce((sum, list) => sum + list.length, 0) / Math.max(1, filled),
            links,
        });
    }
    return out.sort((a, b) => b.pages - a.pages);
}

/**
 * Filters from categories: categories that share a parent category become one filter named after it.
 * Large flat groups are split by name pattern ("Season 1 Bakugan"… → "Season").
 */
export async function facetGuess(wiki: Wiki, categories: CategoryCount[], _total?: number): Promise<CategoryWithFacet[]> {
    const catPrefix = namespacePrefix(wiki.catNs);
    const candidates = categories.filter((c) => !c.maint && c.count >= 2).slice(0, 200);
    const parents = new Map<string, string[]>();
    await inParallel(batches(candidates.map((c) => wiki.catNs[0] + ':' + c.cat)), 3, async (batch) => {
        await queryAll(
            wiki,
            { prop: 'categories', titles: batch.join('|'), cllimit: 'max', clshow: '!hidden' },
            (q) => {
                for (const page of q.pages || [])
                    parents.set(
                        page.title.replace(catPrefix, ''),
                        (page.categories || []).map((c) => c.title.replace(catPrefix, '')).filter((x) => !MAINTENANCE.test(x)),
                    );
            },
            10,
        );
    });
    const parentCount = new Map<string, number>();
    for (const c of candidates) for (const p of parents.get(c.cat) || []) parentCount.set(p, (parentCount.get(p) || 0) + 1);
    const countOf = (p: string) => parentCount.get(p) || 0;
    // a parent that is itself an item category ("Bakugan") is a weaker group name than a pure grouping one ("Bakugan seasons")
    const isItemCategory = new Set(candidates.map((c) => c.cat));
    const out: CategoryWithFacet[] = candidates.map((c) => {
        const shared = (parents.get(c.cat) || []).filter((p) => countOf(p) >= 2 && countOf(p) < candidates.length * 0.8);
        const pure = shared.filter((p) => !isItemCategory.has(p)).sort((a, b) => countOf(a) - countOf(b));
        const item = shared.filter((p) => isItemCategory.has(p)).sort((a, b) => countOf(b) - countOf(a));
        const parent = pure[0] || item[0];
        return { ...c, facet: parent ? (isItemCategory.has(parent) ? parent + ' type' : parent) : 'Other' };
    });

    // big groups on flat wikis: split by name pattern
    const byFacet = new Map<string, CategoryWithFacet[]>();
    for (const c of out) {
        if (!byFacet.has(c.facet)) byFacet.set(c.facet, []);
        byFacet.get(c.facet)!.push(c);
    }
    const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    const tokens = (c: CategoryWithFacet) =>
        c.cat
            .toLowerCase()
            .split(/[\s:()]+/)
            .filter(Boolean);
    for (const [facet, group] of byFacet) {
        if (facet === 'Other' || group.length < 7) continue;
        const wordCounts = new Map<string, number>();
        for (const c of group) for (const w of new Set(tokens(c))) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        // words most of the group shares (and the parent's own words) say nothing
        const common = new Set(
            [...wordCounts]
                .filter(([, n]) => n >= group.length * 0.5)
                .map(([w]) => w)
                .concat(
                    facet
                        .toLowerCase()
                        .split(/[\s:()]+/)
                        .filter((w) => w.length >= 3 && w !== 'type'),
                ),
        );
        const distinctive = (c: CategoryWithFacet) => tokens(c).filter((w) => !common.has(w));
        const left = new Set(group);
        const regroup = (matches: (c: CategoryWithFacet) => boolean, name: string) => {
            const members = [...left].filter(matches);
            if (members.length < 2) return;
            members.forEach((c) => {
                c.facet = name;
                left.delete(c);
            });
        };
        // numbered names: "Season 1", "Season 2" → "Season"
        const numbered = new Map<string, CategoryWithFacet[]>();
        for (const c of group) {
            const rest = distinctive(c);
            if (!rest.some((w) => /\d/.test(w))) continue;
            const key = rest.map((w) => (/\d/.test(w) ? '#' : w)).join(' ');
            if (!numbered.has(key)) numbered.set(key, []);
            numbered.get(key)!.push(c);
        }
        for (const [key, members] of numbered)
            if (members.length >= 2) {
                const name = capitalise(key.replace(/#/g, '').replace(/\s+/g, ' ').trim() || 'Number');
                members.forEach((c) => {
                    c.facet = name;
                    left.delete(c);
                });
            }
        // a shared last word: "Japan Exclusive", "Toys R Us Exclusive" → "Exclusive"
        const lastWords = new Map<string, number>();
        for (const c of left) {
            const rest = distinctive(c);
            if (rest.length >= 2) {
                const last = rest[rest.length - 1]!;
                if (last.length >= 4) lastWords.set(last, (lastWords.get(last) || 0) + 1);
            }
        }
        for (const [word, n] of lastWords)
            if (n >= 2)
                regroup((c) => {
                    const rest = distinctive(c);
                    return rest.length >= 2 && rest[rest.length - 1] === word;
                }, capitalise(word));
    }
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICTURES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every picture in a page's wikitext, with the headings it sits under. Reads [[File:…]] links,
 * <gallery> blocks, tabbers, {{heading|…}} templates and bare "image = X.png" info box fields.
 * Pictures shown at 60 px or less are icons, not artwork, and are skipped.
 */
export function parsePics(
    wiki: Pick<Wiki, 'fileNs'>,
    wikitext: string,
    isGallery: boolean,
    outerPath: string[] = [],
): Omit<PictureMention, 'tier'>[] {
    const out: Omit<PictureMention, 'tier'>[] = [];
    const path = [...outerPath];
    let inGallery = false;
    let inTabber = false;
    let tab: string | null = null;
    let subheading: string | null = null;
    const filePrefix = namespacePrefix(wiki.fileNs);
    const lines = String(wikitext)
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        const heading = line.match(/^(={2,6})\s*(.*?)\s*\1$/);
        if (heading) {
            const level = outerPath.length + heading[1]!.length - 2;
            path.length = level;
            path[level] = plainText(heading[2]!);
            tab = null;
            subheading = null;
            continue;
        }
        if (/<tabber/i.test(line)) inTabber = true;
        if (/<\/tabber>/i.test(line)) {
            inTabber = false;
            tab = null;
        }
        if (inTabber) {
            const tabName = line.match(/^(?:\|-\|)?\s*([^|=<>{}[\]]{1,60}?)\s*=\s*$/);
            if (tabName) {
                tab = plainText(tabName[1]!);
                subheading = null;
                continue;
            }
        }
        const headingTemplate = line.match(/^\{\{\s*(?:heading|header|section|subheading|gallery heading)\s*\|\s*([^|}]+)/i);
        if (headingTemplate) {
            subheading = plainText(headingTemplate[1]!);
            continue;
        }
        const where = [...path.filter(Boolean), ...(tab ? [tab] : []), ...(subheading ? [subheading] : [])];
        if (/<gallery/i.test(line)) {
            inGallery = true;
            const rest = line.replace(/<gallery[^>]*>/i, '');
            if (!/<\/gallery>/i.test(line) || !rest.trim()) continue;
        }
        if (/<\/gallery>/i.test(line)) {
            inGallery = false;
            continue;
        }
        if (inGallery) {
            const parts = splitTopLevel(line);
            const file = parts[0]!.replace(filePrefix, '').trim();
            if (IMAGE_FILE.test(file)) {
                const caption =
                    parts.length > 1
                        ? plainText(
                              parts
                                  .slice(1)
                                  .filter((p) => !/^(link|alt|page|class)\s*=/.test(p))
                                  .pop() || '',
                          )
                        : '';
                out.push({ f: dbk(wiki, file), path: where, cap: caption, g: isGallery });
            }
            continue;
        }
        for (const link of line.matchAll(
            /\[\[\s*(?:File|Image|[^:\]|]{1,20})\s*:\s*([^|\]]+?\.(?:png|jpe?g|gif|webp|bmp))\s*((?:\|[^\]]*)?)\]\]/gi,
        )) {
            const options = splitTopLevel(link[2]!.replace(/^\|/, ''));
            const isIcon = options.some((o) => {
                const size = o.trim().match(/^(\d*)(?:x(\d+))?px$/i);
                const px = size ? Math.max(Number(size[1]) || 0, Number(size[2]) || 0) : 0;
                return px > 0 && px <= 60;
            });
            if (isIcon) continue;
            const caption = plainText(
                options
                    .filter(
                        (o) =>
                            o &&
                            !/^(thumb|thumbnail|frame|frameless|border|left|right|center|centre|none|upright.*|\d+(x\d+)?px|x\d+px|link=.*|alt=.*|class=.*|page=.*)$/i.test(
                                o.trim(),
                            ),
                    )
                    .pop() || '',
            );
            out.push({ f: dbk(wiki, link[1]!), path: where, cap: caption, g: isGallery });
        }
        // bare file names in info box fields: "| image = Drago.png"
        const bare = line.match(/^\|\s*(image\w*|img\w*|picture|photo)\s*=\s*([^[\]{}|]+?\.(?:png|jpe?g|gif|webp))\s*$/i);
        if (bare) out.push({ f: dbk(wiki, bare[2]!), path: ['Info box'], cap: '', g: false, ib: true });
    }
    return out;
}

/** Which "/Gallery"-style sub-page this wiki uses for picture galleries, if any. */
export async function galleryPattern(wiki: Wiki, titles: string[]): Promise<{ suffix: string; hits: number; sample: number } | null> {
    const suffixes = ['/Gallery', '/Image Gallery', '/Image gallery', '/Images', '/Galleries', '/gallery'];
    const sample = titles.slice(0, 60);
    let best: string | null = null;
    let bestHits = 0;
    for (const suffix of suffixes) {
        let hits = 0;
        for (const batch of batches(sample.map((t) => t + suffix))) {
            const answer = await getJson(apiUrl(wiki.api, { action: 'query', titles: batch.join('|') }));
            hits += (answer.query?.pages || []).filter((p) => !p.missing && !p.invalid).length;
        }
        if (hits > bestHits) {
            bestHits = hits;
            best = suffix;
        }
        if (bestHits >= sample.length * 0.5) break;
    }
    return best && bestHits >= Math.max(2, sample.length * 0.05) ? { suffix: best, hits: bestHits, sample: sample.length } : null;
}

/** Follows normalisations and redirects in an answer back to the title I asked for. */
function originalTitles(query: ApiQuery | undefined): (title: string) => string {
    const back = new Map<string, string>();
    for (const r of [...(query?.normalized || []), ...(query?.redirects || [])]) back.set(r.to, r.from);
    return (title) => {
        for (let k = 0; k < 3 && back.has(title); k++) title = back.get(title)!;
        return title;
    };
}

/**
 * Gallery pages of these articles, plus the sub-pages they point to
 * ([[Title/Gallery/Omniverse]], {{:Title/Gallery/X}}, or nav templates with link1 = Omniverse).
 */
export async function readGalleries(wiki: Wiki, titles: string[], suffix: string, onProg?: Progress): Promise<Galleries> {
    const galleries: Galleries = new Map();
    let done = 0;
    await inParallel(batches(titles), 3, async (batch) => {
        const answer = await getJson(
            apiUrl(wiki.api, {
                action: 'query',
                prop: 'revisions',
                rvprop: 'content',
                rvslots: 'main',
                titles: batch.map((t) => t + suffix).join('|'),
                redirects: '1',
            }),
        );
        const asked = originalTitles(answer.query);
        for (const page of answer.query?.pages || []) {
            if (page.missing) continue;
            galleries.set(asked(page.title).slice(0, -suffix.length), pageText(page));
        }
        done += batch.length;
        onProg?.(`Reading gallery pages… ${done} / ${titles.length}`, done / titles.length);
    });
    const subPages: [string, string, string][] = []; // [article, sub-page title, sub-page name]
    for (const [title, wikitext] of galleries) {
        const base = title + suffix + '/';
        const names = new Set<string>();
        for (const link of wikitext.matchAll(/\[\[\s*([^|\]]+?)\s*(?:\||\]\])/g)) {
            const target = templateName(link[1]!);
            if (target.startsWith(base)) names.add(target.slice(base.length));
            else if (target.startsWith('/')) names.add(target.slice(1));
        }
        for (const transclusion of wikitext.matchAll(/\{\{\s*:([^}|]+)/g)) {
            const target = templateName(transclusion[1]!);
            if (target.startsWith(base)) names.add(target.slice(base.length));
        }
        for (const call of templates(wikitext))
            for (const [key, value] of Object.entries(call.params))
                if (/^link\d+$/i.test(key) && value && !/[[{]/.test(value)) names.add(value.trim());
        for (const name of names) if (name && !name.includes('/')) subPages.push([title, base + name, name]);
    }
    const subs = new Map<string, [string, string][]>();
    let subDone = 0;
    await inParallel(batches(subPages), 3, async (batch) => {
        const answer = await getJson(
            apiUrl(wiki.api, {
                action: 'query',
                prop: 'revisions',
                rvprop: 'content',
                rvslots: 'main',
                titles: batch.map((x) => x[1]).join('|'),
            }),
        );
        const textByTitle = new Map((answer.query?.pages || []).filter((p) => !p.missing).map((p) => [p.title, pageText(p)]));
        for (const [article, full, name] of batch) {
            const wikitext = textByTitle.get(full);
            if (wikitext == null) continue;
            if (!subs.has(article)) subs.set(article, []);
            subs.get(article)!.push([name, wikitext]);
        }
        subDone += batch.length;
        onProg?.(`Reading gallery sub-pages… ${subDone} / ${subPages.length}`, subDone / Math.max(1, subPages.length));
    });
    galleries.subs = subs;
    return galleries;
}

const fileInfoCache = new Map<string, Map<string, FileInfo | null>>();

/** Address, size and type of each file (null = missing), at most `width` px wide. Cached per wiki. */
async function resolveFiles(wiki: Wiki, files: string[], onProg: Progress | undefined, width = 500): Promise<Map<string, FileInfo | null>> {
    const key = wiki.api + '|' + width;
    if (!fileInfoCache.has(key)) fileInfoCache.set(key, new Map());
    const known = fileInfoCache.get(key)!;
    const todo = files.filter((f) => !known.has(f));
    let done = files.length - todo.length;
    await inParallel(batches(todo), 3, async (batch) => {
        const answer = await getJson(
            apiUrl(wiki.api, {
                action: 'query',
                titles: batch.map((f) => wiki.fileNs[0] + ':' + f).join('|'),
                prop: 'imageinfo',
                iiprop: 'url|size|mime',
                iiurlwidth: String(width),
                redirects: '1',
            }),
        );
        const asked = originalTitles(answer.query);
        for (const page of answer.query?.pages || []) {
            const info = page.imageinfo?.[0];
            known.set(
                dbk(wiki, asked(page.title)),
                info ? { url: info.thumburl || info.url, w: info.width, h: info.height, mime: info.mime } : null,
            );
        }
        done += batch.length;
        onProg?.(`Checking pictures… ${done} / ${files.length}`, done / files.length);
    });
    return known;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VARIANTS
// ═════════════════════════════════════════════════════════════════════════════

/** Words that start many titles but rarely end one ("Ultimate", "Mega"…): modifiers, not names. */
function modifierWords(titles: string[]): Set<string> {
    const first = new Map<string, number>();
    const last = new Map<string, number>();
    for (const title of titles) {
        const words = title
            .replace(/\(.*?\)/g, '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
        if (words.length < 2) continue;
        first.set(words[0]!, (first.get(words[0]!) || 0) + 1);
        last.set(words[words.length - 1]!, (last.get(words[words.length - 1]!) || 0) + 1);
    }
    const minimum = Math.max(3, titles.length * 0.004);
    return new Set([...first].filter(([w, n]) => n >= minimum && n >= 3 * (last.get(w) || 0)).map(([w]) => w));
}

/**
 * Groups pages that are versions of the same character (union–find):
 *  - links and templates in the variant field (`field` of info box `tpl`),
 *  - with `byName`: "Drago (Gen 2)" ↔ "Drago", and "Delta Dragonoid" ↔ "Dragonoid".
 * Each family's base is the page the others point at, an "(Original)"-style title, or the most-mentioned name.
 */
export function families(
    pages: Pages,
    titles: string[],
    { tpl, field, byName }: { tpl?: string; field?: string; byName?: boolean },
): Family[] {
    const known = new Set(titles);
    const modifiers = modifierWords(titles);
    const nameWords = (title: string) =>
        title
            .replace(/\(.*?\)/g, '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 4 && !modifiers.has(w));
    const related = (a: string, b: string) => {
        const wa = nameWords(a);
        const wb = nameWords(b);
        return wa.some((x) => wb.some((y) => x === y || (x.length >= 5 && y.startsWith(x)) || (y.length >= 5 && x.startsWith(y))));
    };
    const withoutBrackets = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const PREFERRED = /\((classic|original|og|generation 1|gen 1|1|main)\)\s*$/i;
    // "ben tennyson" → "Ben Tennyson (Classic)" when only bracketed titles exist
    const bracketedBase = new Map<string, string>();
    for (const title of titles) {
        if (!/\)\s*$/.test(title)) continue;
        const key = withoutBrackets(title).toLowerCase();
        const current = bracketedBase.get(key);
        if (!current || (PREFERRED.test(title) && !PREFERRED.test(current))) bracketedBase.set(key, title);
    }
    const canonical = (link: string): string | null => (known.has(link) ? link : bracketedBase.get(String(link).toLowerCase()) || null);

    // union–find
    const parent: Record<string, string> = {};
    titles.forEach((t) => {
        parent[t] = t;
    });
    /** The family a title belongs to (union–find, flattening the path as it goes). */
    const root = (x: string): string => {
        if (parent[x] === x) return x;
        parent[x] = root(parent[x]!);
        return parent[x];
    };
    const join = (a: string, b: string) => {
        const ra = root(a);
        const rb = root(b);
        if (ra !== rb) parent[ra] = rb;
    };

    const templateBases = new Set<string>();
    if (field && tpl) {
        const byTemplate = new Map<string, string[]>();
        for (const title of titles) {
            const value = infobox(pages.get(title)?.wt || '', tpl)?.params[field];
            if (!value) continue;
            for (const call of templates(value)) {
                if (!byTemplate.has(call.name)) byTemplate.set(call.name, []);
                byTemplate.get(call.name)!.push(title);
            }
            for (const link of value.matchAll(/\[\[\s*([^|\]#]+?)\s*(\||\]\])/g)) {
                const target = canonical(templateName(link[1]!));
                if (target && target !== title && related(target, title)) join(title, target);
            }
        }
        for (const [name, users] of byTemplate) {
            const character = name.replace(/\s*(list|navbox|nav|family|forms?|evolutions?)$/i, '').trim();
            const members = users.filter((t) => related(t, character));
            const base = canonical(character);
            if (base) {
                members.forEach((t) => {
                    join(t, base);
                });
                templateBases.add(base);
            } else for (let i = 1; i < members.length; i++) join(members[0]!, members[i]!);
        }
    }
    const inFamily = new Set<string>();
    {
        const sizes = new Map<string, number>();
        for (const t of titles) sizes.set(root(t), (sizes.get(root(t)) || 0) + 1);
        for (const t of titles) if (sizes.get(root(t))! > 1) inFamily.add(t);
    }
    // name-based joins never merge two families the variant field already separated
    const joinByName = (a: string, b: string) => {
        if (inFamily.has(a) && inFamily.has(b) && root(a) !== root(b)) return;
        join(a, b);
    };
    if (byName) {
        const plain = new Map(titles.map((t) => [t.toLowerCase(), t]));
        const byBase = new Map<string, string[]>();
        for (const title of titles) {
            if (!/\)\s*$/.test(title)) continue;
            const key = withoutBrackets(title).toLowerCase();
            if (!byBase.has(key)) byBase.set(key, []);
            byBase.get(key)!.push(title);
        }
        for (const [key, list] of byBase) {
            const exact = plain.get(key);
            if (exact) {
                list.forEach((t) => {
                    joinByName(t, exact);
                });
                continue;
            }
            const first = bracketedBase.get(key) || list[0]!;
            list.forEach((t) => {
                if (t !== first) joinByName(t, first);
            });
        }
        for (const title of titles) {
            if (/\(/.test(title)) continue;
            const words = title.split(' ');
            for (let k = 1; k < words.length; k++) {
                const tail = words.slice(k).join(' ');
                const match = plain.get(tail.toLowerCase()) || bracketedBase.get(tail.toLowerCase());
                if (match && match !== title && tail.length >= 4 && !modifiers.has(tail.toLowerCase())) {
                    joinByName(title, match);
                    break;
                }
            }
        }
    }
    const groups = new Map<string, string[]>();
    for (const title of titles) {
        const r = root(title);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r)!.push(title);
    }
    const position = new Map(titles.map((t, i) => [t, i]));
    const out: Family[] = [];
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const core = (title: string) => title.replace(/\s*\(.*\)/, '');
        const mentions = (title: string) => group.filter((x) => x !== title && x.includes(core(title))).length;
        const base =
            group.find((t) => templateBases.has(t)) ||
            group.find((t) => /\((classic|original|og|generation 1|gen 1)\)\s*$/i.test(t)) ||
            group
                .slice()
                .sort(
                    (a, b) => mentions(b) - mentions(a) || a.split(' ').length - b.split(' ').length || position.get(a)! - position.get(b)!,
                )[0]!;
        out.push({ base, members: group.filter((t) => t !== base) });
    }
    return out.sort((a, b) => b.members.length - a.members.length);
}

// ═════════════════════════════════════════════════════════════════════════════
//  PUT IT TOGETHER
// ═════════════════════════════════════════════════════════════════════════════

interface BuiltPicture {
    g: string;
    u: string;
    cap: string;
}
interface BuiltItem {
    t: string;
    name: string;
    tags: string[];
    pics: BuiltPicture[];
    borrowed?: boolean;
}

/** Builds the pack: pictures for every page, tags from filters, variants next to their base. */
export async function build(wiki: Wiki, pages: Pages, options: BuildOptions, onProg?: Progress): Promise<GenericPack> {
    const titles = options.titles;
    const mentionCount = new Map<string, number>();

    // pictures from each page, its gallery page and gallery sub-pages
    const found = new Map<string, PictureMention[]>();
    for (const title of titles) {
        const page = pages.get(title)!;
        const list: PictureMention[] = [];
        if (page.img) list.push({ f: dbk(wiki, page.img), path: [], cap: '', g: false, main: true, tier: 0 });
        list.push(...parsePics(wiki, page.wt || '', false).map((x) => ({ ...x, tier: x.ib ? 0 : 1 })));
        const gallery = options.gal?.get(title);
        if (gallery) list.push(...parsePics(wiki, gallery, true).map((x) => ({ ...x, tier: 2 })));
        for (const [name, wikitext] of options.gal?.subs?.get(title) || [])
            list.push(...parsePics(wiki, wikitext, true, [name]).map((x) => ({ ...x, tier: 3 })));
        const seen = new Set<string>();
        const unique = list.filter((x) => {
            if (seen.has(x.f)) return false;
            seen.add(x.f);
            return true;
        });
        found.set(title, unique);
        for (const x of unique) if (!x.g) mentionCount.set(x.f, (mentionCount.get(x.f) || 0) + 1);
    }

    // files on many pages are decoration (icons, logos), not the item
    const decorationLimit = Math.max(6, titles.length * 0.02);
    const SKIP = /icon|logo|symbol|signature|placeholder|blank|transparent|spacer|navbox|wordmark|stub|^No_image|question_?mark|^Wiki/i;
    const maxPictures = options.maxPics || 30;
    const groupOf = (x: PictureMention): [string, string] => {
        const path = x.path.filter((s) => !/^(image )?galler(y|ies)$|^images$/i.test(s));
        if (x.main || x.ib) return ['Main', x.cap];
        if (x.g) return [path.slice(0, 2).join(' › ') || 'Gallery', x.cap || path.slice(2).join(' › ')];
        return [path[0] || 'Page', x.cap || path.slice(1).join(' › ')];
    };
    // round robin across groups, tier by tier: page 35 %, gallery 45 %, gallery sub-pages the rest (unused share moves on)
    const choose = (list: PictureMention[], count: number): PictureMention[] => {
        const out: PictureMention[] = [];
        const byTier = [0, 1, 2, 3].map((t) => list.filter((x) => x.tier === t));
        const share = [1, Math.ceil(count * 0.35), Math.ceil(count * 0.45), count];
        const quota = byTier.map((tier, i) => Math.min(tier.length, share[i]!));
        const total = () => quota[0]! + quota[1]! + quota[2]! + quota[3]!;
        for (let i = 3; i >= 1; i--) while (total() > count && quota[i]! > 0) quota[i]!--;
        for (let moved = true; total() < count && moved; ) {
            moved = false;
            for (const i of [2, 1, 3, 0])
                if (total() < count && quota[i]! < byTier[i]!.length) {
                    quota[i]!++;
                    moved = true;
                }
        }
        for (let tier = 0; tier < 4; tier++) {
            const byGroup = new Map<string, PictureMention[]>();
            for (const x of byTier[tier]!) {
                const group = groupOf(x)[0];
                if (!byGroup.has(group)) byGroup.set(group, []);
                byGroup.get(group)!.push(x);
            }
            let taken = 0;
            const queues = [...byGroup.values()].map((q) => q.slice());
            while (taken < quota[tier]! && queues.some((q) => q.length))
                for (const queue of queues) {
                    if (taken >= quota[tier]!) break;
                    const x = queue.shift();
                    if (x) {
                        out.push(x);
                        taken++;
                    }
                }
        }
        return out;
    };
    const usable = (x: PictureMention) =>
        !((mentionCount.get(x.f) || 0) > decorationLimit && !x.main) && !SKIP.test(x.f) && !/\.svg$/i.test(x.f);

    // pre-select a few extra per page (some will be too small), then look them all up at once
    const preselected = new Map<string, PictureMention[]>();
    const wanted = new Set<string>();
    for (const [title, list] of found) {
        const chosen = choose(list.filter(usable), maxPictures <= 1 ? 2 : Math.ceil(maxPictures * 1.25));
        preselected.set(title, chosen);
        chosen.forEach((x) => {
            wanted.add(x.f);
        });
    }
    const files = await resolveFiles(wiki, [...wanted], onProg, options.width || 500);
    const minPx = options.minPx ?? 48;
    const allUrls: string[] = [];
    const fieldTags = options.fields && options.tpl ? options.fields.map((f) => fieldValues(pages, options.tpl!, f)) : [];
    const items: BuiltItem[] = [];
    const groupIndex = new Map<string, number>();
    const groups: string[] = [];
    const indexOfGroup = (name: string): number => {
        if (!groupIndex.has(name)) {
            groupIndex.set(name, groups.length);
            groups.push(name);
        }
        return groupIndex.get(name)!;
    };
    for (const title of titles) {
        const list = preselected.get(title)!.filter((x) => {
            const info = files.get(x.f);
            return info && !(info.w < minPx || info.h < minPx);
        });
        // groups: the page's own headings (gallery pages: two levels), captions as labels
        const main = list.find((x) => x.main) || list.find((x) => x.ib) || null;
        const rest = choose(
            list.filter((x) => x !== main).map((x) => (x.tier === 0 ? { ...x, tier: 1 } : x)),
            maxPictures - (main ? 1 : 0),
        );
        const groupOrder: string[] = [];
        const pics: BuiltPicture[] = [];
        if (main) pics.push({ g: 'Main', u: files.get(main.f)!.url, cap: '' });
        for (const x of rest) {
            const [group, label] = groupOf(x);
            if (!groupOrder.includes(group)) groupOrder.push(group);
            pics.push({ g: group, u: files.get(x.f)!.url, cap: label });
        }
        pics.sort((a, b) => (a.g === 'Main' ? -1 : groupOrder.indexOf(a.g)) - (b.g === 'Main' ? -1 : groupOrder.indexOf(b.g)));
        pics.forEach((p) => {
            allUrls.push(p.u);
        });
        const tags: string[] = [];
        for (const category of pages.get(title)!.cats) if (options.catFacet?.has(category)) tags.push(category);
        for (const byPage of fieldTags) for (const value of byPage.get(title) || []) tags.push(value);
        items.push({ t: title, name: options.rename ? options.rename(title) : title, tags: [...new Set(tags)], pics });
    }

    // shared start of every picture address, so the pack stays small
    let base = '';
    if (allUrls.length) {
        base = allUrls[0]!;
        for (const url of allUrls.slice(1, 2000)) {
            let i = 0;
            while (i < base.length && i < url.length && base[i] === url[i]) i++;
            base = base.slice(0, i);
            if (!base) break;
        }
        base = base.slice(0, base.lastIndexOf('/') + 1);
    }

    // headings unique to one item ("Face Bolt - Pegasus I") fold into the part they share ("Face Bolt"); the rest becomes the label
    {
        const SEPARATOR = /^(.+?)\s*(?:\s[-–—]\s|:\s)\s*(.+)$/;
        const itemsUsing = new Map<string, Set<string>>();
        const suffixes = new Map<string, Set<string>>();
        for (const item of items)
            for (const pic of item.pics) {
                const m = pic.g.match(SEPARATOR);
                if (!m) continue;
                if (!itemsUsing.has(m[1]!)) {
                    itemsUsing.set(m[1]!, new Set());
                    suffixes.set(m[1]!, new Set());
                }
                itemsUsing.get(m[1]!)!.add(item.t);
                suffixes.get(m[1]!)!.add(m[2]!);
            }
        for (const item of items)
            for (const pic of item.pics) {
                const m = pic.g.match(SEPARATOR);
                if (m && itemsUsing.get(m[1]!)!.size >= 3 && suffixes.get(m[1]!)!.size >= 3) {
                    pic.cap = pic.cap ? m[2] + ' · ' + pic.cap : m[2]!;
                    pic.g = m[1]!;
                }
            }
    }

    const familyList = options.fams || [];
    const baseOfMember = new Map<string, string>();
    const membersOfBase = new Map<string, string[]>();
    for (const family of familyList) {
        membersOfBase.set(family.base, family.members);
        for (const m of family.members) baseOfMember.set(m, family.base);
    }
    // a variant with no picture of its own borrows a few from its family, labelled with where they come from
    {
        const byTitle = new Map(items.map((item) => [item.t, item]));
        for (const item of items) {
            if (item.pics.length) continue;
            const base = baseOfMember.get(item.t) || (membersOfBase.has(item.t) ? item.t : null);
            if (!base) continue;
            const donor = [base, ...(membersOfBase.get(base) || [])]
                .map((x) => byTitle.get(x))
                .find((x) => x && x !== item && x.pics.length && !x.borrowed);
            if (!donor) continue;
            item.pics = donor.pics.slice(0, 6).map((p) => ({ g: 'Same family', u: p.u, cap: donor.name + (p.cap ? ' · ' + p.cap : '') }));
            item.borrowed = true;
        }
    }
    // each base is followed by its variants
    const ordered: BuiltItem[] = [];
    const placed = new Set<string>();
    for (const item of items) {
        if (placed.has(item.t) || baseOfMember.has(item.t)) continue;
        ordered.push(item);
        placed.add(item.t);
        for (const m of membersOfBase.get(item.t) || []) {
            const member = items.find((x) => x.t === m);
            if (member && !placed.has(m)) {
                ordered.push(member);
                placed.add(m);
            }
        }
    }
    for (const item of items) if (!placed.has(item.t)) ordered.push(item);
    const rowOf = new Map(ordered.map((item, i) => [item.t, i]));
    const facets: Record<string, string[]> = {};
    for (const [name, list] of Object.entries(options.facets || {})) {
        const used = list.filter((v) => ordered.some((item) => item.tags.includes(v)));
        if (used.length) facets[name] = used;
    }
    const noun = options.noun || 'items';
    return {
        type: 'tierpack',
        format: 2,
        id: options.id,
        name: options.name,
        noun,
        version: new Date().toISOString().slice(0, 10),
        about: `${ordered.length} ${noun} from ${wiki.site}${familyList.length ? `, ${familyList.length} with variants` : ''}. Built with the tier list maker's pack builder; pictures load from the wiki.`,
        source: { name: wiki.site, url: wiki.server + wiki.articlepath.replace('$1', ''), api: wiki.api },
        base,
        thumb: '',
        groups,
        facets,
        ...(options.dots ? { dots: options.dots } : {}),
        items: ordered.map((item): PackRow => {
            const pictures = item.pics.map((p): PackPicture => {
                const source = p.u.startsWith(base) ? p.u.slice(base.length) : p.u;
                return p.cap ? [indexOfGroup(p.g), source, p.cap.slice(0, 80)] : [indexOfGroup(p.g), source];
            });
            const row: PackRow = [item.name, item.tags, pictures, item.t];
            const base_ = baseOfMember.get(item.t);
            if (base_ != null && rowOf.has(base_)) row.push(rowOf.get(base_)!);
            return row;
        }),
    };
}
