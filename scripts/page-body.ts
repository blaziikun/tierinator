// scripts/page-body.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The app's page: html/body.html (every bar, popover and window, sectioned by
//  feature) goes into index.html where it says <!-- app:body -->, with the
//  app's name and addresses filled in from src/brand.ts, and {{url}} in every
//  page's head (canonical and preview links) made the site's address. vite.config.ts adds it.
//  Node built-ins only: the build config loads this file before Vite compiles anything.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const BODY = fileURLToPath(new URL('../html/body.html', import.meta.url));
const BODY_MARK = '<!-- app:body -->';
const URL_MARK = '{{url}}';

/** What the page needs from src/brand.ts. */
export interface PageWords {
    id: string;
    name: string;
    tagline: string;
    url: string;
    source: string;
    pokemonApp?: { name: string };
}

const escapeHtml = (text: string): string =>
    text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** html/body.html with the app's words in it. Every {{…}} must be known: a typo fails the build. */
export function fillBody(words: PageWords, body = readFileSync(BODY, 'utf8')): string {
    const values: Record<string, string> = {
        name: words.name,
        tagline: words.tagline,
        Tagline: words.tagline.charAt(0).toUpperCase() + words.tagline.slice(1),
        site: words.url.replace(/^https?:\/\//, ''),
        source: words.source,
        pokemonApp: words.pokemonApp?.name ?? '',
    };
    return body.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
        if (!Object.hasOwn(values, key)) throw new Error(`html/body.html: unknown placeholder ${whole}`);
        return escapeHtml(values[key]!);
    });
}

/** Puts the body into index.html (dev server and build), and names the app on <html>. */
export function pageBody(words: PageWords): Plugin {
    return {
        name: 'page-body',
        transformIndexHtml: {
            order: 'pre',
            handler(written, context) {
                // the site's one real address (brand.ts) in the pages' canonical and preview links
                const page = written.replaceAll(URL_MARK, escapeHtml(words.url));
                if (!page.includes(BODY_MARK)) {
                    if (context.filename.endsWith('index.html')) throw new Error(`index.html: "${BODY_MARK}" is missing`);
                    return page;
                }
                return page
                    .replace(BODY_MARK, fillBody(words))
                    .replace(/<html\b[^>]*>/, `<html lang="en" data-app="${escapeHtml(words.id)}">`);
            },
        },
    };
}
