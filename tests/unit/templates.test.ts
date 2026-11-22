// Every template in public/templates is a clean, readable file that matches the catalogue, so a bad pull request fails here.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readTemplate, readTemplateIndex } from '../../src/core/template-format';

const FOLDER = new URL('../../public/templates/', import.meta.url);
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FOLDER), 'utf8'));

const index = load('index.json');
const templateFiles = readdirSync(FOLDER)
    .filter((name) => name !== 'index.json')
    .sort();

/** The categories the guide lists ("One of the existing categories (A, B, …)"), so the gallery's filter stays short and documented. */
const guide = readFileSync(new URL('../../docs/templates.md', import.meta.url), 'utf8');
const documentedCategories = (guide.match(/One of the existing categories \(([^)]+)\)/)?.[1] ?? '').split(', ');

describe('the catalogue (index.json)', () => {
    it('reads back unchanged: no broken or repeated entries, nothing over the limits', () => {
        expect(readTemplateIndex(index)).toEqual(index);
    });

    it('lists every template file exactly once, and nothing else is in the folder', () => {
        const ids = (index as { id: string }[]).map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.map((id) => id + '.json').sort()).toEqual(templateFiles);
        expect(templateFiles.every((name) => name.endsWith('.json'))).toBe(true);
    });
});

describe.each(templateFiles)('%s', (fileName) => {
    const raw = load(fileName) as Record<string, unknown>;
    const template = readTemplate(raw);
    const entry = (index as Record<string, unknown>[]).find((candidate) => candidate.id + '.json' === fileName);

    it('is a template, and the checker keeps every field (nothing unknown, too long or on an unknown picture site)', () => {
        expect(template).not.toBeNull();
        expect(template).toEqual(raw);
    });

    it('matches its catalogue entry', () => {
        expect(entry).toBeDefined();
        expect({ id: template?.id, title: template?.title, category: template?.category, count: template?.items.length }).toEqual({
            id: entry!.id,
            title: entry!.title,
            category: entry!.category,
            count: entry!.count,
        });
        expect(template?.description).toBe(entry!.description);
    });

    it('has a picture source for every item, and no name or page twice', () => {
        const items = template?.items ?? [];
        expect(items.every((item) => item.wiki || item.image)).toBe(true);
        const names = items.map((item) => item.name.toLowerCase());
        expect(new Set(names).size).toBe(names.length);
        const pages = items.flatMap((item) => (item.wiki ? [item.wiki] : []));
        expect(new Set(pages).size).toBe(pages.length);
    });

    it('follows the guide: a listed category, a description for its card, and a good size to rank', () => {
        expect(documentedCategories).toContain(template?.category);
        expect(template?.description).toMatch(/^[A-Z].*[.?]$/);
        expect(template?.items.length).toBeGreaterThanOrEqual(10);
        expect(template?.items.length).toBeLessThanOrEqual(60);
    });
});

describe('the guide (docs/templates.md)', () => {
    it('lists every category in use, and only those', () => {
        const inUse = new Set((index as { category: string }[]).map((entry) => entry.category));
        expect([...inUse].sort()).toEqual([...documentedCategories].sort());
    });
});
