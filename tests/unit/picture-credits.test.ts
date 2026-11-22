// Picture credits from Wikimedia: authors come as HTML and leave as plain text, odd answers can't break
// anything, a failed lookup still leaves each file's name, and only real Wikimedia picture addresses count.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wikimediaFileOf } from '../../src/features/credits/credits';
import { creditsFromAnswer, findPictureCredits, plainTextFromHtml } from '../../src/features/credits/wiki-credits';

const API = 'https://en.wikipedia.org/w/api.php';

/** One file's page in an imageinfo answer, as Wikimedia writes it for a Commons file. */
const describedFile = (title: string, details: Record<string, unknown>) => ({
    ns: 6,
    title,
    missing: '',
    known: '',
    imagerepository: 'shared',
    imageinfo: [
        { extmetadata: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, { value, source: 'commons-desc-page' }])) },
    ],
});

describe('authors as plain text', () => {
    it('keeps the words of links, spans and line breaks, and decodes entities', () => {
        expect(
            plainTextFromHtml(
                '<bdi><a href="//commons.wikimedia.org/wiki/User:Example" title="User:Example">Example&nbsp;<b>Photographer</b></a></bdi>',
            ),
        ).toBe('Example Photographer');
        expect(plainTextFromHtml('Studio&#32;Example<br/>and   Example&#x2019;s team')).toBe('Studio Example and Example’s team');
        expect(plainTextFromHtml('<span class="fn value">Ada&amp;Co</span> &lt;b&gt;bold&lt;/b&gt;')).toBe('Ada&Co <b>bold</b>');
    });
    it('drops scripts, styles and comments with what is in them, and nonsense entities', () => {
        expect(plainTextFromHtml('<script>alert(1)</script>Jo<style>b{}</style><!-- note -->e &#0;&#xD800;&#9999999;&madeup;')).toBe(
            'Jo e &madeup;',
        );
        expect(plainTextFromHtml('<img src=x onerror=alert(1)>')).toBe('');
        expect(plainTextFromHtml('3 < 4 and 5 > 2')).toBe('3 < 4 and 5 > 2');
    });
});

describe('Wikimedia’s credit answers', () => {
    it('reads author and licence for each file asked, following spelling fixes', () => {
        const answer = {
            query: {
                normalized: [{ from: 'File:Comet_trail.jpg', to: 'File:Comet trail.jpg' }],
                pages: {
                    '-1': describedFile('File:Comet trail.jpg', {
                        Artist: '<a href="https://example.org/">Sky Watcher</a>',
                        LicenseShortName: 'CC BY-SA 4.0',
                        AttributionRequired: 'true',
                    }),
                    '-2': describedFile('File:Old moon.png', { LicenseShortName: 'Public domain', AttributionRequired: 'false' }),
                },
            },
        };
        const credits = creditsFromAnswer(answer, ['Comet_trail.jpg', 'Old moon.png']);
        expect(credits.get('Comet_trail.jpg')).toEqual({ file: 'Comet trail.jpg', by: 'Sky Watcher', licence: 'CC BY-SA 4.0' });
        expect(credits.get('Old moon.png')).toEqual({ file: 'Old moon.png', licence: 'Public domain' });
    });

    it('reads pages given as a list too, and cuts long authors short', () => {
        const longName = 'An Example Observatory '.repeat(20);
        const answer = { query: { pages: [describedFile('File:Wide field.jpg', { Artist: longName, LicenseShortName: 'CC BY 4.0' })] } };
        const credit = creditsFromAnswer(answer, ['Wide field.jpg']).get('Wide field.jpg');
        expect(credit?.by).toHaveLength(120);
        expect(credit?.by?.endsWith('…')).toBe(true);
        expect(credit?.licence).toBe('CC BY 4.0');
    });

    it('gives a file with missing or odd details just its name', () => {
        const answer = {
            query: {
                pages: {
                    '-1': { ns: 6, title: 'File:Nothing known.jpg', missing: '' },
                    '-2': {
                        title: 'File:Odd shapes.jpg',
                        imageinfo: [{ extmetadata: { Artist: { value: 42 }, LicenseShortName: ['x'] } }],
                    },
                    '-3': { title: 'File:Strings.jpg', imageinfo: 'none' },
                },
            },
        };
        const credits = creditsFromAnswer(answer, ['Nothing known.jpg', 'Odd shapes.jpg', 'Strings.jpg', 'Not in the answer.jpg']);
        expect(Object.fromEntries(credits)).toEqual({
            'Nothing known.jpg': { file: 'Nothing known.jpg' },
            'Odd shapes.jpg': { file: 'Odd shapes.jpg', by: '42' },
            'Strings.jpg': { file: 'Strings.jpg' },
            'Not in the answer.jpg': { file: 'Not in the answer.jpg' },
        });
    });

    it('survives junk answers, and leaves out names that can’t be files', () => {
        for (const junk of [null, 'error', 42, [], { query: { pages: 'none' } }, { error: { code: 'ratelimited' } }])
            expect(Object.fromEntries(creditsFromAnswer(junk, ['Comet.jpg']))).toEqual({ 'Comet.jpg': { file: 'Comet.jpg' } });
        expect(creditsFromAnswer(null, ['', 'a|b.jpg', 'x<y>.png', 'x'.repeat(300)]).size).toBe(0);
    });
});

describe('which file a picture shows', () => {
    it('reads the file from thumbnails and originals, on Commons or a Wikipedia', () => {
        expect(
            wikimediaFileOf(
                'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Comet_trail_%281%29.jpg/256px-Comet_trail_%281%29.jpg',
            ),
        ).toEqual({ file: 'Comet trail (1).jpg', home: 'commons.wikimedia.org' });
        expect(wikimediaFileOf('https://upload.wikimedia.org/wikipedia/commons/a/ab/Old_moon.png')).toEqual({
            file: 'Old moon.png',
            home: 'commons.wikimedia.org',
        });
        expect(wikimediaFileOf('https://upload.wikimedia.org/wikipedia/en/thumb/c/c3/Local_map.svg/256px-Local_map.svg.png')).toEqual({
            file: 'Local map.svg',
            home: 'en.wikipedia.org',
        });
    });
    it('knows nothing of other sites and odd paths', () => {
        for (const address of [
            'http://upload.wikimedia.org/wikipedia/commons/a/ab/Old_moon.png',
            'https://upload.wikimedia.org.example/wikipedia/commons/a/ab/Old_moon.png',
            'https://example.org/wikipedia/commons/a/ab/Old_moon.png',
            'https://upload.wikimedia.org/wikipedia/commons/thumb/zz/Old_moon.png',
            'https://upload.wikimedia.org/wikipedia/commons/a/ab/%E0%A4%A.png',
            'https://upload.wikimedia.org/wikipedia/commons/a/ab/',
            'https://upload.wikimedia.org/wikipedia/evil.example%2F/a/ab/Old_moon.png',
            'custom',
            '',
        ])
            expect(wikimediaFileOf(address)).toBeNull();
    });
});

describe('asking for credits', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks 50 files at a time, one request after another, for the three details only', async () => {
        const asked: URL[] = [];
        vi.stubGlobal('fetch', async (address: string) => {
            asked.push(new URL(address));
            const titles = new URL(address).searchParams.get('titles')!.split('|');
            const pages = titles.map((title) => describedFile(title, { Artist: 'Sky Watcher', LicenseShortName: 'CC0' }));
            return new Response(JSON.stringify({ query: { pages } }));
        });
        const files = Array.from({ length: 70 }, (_, index) => `Star ${index}.jpg`);
        const progressSeen: number[] = [];
        const credits = await findPictureCredits(API, [...files, 'Star 0.jpg'], undefined, (lookedUp) => progressSeen.push(lookedUp));
        expect(asked.map((url) => url.searchParams.get('titles')!.split('|').length)).toEqual([50, 20]);
        expect(asked[0]!.searchParams.get('titles')!.startsWith('File:Star 0.jpg|File:Star 1.jpg')).toBe(true);
        for (const url of asked) {
            expect(url.origin + url.pathname).toBe(API);
            expect(Object.fromEntries(url.searchParams)).toMatchObject({
                action: 'query',
                prop: 'imageinfo',
                iiprop: 'extmetadata',
                iiextmetadatafilter: 'Artist|LicenseShortName|AttributionRequired',
                format: 'json',
                origin: '*',
            });
        }
        expect(progressSeen).toEqual([50, 70]);
        expect(credits.size).toBe(70);
        expect(credits.get('Star 69.jpg')).toEqual({ file: 'Star 69.jpg', by: 'Sky Watcher', licence: 'CC0' });
    });

    it('asks for files by their names as Wikipedia shows them, and answers under the names given', async () => {
        const asked: string[] = [];
        vi.stubGlobal('fetch', async (address: string) => {
            asked.push(new URL(address).searchParams.get('titles')!);
            return new Response(JSON.stringify({ query: { pages: [describedFile('File:Comet trail.jpg', { Artist: 'Sky Watcher' })] } }));
        });
        const credits = await findPictureCredits(API, ['Comet_trail.jpg']);
        expect(asked).toEqual(['File:Comet trail.jpg']);
        expect(credits.get('Comet_trail.jpg')).toEqual({ file: 'Comet trail.jpg', by: 'Sky Watcher' });
    });

    it('still names every file when the wiki can’t be reached, or after Cancel', async () => {
        vi.stubGlobal('fetch', async () => {
            throw new TypeError('Failed to fetch');
        });
        const credits = await findPictureCredits(API, ['Comet.jpg']);
        expect(Object.fromEntries(credits)).toEqual({ 'Comet.jpg': { file: 'Comet.jpg' } });

        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const cancelled = await findPictureCredits(API, ['Comet.jpg'], () => true);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(Object.fromEntries(cancelled)).toEqual({ 'Comet.jpg': { file: 'Comet.jpg' } });
    }, 10_000);
});
