// src/lib/html.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Safe HTML. The only way the app puts markup on the page.
//
//    setHtml(list, html`<b>${name}</b> has ${count} items`);
//
//  Every ${value} is escaped, so a name like  <img src=x onerror=alert(1)>  shows up
//  as text instead of running. Nested html`` templates (and arrays of them) are
//  inserted as-is because they were escaped when they were built.
//
//  On browsers that support Trusted Types, the site's security policy also makes
//  any *other* way of assigning innerHTML throw, so a forgotten escape can't slip in.
// ─────────────────────────────────────────────────────────────────────────────
import { escapeHtml } from './dom';

/** Markup that is known to be safe because it was built by html``. */
export class SafeHtml {
    constructor(readonly value: string) {}
    toString(): string {
        return this.value;
    }
}

/** Anything a template can hold. false, null and undefined render nothing (handy for `${on && html`…`}`). */
export type HtmlPart = SafeHtml | string | number | boolean | null | undefined | readonly HtmlPart[];

function render(part: HtmlPart): string {
    if (part == null || part === false || part === true) return '';
    if (part instanceof SafeHtml) return part.value;
    if (Array.isArray(part)) return part.map(render).join('');
    return escapeHtml(part);
}

/** Builds HTML; every interpolated value is escaped unless it is already SafeHtml. */
export function html(strings: TemplateStringsArray, ...parts: HtmlPart[]): SafeHtml {
    let out = strings[0]!;
    parts.forEach((part, i) => {
        out += render(part) + strings[i + 1]!;
    });
    return new SafeHtml(out);
}

/** Joins pieces of HTML with a separator (like Array.join, but stays safe). */
export const joinHtml = (parts: readonly HtmlPart[], separator: HtmlPart = ''): SafeHtml =>
    new SafeHtml(parts.map(render).join(render(separator)));

// ── putting it on the page ──
interface TrustedTypePolicy {
    createHTML(input: string): unknown;
}
const policy: TrustedTypePolicy | null =
    (
        globalThis as { trustedTypes?: { createPolicy(name: string, rules: { createHTML(s: string): string }): TrustedTypePolicy } }
    ).trustedTypes?.createPolicy('tierinator-html', { createHTML: (s) => s }) ?? null;

/** Replaces an element's contents with safe HTML. */
export function setHtml(element: Element, content: SafeHtml): void {
    element.innerHTML = (policy ? policy.createHTML(content.value) : content.value) as string;
}

/** A link address that can't run code: only http(s) and same-site links, everything else becomes "#". */
export function safeUrl(url: string): string {
    const text = String(url || '').trim();
    if (text.includes('\\')) return '#'; // browsers read "/\evil.example" as "//evil.example"
    if (/^https?:\/\//i.test(text) || /^\/(?!\/)/.test(text) || text.startsWith('#')) return text;
    return '#';
}
