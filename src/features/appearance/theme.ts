// src/features/appearance/theme.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Applying a theme: fonts (loaded from Google Fonts on demand), colours turned
//  into the CSS variables every stylesheet uses, the logo, and theme clean-up.
//  The Appearance drawer that edits themes is panel.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_THEME } from '../../core/defaults';
import { findTier, state } from '../../core/state';
import type { Theme, Tier } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { contrastRatio, isHexColor, luminance, mixRgb, readableTextOn, rgbToHex } from '../../lib/color';
import { byId } from '../../lib/dom';
import { html, type SafeHtml, setHtml } from '../../lib/html';
import { renderListButton } from '../layout/top-bar';
import { syncTagDotsButton } from '../tags/tags';
import { measureRowWidth } from '../tier-board/board';
import { themeLibrary } from './panel';

// ═════════════════════════════════════════════════════════════════════════════
//  FONTS
// ═════════════════════════════════════════════════════════════════════════════

export type FontCategory = 'sans' | 'serif' | 'mono' | 'pixel' | 'sys';
/** A Google font: either a variable weight range, or the fixed weights that exist. */
interface FontInfo {
    v?: [number, number];
    w?: number[];
    c: FontCategory;
}

export const FONTS: Record<string, FontInfo> = {
    'Chakra Petch': { w: [300, 400, 500, 600, 700], c: 'sans' },
    Inter: { v: [100, 900], c: 'sans' },
    Geist: { v: [100, 900], c: 'sans' },
    'Instrument Sans': { v: [400, 700], c: 'sans' },
    'Space Grotesk': { v: [300, 700], c: 'sans' },
    Sora: { v: [100, 800], c: 'sans' },
    Outfit: { v: [100, 900], c: 'sans' },
    Manrope: { v: [200, 800], c: 'sans' },
    'Plus Jakarta Sans': { v: [200, 800], c: 'sans' },
    'DM Sans': { v: [100, 900], c: 'sans' },
    Figtree: { v: [300, 900], c: 'sans' },
    'Bricolage Grotesque': { v: [200, 800], c: 'sans' },
    Syne: { v: [400, 800], c: 'sans' },
    Unbounded: { v: [200, 900], c: 'sans' },
    Archivo: { v: [100, 900], c: 'sans' },
    Montserrat: { v: [100, 900], c: 'sans' },
    Poppins: { w: [100, 200, 300, 400, 500, 600, 700, 800, 900], c: 'sans' },
    'Bebas Neue': { w: [400], c: 'sans' },
    Anton: { w: [400], c: 'sans' },
    Fraunces: { v: [100, 900], c: 'serif' },
    'Playfair Display': { v: [400, 900], c: 'serif' },
    'Instrument Serif': { w: [400], c: 'serif' },
    'DM Serif Display': { w: [400], c: 'serif' },
    'Cormorant Garamond': { w: [300, 400, 500, 600, 700], c: 'serif' },
    'DM Mono': { w: [300, 400, 500], c: 'mono' },
    'JetBrains Mono': { v: [100, 800], c: 'mono' },
    'IBM Plex Mono': { w: [100, 200, 300, 400, 500, 600, 700], c: 'mono' },
    'Space Mono': { w: [400, 700], c: 'mono' },
    'Geist Mono': { v: [100, 900], c: 'mono' },
    Silkscreen: { w: [400, 700], c: 'pixel' },
    'Press Start 2P': { w: [400], c: 'pixel' },
    VT323: { w: [400], c: 'pixel' },
    System: { w: [300, 400, 500, 600, 700, 800, 900], c: 'sys' },
};
export const FONT_CATEGORIES: Record<FontCategory, string> = {
    sans: 'Sans-serif',
    serif: 'Serif',
    mono: 'Monospace',
    pixel: 'Pixel / retro',
    sys: 'Device default',
};
export const WEIGHT_NAMES: Record<number, string> = {
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'Semibold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black',
};

/** A font I offer. Own keys only: a name like "constructor" or "__proto__" from a file must not count as one. */
const knownFont = (font: unknown): FontInfo | undefined =>
    typeof font === 'string' && Object.hasOwn(FONTS, font) ? FONTS[font] : undefined;
const fontInfo = (font: string): FontInfo => knownFont(font) || FONTS.System!;

/** The weights a font actually has. */
export const fontWeights = (font: string): number[] => {
    const info = fontInfo(font);
    if (info.w) return info.w;
    const weights: number[] = [];
    for (let w = 100; w <= 900; w += 100) if (w >= info.v![0] && w <= info.v![1]) weights.push(w);
    return weights;
};
export const nearestWeight = (font: string, weight: number): number =>
    fontWeights(font).reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));

/** CSS font-family for a font, with sensible fall-backs while it loads. */
export const fontStack = (font: string): string => {
    const { c } = fontInfo(font);
    if (c === 'sys') return 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    const fallback =
        c === 'mono' || c === 'pixel'
            ? 'ui-monospace,Menlo,monospace'
            : c === 'serif'
              ? 'Georgia,"Times New Roman",serif'
              : 'system-ui,-apple-system,"Segoe UI",sans-serif';
    return `'${font}',${fallback}`;
};

export function googleFontUrl(font: string): string | null {
    const info = knownFont(font);
    if (!info || info.c === 'sys') return null;
    const axis = info.v ? `:wght@${info.v[0]}..${info.v[1]}` : info.w!.length > 1 || info.w![0] !== 400 ? `:wght@${info.w!.join(';')}` : '';
    return `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}${axis}&display=swap`;
}

/** Served by the site itself (styles/base.css), so most visits never contact Google. */
const SELF_HOSTED_FONTS = new Set(['Playfair Display', 'Instrument Sans', 'Geist Mono']);
const loadedFonts = new Set<string>();
/** Makes a font available: built in, self-hosted, or from Google Fonts the first time it's used. */
export function loadFont(font: string): void {
    const url = googleFontUrl(font);
    if (!url || loadedFonts.has(font) || SELF_HOSTED_FONTS.has(font)) return;
    loadedFonts.add(font);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.append(link);
}

// ═════════════════════════════════════════════════════════════════════════════
//  THEME
// ═════════════════════════════════════════════════════════════════════════════

/** Tier label text in the theme's letter case. */
export const applyLabelCase = (text: string): string => {
    const mode = state.theme.tt;
    if (mode === 'uppercase') return String(text).toUpperCase();
    if (mode === 'lowercase') return String(text).toLowerCase();
    if (mode === 'capitalize') return String(text).replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    return String(text);
};

/** A theme from a file or your library, with every value checked and kept in range. */
export function sanitizeTheme(raw: unknown): Theme {
    const given: Record<string, unknown> = isRecord(raw) ? raw : {};
    // only the fields a theme has: anything else in a file is dropped
    const theme = Object.fromEntries(
        Object.entries(DEFAULT_THEME).map(([key, fallback]) => [key, given[key] ?? fallback]),
    ) as unknown as Theme;
    for (const key of ['bg', 'panel', 'text', 'muted', 'accent', 'hi'] as const)
        if (!isHexColor(theme[key])) theme[key] = DEFAULT_THEME[key];
    for (const key of ['rowBg', 'lblColor'] as const) if (!isHexColor(theme[key])) theme[key] = '';
    for (const key of ['fHead', 'fUi'] as const) if (!knownFont(theme[key])) theme[key] = DEFAULT_THEME[key];
    const keepInRange = (
        key: 'tint' | 'lblFs' | 'lblGap' | 'fs' | 'fsLogo' | 'fsLabel' | 'radius' | 'lw' | 'gap',
        min: number,
        max: number,
    ) => {
        const value = Number(theme[key]);
        theme[key] = Math.max(min, Math.min(max, Number.isFinite(value) ? value : DEFAULT_THEME[key]));
    };
    keepInRange('tint', 0, 1);
    keepInRange('lblFs', 6, 20);
    keepInRange('lblGap', -8, 16);
    theme.tagDots = theme.tagDots !== false;
    keepInRange('fs', 11, 16);
    keepInRange('fsLogo', 12, 34);
    keepInRange('fsLabel', 10, 36);
    keepInRange('radius', 0, 20);
    keepInRange('lw', 70, 260);
    keepInRange('gap', 0, 16);
    theme.ls = Math.max(-0.06, Math.min(0.2, Number(theme.ls) || 0));
    for (const key of ['wLogo', 'wLabel', 'wHead'] as const) theme[key] = nearestWeight(theme.fHead, Number(theme[key]) || 700);
    theme.wUi = nearestWeight(theme.fUi, Number(theme.wUi) || 400);
    if (!['two', 'gradient', 'accent', 'text'].includes(theme.logo)) theme.logo = 'two';
    if (!['none', 'uppercase', 'lowercase', 'capitalize'].includes(theme.tt)) theme.tt = 'none';
    theme.name = String(theme.name ?? 'Tierinator').slice(0, 40);
    // a theme that isn't in this browser's library (another person's, or the light one that used to be built in)
    // keeps every value and counts as an edited copy of the built-in look
    if (theme.preset !== 'default' && !themeLibrary.some((t) => t.id === theme.preset)) theme.preset = 'default';
    return theme;
}

/** The site name as logo markup; the "two colours" style splits it at its last capital ("Poké|Rank") or first space. */
export function logoParts(name: string): SafeHtml {
    if (state.theme.logo !== 'two') return html`<span>${name}</span>`;
    let split = -1;
    for (let k = name.length - 1; k > 0; k--) {
        if (/\p{Lu}/u.test(name[k]!) && name[k - 1] !== ' ') {
            split = k;
            break;
        }
    }
    if (split < 0) {
        const space = name.indexOf(' ');
        split = space > 0 ? space : Math.ceil(name.length / 2);
    }
    return html`<span class="l1">${name.slice(0, split)}</span><span class="l2">${name.slice(split)}</span>`;
}

export function renderLogo(): void {
    const logo = byId('logo');
    logo.className = 'logo ' + state.theme.logo;
    renderListButton();
    setHtml(logo, logoParts(state.theme.name || 'Tier list'));
}

/** A tier row's background: the row colour (or page background) tinted toward the tier colour. */
export const rowBackground = (tierColor: string): string =>
    rgbToHex(mixRgb(state.theme.rowBg || state.theme.bg, tierColor, state.theme.tint));

/** A tier label's text colour: the tier's own, the theme's, or whatever reads best on the tier colour. */
export const labelTextColor = (tier: Tier): string =>
    isHexColor(tier.textColor) ? tier.textColor : isHexColor(state.theme.lblColor) ? state.theme.lblColor : readableTextOn(tier.color);

/** Puts the open list's theme on the page (CSS variables, fonts, logo, title, tier rows). */
export function applyTheme(): void {
    const theme = state.theme;
    const style = document.documentElement.style;
    const set = (name: string, value: string | number) => style.setProperty(name, String(value));
    const light = luminance(theme.bg) > 0.5;
    set('--bg', theme.bg);
    set('--s1', theme.panel);
    set('--s2', rgbToHex(mixRgb(theme.panel, theme.text, light ? 0.045 : 0.055)));
    set('--s3', rgbToHex(mixRgb(theme.panel, theme.text, light ? 0.1 : 0.13)));
    // text that wouldn't be readable on the page or the panels is swapped for black or white
    // (the theme keeps its own colour; only what's shown changes)
    const readsWell = (colour: string, minimum: number) =>
        Math.min(contrastRatio(colour, theme.bg), contrastRatio(colour, theme.panel)) >= minimum;
    const fallback = readableTextOn(theme.panel);
    set('--text', readsWell(theme.text, 3) ? theme.text : fallback);
    set('--muted', readsWell(theme.muted, 1.8) ? theme.muted : rgbToHex(mixRgb(fallback, theme.panel, 0.4)));
    set('--accent', theme.accent);
    set('--on-accent', readableTextOn(theme.accent));
    set('--cyan', theme.hi);
    set('--on-cyan', readableTextOn(theme.hi));
    set('--shadow', light ? 'rgba(20,20,30,.14)' : 'rgba(0,0,0,.5)');
    set('--overlay', light ? 'rgba(25,25,35,.32)' : 'rgba(0,0,0,.72)');
    loadFont(theme.fHead);
    loadFont(theme.fUi);
    set('--font-head', fontStack(theme.fHead));
    set('--font-ui', fontStack(theme.fUi));
    set('--w-logo', theme.wLogo);
    set('--w-label', theme.wLabel);
    set('--w-head', theme.wHead);
    set('--w-ui', theme.wUi);
    set('--w-strong', nearestWeight(theme.fUi, Math.min(900, theme.wUi + 200)));
    set('--fs', theme.fs + 'px');
    set('--fs-logo', theme.fsLogo + 'px');
    set('--fs-label', theme.fsLabel + 'px');
    set('--ls-label', theme.ls + 'em');
    set('--tt-label', theme.tt);
    set('--lbl-fs', theme.lblFs + 'px');
    set('--lbl-gap', theme.lblGap + 'px');
    document.body.classList.toggle('notagdots', !theme.tagDots);
    syncTagDotsButton();
    set('--r', theme.radius + 'px');
    set('--lw', theme.lw + 'px');
    set('--rowgap', theme.gap + 'px');
    document.body.style.backgroundColor = theme.bg;
    style.colorScheme = light ? 'light' : 'dark';
    renderLogo();
    document.title = theme.name || 'Tier list';
    document.querySelectorAll<HTMLElement>('.trow').forEach((row) => {
        const tier = findTier(row.dataset.tid!);
        if (tier) row.querySelector<HTMLElement>('.tcont')!.style.background = rowBackground(tier.color);
    });
    setTimeout(measureRowWidth, 60);
}
