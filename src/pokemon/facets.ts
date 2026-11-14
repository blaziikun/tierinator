// src/pokemon/facets.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What a Pokémon can be sorted by: type, generation, evolution stage, group
//  (starter line, legendary…) and form. The Focus bar filters by them and the
//  grid lays them out down and across, so both read them from here.
// ─────────────────────────────────────────────────────────────────────────────

import type { Entry, FacetKey, Focus } from '../core/types';
import { isRecord } from '../lib/checks';
import { POKEMON_TYPES } from './data';
import { CATEGORY_NAMES, evolutionStage, STAGE_NAMES, specialCategory } from './pokedex-extras';

export interface FacetValue {
    value: string;
    label: string;
}

export interface Facet {
    key: FacetKey;
    /** "Type", "Generation"… */
    label: string;
    values: readonly FacetValue[];
    /** The values a Pokémon has (two for a dual type; none for your own items). */
    of: (entry: Entry) => string[];
}

/** Stage keys, in the order of STAGE_NAMES (pokedex-extras.ts), which is how they're stored. */
const STAGE_KEYS = ['single', 'baby', 'first', 'middle', 'final'] as const;
/** Group keys, in the order of CATEGORY_NAMES. */
const GROUP_KEYS = ['regular', 'starter', 'pseudo', 'paradox', 'ultra', 'legendary', 'box', 'mythical'] as const;

const STAGE_ORDER = ['baby', 'first', 'middle', 'final', 'single'] as const;
const STAGE_LABELS: Record<(typeof STAGE_KEYS)[number], string> = {
    single: "Doesn't evolve",
    baby: 'Baby',
    first: 'First stage',
    middle: 'Middle stage',
    final: 'Final stage',
};

const FORM_VALUES: readonly FacetValue[] = [
    { value: 'standard', label: 'Standard' },
    { value: 'mega', label: 'Mega' },
    { value: 'gmax', label: 'Gigantamax' },
    { value: 'regional', label: 'Regional' },
    { value: 'battle', label: 'Battle form' },
    { value: 'cosmetic', label: 'Cosmetic' },
];

const keyOfName = <K extends string>(keys: readonly K[], names: readonly string[], name: string | null): K | undefined =>
    name == null ? undefined : keys[names.indexOf(name)];

export const FACETS: Record<FacetKey, Facet> = {
    type: {
        key: 'type',
        label: 'Type',
        values: POKEMON_TYPES.map((type) => ({ value: type, label: type })),
        of: (entry) => (entry.custom ? [] : entry.types.slice()),
    },
    gen: {
        key: 'gen',
        label: 'Generation',
        values: Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: 'Gen ' + (i + 1) })),
        of: (entry) => (!entry.custom && entry.gen > 0 ? [String(entry.gen)] : []),
    },
    stage: {
        key: 'stage',
        label: 'Stage',
        values: STAGE_ORDER.map((value) => ({ value, label: STAGE_LABELS[value] })),
        of: (entry) => {
            const key = keyOfName(STAGE_KEYS, STAGE_NAMES, evolutionStage(entry));
            return key ? [key] : [];
        },
    },
    group: {
        key: 'group',
        label: 'Group',
        values: GROUP_KEYS.map((value, i) => ({ value, label: CATEGORY_NAMES[i]! })),
        of: (entry) => {
            const key = keyOfName(GROUP_KEYS, CATEGORY_NAMES, specialCategory(entry));
            return key ? [key] : [];
        },
    },
    form: {
        key: 'form',
        label: 'Form',
        values: FORM_VALUES,
        of: (entry) => (entry.custom ? [] : [entry.form ?? 'standard']),
    },
};

export const FACET_KEYS = Object.keys(FACETS) as FacetKey[];

export const isFacetKey = (value: unknown): value is FacetKey => typeof value === 'string' && Object.hasOwn(FACETS, value);

/** A value's label ("Gen 4", "Final stage"), or the value itself if it's unknown. */
export const valueLabel = (facet: FacetKey, value: string): string => FACETS[facet].values.find((v) => v.value === value)?.label ?? value;

/** Common sets of stages, offered as one click. */
export const STAGE_SHORTCUTS: readonly { label: string; title: string; values: readonly string[] }[] = [
    {
        label: 'Unevolved',
        title: "Not evolved from anything: babies, first stages and Pokémon that don't evolve",
        values: ['baby', 'first', 'single'],
    },
    { label: 'Fully evolved', title: "Can't evolve any further: final stages and Pokémon that don't evolve", values: ['final', 'single'] },
];

// ═════════════════════════════════════════════════════════════════════════════
//  FOCUS
// ═════════════════════════════════════════════════════════════════════════════

export const isFocusEmpty = (focus: Focus): boolean => !focus.only && FACET_KEYS.every((key) => !focus[key]?.length);

/** True if the Pokémon matches every facet that has values chosen (any one of them), and `only`. */
export function matchesFocus(entry: Entry, focus: Focus): boolean {
    if (focus.only && !focus.only.ids.includes(entry.id)) return false;
    for (const key of FACET_KEYS) {
        const wanted = focus[key];
        if (!wanted?.length) continue;
        const has = FACETS[key].of(entry);
        if (!has.some((value) => wanted.includes(value))) return false;
    }
    return true;
}

/** "Electric or Ghost · Gen 4 · Fully evolved": what the focus shows, in words. */
export function focusSummary(focus: Focus): string {
    const parts: string[] = [];
    if (focus.only) parts.push(focus.only.label);
    for (const key of FACET_KEYS) {
        const values = focus[key];
        if (!values?.length) continue;
        const shortcut = key === 'stage' && STAGE_SHORTCUTS.find((s) => sameSet(s.values, values));
        parts.push(shortcut ? shortcut.label : values.map((value) => valueLabel(key, value)).join(' or '));
    }
    return parts.join(' · ');
}

export const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/** A focus read from a file or undo history: known facets and values only, and never `only`. */
export function readFocus(raw: unknown): Focus {
    const focus: Focus = {};
    if (!isRecord(raw)) return focus;
    for (const key of FACET_KEYS) {
        const values = raw[key];
        if (!Array.isArray(values)) continue;
        const known = FACETS[key].values.map((v) => v.value);
        const kept = [...new Set(values.filter((v): v is string => typeof v === 'string' && known.includes(v)))];
        if (kept.length) focus[key] = kept;
    }
    return focus;
}

/** Facet values that are known, without repeats (a grid's chosen rows or columns). */
export const readValues = (facet: FacetKey, raw: unknown): string[] => {
    const known = FACETS[facet].values.map((v) => v.value);
    return Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && known.includes(v)))] : [];
};
