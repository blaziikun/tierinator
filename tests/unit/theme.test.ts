// The look a list was saved with comes back exactly, including lists saved with the light theme that used to be built in.
import { describe, expect, it, vi } from 'vitest';
import { createListState, DEFAULT_THEME } from '../../src/core/defaults';
import { readStored, toStored } from '../../src/core/snapshot';
import { sanitizeTheme } from '../../src/features/appearance/theme';

// theme.ts also draws the look on screen; only its checking is tested here, so the screens it would reach are stood in for
vi.mock('../../src/features/appearance/panel', () => ({ themeLibrary: [] }));
vi.mock('../../src/features/layout/top-bar', () => ({ renderListButton: () => {} }));
vi.mock('../../src/features/tags/tags', () => ({ syncTagDotsButton: () => {} }));
vi.mock('../../src/features/tier-board/board', () => ({ measureRowWidth: () => {} }));

/** The light theme as lists saved it, before the site went dark only: every value stored in full. */
const OLD_LIGHT_THEME = {
    preset: 'light',
    name: 'Tierinator',
    bg: '#f6f6f4',
    panel: '#ffffff',
    text: '#151517',
    muted: '#6c6c73',
    accent: '#151517',
    hi: '#151517',
    fHead: 'Playfair Display',
    fUi: 'Geist Mono',
    wLogo: 600,
    wLabel: 500,
    wHead: 500,
    wUi: 400,
    logo: 'text',
    radius: 3,
    ls: -0.02,
    tt: 'none',
    fs: 12,
    fsLogo: 20,
    fsLabel: 16,
    lw: 88,
    gap: 2,
    rowBg: '',
    tint: 0.14,
    lblColor: '',
    lblFs: 7,
    lblGap: 0,
    tagDots: true,
};

const exists = (id: number) => id >= 1 && id <= 2000;
let n = 0;
const makeId = () => 'new' + n++;

describe('a list saved with the old light theme', () => {
    it('opens with every colour and size it was saved with', () => {
        const file = {
            app: 'tierlist',
            v: 10,
            tiers: [{ id: 'a', label: 'S', sub: '', color: '#65e3f9', items: [25] }],
            sz: 88,
            theme: OLD_LIGHT_THEME,
        };
        const read = readStored(file, exists, makeId);
        const theme = sanitizeTheme(read.theme);
        const { preset, ...values } = OLD_LIGHT_THEME;
        expect(theme).toMatchObject(values);
        // there's no built-in light theme to point at any more: it counts as an edited copy of the built-in look
        expect(theme.preset).toBe('default');
        expect(preset).toBe('light');
    });

    it('keeps looking the same after saving it again', () => {
        const state = createListState();
        state.theme = sanitizeTheme(OLD_LIGHT_THEME);
        const again = sanitizeTheme(readStored(JSON.parse(JSON.stringify(toStored(state, 'Light list'))), exists, makeId).theme);
        expect(again).toEqual(state.theme);
        expect(again.bg).toBe('#f6f6f4');
    });
});

describe('a list saved with the built-in look before its interface font changed', () => {
    /** The built-in dark theme as lists stored it while the interface was set in Geist Mono at 12 px. */
    const OLD_DARK_THEME = {
        ...OLD_LIGHT_THEME,
        preset: 'default',
        bg: '#0b0b0c',
        panel: '#141416',
        text: '#ededee',
        muted: '#8c8c93',
        tint: 0.06,
    };

    it('keeps the font and size it was saved with', () => {
        const file = {
            app: 'tierlist',
            v: 10,
            tiers: [{ id: 'a', label: 'S', sub: '', color: '#65e3f9', items: [25] }],
            sz: 88,
            theme: OLD_DARK_THEME,
        };
        const theme = sanitizeTheme(readStored(file, exists, makeId).theme);
        expect(theme).toMatchObject({ fUi: 'Geist Mono', wUi: 400, fs: 12, fHead: 'Playfair Display', preset: 'default' });
    });

    it('stays that way after saving it again', () => {
        const state = createListState();
        state.theme = sanitizeTheme(OLD_DARK_THEME);
        const again = sanitizeTheme(readStored(JSON.parse(JSON.stringify(toStored(state, 'Old list'))), exists, makeId).theme);
        expect(again).toEqual(state.theme);
        expect(again.fUi).toBe('Geist Mono');
    });
});

describe('a new list', () => {
    it('starts in the built-in dark look', () => {
        expect(createListState().theme).toEqual(DEFAULT_THEME);
        expect(DEFAULT_THEME).toMatchObject({ preset: 'default', bg: '#0b0b0c', text: '#ededee' });
    });

    it('sets the interface in Instrument Sans, a font the site serves itself', () => {
        expect(DEFAULT_THEME).toMatchObject({ fUi: 'Instrument Sans', wUi: 400, fs: 13, fHead: 'Playfair Display' });
        expect(sanitizeTheme(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
    });
});
