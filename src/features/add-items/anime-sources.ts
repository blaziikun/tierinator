// src/features/add-items/anime-sources.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Anime, manga and character search across three sites at once: AniList,
//  MyAnimeList (through Jikan) and Kitsu. The same show or character found on
//  several sites becomes one result with every site's picture.
//
//  Matching rules (so two different "Naruto"s never merge):
//    shows        MyAnimeList ids are exact links (AniList and Kitsu store them)
//    characters   names must agree, and the native (Japanese) names too or a shared
//                 show; Kitsu stores the MyAnimeList id, so that link is exact
// ─────────────────────────────────────────────────────────────────────────────
import { asArray, asNumber, asText, dig, isRecord } from '../../lib/checks';
import { getJSON, sleep } from '../../lib/net';
import type { WebResult, WebResults } from './web-sources';

/** One show or character while the three sites' answers are merged. */
interface Candidate {
    name: string;
    /** Every spelling of the name, as word keys (see nameKey). */
    keys: Set<string>;
    /** Native name without spacing or punctuation. */
    nativeName: string;
    pictures: string[];
    subtitle: string;
    /** Shows it appears in: "A123" (anime) or "M123" (manga), by MyAnimeList id. */
    shows: Set<string>;
    favourites: number;
    ids: { anilist?: number; mal?: number; kitsu?: string };
}

const SITES = ['AniList', 'MyAnimeList', 'Kitsu'] as const;

// ═════════════════════════════════════════════════════════════════════════════
//  TALKING TO THE SITES
// ═════════════════════════════════════════════════════════════════════════════

const anilist = (query: string, search: string): Promise<unknown> =>
    getJSON('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { s: search } }),
    });

/** Jikan allows about 3 requests a second; if it's slow or down, it's left out for 10 minutes. */
const jikan = { lastCall: 0, downUntil: 0 };

async function askJikan(path: string): Promise<unknown> {
    if (Date.now() < jikan.downUntil) throw new Error('MyAnimeList unavailable');
    const now = Date.now();
    const at = Math.max(now, jikan.lastCall + 420);
    jikan.lastCall = at;
    if (at > now) await sleep(at - now);
    const url = 'https://api.jikan.moe/v4/' + path;
    try {
        return await getJSON(url, {}, 6000);
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/429/.test(message)) {
            await sleep(1200);
            return getJSON(url, {}, 6000);
        }
        if (!/HTTP 4/.test(message)) jikan.downUntil = Date.now() + 600_000;
        throw error;
    }
}

/** Kitsu moved from kitsu.io to kitsu.app; both are tried. */
async function askKitsu(path: string): Promise<unknown> {
    const init = { headers: { Accept: 'application/vnd.api+json' } };
    try {
        return await getJSON('https://kitsu.app/api/edge/' + path, init, 10_000);
    } catch {
        return getJSON('https://kitsu.io/api/edge/' + path, init, 10_000);
    }
}

/** Asks all three sites at once; a site that fails is noted and gives nothing. */
async function askAll(
    requests: readonly [Promise<unknown>, Promise<unknown>, Promise<unknown>],
): Promise<{ answers: unknown[]; failed: string[] }> {
    const failed: string[] = [];
    const answers = await Promise.all(
        requests.map((request, index) =>
            request.catch(() => {
                failed.push(SITES[index]!);
                return null;
            }),
        ),
    );
    return { answers, failed };
}

// ═════════════════════════════════════════════════════════════════════════════
//  NAMES AND RESULTS
// ═════════════════════════════════════════════════════════════════════════════

/** Word order and accents don't matter: "Lamperouge, Lelouch" = "Lelouch Lamperouge". */
export const nameKey = (name: unknown): string =>
    asText(name)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');

/** Native names ignore spacing and dots. */
const nativeKey = (name: unknown): string =>
    asText(name)
        .normalize('NFKC')
        .replace(/[\s・·=＝.,'"()（）-]/g, '');

/** Sites use placeholder pictures ("no image", question marks); those are skipped. */
const isUsefulPicture = (url: string): boolean =>
    /^https:\/\//.test(url) && !/questionmark|\/default\.(jpg|png)|na\.gif|no_image/i.test(url);

function addPicture(candidate: Candidate, url: unknown): void {
    const address = asText(url);
    if (isUsefulPicture(address) && !candidate.pictures.includes(address)) candidate.pictures.push(address);
}

const newCandidate = (name: string, fields: Partial<Candidate> = {}): Candidate => ({
    name,
    keys: new Set([nameKey(name)].filter(Boolean)),
    nativeName: '',
    pictures: [],
    subtitle: '',
    shows: new Set(),
    favourites: 0,
    ids: {},
    ...fields,
});

/** AniList's own ranking first, then the extra finds from the other sites by popularity. */
function finishResults(candidates: readonly Candidate[], failed: readonly string[]): WebResults {
    if (failed.length === SITES.length) throw new Error('all sources failed');
    const withPictures = candidates.filter((candidate) => candidate.pictures.length);
    // AniList's results come first already; everything from the first other-site find on is sorted by popularity
    const firstOther = withPictures.findIndex((candidate) => candidate.ids.anilist == null);
    const ordered =
        firstOther < 0
            ? withPictures
            : [...withPictures.slice(0, firstOther), ...withPictures.slice(firstOther).sort((a, b) => b.favourites - a.favourites)];
    const results: WebResults = ordered.map(
        (candidate): WebResult => ({
            name: candidate.name,
            img: candidate.pictures[0]!,
            imgs: candidate.pictures,
            sub: candidate.subtitle,
            badge:
                [candidate.ids.anilist && 'AniList', candidate.ids.mal && 'MAL', candidate.ids.kitsu && 'Kitsu']
                    .filter(Boolean)
                    .join(', ') + (candidate.pictures.length > 1 ? ` (${candidate.pictures.length} pictures)` : ''),
        }),
    );
    if (failed.length) results.note = `Couldn't reach ${failed.join(' or ')} just now, so these are from the others.`;
    return results;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHOWS (anime or manga)
// ═════════════════════════════════════════════════════════════════════════════

/** "TV", "OVA", "movie"… */
const formatName = (format: unknown): string =>
    asText(format).replace(/_/g, ' ').toLowerCase().replace(/^tv$/, 'TV').replace(/^ova$/, 'OVA').replace(/^ona$/, 'ONA');

export async function searchMedia(query: string, type: 'ANIME' | 'MANGA'): Promise<WebResults> {
    const encoded = encodeURIComponent(query);
    const kind = type.toLowerCase();
    const { answers, failed } = await askAll([
        anilist(
            `query($s:String){Page(perPage:25){media(search:$s,type:${type},sort:SEARCH_MATCH){id idMal title{english romaji} coverImage{extraLarge large} seasonYear startDate{year} format}}}`,
            query,
        ),
        askJikan(`${kind}?q=${encoded}&limit=20`),
        askKitsu(`${kind}?filter[text]=${encoded}&page[limit]=20&include=mappings`),
    ]);
    const candidates: Candidate[] = [];
    const byMalId = (id: number) => (id ? candidates.find((candidate) => candidate.ids.mal === id) : undefined);

    for (const show of asArray(dig(answers[0], 'data', 'Page', 'media')).filter(isRecord)) {
        const english = asText(dig(show, 'title', 'english'));
        const romaji = asText(dig(show, 'title', 'romaji'));
        const candidate = newCandidate(english || romaji, {
            keys: new Set([nameKey(english), nameKey(romaji)].filter(Boolean)),
            subtitle: [asText(show.seasonYear) || asText(dig(show, 'startDate', 'year')), formatName(show.format)]
                .filter(Boolean)
                .join(', '),
            ids: { anilist: asNumber(show.id), mal: asNumber(show.idMal) || undefined },
        });
        addPicture(candidate, dig(show, 'coverImage', 'extraLarge') || dig(show, 'coverImage', 'large'));
        candidates.push(candidate);
    }
    for (const show of asArray(dig(answers[1], 'data')).filter(isRecord)) {
        const malId = asNumber(show.mal_id);
        let candidate = byMalId(malId);
        if (!candidate) {
            const year =
                asText(show.year) ||
                asText(dig(show, 'published', 'prop', 'from', 'year')) ||
                asText(dig(show, 'aired', 'prop', 'from', 'year'));
            candidate = newCandidate(asText(show.title_english) || asText(show.title), {
                keys: new Set([nameKey(show.title), nameKey(show.title_english)].filter(Boolean)),
                subtitle: [year, asText(show.type)].filter(Boolean).join(', '),
                ids: { mal: malId },
            });
            candidates.push(candidate);
        }
        addPicture(candidate, dig(show, 'images', 'webp', 'large_image_url') || dig(show, 'images', 'jpg', 'large_image_url'));
    }
    // Kitsu links to MyAnimeList through "mappings"
    const malIdByMapping = new Map<string, number>();
    for (const included of asArray(dig(answers[2], 'included')).filter(isRecord))
        if (included.type === 'mappings' && dig(included, 'attributes', 'externalSite') === `myanimelist/${kind}`)
            malIdByMapping.set(asText(included.id), asNumber(dig(included, 'attributes', 'externalId')));
    for (const show of asArray(dig(answers[2], 'data')).filter(isRecord)) {
        const mappings = asArray(dig(show, 'relationships', 'mappings', 'data')).map((mapping) =>
            malIdByMapping.get(asText(dig(mapping, 'id'))),
        );
        const candidate = byMalId(mappings.find(Boolean) ?? 0);
        if (!candidate) continue;
        candidate.ids.kitsu = asText(show.id);
        addPicture(candidate, dig(show, 'attributes', 'posterImage', 'large') || dig(show, 'attributes', 'posterImage', 'original'));
    }
    return finishResults(candidates, failed);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHARACTERS
// ═════════════════════════════════════════════════════════════════════════════

export async function searchCharacters(query: string): Promise<WebResults> {
    const encoded = encodeURIComponent(query);
    const { answers, failed } = await askAll([
        anilist(
            'query($s:String){Page(perPage:25){characters(search:$s,sort:SEARCH_MATCH){id name{full native alternative} image{large} favourites media(perPage:6,sort:POPULARITY_DESC){nodes{idMal type title{english romaji}}}}}}',
            query,
        ),
        askJikan(`characters?q=${encoded}&limit=25&order_by=favorites&sort=desc`),
        askKitsu(`characters?filter[name]=${encoded}&page[limit]=20`),
    ]);
    const candidates: Candidate[] = [];

    // AniList: the main list (it knows which shows each character is in)
    for (const character of asArray(dig(answers[0], 'data', 'Page', 'characters')).filter(isRecord)) {
        const shows = asArray(dig(character, 'media', 'nodes')).filter(isRecord);
        const fullName = asText(dig(character, 'name', 'full'));
        const candidate = newCandidate(fullName, {
            keys: new Set([nameKey(fullName), ...asArray(dig(character, 'name', 'alternative')).map(nameKey)].filter(Boolean)),
            nativeName: nativeKey(dig(character, 'name', 'native')),
            subtitle: shows[0] ? asText(dig(shows[0], 'title', 'english')) || asText(dig(shows[0], 'title', 'romaji')) : '',
            shows: new Set(shows.filter((show) => show.idMal).map((show) => (show.type === 'MANGA' ? 'M' : 'A') + asText(show.idMal))),
            favourites: asNumber(character.favourites),
            ids: { anilist: asNumber(character.id) },
        });
        addPicture(candidate, dig(character, 'image', 'large'));
        candidates.push(candidate);
    }

    // MyAnimeList: merged into an AniList character only when it's surely the same one
    const malPicture = (character: Record<string, unknown>) =>
        dig(character, 'images', 'webp', 'image_url') || dig(character, 'images', 'jpg', 'image_url');
    const addMalOnly = (character: Record<string, unknown>): Candidate => {
        const name = asText(character.name);
        const candidate = newCandidate(name, {
            keys: new Set([nameKey(name), ...asArray(character.nicknames).map(nameKey)].filter(Boolean)),
            nativeName: nativeKey(character.name_kanji),
            favourites: asNumber(character.favorites),
            ids: { mal: asNumber(character.mal_id) },
        });
        addPicture(candidate, malPicture(character));
        candidates.push(candidate);
        return candidate;
    };
    const mergeMal = (candidate: Candidate, character: Record<string, unknown>) => {
        candidate.ids.mal = asNumber(character.mal_id);
        addPicture(candidate, malPicture(character));
        candidate.nativeName ||= nativeKey(character.name_kanji);
        candidate.favourites = Math.max(candidate.favourites, asNumber(character.favorites));
    };
    const unsure: [Record<string, unknown>, Candidate[]][] = [];
    for (const character of asArray(dig(answers[1], 'data')).filter(isRecord)) {
        const key = nameKey(character.name);
        const native = nativeKey(character.name_kanji);
        const nicknames = asArray(character.nicknames).map(nameKey);
        const matches = candidates.filter(
            (candidate) =>
                candidate.ids.anilist != null &&
                candidate.ids.mal == null &&
                (candidate.keys.has(key) || nicknames.some((nickname) => candidate.keys.has(nickname))) &&
                !(candidate.nativeName && native && candidate.nativeName !== native),
        );
        if (matches.length === 1 && matches[0]!.nativeName && native) mergeMal(matches[0]!, character);
        else if (matches.length) unsure.push([character, matches]);
        else addMalOnly(character);
    }
    // same name but no native names to compare: look up the shows they're in (a few, Jikan is slow)
    for (const [index, [character, matches]] of unsure.entries()) {
        if (index >= 8) {
            addMalOnly(character);
            continue;
        }
        try {
            const details = await askJikan(`characters/${asText(character.mal_id)}/full`);
            const shows = new Set([
                ...asArray(dig(details, 'data', 'anime')).map((entry) => 'A' + asText(dig(entry, 'anime', 'mal_id'))),
                ...asArray(dig(details, 'data', 'manga')).map((entry) => 'M' + asText(dig(entry, 'manga', 'mal_id'))),
            ]);
            const same = matches.find((candidate) => candidate.ids.mal == null && [...candidate.shows].some((show) => shows.has(show)));
            if (same) {
                mergeMal(same, character);
                continue;
            }
            const own = addMalOnly(character);
            own.subtitle =
                asText(dig(details, 'data', 'anime', 0, 'anime', 'title')) || asText(dig(details, 'data', 'manga', 0, 'manga', 'title'));
        } catch {
            addMalOnly(character);
        }
    }

    // Kitsu: linked by its MyAnimeList id, or by name if that's unambiguous
    const queryWords = nameKey(query).split(' ');
    for (const character of asArray(dig(answers[2], 'data')).filter(isRecord)) {
        const attributes = isRecord(character.attributes) ? character.attributes : {};
        const malId = asNumber(attributes.malId);
        let candidate = malId ? candidates.find((c) => c.ids.mal === malId) : undefined;
        if (!candidate) {
            const name = asText(attributes.canonicalName) || asText(attributes.name);
            const key = nameKey(name);
            const native = nativeKey(dig(attributes, 'names', 'ja_jp'));
            const matches = candidates.filter(
                (c) => c.ids.kitsu == null && c.keys.has(key) && !(c.nativeName && native && c.nativeName !== native),
            );
            if (matches.length === 1 && matches[0]!.nativeName && native) candidate = matches[0];
            else if (!matches.length && key && queryWords.every((word) => key.includes(word))) {
                candidate = newCandidate(name, { nativeName: native });
                candidates.push(candidate);
            }
        }
        if (!candidate) continue;
        candidate.ids.kitsu = asText(character.id);
        addPicture(candidate, dig(attributes, 'image', 'original') || dig(attributes, 'image', 'large'));
    }
    return finishResults(candidates, failed);
}
