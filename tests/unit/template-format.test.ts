// Template files and Wikipedia's picture answers are read safely: good ones come through, crafted ones lose what's dangerous.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isKnownPictureAddress } from '../../src/core/picture-sites';
import { MAX_TEMPLATE_ITEMS, readTemplate, readTemplateIndex } from '../../src/core/template-format';
import { findFreePictures, picturesFromAnswer } from '../../src/features/templates/wiki-pictures';

const template = (changes: Record<string, unknown> = {}) => ({
    format: 'tierinator-template',
    version: 1,
    id: 'robots',
    title: 'Robots',
    category: 'Machines',
    items: [{ name: 'Boltz', wiki: 'Boltz (robot)' }],
    ...changes,
});

describe('one template', () => {
    it('a template using every field comes through unchanged', () => {
        const raw = template({
            description: 'Robots from a made-up show.',
            tiers: ['Best', 'Fine', 'Scrap'],
            items: [
                { name: 'Boltz', wiki: 'Boltz (robot)' },
                { name: 'Gearo', image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Gearo.png' },
                { name: 'Sprocket', wiki: 'Sprocket', image: 'https://flagcdn.com/w320/fr.png' },
            ],
        });
        expect(readTemplate(raw)).toEqual(raw);
    });

    it('refuses what isn’t a template', () => {
        for (const raw of [
            null,
            [],
            'robots',
            template({ format: 'tierpack' }),
            template({ version: 2 }),
            template({ id: '../index' }),
            template({ id: 'Robots' }),
            template({ id: 'a'.repeat(61) }),
            template({ title: '   ' }),
            template({ items: 'Boltz' }),
            template({ items: [] }),
            template({ items: [{ name: '' }, { wiki: 'Boltz' }, 'Boltz', null] }),
        ])
            expect(readTemplate(raw)).toBeNull();
    });

    it('drops unknown fields, pictures from anywhere else, and page titles that would ask about other pages', () => {
        const read = readTemplate(
            template({
                author: 'someone',
                script: '<script>alert(1)</script>',
                items: [
                    { name: 'Tracker', image: 'https://tracker.example/pixel.png', extra: true },
                    { name: 'Plain web', image: 'http://upload.wikimedia.org/a.png' },
                    { name: 'Odd port', image: 'https://upload.wikimedia.org:8443/a.png' },
                    { name: 'Lookalike', image: 'https://upload.wikimedia.org.evil.example/a.png' },
                    { name: 'Script', image: 'javascript:alert(1)' },
                    { name: 'Data', image: 'data:image/png;base64,AAAA' },
                    { name: 'Smuggled', wiki: 'Apple|Banana' },
                    { name: 'Section', wiki: 'Apple#History' },
                    { name: 'Markup', wiki: '<b>Apple</b>' },
                    { name: 'Too long', wiki: 'x'.repeat(251) },
                    { name: 'Number', wiki: 42 },
                ],
            }),
        );
        expect(read).not.toBeNull();
        expect(read).not.toHaveProperty('author');
        expect(read).not.toHaveProperty('script');
        expect(read!.items.every((item) => Object.keys(item).join() === 'name')).toBe(true);
    });

    it('caps names, titles and counts, and cleans out control characters', () => {
        const read = readTemplate(
            template({
                title: 'T'.repeat(500),
                category: '',
                description: 'D'.repeat(5000),
                tiers: ['S'.repeat(100), '', 7, ...Array.from({ length: 50 }, (_, i) => 'Tier ' + i)],
                items: Array.from({ length: MAX_TEMPLATE_ITEMS + 50 }, (_, i) => ({ name: `  Item\u0000\u001b ${i} ${'n'.repeat(200)}` })),
            }),
        )!;
        expect(read.title).toHaveLength(60);
        expect(read.category).toBe('Other');
        expect(read.description).toHaveLength(300);
        expect(read.tiers).toHaveLength(18); // the first 20 are looked at; the empty one and the number are dropped
        expect(read.tiers![0]).toHaveLength(40);
        expect(read.items).toHaveLength(MAX_TEMPLATE_ITEMS);
        expect(read.items[0]!.name.startsWith('Item 0 ')).toBe(true);
        expect(read.items[0]!.name.length).toBeLessThanOrEqual(80);
    });
});

describe('the catalogue', () => {
    const entry = { id: 'robots', title: 'Robots', category: 'Machines', count: 3 };

    it('keeps good entries and leaves out broken and repeated ones', () => {
        expect(
            readTemplateIndex([
                entry,
                { ...entry, title: 'Robots again' },
                { ...entry, id: '../../etc/passwd' },
                { ...entry, id: 'no-count', count: '3' },
                { ...entry, id: 'none', count: 0 },
                { ...entry, id: 'too-many', count: MAX_TEMPLATE_ITEMS + 1 },
                { ...entry, id: 'untitled', title: '' },
                { ...entry, id: 'extra', description: 'More robots.', hidden: true },
                'robots',
                null,
            ]),
        ).toEqual([entry, { ...entry, id: 'extra', description: 'More robots.' }]);
    });

    it('is refused if it isn’t a list', () => {
        expect(readTemplateIndex({ templates: [entry] })).toBeNull();
        expect(readTemplateIndex(null)).toBeNull();
    });
});

describe('known picture sites', () => {
    it('accepts https on the known sites only', () => {
        expect(isKnownPictureAddress('https://upload.wikimedia.org/wikipedia/commons/a/ab/A.png')).toBe(true);
        expect(isKnownPictureAddress('https://is3-ssl.mzstatic.com/a.jpg')).toBe(true);
        expect(isKnownPictureAddress('http://upload.wikimedia.org/a.png')).toBe(false);
        expect(isKnownPictureAddress('https://user:pass@upload.wikimedia.org/a.png')).toBe(false);
        expect(isKnownPictureAddress('https://evil.example/upload.wikimedia.org/a.png')).toBe(false);
        expect(isKnownPictureAddress('not an address')).toBe(false);
    });

    it('on GitHub and jsDelivr, trusts only the sprite collections’ own folders', () => {
        const collection = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png';
        expect(isKnownPictureAddress(collection)).toBe(true);
        expect(isKnownPictureAddress('https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/25.png')).toBe(true);
        // anyone's file there could count its downloads, so a link could tell its maker it was opened
        expect(isKnownPictureAddress('https://raw.githubusercontent.com/someone/tracker/main/opened.png')).toBe(false);
        expect(isKnownPictureAddress('https://cdn.jsdelivr.net/gh/someone/tracker@main/opened.png')).toBe(false);
        // climbing out of the folder, plainly or encoded
        expect(isKnownPictureAddress('https://raw.githubusercontent.com/PokeAPI/sprites/master/../../someone/x.png')).toBe(false);
        expect(isKnownPictureAddress('https://raw.githubusercontent.com/PokeAPI/sprites/master/%2e%2e/%2e%2e/someone/x.png')).toBe(false);
    });
});

describe('Wikipedia’s picture answers', () => {
    const picture = (name: string) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}.jpg/256px-${name}.jpg`;

    it('follow spelling fixes and redirects back to the titles asked for', () => {
        const answer = {
            query: {
                normalized: [{ from: 'Mercury_(planet)', to: 'Mercury (planet)' }],
                redirects: [
                    { from: 'Doberman Pinscher', to: 'Dobermann' },
                    { from: 'Loop A', to: 'Loop B' },
                    { from: 'Loop B', to: 'Loop A' },
                ],
                pages: {
                    1: { title: 'Mercury (planet)', thumbnail: { source: picture('Mercury') }, pageimage: 'Mercury.jpg' },
                    2: { title: 'Dobermann', thumbnail: { source: picture('Dobermann') } },
                    3: { title: 'Beagle' },
                    '-1': { title: 'Not a page', missing: '' },
                    4: { title: 'Sneaky', thumbnail: { source: 'https://tracker.example/pixel.png' } },
                    5: { title: 'Script', thumbnail: { source: 'javascript:alert(1)' } },
                },
            },
        };
        const titles = ['Mercury_(planet)', 'Doberman Pinscher', 'Beagle', 'Not a page', 'Sneaky', 'Script', 'Loop A'];
        expect(Object.fromEntries(picturesFromAnswer(answer, titles))).toEqual({
            'Mercury_(planet)': { address: picture('Mercury'), file: 'Mercury.jpg' },
            'Doberman Pinscher': { address: picture('Dobermann') },
        });
    });

    it('read pages given as a list too, and treat anything else as no pictures', () => {
        const answer = { query: { pages: [{ title: 'Beagle', thumbnail: { source: picture('Beagle') } }] } };
        expect(Object.fromEntries(picturesFromAnswer(answer, ['Beagle']))).toEqual({ Beagle: { address: picture('Beagle') } });
        for (const broken of [null, 'error', { query: { pages: 'none' } }, { error: { code: 'ratelimited' } }])
            expect(picturesFromAnswer(broken, ['Beagle']).size).toBe(0);
    });
});

describe('asking Wikipedia', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks 50 titles at a time, one request after another, for free pictures only', async () => {
        const asked: URL[] = [];
        let running = 0;
        let mostAtOnce = 0;
        vi.stubGlobal('fetch', async (address: string) => {
            running++;
            mostAtOnce = Math.max(mostAtOnce, running);
            asked.push(new URL(address));
            await new Promise((resolve) => setTimeout(resolve, 5));
            running--;
            const titles = new URL(address).searchParams.get('titles')!.split('|');
            const pages = titles.map((title) => ({
                title,
                thumbnail: { source: `https://upload.wikimedia.org/${encodeURIComponent(title)}.png` },
            }));
            return new Response(JSON.stringify({ query: { pages } }));
        });
        const titles = Array.from({ length: 120 }, (_, i) => `Page ${i}`);
        const progressSeen: number[] = [];
        const { pictures, reachedWikipedia } = await findFreePictures([...titles, 'Page 0'], (lookedUp) => progressSeen.push(lookedUp));
        expect(asked.map((url) => url.searchParams.get('titles')!.split('|').length)).toEqual([50, 50, 20]);
        expect(asked.every((url) => url.origin + url.pathname === 'https://en.wikipedia.org/w/api.php')).toBe(true);
        expect(asked.every((url) => url.searchParams.get('pilicense') === 'free' && url.searchParams.get('redirects') === '1')).toBe(true);
        expect(asked.every((url) => url.searchParams.get('piprop') === 'thumbnail|name')).toBe(true);
        expect(mostAtOnce).toBe(1);
        expect(progressSeen).toEqual([50, 100, 120]);
        expect(pictures.size).toBe(120);
        expect(reachedWikipedia).toBe(true);
    });

    it('says so when Wikipedia can’t be reached', async () => {
        vi.stubGlobal('fetch', async () => {
            throw new TypeError('Failed to fetch');
        });
        const { pictures, reachedWikipedia } = await findFreePictures(['Apple'], () => {});
        expect(pictures.size).toBe(0);
        expect(reachedWikipedia).toBe(false);
    });
});
