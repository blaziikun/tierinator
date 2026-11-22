// tests/e2e/mock-wiki.ts
// ─────────────────────────────────────────────────────────────────────────────
//  A tiny fake MediaWiki ("Mockugan Wiki") answering the API calls the pack builder
//  and the category importer make, so wiki features are tested without the internet.
// ─────────────────────────────────────────────────────────────────────────────
import type { BrowserContext } from '@playwright/test';
import { SPRITE_PNG } from './fixtures';

export const WIKI_HOST = 'https://mockugan.fandom.com';
const CDN = 'https://static.wikia.nocookie.net/mockugan/images/';
const ATTRIBUTES = ['Pyrus', 'Aquos', 'Haos', 'Darkus', 'Subterra', 'Ventus'];

interface Page {
    wikitext: string;
    categories: string[];
    image: string | null;
}

function buildWiki() {
    const pages: Record<string, Page> = {};
    const parentCategories: Record<string, string[]> = {};
    const infobox = (attribute: string, image: string, extra = '') =>
        `{{Infobox Bakugan\n|name=X\n|image=${image}\n|attribute=${attribute}\n|g-power=450\n|first=Ep 1${extra}\n}}\n`;
    const icon = '[[File:Pyrus icon.png|20px]]';
    const add = (title: string, wikitext: string, categories: string[], image: string | null) =>
        (pages[title] = { wikitext, categories, image });

    add(
        'Drago',
        infobox('[[Pyrus]]', 'Drago.png', '\n|variations={{Drago list}}') +
            icon +
            "'''Drago''' is a dragon.\n==Anime==\n[[File:Drago anime.png|thumb|Drago in the anime]]\n==Toy==\n[[File:Drago toy.jpg|thumb|left|200px|Original toy]]\n[[File:Tiny.png]]\n",
        ['Bakugan', 'Pyrus Bakugan', 'Characters'],
        'Drago.png',
    );
    add(
        'Delta Dragonoid',
        infobox('[[Pyrus]]', 'Delta.png', '\n|variations={{Drago list}}') + icon + 'Evolved.\n',
        ['Bakugan', 'Pyrus Bakugan'],
        'Delta.png',
    );
    add(
        'Neo Dragonoid',
        infobox('[[Pyrus]]', 'Neo.png', '\n|variations={{Drago list}}') + icon + 'Gen 2.\n',
        ['Bakugan', 'Pyrus Bakugan'],
        'Neo.png',
    );
    add('Tigrerra', infobox('[[Haos]]', 'Tigrerra.png') + icon + 'Cat.\n', ['Bakugan', 'Haos Bakugan', 'Characters'], 'Tigrerra.png');
    add('Blade Tigrerra', infobox('[[Haos]]', 'Blade.png') + icon + 'Evolved cat.\n', ['Bakugan', 'Haos Bakugan'], 'Blade.png');
    add('Preyas', infobox('[[Aquos]]', 'Preyas.png') + icon + 'Fish.\n', ['Bakugan', 'Aquos Bakugan'], 'Preyas.png');
    add('Preyas (Gen 2)', infobox('[[Aquos]]', 'Preyas2.png') + 'Fish again.\n', ['Bakugan', 'Aquos Bakugan'], 'Preyas2.png');
    add(
        'Gorem',
        infobox('[[Subterra]] [[File:Subterra.png|20px]]', 'Gorem.png') + icon + 'Rock.\n',
        ['Bakugan', 'Subterra Bakugan'],
        'Gorem.png',
    );
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'].forEach((greek, i) => {
        const attribute = ATTRIBUTES[(i + 1) % 6];
        add(
            `Monster ${greek}`,
            infobox(`[[${attribute}]]`, `M${i + 1}.png`) + icon + 'Monster.\n',
            ['Bakugan', `${attribute} Bakugan`],
            `M${i + 1}.png`,
        );
    });
    add('Jetkor', infobox('[[Pyrus]]', 'Jetkor.png') + 'Battle gear.\n', ['Battle Gear'], 'Jetkor.png');
    add(
        'Drago/Gallery',
        '==Anime==\n===Season 1===\n<gallery>\nDrago s1a.png|Ball form\nDrago s1b.png|Opening\n</gallery>\n==Toys==\n<gallery>\nDrago box.jpg|Box\nDrago ball.png\nPyrus icon.png\n</gallery>\n',
        [],
        null,
    );
    add('Tigrerra/Gallery', '==Anime==\n<gallery>\nTig a.png|Roar\n</gallery>\n', [], null);
    add('Pyrus', 'Attribute page.', [], null);
    for (const attribute of ATTRIBUTES) parentCategories[`Category:${attribute} Bakugan`] = ['Bakugan by attribute'];
    parentCategories['Category:Bakugan'] = ['Content'];
    parentCategories['Category:Characters'] = ['Content'];
    parentCategories['Category:Battle Gear'] = ['Content'];
    return { pages, parentCategories };
}

/** Serves the fake wiki on WIKI_HOST for this browser context. */
export async function serveMockWiki(context: BrowserContext): Promise<void> {
    const { pages, parentCategories } = buildWiki();
    const fileName = (title: string) => title.replace(/^(File|Image):/, '').replace(/_/g, ' ');
    await context.route(/^https:\/\/static\.wikia\.nocookie\.net\//, (r) => r.fulfill({ body: SPRITE_PNG, contentType: 'image/png' }));
    await context.route(`${WIKI_HOST}/**`, (route) => {
        const url = new URL(route.request().url());
        const q = Object.fromEntries(url.searchParams);
        const json = (body: unknown) =>
            route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
        if (url.pathname !== '/api.php') return route.fulfill({ status: 404, body: '' });
        if (q.meta === 'siteinfo')
            return json({
                query: {
                    general: { sitename: 'Mockugan Wiki', server: WIKI_HOST, articlepath: '/wiki/$1' },
                    namespaces: {
                        6: { name: 'File', canonical: 'File' },
                        10: { name: 'Template', canonical: 'Template' },
                        14: { name: 'Category', canonical: 'Category' },
                    },
                    namespacealiases: [{ id: 6, alias: 'Image' }],
                },
            });
        if (q.list === 'embeddedin') {
            const template = q.eititle.replace(/^Template:/, '');
            return json({
                query: {
                    embeddedin: Object.keys(pages)
                        .filter((t) => pages[t].wikitext.includes('{{' + template))
                        .map((title) => ({ ns: 0, title })),
                },
            });
        }
        if (q.list === 'categorymembers') {
            const category = q.cmtitle.replace(/^Category:/, '');
            const members: { ns: number; title: string }[] = Object.keys(pages)
                .filter((t) => pages[t].categories.includes(category))
                .map((title) => ({ ns: 0, title }));
            if (q.cmtype.includes('subcat'))
                for (const [child, parents] of Object.entries(parentCategories))
                    if (parents.includes(category)) members.push({ ns: 14, title: child });
            return json({ query: { categorymembers: members } });
        }
        if (q.list === 'allpages')
            return json({
                query: {
                    allpages: Object.keys(pages)
                        .filter((t) => t.startsWith(q.apprefix))
                        .map((title) => ({ title })),
                },
            });
        const titles = (q.titles || '').split('|').filter(Boolean);
        if (q.prop === 'revisions')
            return json({
                query: {
                    pages: titles.map((t) =>
                        pages[t]
                            ? { title: t, revisions: [{ slots: { main: { content: pages[t].wikitext } } }] }
                            : { title: t, missing: true },
                    ),
                },
            });
        if (q.prop === 'categories|pageimages')
            return json({
                query: {
                    pages: titles.map((t) =>
                        pages[t]
                            ? {
                                  title: t,
                                  categories: pages[t].categories.map((c) => ({ title: 'Category:' + c })),
                                  ...(pages[t].image ? { pageimage: pages[t].image!.replace(/ /g, '_') } : {}),
                              }
                            : { title: t, missing: true },
                    ),
                },
            });
        if (q.prop === 'categories')
            return json({
                query: {
                    pages: titles.map((t) => ({
                        title: t,
                        categories: (parentCategories[t] || []).map((c) => ({ title: 'Category:' + c })),
                    })),
                },
            });
        if (q.prop === 'imageinfo')
            return json({
                query: {
                    pages: titles.map((t) => {
                        const file = fileName(t);
                        const tiny = /Tiny/.test(file);
                        const url = CDN + 'a/ab/' + file.replace(/ /g, '_');
                        return {
                            title: 'File:' + file,
                            imageinfo: [
                                {
                                    url,
                                    thumburl: url + '/revision/latest/scale-to-width-down/500',
                                    width: tiny ? 20 : 600,
                                    height: tiny ? 20 : 600,
                                    mime: 'image/png',
                                },
                            ],
                        };
                    }),
                },
            });
        if (q.prop === 'pageimages')
            return json({
                query: {
                    pages: titles.map((t) =>
                        pages[t]
                            ? {
                                  title: t,
                                  ...(pages[t].image ? { thumbnail: { source: CDN + 'thumb/' + pages[t].image!.replace(/ /g, '_') } } : {}),
                              }
                            : { title: t, missing: true },
                    ),
                },
            });
        if (q.prop === 'images')
            return json({
                query: {
                    pages: titles.map((t) => ({
                        title: t,
                        images: [...(pages[t]?.wikitext.matchAll(/\[\[File:([^|\]]+)/g) || [])].map((m) => ({ title: 'File:' + m[1] })),
                    })),
                },
            });
        if (q.list === 'allcategories')
            return json({
                query: {
                    allcategories: ['Bakugan', 'Characters', 'Battle Gear'].map((category) => ({
                        category,
                        size: Object.values(pages).filter((page) => page.categories.includes(category)).length,
                    })),
                },
            });
        if (!q.prop && !q.list)
            return json({ query: { pages: titles.map((t) => (pages[t] ? { title: t } : { title: t, missing: true })) } });
        return json({});
    });
}
