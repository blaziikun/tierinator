// src/features/share/share.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Share links: the list itself, compressed into the link after "#" (that part
//  never reaches any server). Opening one shows the list as a preview: "Keep a copy"
//  makes it one of your lists, "Close" throws it away.
//
//  Pictures in a link load straight from their addresses. Those on the sprite
//  collections and the sites Add items searches load at once; any other site waits
//  until you choose to show them, so a link can't report back that you opened it.
// ─────────────────────────────────────────────────────────────────────────────
import { entryById } from '../../core/items';
import { toSnapshot } from '../../core/persist';
import { isKnownPictureAddress } from '../../core/picture-sites';
import { addListMeta, currentListMeta, onListOpen, saveListIndex, session, spriteBlobs, state } from '../../core/state';
import type { ItemId, OwnItem } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId } from '../../lib/dom';
import { packForLink, unpackFromLink } from '../../lib/link-data';
import { askText, closePopovers, toast } from '../../lib/ui';
import { useTextTile } from '../items/items';
import { dropEmptyStartingList, forgetList, openList, openStartingList, renderListMenu } from '../lists/lists';
import { genericPacks } from '../packs/packs';

const LINK_PREFIX = '#l=';
/** Longer links get cut off by chat apps; lists that big are better sent as a file. */
const MAX_LINK_LENGTH = 30_000;
/** What a link may unpack to at most (a big Pokémon list is well under 1 MB). */
const MAX_LIST_BYTES = 4_000_000;

/** The shared list being previewed, in full, while pictures from other sites are held back. */
let heldBack: { listId: string; list: Record<string, unknown>; sites: string[] } | null = null;

/** The parts of a saved list that travel in a link: the list, not this browser's view settings. */
const SHARED_FIELDS = [
    'app',
    'v',
    'kind',
    'pack',
    'notes',
    'fam',
    'famM',
    'listName',
    'items',
    'nextId',
    'theme',
    'tiers',
    'lay',
    'cols',
    'shape',
    'fit',
    'sz',
    'lbl',
    'trim',
    'formCats',
    'formOv',
    'tags',
] as const;

/** Pictures that live only in this browser (your uploads, gallery, text tiles) can't travel in a link. */
const travels = (path: string): boolean => path !== 'custom' && !/^(gal|xp):/.test(path);

/** The open list as it goes into a link, and how many of your own items lose their picture on the way. */
function shareableList(): { list: Record<string, unknown>; picturesLeftOut: number } {
    const stored = toSnapshot() as unknown as Record<string, unknown>;
    const list: Record<string, unknown> = Object.fromEntries(SHARED_FIELDS.map((field) => [field, stored[field]]));
    const ownIds = new Set(state.ownItems.map((item) => String(item.id)));
    let picturesLeftOut = 0;
    list.picks = Object.fromEntries(
        Object.entries(state.picks).filter(([id, pick]) => {
            if (travels(pick.path)) return true;
            if (ownIds.has(id) && !pick.text) picturesLeftOut++;
            return false;
        }),
    );
    return { list, picturesLeftOut };
}

/** Picture credits cut down to their file names: the files' pages still name the author and licence. */
const withShortCredits = (items: readonly OwnItem[]): OwnItem[] =>
    items.map((item) => (item.credit ? { ...item, credit: { file: item.credit.file } } : item));

/** The share link for the open list (null if it's too long for one), and what to tell you about it. */
export async function makeShareLink(): Promise<{ link: string | null; notes: string[] }> {
    const { list, picturesLeftOut } = shareableList();
    let link = location.origin + '/' + LINK_PREFIX + (await packForLink(list));
    // picture credits travel whole when they fit (most lists); a list that only fits without them keeps their files
    if (link.length > MAX_LINK_LENGTH && state.ownItems.some((item) => item.credit))
        link = location.origin + '/' + LINK_PREFIX + (await packForLink({ ...list, items: withShortCredits(state.ownItems) }));
    const notes = [
        picturesLeftOut > 0 &&
            `${picturesLeftOut} item${picturesLeftOut > 1 ? 's' : ''} with your own uploaded pictures will show as names.`,
        !!state.packId && `It uses the “${genericPacks.get(state.packId)?.name || state.packId}” pack, so others need that pack too.`,
    ].filter((note): note is string => typeof note === 'string');
    return { link: link.length > MAX_LINK_LENGTH ? null : link, notes };
}

export async function copyShareLink(): Promise<void> {
    closePopovers();
    if (session.needsPack) return toast('Load the Pokémon pack first');
    const { link, notes } = await makeShareLink();
    if (!link) {
        toast('This list is too big for a link. Send it as a file instead (File → Save list).', 5000);
        return;
    }
    try {
        await navigator.clipboard.writeText(link);
        toast(['Share link copied.', ...notes].join(' '), notes.length ? 6000 : 2600);
    } catch {
        await askText(['Copy this link to share the list.', ...notes].join(' '), link);
    }
}

/** The list in a share link (a whole address, or just its "#l=…" part), unchecked; null if there's none or it's broken. */
export async function listInLink(link: string): Promise<unknown> {
    const start = link.indexOf(LINK_PREFIX);
    return start < 0 ? null : unpackFromLink(link.slice(start + LINK_PREFIX.length), MAX_LIST_BYTES);
}

// ═════════════════════════════════════════════════════════════════════════════
//  OPENING A LINK
// ═════════════════════════════════════════════════════════════════════════════

/** If the page was opened from a share link: show that list as a preview. */
export async function openShareLinkIfAny(): Promise<void> {
    if (!location.hash.startsWith(LINK_PREFIX)) return;
    const list = await unpackFromLink(location.hash.slice(LINK_PREFIX.length), MAX_LIST_BYTES);
    if (!isRecord(list) || !Array.isArray(list.tiers)) {
        forgetLinkInAddressBar();
        toast('That share link is broken or cut short', 4000);
        return;
    }
    const kind = list.kind === 'pokemon' ? 'pokemon' : 'custom';
    const meta = addListMeta(String(list.listName || 'Shared list').slice(0, 60), kind);
    meta.preview = true;
    saveListIndex();
    const { shown, held, sites } = holdBackUnknownPictures({ ...list, kind });
    try {
        localStorage.setItem('ptl_' + meta.id, JSON.stringify(shown));
    } catch {
        toast('Browser storage is full');
        return;
    }
    heldBack = sites.length ? { listId: meta.id, list: { ...list, kind }, sites } : null;
    await openList(meta.id);
    await giveTextTilesToPicturelessItems(held);
}

const siteOf = (address: unknown): string => {
    try {
        return typeof address === 'string' && /^https?:/i.test(address) ? new URL(address).hostname : '';
    } catch {
        return '';
    }
};

/** A shared list without its pictures from unknown sites, which items those were, and the sites' names. */
function holdBackUnknownPictures(list: Record<string, unknown>): { shown: Record<string, unknown>; held: Set<string>; sites: string[] } {
    const sites = new Set<string>();
    const held = new Set<string>();
    const picks = Object.entries(isRecord(list.picks) ? list.picks : {}).filter(([id, pick]) => {
        const unknownSites = isRecord(pick)
            ? [pick.path, pick.remote]
                  .filter((address) => typeof address === 'string' && /^https?:/i.test(address) && !isKnownPictureAddress(address))
                  .map(siteOf)
            : [];
        for (const site of unknownSites) sites.add(site);
        if (unknownSites.length) held.add(id);
        return !unknownSites.length;
    });
    // very old lists kept plain addresses here; a link never needs them
    const { chosenSprites: _, ...rest } = list;
    return { shown: { ...rest, picks: Object.fromEntries(picks) }, held, sites: [...sites] };
}

/** Puts the held-back pictures in and opens the list again, which fetches them. */
async function showHeldBackPictures(): Promise<void> {
    if (!heldBack || currentListMeta()?.id !== heldBack.listId) return;
    const { listId, list } = heldBack;
    heldBack = null;
    session.listId = null; // so reopening doesn't first save the preview over the full list
    try {
        localStorage.setItem('ptl_' + listId, JSON.stringify(list));
    } catch {}
    await openList(listId);
}

/** Your own items whose pictures stayed behind show their name instead of a blank square (held-back ones wait). */
async function giveTextTilesToPicturelessItems(held: Set<string>): Promise<void> {
    const generation = session.generation;
    for (const item of state.ownItems) {
        const id = item.id as ItemId;
        if (generation !== session.generation) return;
        if (!spriteBlobs.has(id) && !state.picks[id] && !held.has(String(id)) && entryById.has(id)) await useTextTile(id);
    }
}

const forgetLinkInAddressBar = (): void => history.replaceState(null, '', location.pathname + location.search);

async function keepSharedList(): Promise<void> {
    const meta = currentListMeta();
    if (!meta?.preview) return;
    heldBack = null;
    delete meta.preview;
    saveListIndex();
    await dropEmptyStartingList(meta.id);
    forgetLinkInAddressBar();
    syncShareBar();
    renderListMenu();
    toast(`“${meta.name}” is one of your lists now`);
}

async function closeSharedList(): Promise<void> {
    const meta = currentListMeta();
    if (!meta?.preview) return;
    heldBack = null;
    forgetLinkInAddressBar();
    await forgetList(meta.id);
    await openStartingList();
}

const syncShareBar = (): void => {
    const meta = currentListMeta();
    byId('sharebar').classList.toggle('hid', !meta?.preview);
    const holding = !!heldBack && heldBack.listId === meta?.id;
    const button = byId('sharepics');
    button.classList.toggle('hid', !holding);
    if (holding) {
        const sites = heldBack!.sites;
        button.textContent = `Show pictures from ${sites.length === 1 ? sites[0] : sites.length + ' other sites'}`;
        button.title = 'Not loaded yet, so those sites can’t see you opened this list: ' + sites.join(', ');
    }
};

// ── wiring (runs once at start-up, from main.ts) ──
export function setupShare(): void {
    byId('sharebtn').onclick = () => void copyShareLink();
    byId('sharekeep').onclick = () => void keepSharedList();
    byId('shareclose').onclick = () => void closeSharedList();
    byId('sharepics').onclick = () => void showHeldBackPictures();
    onListOpen(syncShareBar);
    // a share link pasted into the address bar of an open page
    addEventListener('hashchange', () => void openShareLinkIfAny());
}
