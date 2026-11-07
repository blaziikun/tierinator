// src/features/templates/wiki-pictures.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The freely licensed lead picture of English Wikipedia pages, and its file name
//  (for its credit), for a template's items. Nothing is hosted here: the pictures stay
//  on Wikimedia's servers until someone opens a template. 50 pages a request, one at a time.
// ─────────────────────────────────────────────────────────────────────────────
import { asArray, asText, dig, isRecord } from '../../lib/checks';
import { getJSON, sleep } from '../../lib/net';

export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
/** MediaWiki's limit on titles per query for anyone without a bot account. */
const TITLES_PER_REQUEST = 50;
const GAP_MS = 300;
const TIMEOUT_MS = 15_000;

/** Wikipedia answers with thumbnails only from its own picture server. */
const isWikimediaPicture = (address: string): boolean => /^https:\/\/upload\.wikimedia\.org\//.test(address);

/** A page's lead picture: its address, and its file's name as Wikipedia gives it ("Pluto_in_true_colour.jpg"). */
export interface LeadPicture {
    address: string;
    file?: string;
}

/** One batch's question: lead pictures 256 px wide and their file names, only freely licensed ones (pilicense=free). */
const pictureQuery = (titles: readonly string[]): string =>
    WIKIPEDIA_API +
    '?' +
    new URLSearchParams({
        action: 'query',
        format: 'json',
        origin: '*',
        redirects: '1',
        prop: 'pageimages',
        piprop: 'thumbnail|name',
        pithumbsize: '256',
        pilicense: 'free',
        titles: titles.join('|'),
    });

/**
 * Each asked title → its page's picture. Wikipedia answers under the page's real title,
 * so the spelling fixes ("normalized") and redirects it reports are followed back.
 */
export function picturesFromAnswer(answer: unknown, titles: readonly string[]): Map<string, LeadPicture> {
    const renamed = new Map<string, string>();
    for (const list of ['normalized', 'redirects'])
        for (const step of asArray(dig(answer, 'query', list)).filter(isRecord))
            if (typeof step.from === 'string' && typeof step.to === 'string') renamed.set(step.from, step.to);
    const rawPages = dig(answer, 'query', 'pages');
    const pages = (Array.isArray(rawPages) ? rawPages : isRecord(rawPages) ? Object.values(rawPages) : []).filter(isRecord);
    const pictureOfPage = new Map<string, LeadPicture>();
    for (const page of pages) {
        const address = asText(dig(page, 'thumbnail', 'source'));
        const file = asText(page.pageimage);
        if (typeof page.title === 'string' && isWikimediaPicture(address))
            pictureOfPage.set(page.title, { address, ...(file ? { file } : {}) });
    }
    const pictures = new Map<string, LeadPicture>();
    for (const title of titles) {
        let current = title;
        // a redirect can point at another redirect; a loop stops after a few steps
        for (let step = 0; step < 4 && renamed.has(current); step++) current = renamed.get(current)!;
        const picture = pictureOfPage.get(current);
        if (picture) pictures.set(title, picture);
    }
    return pictures;
}

/** One batch, asked again once after a pause if Wikipedia is busy or the connection drops. */
async function askBatch(titles: readonly string[]): Promise<unknown> {
    try {
        return await getJSON(pictureQuery(titles), {}, TIMEOUT_MS);
    } catch {
        await sleep(2000);
        return getJSON(pictureQuery(titles), {}, TIMEOUT_MS);
    }
}

/**
 * The free lead picture of each page title that has one. `onBatch` hears how many titles
 * have been looked up so far; `reachedWikipedia` is false if no batch got an answer.
 */
export async function findFreePictures(
    titles: readonly string[],
    onBatch: (lookedUp: number) => void,
    shouldStop: () => boolean = () => false,
): Promise<{ pictures: Map<string, LeadPicture>; reachedWikipedia: boolean }> {
    const unique = [...new Set(titles)];
    const pictures = new Map<string, LeadPicture>();
    let answered = 0;
    for (let start = 0; start < unique.length && !shouldStop(); start += TITLES_PER_REQUEST) {
        if (start) await sleep(GAP_MS);
        const batch = unique.slice(start, start + TITLES_PER_REQUEST);
        try {
            for (const [title, picture] of picturesFromAnswer(await askBatch(batch), batch)) pictures.set(title, picture);
            answered++;
        } catch {}
        onBatch(Math.min(unique.length, start + TITLES_PER_REQUEST));
    }
    return { pictures, reachedWikipedia: answered > 0 || !unique.length };
}
