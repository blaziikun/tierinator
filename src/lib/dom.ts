// src/lib/dom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Small helpers for the page itself: finding elements, escaping text, dates,
//  downloads. No app knowledge lives here.
// ─────────────────────────────────────────────────────────────────────────────

/** The element with this id. Throws if it isn't on the page: every id the code asks for exists. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`#${id} is not on the page`);
    return element as T;
}

/** The element with this id, or null for elements that only exist some of the time. */
export function findById<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to put inside HTML (as content or inside a quoted attribute). */
export const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/** 7 → "007" (Pokédex numbers). */
export const pad3 = (n: number | string): string => String(n).padStart(3, '0');

/** A short random id for tiers, lists and items (not for anything security-related). */
export const randomId = (): string => Math.random().toString(36).slice(2, 9);

/** Lets the browser draw a frame before a long loop continues. */
export const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** "mr-mime" → "Mr Mime". */
export const prettyName = (slug: string): string =>
    String(slug)
        .split('-')
        .filter(Boolean)
        .map((word) => word[0]!.toUpperCase() + word.slice(1))
        .join(' ');

/** Saves a file to the person's computer. */
export function downloadBlob(blob: Blob, fileName: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

/** Today as 2026-11-03 (for file names). */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** The small status text in the pool header. */
export const setStatus = (text: string): void => {
    byId('status').textContent = text;
};
