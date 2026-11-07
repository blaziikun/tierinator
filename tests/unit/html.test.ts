// The html`` helper must escape everything that isn't already safe markup.
import { describe, expect, it } from 'vitest';
import { html, joinHtml, safeUrl } from '../../src/lib/html';

describe('html``', () => {
    it('escapes text, so a booby-trapped name shows as text', () => {
        const name = '<img src=x onerror=alert(1)>';
        expect(html`<b>${name}</b>`.value).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
    });
    it('escapes quotes, so a value cannot break out of an attribute', () => {
        expect(html`<div title="${'" onmouseover="alert(1)'}">`.value).toBe('<div title="&quot; onmouseover=&quot;alert(1)">');
    });
    it('keeps nested templates and arrays of them as markup', () => {
        const rows = ['a', '<b>'].map((x) => html`<li>${x}</li>`);
        expect(html`<ul>${rows}</ul>`.value).toBe('<ul><li>a</li><li>&lt;b&gt;</li></ul>');
    });
    it('renders nothing for false, null and undefined, and numbers as text', () => {
        expect(html`${false}${null}${undefined}${0}${12}`.value).toBe('012');
    });
    it('joins with a separator', () => {
        expect(joinHtml([html`<i>1</i>`, '2<'], ', ').value).toBe('<i>1</i>, 2&lt;');
    });
});

describe('safeUrl', () => {
    it('allows web and same-site links', () => {
        expect(safeUrl('https://bakugan.fandom.com/wiki/Drago')).toBe('https://bakugan.fandom.com/wiki/Drago');
        expect(safeUrl('/packs/pokemon.json')).toBe('/packs/pokemon.json');
    });
    it('blocks links that would run code or leave for another scheme', () => {
        for (const url of [
            'javascript:alert(1)',
            ' JavaScript:alert(1)',
            'data:text/html,<script>',
            '//evil.example',
            '/\\evil.example',
            'vbscript:x',
        ])
            expect(safeUrl(url)).toBe('#');
    });
});
