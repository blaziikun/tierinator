// src/features/add-items/web-sources.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Where Add items → Search the web looks: free, public search APIs that answer
//  with names and pictures. Each source turns its own answer into WebResults.
//  (Anime, manga and characters search three sites at once: anime-sources.ts.)
// ─────────────────────────────────────────────────────────────────────────────
import { asArray, asText, dig, isRecord } from '../../lib/checks';
import { getJSON } from '../../lib/net';
import { searchCharacters, searchMedia } from './anime-sources';

/** One search result: something to add as an item, with its picture(s). */
export interface WebResult {
    name: string;
    img: string;
    /** Every picture found for it (several sites can each have one). */
    imgs?: string[];
    sub?: string;
    /** Which sites it was found on. */
    badge?: string;
}

/** Results, with a note when some of the sites couldn't be reached. */
export type WebResults = WebResult[] & { note?: string };

export interface WebSource {
    name: string;
    search(query: string): Promise<WebResults>;
}

/** Results with a usable (https) picture only. */
const withPictures = (results: WebResult[]): WebResults => results.filter((result) => /^https:\/\//.test(result.img));

const records = (value: unknown): Record<string, unknown>[] => asArray(value).filter(isRecord);

async function searchWikipedia(query: string): Promise<WebResults> {
    const answer = await getJSON(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=30&prop=pageimages|description&piprop=thumbnail&pithumbsize=500`,
    );
    const pages = Object.values(
        isRecord(dig(answer, 'query', 'pages')) ? (dig(answer, 'query', 'pages') as Record<string, unknown>) : {},
    ).filter(isRecord);
    return withPictures(
        pages
            .sort((a, b) => Number(a.index) - Number(b.index))
            .map((page) => ({ name: asText(page.title), img: asText(dig(page, 'thumbnail', 'source')), sub: asText(page.description) })),
    );
}

async function searchTvMaze(query: string): Promise<WebResults> {
    const answer = await getJSON(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
    return withPictures(
        records(answer).map((hit) => ({
            name: asText(dig(hit, 'show', 'name')),
            img: asText(dig(hit, 'show', 'image', 'original')) || asText(dig(hit, 'show', 'image', 'medium')),
            sub: asText(dig(hit, 'show', 'premiered')).slice(0, 4),
        })),
    );
}

async function searchItunes(query: string, entity: 'movie' | 'album' | 'song' | 'software'): Promise<WebResults> {
    const answer = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=${entity}&limit=30`);
    return withPictures(
        records(dig(answer, 'results')).map((hit) => ({
            name:
                entity === 'album' && hit.collectionName ? asText(hit.collectionName) : asText(hit.trackName) || asText(hit.collectionName),
            // iTunes serves any size: ask for 600 px instead of 100
            img: asText(hit.artworkUrl100).replace(/100x100bb/, '600x600bb'),
            sub: asText(hit.artistName),
        })),
    );
}

async function searchOpenLibrary(query: string): Promise<WebResults> {
    const answer = await getJSON(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=30&fields=title,author_name,cover_i,first_publish_year`,
    );
    return withPictures(
        records(dig(answer, 'docs'))
            .filter((book) => book.cover_i)
            .map((book) => ({
                name: asText(book.title),
                img: `https://covers.openlibrary.org/b/id/${asText(book.cover_i)}-L.jpg`,
                sub: asText(dig(book, 'author_name', 0)),
            })),
    );
}

async function searchCountries(query: string): Promise<WebResults> {
    const url = query.trim()
        ? `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,flags`
        : 'https://restcountries.com/v3.1/all?fields=name,flags';
    return withPictures(
        records(await getJSON(url))
            .map((country) => ({ name: asText(dig(country, 'name', 'common')), img: asText(dig(country, 'flags', 'png')), sub: '' }))
            .sort((a, b) => a.name.localeCompare(b.name)),
    );
}

export const WEB_SOURCES: Record<string, WebSource> = {
    wiki: { name: 'Wikipedia: anything', search: searchWikipedia },
    anime: { name: 'Anime (AniList + MyAnimeList + Kitsu)', search: (query) => searchMedia(query, 'ANIME') },
    manga: { name: 'Manga (AniList + MyAnimeList + Kitsu)', search: (query) => searchMedia(query, 'MANGA') },
    chars: { name: 'Anime & manga characters (AniList + MyAnimeList + Kitsu)', search: searchCharacters },
    tv: { name: 'TV shows (TVmaze)', search: searchTvMaze },
    movies: { name: 'Movies (iTunes)', search: (query) => searchItunes(query, 'movie') },
    albums: { name: 'Albums (iTunes)', search: (query) => searchItunes(query, 'album') },
    songs: { name: 'Songs (iTunes)', search: (query) => searchItunes(query, 'song') },
    apps: { name: 'Apps & games (iTunes)', search: (query) => searchItunes(query, 'software') },
    books: { name: 'Books (Open Library)', search: searchOpenLibrary },
    countries: { name: 'Countries & flags', search: searchCountries },
};
