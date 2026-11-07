// src/core/template-format.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Reading template files (public/templates, docs/templates.md) safely. Anyone can
//  propose one, so every field is checked and capped, unknown fields are dropped,
//  and a file that isn't a template is refused whole.
//
//    readTemplateIndex(raw)   the catalogue, index.json   → TemplateEntry[] | null
//    readTemplate(raw)        one template, <id>.json      → Template | null
// ─────────────────────────────────────────────────────────────────────────────
import { isRecord } from '../lib/checks';
import { isKnownPictureAddress } from './picture-sites';

/** Enough for every US state or every country; a list much longer than this is no fun to rank. */
export const MAX_TEMPLATE_ITEMS = 300;
const MAX_TEMPLATES = 2000;
const MAX_TIERS = 20;

/** One template in the catalogue. */
export interface TemplateEntry {
    id: string;
    title: string;
    category: string;
    /** How many items it has (shown on its card). */
    count: number;
    description?: string;
}

/** Something to rank: a name, with the Wikipedia page or https address its picture comes from. */
export interface TemplateItem {
    name: string;
    /** An English Wikipedia page title. */
    wiki?: string;
    image?: string;
}

export interface Template {
    format: 'tierinator-template';
    version: 1;
    id: string;
    title: string;
    category: string;
    description?: string;
    /** Tier labels, top first; without them the list gets the usual tiers. */
    tiers?: string[];
    items: TemplateItem[];
}

// ── small checks ──
/** Trimmed text without control characters, at most `max` long ('' if it isn't text). */
const cleanText = (value: unknown, max: number): string =>
    typeof value === 'string'
        ? value
              // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
              .replace(/[\u0000-\u001f\u007f]/g, '')
              .trim()
              .slice(0, max)
              .trim()
        : '';

/** Lower-case words joined by single hyphens: safe in an address (templates/<id>.json) and a file name. */
export const isTemplateId = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);

/**
 * A page title MediaWiki would accept, or ''. "|" matters most: it separates the titles
 * of a batched request, so one in a title would ask about another page.
 */
function readWikiTitle(value: unknown): string {
    if (typeof value !== 'string' || value.length > 250) return '';
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused, not kept
    if (/[#<>[\]{}|\u0000-\u001f\u007f]/.test(value)) return '';
    return value.trim();
}

const readImage = (value: unknown): string =>
    typeof value === 'string' && value.length <= 1000 && isKnownPictureAddress(value) ? value : '';

// ═════════════════════════════════════════════════════════════════════════════
//  THE CATALOGUE
// ═════════════════════════════════════════════════════════════════════════════

function readEntry(raw: unknown): TemplateEntry | null {
    if (!isRecord(raw) || !isTemplateId(raw.id)) return null;
    const title = cleanText(raw.title, 60);
    const count = raw.count;
    if (!title || !Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_TEMPLATE_ITEMS) return null;
    const entry: TemplateEntry = { id: raw.id, title, category: cleanText(raw.category, 40) || 'Other', count: count as number };
    const description = cleanText(raw.description, 300);
    if (description) entry.description = description;
    return entry;
}

/** The catalogue, checked: broken entries and repeated ids are left out. Null if it isn't a list. */
export function readTemplateIndex(raw: unknown): TemplateEntry[] | null {
    if (!Array.isArray(raw)) return null;
    const seen = new Set<string>();
    const entries: TemplateEntry[] = [];
    for (const item of raw.slice(0, MAX_TEMPLATES)) {
        const entry = readEntry(item);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
    }
    return entries;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ONE TEMPLATE
// ═════════════════════════════════════════════════════════════════════════════

function readItem(raw: unknown): TemplateItem | null {
    if (!isRecord(raw)) return null;
    const name = cleanText(raw.name, 80);
    if (!name) return null;
    const item: TemplateItem = { name };
    const wiki = readWikiTitle(raw.wiki);
    if (wiki) item.wiki = wiki;
    const image = readImage(raw.image);
    if (image) item.image = image;
    return item;
}

/** A template, checked; null if it isn't one (or has nothing to rank). */
export function readTemplate(raw: unknown): Template | null {
    if (!isRecord(raw) || raw.format !== 'tierinator-template' || raw.version !== 1 || !isTemplateId(raw.id)) return null;
    const title = cleanText(raw.title, 60);
    if (!title || !Array.isArray(raw.items)) return null;
    const items = raw.items
        .slice(0, MAX_TEMPLATE_ITEMS)
        .map(readItem)
        .filter((item): item is TemplateItem => item !== null);
    if (!items.length) return null;
    const template: Template = {
        format: 'tierinator-template',
        version: 1,
        id: raw.id,
        title,
        category: cleanText(raw.category, 40) || 'Other',
        items,
    };
    const description = cleanText(raw.description, 300);
    if (description) template.description = description;
    if (Array.isArray(raw.tiers)) {
        const tiers = raw.tiers
            .slice(0, MAX_TIERS)
            .map((label) => cleanText(label, 40))
            .filter(Boolean);
        if (tiers.length) template.tiers = tiers;
    }
    return template;
}
