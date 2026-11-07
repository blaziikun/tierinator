// Markup only reaches the page through lib/html.ts (escaped templates + Trusted Types).
// Any other innerHTML / insertAdjacentHTML / outerHTML / document.write is a mistake waiting to happen.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url).pathname;
const ALLOWED = new Set(['lib/html.ts']);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? sourceFiles(path) : name.endsWith('.ts') ? [path] : [];
    });
}

describe('safe HTML only', () => {
    it('no raw HTML sinks outside lib/html.ts', () => {
        const offenders = sourceFiles(SRC)
            .filter((file) => !ALLOWED.has(relative(SRC, file)))
            .flatMap((file) =>
                readFileSync(file, 'utf8')
                    .split('\n')
                    .map((line, i) => [line, i + 1] as const)
                    .filter(([line]) =>
                        /\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(line),
                    )
                    .map(([, number]) => `${relative(SRC, file)}:${number}`),
            );
        expect(offenders).toEqual([]);
    });

    it('no inline event handlers in markup (the security policy blocks them)', () => {
        const pattern = /<[^>]+\son[a-z]+\s*=\s*["']/i;
        const files = [...sourceFiles(SRC), new URL('../../index.html', import.meta.url).pathname];
        const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => relative(SRC, file));
        expect(offenders).toEqual([]);
    });
});
