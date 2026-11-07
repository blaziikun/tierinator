// tests/e2e/injection.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What the injection tests type into the app, and how they notice if any of it
//  became markup or ran. Every attack sets window.__xssRan if it ever runs, and
//  carries "xss-probe" in a tag, an attribute name or a picture address, so an
//  attack that became markup is caught even when the security policy then stops
//  it running. The watcher (installed before the page's own scripts) records:
//    - any element an attack could only have made: an inline on… handler, a
//      javascript: address, srcdoc, a script, frame or object the app didn't load
//    - every securitypolicyviolation event (the app on its own causes none)
//    - any request for the probe picture
// ─────────────────────────────────────────────────────────────────────────────
import { type BrowserContext, expect, type Page } from '@playwright/test';

/** One attack per line; each fits the shortest text field (a tier label: 40 characters). */
export const ATTACKS = [
    '<img src=xss-probe onerror=__xssRan=1>',
    '<script>__xssRan=1</script>',
    '<svg onload=__xssRan=1><xss-probe>',
    '"><b data-xss-probe onclick=__xssRan=1>',
    "'><img src=xss-probe onerror=__xssRan=1>",
    'javascript:__xssRan=1',
    '<a href=javascript:__xssRan=1>xss-probe',
    '<iframe srcdoc="<script>__xssRan=1">',
    '</textarea><img src=xss-probe onerror=1',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template syntax, as an attack on anything that evaluates it
    '${__xssRan=1}{{__xssRan=1}}',
];

interface Watch {
    __xssRan?: unknown;
    __injected: string[];
    __violations: string[];
}

/** Starts watching every page in this context, from before its first script. */
export async function watchForInjection(context: BrowserContext): Promise<{ probeRequests: string[] }> {
    const probeRequests: string[] = [];
    context.on('request', (request) => {
        // only what markup loads by itself: a page address or a search the app makes may carry typed text, as text
        if (request.url().includes('xss-probe') && !['document', 'fetch', 'xhr'].includes(request.resourceType())) {
            probeRequests.push(request.url());
        }
    });
    await context.addInitScript(() => {
        const watch = window as unknown as Watch;
        watch.__injected = [];
        watch.__violations = [];
        document.addEventListener(
            'securitypolicyviolation',
            (event) => watch.__violations.push(`${event.effectiveDirective}: ${event.blockedURI || 'inline'} ${event.sample}`.trim()),
            true,
        );
        const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster']);
        const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'form']);
        // the app's own scripts: Vite's module scripts from this site, with no text inside
        const isAppScript = (element: Element): boolean =>
            element.localName === 'script' && /^\/(assets|src)\//.test(element.getAttribute('src') ?? '') && !element.textContent;
        const isInjected = (element: Element): boolean =>
            element.localName.includes('xss') ||
            (ACTIVE_TAGS.has(element.localName) && !isAppScript(element)) ||
            [...element.attributes].some(
                (attribute) =>
                    attribute.name.startsWith('on') ||
                    attribute.name.includes('xss') ||
                    attribute.name === 'srcdoc' ||
                    (URL_ATTRIBUTES.has(attribute.name) && /^\s*javascript:/i.test(attribute.value)),
            );
        const record = (element: Element): void => {
            if (isInjected(element))
                watch.__injected.push(`<${element.localName} ${[...element.attributes].map((a) => a.name).join(' ')}>`);
        };
        new MutationObserver((changes) => {
            for (const change of changes) {
                if (change.type === 'attributes' && change.target instanceof Element) record(change.target);
                for (const node of change.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    record(node);
                    for (const inside of node.querySelectorAll('*')) record(inside);
                }
            }
        }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    return { probeRequests };
}

/** Nothing ran, nothing became markup, nothing was blocked, and the probe picture was never asked for. */
export async function expectNothingInjected(page: Page, probeRequests: string[]): Promise<void> {
    const report = await page.evaluate(() => {
        const watch = window as unknown as Watch;
        return { ran: watch.__xssRan !== undefined, injected: watch.__injected, violations: watch.__violations };
    });
    expect(report).toEqual({ ran: false, injected: [], violations: [] });
    expect(probeRequests).toEqual([]);
}
