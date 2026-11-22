// The rules between the boxes (docs/architecture.md {2}): lib knows nothing of the app; core and pokemon use only
// lib and each other, never a feature; nothing in src reaches into scripts/ or tests/ (scripts may use src).
// Each import is read from the source, so a broken rule names the file, the line and the import.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(new URL('../../', import.meta.url).pathname);

function sourceFiles(folder: string): string[] {
    return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
        const path = `${folder}/${entry.name}`;
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|mjs|js)$/.test(entry.name) ? [path] : [];
    });
}

interface Import {
    file: string;
    line: number;
    /** As written: '../core/types', 'fflate'. */
    specifier: string;
    /** The box it lands in, for imports inside the repository; undefined for packages and node: modules. */
    target?: string;
}

/** Which box a repository path is in: lib, core, pokemon, features, styles, brand, main (start.ts, testing.ts), scripts, tests or other. */
function boxOf(path: string): string {
    if (/^src\/brand(\.ts)?$/.test(path)) return 'brand';
    const box = path.match(/^src\/(lib|core|pokemon|features|styles)\//)?.[1];
    if (box) return box;
    if (/^src\/[^/]+$/.test(path)) return 'main';
    return path.match(/^(scripts|tests)\//)?.[1] ?? 'other';
}

/** Every static import, re-export, side-effect import and dynamic import('…') in a file, with its line. */
function importsOf(file: string): Import[] {
    const imports: Import[] = [];
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s*['"]([^'"]+)['"]/g];
    lines.forEach((text, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(text)) return; // a comment can mention an import without making one
        for (const pattern of patterns) {
            for (const [, specifier = ''] of text.matchAll(pattern)) {
                const target = specifier.startsWith('.') ? boxOf(relative(ROOT, resolve(dirname(join(ROOT, file)), specifier))) : undefined;
                imports.push({ file, line: index + 1, specifier, target });
            }
        }
    });
    return imports;
}

const allImports = [...sourceFiles('src'), ...sourceFiles('scripts')].flatMap(importsOf);

/** The boxes each box may import from (anything not listed, such as packages, is fine). */
const ALLOWED: Record<string, string[]> = {
    lib: ['lib'],
    core: ['lib', 'core', 'pokemon'],
    pokemon: ['lib', 'core', 'pokemon'],
    features: ['lib', 'core', 'pokemon', 'features'],
    brand: ['core'],
    main: ['lib', 'core', 'pokemon', 'features', 'styles', 'main', 'brand'],
    // the build reads the app's name and addresses (src/brand.ts) for the pages it writes
    scripts: ['lib', 'core', 'pokemon', 'features', 'scripts', 'brand'],
};

describe('the rules between boxes', () => {
    it('reads the imports it checks (an empty list would pass anything)', () => {
        expect(allImports.length).toBeGreaterThan(200);
        expect(allImports).toContainEqual(expect.objectContaining({ file: 'src/core/items.ts', specifier: './defaults', target: 'core' }));
        expect(allImports.some((found) => found.file === 'src/start.ts' && found.target === 'features')).toBe(true);
    });

    it('every import stays inside the boxes its box may use', () => {
        const broken = allImports
            .filter((found) => found.target !== undefined && !ALLOWED[boxOf(found.file)]?.includes(found.target))
            .map(
                (found) =>
                    `${found.file}:${found.line} imports '${found.specifier}' (${found.target}), ` +
                    `but ${boxOf(found.file)} may import only ${ALLOWED[boxOf(found.file)]?.join(', ') ?? 'nothing in the app'}`,
            );
        expect(broken).toEqual([]);
    });
});
