// The static template pages and the sitemap: hostile templates come out as text, addresses are the canonical ones,
// and every template file gets its page (scripts/template-pages.ts).
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTemplateFolder, SITE, sitemap, templateIndexPage, templatePage, templatePageFiles } from '../../scripts/template-pages';
import { readTemplate, type Template } from '../../src/core/template-format';

const STYLESHEET = '/assets/template-pages-AbC123.css';

/** A template as the app reads it (the pages are only ever made from checked ones). */
const template = (changes: Record<string, unknown> = {}): Template =>
    readTemplate({
        format: 'tierinator-template',
        version: 1,
        id: 'robots',
        title: 'Robots',
        category: 'Machines',
        description: 'Robots from a made-up show.',
        items: [
            { name: 'Boltz', wiki: 'Boltz (robot)' },
            { name: 'Gearo', wiki: 'Gearo' },
        ],
        ...changes,
    })!;

/** Every element and attribute name in a page: what a browser would build, as far as injection goes. */
const tags = (page: string): string[] => [...page.matchAll(/<([a-z][a-z0-9]*)\b/gi)].map((match) => match[1]!.toLowerCase());
// each value is read whole (quotes inside it are escaped), so text inside a value can't pass for an attribute
const attributeNames = (page: string): string[] =>
    [...page.matchAll(/<[a-z][^>]*>/gi)].flatMap((tag) =>
        [...tag[0].matchAll(/\s([a-z:-]+)(?:="[^"]*")?/gi)].map((match) => match[1]!.toLowerCase()),
    );

describe('a template page', () => {
    it('says what it is: title, description, canonical address, link previews, the language', () => {
        const page = templatePage(template(), [template()], STYLESHEET);
        expect(page).toMatch(/^<!doctype html>\n<html lang="en">/);
        expect(page).toContain('<title>Robots tier list on Tierinator</title>');
        expect(page).toContain(
            '<meta name="description" content="Robots from a made-up show. Rank them in a tier list of your own: free, no sign-up." />',
        );
        expect(page).toContain(`<link rel="canonical" href="${SITE}/t/robots/" />`);
        expect(page).toContain(`<meta property="og:url" content="${SITE}/t/robots/" />`);
        expect(page).toContain(`<meta property="og:image" content="${SITE}/og.png" />`);
        expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
        expect(page).toContain(`<link rel="stylesheet" href="${STYLESHEET}" />`);
        expect(page).toContain('<h1>Robots tier list</h1>');
    });

    it('opens the template in the app, lists its items as text, and links back to the app and privacy', () => {
        const page = templatePage(template(), [template()], STYLESHEET);
        expect(page).toContain('<a class="rank" href="/?template=robots">Rank these</a>');
        expect(page).toContain('<ul class="items"><li>Boltz</li><li>Gearo</li></ul>');
        expect(page).toContain('<a href="/">Tierinator</a>');
        expect(page).toContain('<p class="back"><a href="/t/">← All templates</a></p>');
        expect(page).toContain('<a href="/privacy.html">');
    });

    it('needs nothing but this site: no script, no pictures, no outside addresses except in its own metadata', () => {
        const page = templatePage(template(), [template()], STYLESHEET);
        expect(tags(page)).not.toContain('script');
        expect(tags(page)).not.toContain('img');
        expect(attributeNames(page).filter((name) => name.startsWith('on'))).toEqual([]);
        const outside = [...page.matchAll(/(?:href|src)="(https?:[^"]*)"/g)].map((match) => match[1]);
        expect(outside).toEqual([`${SITE}/t/robots/`]); // the canonical link only
    });

    it('a title that already says "tier list" doesn’t say it twice', () => {
        const page = templatePage(template({ title: 'The ultimate tier list' }), [], STYLESHEET);
        expect(page).toContain('<title>The ultimate tier list on Tierinator</title>');
    });

    it('without a description, says how many there are and from what to what', () => {
        const page = templatePage(template({ description: undefined }), [], STYLESHEET);
        expect(page).toContain('<p class="lead">2 to rank, from Boltz to Gearo.</p>');
    });

    it('links to the other templates in its category, not to itself or other categories', () => {
        const all = [template(), template({ id: 'cranes', title: 'Cranes' }), template({ id: 'cats', title: 'Cats', category: 'Animals' })];
        const page = templatePage(all[0]!, all, STYLESHEET);
        expect(page).toContain('<h2>More in Machines</h2>');
        expect(page).toContain('href="/t/cranes/"');
        expect(page).not.toContain('href="/t/robots/"');
        expect(page).not.toContain('href="/t/cats/"');
        expect(templatePage(all[2]!, all, STYLESHEET)).not.toContain('More in');
    });

    it('a hostile template comes out as text: titles, names, descriptions and categories are escaped everywhere', () => {
        const hostile = template({
            title: '</title><script>alert(1)</script>',
            category: '<img src=x onerror=alert(2)>',
            description: '" onfocus="alert(3)" autofocus x="',
            items: [
                { name: '<script src="//evil.example/x.js"></script>', wiki: 'Boltz' },
                { name: "Gearo's & <b>bold</b>", wiki: 'Gearo' },
            ],
        });
        const other = template({ id: 'cranes', title: '<svg onload=alert(4)>', category: hostile.category });
        for (const page of [templatePage(hostile, [hostile, other], STYLESHEET), templateIndexPage([hostile, other], STYLESHEET)]) {
            expect(tags(page)).not.toContain('script');
            expect(tags(page)).not.toContain('img');
            expect(tags(page)).not.toContain('svg');
            expect(attributeNames(page).filter((name) => name.startsWith('on') || name === 'autofocus')).toEqual([]);
            expect(page).not.toContain('evil.example/x.js"');
        }
        const page = templatePage(hostile, [hostile, other], STYLESHEET);
        expect(page).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; tier list on Tierinator</title>');
        expect(page).toContain('content="&quot; onfocus=&quot;alert(3)&quot; autofocus x=&quot; Rank them');
        expect(page).toContain('<li>Gearo&#39;s &amp; &lt;b&gt;bold&lt;/b&gt;</li>');
    });
});

describe('the index of templates (/t/)', () => {
    const all = [
        template(),
        template({ id: 'cats', title: 'Cats', category: 'Animals' }),
        template({ id: 'chess', title: 'Chess', category: 'Games' }),
    ];

    it('groups every template by category, in order, with the Pokémon pack among the games', () => {
        const page = templateIndexPage(all, STYLESHEET);
        expect([...page.matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => match[1])).toEqual(['Animals', 'Games', 'Machines']);
        const games = page.slice(page.indexOf('<h2>Games</h2>'), page.indexOf('<h2>Machines</h2>'));
        expect(games).toContain('href="/?template=pokemon"');
        expect(games).toContain('href="/t/chess/"');
        expect(page).toContain(`<link rel="canonical" href="${SITE}/t/" />`);
    });

    it('a Games category is made for the Pokémon pack when no template has one', () => {
        const page = templateIndexPage([template()], STYLESHEET);
        expect(page).toContain('<h2>Games</h2>');
    });

    it('asks for missing templates through the issue form', () => {
        expect(templateIndexPage(all, STYLESHEET)).toContain(
            '<a href="https://github.com/blaziikun/tierinator/issues/new?template=template.yml">Suggest a template</a>',
        );
    });
});

describe('the sitemap', () => {
    it('lists the app, the index, every template page and privacy, at their canonical addresses', () => {
        const xml = sitemap([template({ id: 'zebras', title: 'Zebras' }), template()]);
        expect(xml).toMatch(
            /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
        );
        expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1])).toEqual([
            `${SITE}/`,
            `${SITE}/t/`,
            `${SITE}/t/robots/`,
            `${SITE}/t/zebras/`,
            `${SITE}/privacy`,
        ]);
        expect(xml.trimEnd()).toMatch(/<\/urlset>$/);
    });
});

describe('reading the folder', () => {
    let folder = '';
    afterEach(() => rmSync(folder, { recursive: true, force: true }));

    it('makes pages only from files that are templates and are named after their id', () => {
        folder = mkdtempSync(join(tmpdir(), 'template-pages-'));
        const raw = (id: string, title: string) =>
            JSON.stringify({ format: 'tierinator-template', version: 1, id, title, category: 'Machines', items: [{ name: 'Boltz' }] });
        writeFileSync(join(folder, 'robots.json'), raw('robots', 'Robots'));
        writeFileSync(join(folder, 'cranes.json'), raw('cranes', 'Cranes'));
        writeFileSync(join(folder, 'renamed.json'), raw('something-else', 'Renamed'));
        writeFileSync(join(folder, 'broken.json'), '{ "format": "tierinator-template", ');
        writeFileSync(join(folder, 'pack.json'), JSON.stringify({ format: 'tierpack', id: 'pack' }));
        writeFileSync(join(folder, 'index.json'), '[]');
        writeFileSync(join(folder, 'notes.txt'), 'not a template');
        const { templates, refused } = readTemplateFolder(folder);
        expect(templates.map((t) => t.id)).toEqual(['cranes', 'robots']); // by title
        expect(refused).toEqual(['broken.json', 'pack.json', 'renamed.json']);
    });

    it('the real templates: a page for every file, the index and the sitemap, none with a script', () => {
        const real = new URL('../../public/templates/', import.meta.url).pathname;
        const ids = readdirSync(real)
            .filter((name) => name.endsWith('.json') && name !== 'index.json')
            .map((name) => name.slice(0, -'.json'.length));
        const { files, refused } = templatePageFiles(real, STYLESHEET);
        expect(refused).toEqual([]);
        expect(files.map((file) => file.fileName).sort()).toEqual(
            [...ids.map((id) => `t/${id}/index.html`), 't/index.html', 'sitemap.xml'].sort(),
        );
        for (const file of files) expect(tags(file.source)).not.toContain('script');
        const xml = files.find((file) => file.fileName === 'sitemap.xml')!.source;
        for (const id of ids) expect(xml).toContain(`<loc>${SITE}/t/${id}/</loc>`);
    });
});
