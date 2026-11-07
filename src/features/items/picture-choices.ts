// src/features/items/picture-choices.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The picture choices of one of your own items, as cards grouped by where they
//  came from (shared by the custom studio and the item editor), and finding more
//  on the item's wiki pages.
// ─────────────────────────────────────────────────────────────────────────────
import type { ItemId, OwnItem, PictureChoice } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { html, type SafeHtml } from '../../lib/html';
import { getJSON } from '../../lib/net';
import { copyPick, pickSprite } from '../sprites/sprites';

/** Choices by group, in the order the groups first appear. */
export function groupChoices(choices: readonly PictureChoice[]): Map<string, PictureChoice[]> {
    const groups = new Map<string, PictureChoice[]>();
    for (const choice of choices) {
        const group = groups.get(choice.group);
        if (group) group.push(choice);
        else groups.set(choice.group, [choice]);
    }
    return groups;
}

/** Adds choices that aren't in the list yet (same address = same picture). */
export function mergeChoices(choices: readonly PictureChoice[], more: readonly PictureChoice[]): PictureChoice[] {
    const merged = [...choices];
    for (const choice of more) if (!merged.some((other) => other.url === choice.url)) merged.push(choice);
    return merged;
}

/** One clickable picture card; `currentPath` is the item's pick, so its card shows as chosen. */
export function choiceCard(choice: PictureChoice, currentPath: string | undefined): SafeHtml {
    const chosen = choice.url === currentPath || (choice.extraKey && currentPath === 'xp:' + choice.extraKey);
    return html`<div class="vc${chosen ? ' chosen' : ''}" data-u="${choice.url}"${choice.extraKey && html` data-xp="${choice.extraKey}"`}${choice.variantId && html` data-vid="${choice.variantId}"`} title="${choice.label || choice.group}"><div class="vimg"><img alt="" loading="lazy" src="${choice.url}" referrerpolicy="no-referrer" data-miss></div>${choice.label && html`<div class="vl">${choice.label}</div>`}</div>`;
}

/**
 * Uses the clicked card's picture for the item: one of your uploads, a variant's picture,
 * or (via `useAddress`) a web address. Marks the card chosen among `cards`.
 */
export async function useChoiceCard(
    card: HTMLElement,
    id: ItemId,
    cards: Iterable<Element>,
    useAddress: (url: string) => Promise<unknown> | undefined,
): Promise<void> {
    for (const other of cards) other.classList.toggle('chosen', other === card);
    if (card.dataset.xp) await pickSprite(id, 'xp:' + card.dataset.xp, { quiet: true });
    else if (card.dataset.vid) await copyPick(id, Number(card.dataset.vid));
    else await useAddress(card.dataset.u!);
}

// ═════════════════════════════════════════════════════════════════════════════
//  MORE FROM THE WIKI
// ═════════════════════════════════════════════════════════════════════════════

/** MediaWiki's answer: { query: { pages: [...] } } (anything else counts as no pages). */
const wikiPages = (answer: unknown): Record<string, unknown>[] =>
    isRecord(answer) && isRecord(answer.query) && Array.isArray(answer.query.pages) ? answer.query.pages.filter(isRecord) : [];

/** Every picture on an item's wiki page (and its versions' pages, up to 10), 150 per page at most. */
export async function wikiPicturesFor(item: OwnItem): Promise<PictureChoice[]> {
    const api = item.w?.a;
    if (!api || !item.w) return [];
    const versions = item.vars || [];
    const mainVersion = versions.find((version) => version.t === item.w!.t);
    const pages: [title: string, group: string][] = [
        [item.w.t, versions.length > 1 ? 'Wiki: ' + (mainVersion?.l || item.name) : 'On its wiki page'],
        ...versions
            .filter((version) => version.t && version.t !== item.w!.t)
            .slice(0, 10)
            .map((version): [string, string] => [version.t!, 'Wiki: ' + (version.l || version.t)]),
    ];
    const ask = (params: Record<string, string>) =>
        getJSON(api + '?' + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params }));
    const found: PictureChoice[] = [];
    for (const [title, group] of pages) {
        let files: string[];
        try {
            files = wikiPages(await ask({ titles: title, prop: 'images', imlimit: 'max', redirects: '1' }))
                .flatMap((page) => (Array.isArray(page.images) ? page.images.filter(isRecord) : []))
                .map((image) => String(image.title))
                .filter((file) => !/\.(svg|ogg|mp3|wav|webm|mp4|pdf)$/i.test(file));
        } catch {
            continue;
        }
        for (let start = 0; start < files.length && start < 150; start += 50) {
            try {
                const answer = await ask({
                    titles: files.slice(start, start + 50).join('|'),
                    prop: 'imageinfo',
                    iiprop: 'url',
                    iiurlwidth: '400',
                });
                for (const page of wikiPages(answer)) {
                    const info = Array.isArray(page.imageinfo) && isRecord(page.imageinfo[0]) ? page.imageinfo[0] : null;
                    const url = String(info?.thumburl || info?.url || '');
                    if (!/^https:\/\//.test(url)) continue;
                    const label = String(page.title)
                        .replace(/^[^:]+:/, '')
                        .replace(/\.[a-z0-9]+$/i, '')
                        .replace(/_/g, ' ');
                    found.push({ group, url, label });
                }
            } catch {}
        }
    }
    return found;
}
