// The site's address: tierinator.com is the one real address (src/brand.ts), filled in at build time wherever a
// page must name it (canonical and preview links, the sitemap, robots.txt, the "Made with" line); the old address,
// tierinator.sayel.dev, stays live during the move but is named nowhere the site is built from.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageBody } from '../../scripts/page-body';
import { robots, SITE, sitemap } from '../../scripts/template-pages';
import { brand } from '../../src/brand';

const NEW = 'https://tierinator.com';

/** The page plugin's work on one page, as the build does it. */
function built(fileName: string): string {
    const plugin = pageBody(brand);
    const transform = plugin.transformIndexHtml as { handler: (page: string, context: { filename: string }) => string };
    return transform.handler(readFileSync(fileName, 'utf8'), { filename: fileName });
}

describe('the address', () => {
    it('is tierinator.com, with no slash at the end', () => {
        expect(brand.url).toBe(NEW);
        expect(SITE).toBe(NEW);
    });

    it("goes into the app's and the privacy page's canonical and preview links", () => {
        const app = built('index.html');
        expect(app).toContain(`<link rel="canonical" href="${NEW}/" />`);
        expect(app).toContain(`<meta property="og:url" content="${NEW}/" />`);
        expect(app).toContain(`<meta property="og:image" content="${NEW}/og.png" />`);
        expect(app).toContain('Made with tierinator.com');
        expect(built('privacy.html')).toContain(`<link rel="canonical" href="${NEW}/privacy" />`);
        for (const page of [app, built('privacy.html')]) expect(page).not.toContain('{{url}}');
    });

    it('is the only one in the sitemap and robots.txt', () => {
        const locations = [...sitemap([]).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
        expect(locations.length).toBeGreaterThan(2);
        for (const location of locations) expect(location.startsWith(`${NEW}/`)).toBe(true);
        expect(robots()).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${NEW}/sitemap.xml\n`);
    });

    it('the old one is named nowhere the site is built from', () => {
        const files = (path: string): string[] =>
            statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => files(join(path, name))) : [path];
        const sources = ['src', 'html', 'public', 'scripts', 'index.html', 'privacy.html']
            .flatMap(files)
            .filter((file) => !/\.(png|woff2?)$/.test(file));
        expect(sources.filter((file) => readFileSync(file, 'utf8').includes('tierinator.sayel.dev'))).toEqual([]);
    });
});
