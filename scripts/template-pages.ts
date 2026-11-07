// scripts/template-pages.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The template pages search engines find: /t/<id>/ for every template in
//  public/templates, /t/ with all of them, and sitemap.xml. Written by `pnpm build`
//  (templatePages in vite.config.ts). Plain HTML and one stylesheet: no JavaScript.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTemplate, type Template } from '../src/core/template-format';
import { POKEMON_PACK, SITE_ADDRESS, SUGGEST_TEMPLATE_ADDRESS, templateLink } from '../src/features/templates/template-addresses';
import { html, type SafeHtml } from '../src/lib/html';

/** The site's own address (one constant, shared with the app's export credit). */
export const SITE = SITE_ADDRESS;
/** The file, which works on any server; Cloudflare redirects it to the address in its canonical link. */
const PRIVACY_PAGE = '/privacy.html';
const PRIVACY_CANONICAL = '/privacy';

export const templatePagePath = (id: string): string => `/t/${id}/`;

/** "Dog breeds" → "Dog breeds tier list", without saying it twice for a title that already does. */
const pageHeading = (title: string): string => (/\btier list$/i.test(title) ? title : `${title} tier list`);

const byTitle = (a: Template, b: Template): number => a.title.localeCompare(b.title, 'en');

// ═════════════════════════════════════════════════════════════════════════════
//  READING THE TEMPLATES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every template file in the folder, through the same checks the app uses. A file that
 * isn't a template, or whose id isn't its file name, is left out and named in `refused`.
 */
export function readTemplateFolder(folder: string): { templates: Template[]; refused: string[] } {
    const templates: Template[] = [];
    const refused: string[] = [];
    const fileNames = readdirSync(folder)
        .filter((name) => name.endsWith('.json') && name !== 'index.json')
        .sort();
    for (const fileName of fileNames) {
        let template: Template | null = null;
        try {
            template = readTemplate(JSON.parse(readFileSync(join(folder, fileName), 'utf8')));
        } catch {}
        if (template && template.id + '.json' === fileName) templates.push(template);
        else refused.push(fileName);
    }
    return { templates: templates.sort(byTitle), refused };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE PAGES
// ═════════════════════════════════════════════════════════════════════════════

interface PageHead {
    title: string;
    description: string;
    /** The page's own path, for its canonical address. */
    path: string;
    /** The built stylesheet's path (its name has a content hash). */
    stylesheet: string;
}

/** What every page has: the canonical address, link previews with the site's picture, the stylesheet. */
function page(head: PageHead, body: SafeHtml): string {
    const address = SITE + head.path;
    return html`<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="referrer" content="no-referrer" />
        <meta name="color-scheme" content="dark" />
        <title>${head.title}</title>
        <meta name="description" content="${head.description}" />
        <link rel="canonical" href="${address}" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Tierinator" />
        <meta property="og:title" content="${head.title}" />
        <meta property="og:description" content="${head.description}" />
        <meta property="og:url" content="${address}" />
        <meta property="og:image" content="${SITE}/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Tierinator: a tier list with SS, S, A, B and C rows" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="stylesheet" href="${head.stylesheet}" />
    </head>
    <body>
        <main>
${body}
            <footer>
                <a href="/">Tierinator</a>
                <a href="/t/">All templates</a>
                <a href="${PRIVACY_PAGE}">Privacy, terms and accessibility</a>
            </footer>
        </main>
    </body>
</html>
`.value;
}

/** A card linking to a template's page, like the gallery's. */
const templateCard = (template: Template): SafeHtml =>
    html`<li><a href="${templatePagePath(template.id)}"><b>${template.title}</b>${template.description && html`<span>${template.description}</span>`}<span class="count">${template.items.length} items</span></a></li>`;

/** /t/<id>/: what the template is, the one link that opens it in the app, its items as text, others like it. */
export function templatePage(template: Template, allTemplates: readonly Template[], stylesheet: string): string {
    const heading = pageHeading(template.title);
    const count = template.items.length;
    const first = template.items[0]!.name;
    const last = template.items[count - 1]!.name;
    const summary = template.description || `${count} to rank, from ${first} to ${last}.`;
    const others = allTemplates.filter((other) => other.category === template.category && other.id !== template.id);
    return page(
        {
            title: `${heading} on Tierinator`,
            description: `${summary} Rank them in a tier list of your own: free, no sign-up.`,
            path: templatePagePath(template.id),
            stylesheet,
        },
        html`            <p class="back"><a href="/t/">← All templates</a></p>
            <h1>${heading}</h1>
            <p class="lead">${summary}</p>
            <a class="rank" href="${templateLink(template.id)}">Rank these</a>
            <p class="note">Opens in Tierinator as a new list of your own, with pictures from Wikipedia. Free, no sign-up.</p>
            <h2>The ${count} to rank</h2>
            <ul class="items">${template.items.map((item) => html`<li>${item.name}</li>`)}</ul>
            ${others.length > 0 && html`<h2>More in ${template.category}</h2><ul class="cards">${others.map(templateCard)}</ul>`}`,
    );
}

/** /t/: every template, by category, with the Pokémon pack among the games. */
export function templateIndexPage(allTemplates: readonly Template[], stylesheet: string): string {
    const categories = [...new Set([POKEMON_PACK.category, ...allTemplates.map((template) => template.category)])].sort((a, b) =>
        a.localeCompare(b, 'en'),
    );
    const pokemonCard = html`<li><a href="${templateLink(POKEMON_PACK.id)}"><b>${POKEMON_PACK.title}</b><span>${POKEMON_PACK.description}</span><span class="count">Pack</span></a></li>`;
    const sections = categories.map(
        (category) =>
            html`<h2>${category}</h2><ul class="cards">${category === POKEMON_PACK.category && pokemonCard}${allTemplates
                .filter((template) => template.category === category)
                .map(templateCard)}</ul>`,
    );
    return page(
        {
            title: 'Tier list templates on Tierinator',
            description: `${allTemplates.length + 1} ready-made tier lists to rank yourself: ${categories.join(', ')}. Free, no sign-up.`,
            path: '/t/',
            stylesheet,
        },
        html`            <p class="back"><a href="/">← Tierinator</a></p>
            <h1>Tier list templates</h1>
            <p class="lead">Ready-made lists to rank yourself. Pick one to see what's in it, then open it in Tierinator as a list of your own.</p>
            <p class="note">Missing one? <a href="${SUGGEST_TEMPLATE_ADDRESS}">Suggest a template</a></p>
            ${sections}`,
    );
}

/** Every page worth finding: the app, the template pages, privacy. */
export function sitemap(allTemplates: readonly Template[]): string {
    const paths = [
        '/',
        '/t/',
        ...[...allTemplates].sort((a, b) => a.id.localeCompare(b.id)).map((t) => templatePagePath(t.id)),
        PRIVACY_CANONICAL,
    ];
    return html`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => html`    <url><loc>${SITE + path}</loc></url>\n`)}</urlset>
`.value;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ALL OF THEM
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every page and the sitemap, as files for the built site, from the templates in `templateFolder`.
 * `stylesheet` is the built stylesheet's path (its name carries a content hash).
 */
export function templatePageFiles(
    templateFolder: string,
    stylesheet: string,
): { files: { fileName: string; source: string }[]; refused: string[] } {
    const { templates, refused } = readTemplateFolder(templateFolder);
    const files = templates.map((template) => ({
        fileName: `t/${template.id}/index.html`,
        source: templatePage(template, templates, stylesheet),
    }));
    files.push({ fileName: 't/index.html', source: templateIndexPage(templates, stylesheet) });
    files.push({ fileName: 'sitemap.xml', source: sitemap(templates) });
    return { files, refused };
}
