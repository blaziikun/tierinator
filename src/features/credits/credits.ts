// src/features/credits/credits.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Picture credits: who made each Wikimedia picture in the open list, and its
//  licence, as a line in the item editor and in the Picture credits window (#pcm,
//  from About & privacy). A credit shows only while the item still shows its picture.
// ─────────────────────────────────────────────────────────────────────────────
import { isPictureFileName } from '../../core/snapshot';
import { state } from '../../core/state';
import type { ItemId, PictureCredit } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, type SafeHtml, safeUrl, setHtml } from '../../lib/html';

/** A credited picture as shown: its credit, its page on the wiki that holds it, and that wiki's name. */
interface ShownCredit {
    credit: PictureCredit;
    page: string;
    site: string;
}

const creditsWindow = {
    /** Where focus was before the window opened: it goes back there on close. */
    opener: null as HTMLElement | null,
};

const isOpen = (): boolean => byId('pcm').classList.contains('show');

/**
 * The file behind a picture address on Wikimedia's picture server, and the wiki whose
 * page describes it (Commons, or a Wikipedia for its own local files):
 * /wikipedia/<commons or language>/[thumb/]<a>/<ab>/<file>[/<width>px-<file>].
 */
export function wikimediaFileOf(address: string): { file: string; home: string } | null {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org') return null;
    const parts = url.pathname.split('/');
    const wiki = parts[2] || '';
    if (parts[1] !== 'wikipedia' || !/^[a-z][a-z-]{1,15}$/.test(wiki)) return null;
    const at = parts[3] === 'thumb' ? 4 : 3;
    if (!/^[0-9a-f]$/.test(parts[at] || '') || !/^[0-9a-f]{2}$/.test(parts[at + 1] || '')) return null;
    let file = '';
    try {
        file = decodeURIComponent(parts[at + 2] || '').replace(/_/g, ' ');
    } catch {
        return null;
    }
    if (!isPictureFileName(file)) return null;
    return { file, home: wiki === 'commons' ? 'commons.wikimedia.org' : `${wiki}.wikipedia.org` };
}

/** The credit of the picture an item shows now (none once its picture was changed or became a text tile). */
function shownCredit(id: ItemId): ShownCredit | null {
    const credit = state.ownItems.find((item) => item.id === id)?.credit;
    const path = state.picks[id]?.path;
    const shown = credit && path ? wikimediaFileOf(path) : null;
    if (!credit || !shown || shown.file !== credit.file) return null;
    return {
        credit,
        page: `https://${shown.home}/wiki/File:${encodeURIComponent(credit.file.replace(/ /g, '_'))}`,
        site: shown.home === 'commons.wikimedia.org' ? 'Wikimedia Commons' : 'Wikipedia',
    };
}

/** "Jane Doe, CC BY-SA 4.0", or as much of it as is known ('' if neither). */
const authorAndLicence = (credit: PictureCredit): string => [credit.by, credit.licence].filter(Boolean).join(', ');

const pageLink = (shown: ShownCredit, text: string): SafeHtml =>
    html`<a href="${safeUrl(shown.page)}" target="_blank" rel="noopener noreferrer" title="The picture's page on ${shown.site}, with its full credit and licence (opens in a new tab)">${text}</a>`;

/** The item editor's line under the picture: "Picture: Jane Doe, CC BY-SA 4.0" (a link), or nothing. */
export function creditLine(id: ItemId): SafeHtml {
    const shown = shownCredit(id);
    if (!shown) return html``;
    const known = authorAndLicence(shown.credit);
    return known ? html`Picture: ${pageLink(shown, known)}` : pageLink(shown, `Picture from ${shown.site}`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE WINDOW
// ═════════════════════════════════════════════════════════════════════════════

function buildWindow(): void {
    const modal = document.createElement('div');
    modal.id = 'pcm';
    modal.className = 'modal';
    setHtml(
        modal,
        html`<div class="mbox" id="pcbox" role="dialog" aria-modal="true" aria-labelledby="pctitle">
  <div class="addhead"><h3 id="pctitle">Picture credits</h3><button id="pcx" aria-label="Close" title="Close (Esc)">✕</button></div>
  <p class="note">The pictures in this list from Wikipedia and Wikimedia Commons, who made them and their licence. Each link opens the picture's page with the full details. If you share an export of this list, credit them there too.</p>
  <div id="pclist"></div>
</div>`,
    );
    document.body.append(modal);
}

function renderCredits(): void {
    const credited = state.ownItems
        .map((item) => ({ name: item.name, shown: shownCredit(item.id) }))
        .filter((row): row is { name: string; shown: ShownCredit } => !!row.shown);
    setHtml(
        byId('pclist'),
        credited.length
            ? html`<ul>${credited.map(
                  ({ name, shown }) =>
                      html`<li><b>${name}</b><span>${authorAndLicence(shown.credit) || `Author and licence on its page on ${shown.site}`}</span>${pageLink(shown, shown.credit.file)}</li>`,
              )}</ul>`
            : html`<p class="empty">No pictures in this list came from Wikipedia or Wikimedia Commons, so there's nobody to credit here.</p>`,
    );
}

export function openPictureCredits(): void {
    const focused = document.activeElement;
    creditsWindow.opener = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    renderCredits();
    byId('pcm').classList.add('show');
    byId('pcx').focus();
}

function closePictureCredits(): void {
    byId('pcm').classList.remove('show');
    if (creditsWindow.opener?.isConnected && creditsWindow.opener.offsetParent) creditsWindow.opener.focus();
    creditsWindow.opener = null;
}

/** Tab and Shift+Tab stay inside the window while it's open; Escape closes it (and only it). */
function handleWindowKeys(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // the About window underneath stays open
        closePictureCredits();
        return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...byId('pcbox').querySelectorAll<HTMLElement>('button, a[href]')].filter((element) => element.offsetParent);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupPictureCredits(): void {
    buildWindow();
    byId('aboutcredits').onclick = openPictureCredits;
    byId('pcx').onclick = closePictureCredits;
    byId('pcm').addEventListener('click', (e) => {
        if (e.target === e.currentTarget && isOpen()) closePictureCredits();
    });
    byId('pcm').addEventListener('keydown', handleWindowKeys);
}
