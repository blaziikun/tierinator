// src/core/picture-sites.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The picture addresses trusted without asking: the sprite collections and what
//  Add items searches. A share link's pictures from them load at once; a template's
//  pictures may come from nowhere else.
// ─────────────────────────────────────────────────────────────────────────────

/** Sites that only serve their own pictures, so any address on them is fine. */
const PICTURE_SITES =
    /^(archives\.bulbagarden\.net|upload\.wikimedia\.org|static\.tvmaze\.com|is\d+-ssl\.mzstatic\.com|covers\.openlibrary\.org|flagcdn\.com|s\d+\.anilist\.co|cdn\.myanimelist\.net|media\.kitsu\.(app|io))$/;

/**
 * GitHub and jsDelivr serve anyone's files, so only the sprite collections' own folders count: otherwise a link could
 * point at a file of its maker's and learn, from its download count, that it was opened.
 */
const COLLECTION_FOLDERS = [
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/',
    'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/',
    'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/',
    'https://cdn.jsdelivr.net/gh/PokeMiners/pogo_assets@master/',
    'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/',
    'https://cdn.jsdelivr.net/gh/PMDCollab/SpriteCollab@master/',
];

/**
 * An https address on one of those sites or in one of those folders (no other port, no user name in it). The
 * address is checked as the browser will read it, so `%2e%2e` can't climb out of a folder.
 */
export function isKnownPictureAddress(address: string): boolean {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    return PICTURE_SITES.test(url.hostname) || COLLECTION_FOLDERS.some((folder) => url.href.startsWith(folder));
}
