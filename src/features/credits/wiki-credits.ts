// src/features/credits/wiki-credits.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Who made each Wikimedia picture, and under which licence: asked of a Wikimedia
//  wiki's API (imageinfo with extmetadata), 50 files at a time. Loaded with the
//  template gallery and the wiki import, the two places that add such pictures.
// ─────────────────────────────────────────────────────────────────────────────
import { readPictureCredit } from '../../core/snapshot';
import type { PictureCredit } from '../../core/types';
import { asArray, asText, dig, isRecord } from '../../lib/checks';
import { getJSON, sleep } from '../../lib/net';

/** MediaWiki's limit on titles per query for anyone without a bot account. */
const FILES_PER_REQUEST = 50;
const GAP_MS = 300;
const TIMEOUT_MS = 15_000;
/** Some authors are whole paragraphs (every contributor, a museum's full name): the first part is enough here. */
const LONGEST_AUTHOR = 120;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** "File:Pluto_in_true_colour.jpg" → "Pluto in true colour.jpg", the form credits keep. */
const displayFileName = (name: string): string =>
    name
        .replace(/^(File|Image):/i, '')
        .replace(/_/g, ' ')
        .trim();

/** One `&…;` entity as its character; unknown names stay as they are, impossible numbers become nothing. */
function decodeEntity(whole: string, name: string): string {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const codePoint = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    const isCharacter = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
    return isCharacter ? String.fromCodePoint(codePoint) : '';
}

/**
 * The words in a piece of Wikimedia's HTML (an author is usually a link, sometimes spans and
 * line breaks). Tags are cut out as text, never parsed into a page, so nothing in it can run.
 */
export function plainTextFromHtml(markup: string): string {
    return markup
        .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/?(br|p|div|li|ul|ol|dd|dt|tr|td|th|table)\b[^>]*>/gi, ' ')
        .replace(/<\/?[a-z!][^>]*>/gi, '')
        .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, decodeEntity)
        .replace(/\s+/g, ' ')
        .trim();
}

/** Cut to `longest` characters at most, with "…" when something was left out. */
const shortened = (text: string, longest: number): string => (text.length > longest ? text.slice(0, longest - 1).trimEnd() + '…' : text);

/** One batch's question: author and licence of each file. Commons files can be asked of any Wikimedia wiki. */
const creditQuery = (api: string, files: readonly string[]): string =>
    api +
    '?' +
    new URLSearchParams({
        action: 'query',
        format: 'json',
        origin: '*',
        prop: 'imageinfo',
        iiprop: 'extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName|AttributionRequired',
        titles: files.map((file) => 'File:' + displayFileName(file)).join('|'),
    });

/**
 * Each asked file → its credit, from one imageinfo answer. Files the answer doesn't describe
 * (or describes in a shape it shouldn't) get a credit with just their name.
 */
export function creditsFromAnswer(answer: unknown, files: readonly string[]): Map<string, PictureCredit> {
    const renamed = new Map<string, string>();
    for (const step of asArray(dig(answer, 'query', 'normalized')).filter(isRecord))
        if (typeof step.from === 'string' && typeof step.to === 'string') renamed.set(step.from, step.to);
    const rawPages = dig(answer, 'query', 'pages');
    const pages = (Array.isArray(rawPages) ? rawPages : isRecord(rawPages) ? Object.values(rawPages) : []).filter(isRecord);
    const detailsOfTitle = new Map<string, { by: string; licence: string }>();
    for (const page of pages) {
        const details = dig(page, 'imageinfo', 0, 'extmetadata');
        if (typeof page.title !== 'string' || !isRecord(details)) continue;
        detailsOfTitle.set(page.title, {
            by: shortened(plainTextFromHtml(asText(dig(details, 'Artist', 'value'))), LONGEST_AUTHOR),
            licence: plainTextFromHtml(asText(dig(details, 'LicenseShortName', 'value'))),
        });
    }
    const credits = new Map<string, PictureCredit>();
    for (const file of files) {
        const title = 'File:' + displayFileName(file);
        const details = detailsOfTitle.get(renamed.get(title) ?? title);
        const credit = readPictureCredit({ file: displayFileName(file), ...details });
        if (credit) credits.set(file, credit);
    }
    return credits;
}

/** One batch, asked again once after a pause if the wiki is busy or the connection drops. */
async function askBatch(api: string, files: readonly string[]): Promise<unknown> {
    try {
        return await getJSON(creditQuery(api, files), {}, TIMEOUT_MS);
    } catch {
        await sleep(2000);
        return getJSON(creditQuery(api, files), {}, TIMEOUT_MS);
    }
}

/**
 * The credit of each picture file (named as `pageimages` or a picture's address gives it), from
 * the wiki at `api`. Every file gets at least its name, so its page can be linked even when the
 * wiki can't be reached; `shouldStop` (Cancel) leaves the rest at that. `onBatch` hears how many
 * files have been looked up so far.
 */
export async function findPictureCredits(
    api: string,
    files: readonly string[],
    shouldStop: () => boolean = () => false,
    onBatch: (lookedUp: number) => void = () => {},
): Promise<Map<string, PictureCredit>> {
    const unique = [...new Set(files)];
    const credits = new Map<string, PictureCredit>();
    for (let start = 0; start < unique.length; start += FILES_PER_REQUEST) {
        const batch = unique.slice(start, start + FILES_PER_REQUEST);
        let answer: unknown = null;
        if (!shouldStop())
            try {
                if (start) await sleep(GAP_MS);
                answer = await askBatch(api, batch);
            } catch {}
        for (const [file, credit] of creditsFromAnswer(answer, batch)) credits.set(file, credit);
        onBatch(Math.min(unique.length, start + FILES_PER_REQUEST));
    }
    return credits;
}
