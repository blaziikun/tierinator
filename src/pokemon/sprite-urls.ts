// src/pokemon/sprite-urls.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Where Pokémon pictures are fetched from, and whether that works right now.
//
//  Sprites aren't part of the site (they're Nintendo's art); they come from public
//  GitHub collections (PokeAPI, PokeMiners, PMDCollab): straight from GitHub, or the
//  jsDelivr CDN copy. The one that works is remembered, and if neither does, the
//  sprite pickers say so and offer the offline pokemon.zip instead.
// ─────────────────────────────────────────────────────────────────────────────
import { byId } from '../lib/dom';
import { html, setHtml } from '../lib/html';
import { usingLocalSprites } from './local-source';

export const POKEAPI_SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

/** The same files on GitHub and on jsDelivr's copy of it, in the same order for every collection. */
const SPRITE_MIRRORS = [POKEAPI_SPRITES, 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/'];
const GO_MIRRORS = [
    'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon%20-%20256x256/Addressable%20Assets/',
    'https://cdn.jsdelivr.net/gh/PokeMiners/pogo_assets@master/Images/Pokemon%20-%20256x256/Addressable%20Assets/',
];
const PMD_MIRRORS = [
    'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/',
    'https://cdn.jsdelivr.net/gh/PMDCollab/SpriteCollab@master/portrait/',
];

type NetStatus = 'unknown' | 'ok' | 'blocked';

/** How online sprites are doing: successes, failures, and which mirror to try first. */
const network = {
    loaded: 0,
    failed: 0,
    status: 'unknown' as NetStatus,
    preferredMirror: 0,
};

/** Mirror numbers to try, the one that last worked first. */
export const mirrorOrder = (): number[] => [
    network.preferredMirror,
    ...SPRITE_MIRRORS.map((_, i) => i).filter((i) => i !== network.preferredMirror),
];

/** "lore:ab/File.png" → the Bulbagarden archive address (without https://). */
function loreArchivePath(path: string): string {
    const rest = path.slice(5);
    const slash = rest.indexOf('/');
    const folder = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    return `archives.bulbagarden.net/media/upload/${folder[0]}/${folder}/${encodeURIComponent(file)}`;
}

/** Every address a sprite path can be fetched from, most likely to work first. */
export function spriteUrlsFor(path: string): string[] {
    if (/^https?:/.test(path)) return [path, 'https://wsrv.nl/?url=' + encodeURIComponent(path.replace(/^https?:\/\//, ''))];
    if (path.startsWith('go:')) return mirrorOrder().map((i) => GO_MIRRORS[i] + 'pm' + path.slice(3) + '.icon.png');
    if (path.startsWith('pmd:')) return mirrorOrder().map((i) => PMD_MIRRORS[i] + path.slice(4) + '.png');
    // straight from the Bulbagarden archive only: if it says no, the default sprite is shown instead
    if (path.startsWith('lore:')) return ['https://' + loreArchivePath(path)];
    return mirrorOrder().map((i) => SPRITE_MIRRORS[i] + path);
}

// ═════════════════════════════════════════════════════════════════════════════
//  IS IT WORKING?
// ═════════════════════════════════════════════════════════════════════════════

/** Called after each online sprite loads or fails; `mirror` is the mirror number that worked. */
export function recordNetResult(ok: boolean, mirror?: number): void {
    if (ok) {
        network.loaded++;
        if (mirror !== undefined && mirror !== network.preferredMirror && network.status !== 'ok') network.preferredMirror = mirror;
    } else network.failed++;
    const status: NetStatus = network.loaded > 0 ? 'ok' : network.failed >= 3 ? 'blocked' : 'unknown';
    if (status !== network.status) {
        network.status = status;
        renderNetState();
    }
}

/** Shows or hides the "can't reach sprites" notes and updates the sprite-source line. */
export function renderNetState(): void {
    const blocked = network.status === 'blocked';
    document.querySelectorAll<HTMLElement>('.netnote').forEach((note) => {
        note.classList.toggle('hid', !blocked || usingLocalSprites());
        setHtml(
            note.querySelector('.nmsg')!,
            html`<b>Online sprites can't be reached.</b> GitHub's picture hosting and its mirrors aren't loading on this connection. Check you're
                online, try another network, or load your <b>pokemon.zip</b> (covers #1–807 offline).`,
        );
    });
    if (usingLocalSprites()) return;
    const viaMirror = network.preferredMirror ? ' (via mirror)' : '';
    setHtml(
        byId('srcinfo'),
        network.status === 'ok'
            ? html`<b>Online</b>: all PokeAPI sprites${viaMirror}`
            : blocked
              ? html`<b class="accent">Blocked</b>: load your zip`
              : html`<b>Online</b>: checking…`,
    );
}

let probed = false;

/**
 * Loads one small sprite through each mirror in turn to find one that works. Once per visit, and only
 * when a Pokémon list is open: nobody else's browser needs to contact GitHub.
 */
export function probeNetwork(): void {
    if (probed) return;
    probed = true;
    const order = mirrorOrder();
    let attempt = 0;
    const probe = new Image();
    const tryNext = () => {
        if (attempt >= order.length) {
            network.failed = Math.max(network.failed, 3);
            recordNetResult(false);
            return;
        }
        probe.src = SPRITE_MIRRORS[order[attempt]!] + '25.png?probe';
    };
    probe.onload = () => recordNetResult(true, order[attempt]);
    probe.onerror = () => {
        attempt++;
        tryNext();
    };
    tryNext();
}
