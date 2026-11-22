// vite.config.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Build and unit-test settings. pageBody puts the app's markup into index.html;
//  the engine's plugin (tier-engine/vite) compiles the engine, writes the offline
//  copy and sends the security headers in preview; templatePages writes the
//  template pages and their sitemap.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tierEngine } from 'tier-engine/vite';
import { type Plugin, runnerImport } from 'vite';
import { defineConfig } from 'vitest/config';
import { pageBody } from './scripts/page-body.ts';
import { brand } from './src/brand.ts';

const TEMPLATE_PAGES_STYLESHEET = 'src/template-pages.css';

type PageMaker = typeof import('./scripts/template-pages');
const PAGE_MAKER = fileURLToPath(new URL('./scripts/template-pages.ts', import.meta.url));
/** /t/, /t/<id>/, /sitemap.xml and /robots.txt: what the page maker writes, as addresses. */
const TEMPLATE_PAGE_ADDRESS = /^\/(t\/([a-z0-9-]+\/)?|sitemap\.xml|robots\.txt)$/;

/**
 * The template pages (/t/, /t/<id>/), sitemap.xml and robots.txt, made by scripts/template-pages.ts: written
 * beside the built site, and shown fresh by `pnpm dev`. Their stylesheet is a build entry of its own
 * (below), so it and its fonts get hashed names like the app's; the pages link to whatever name it got.
 */
function templatePages(): Plugin {
    let templateFolder = '';
    let outDir = '';
    return {
        name: 'template-pages',
        configResolved(config) {
            templateFolder = join(config.publicDir, 'templates');
            outDir = resolve(config.root, config.build.outDir);
        },
        async generateBundle(_options, bundle) {
            const stylesheet = Object.values(bundle).find(
                (file) =>
                    file.type === 'asset' && file.fileName.endsWith('.css') && file.originalFileNames.includes(TEMPLATE_PAGES_STYLESHEET),
            );
            if (!stylesheet) this.error(`${TEMPLATE_PAGES_STYLESHEET} is missing from the build`);
            // loaded through Vite rather than imported: it uses the app's own modules (extension-less
            // imports), which would stop Node loading this config file by itself, Vite's coming default
            const { module: pages } = await runnerImport<PageMaker>(PAGE_MAKER, {
                configFile: false,
                logLevel: 'error',
                ssr: { noExternal: ['tier-engine'] },
            });
            const { files, refused } = pages.templatePageFiles(templateFolder, '/' + stylesheet.fileName);
            for (const fileName of refused) this.warn(`public/templates/${fileName} isn't a readable template, so it has no page`);
            for (const { fileName, source } of files) this.emitFile({ type: 'asset', fileName, source });
        },
        configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
                const path = (request.url ?? '').split('?')[0]!;
                if (!TEMPLATE_PAGE_ADDRESS.test(path)) return next();
                const pages = (await server.ssrLoadModule(PAGE_MAKER)) as PageMaker;
                const fileName = path.slice(1) + (path.endsWith('/') ? 'index.html' : '');
                const file = pages
                    .templatePageFiles(templateFolder, '/' + TEMPLATE_PAGES_STYLESHEET)
                    .files.find((f) => f.fileName === fileName);
                if (!file) return next();
                response.setHeader(
                    'Content-Type',
                    path.endsWith('.xml')
                        ? 'application/xml'
                        : path.endsWith('.txt')
                          ? 'text/plain; charset=utf-8'
                          : 'text/html; charset=utf-8',
                );
                response.end(file.source);
            });
        },
        configurePreviewServer(server) {
            // as Cloudflare does (docs/hosting.md {6}): a folder's address without its last slash is sent to the one with it
            server.middlewares.use((request, response, next) => {
                const [path = '', query] = (request.url ?? '').split('?');
                if (!/^\/t(\/[a-z0-9-]+)?$/.test(path) || !existsSync(join(outDir, path, 'index.html'))) return next();
                response.writeHead(307, { Location: path + '/' + (query === undefined ? '' : '?' + query) }).end();
            });
        },
    };
}

export default defineConfig({
    build: {
        target: 'es2022', // browsers from 2022 on: no old-browser code is shipped
        sourcemap: false, // keeps the site lean (the code is public on GitHub anyway)
        assetsInlineLimit: 0, // the favicon etc. stay real files: the security policy allows 'self', not inline data
        // two pages: the app, and the privacy / terms / accessibility page; and the template pages' stylesheet
        rollupOptions: {
            input: { app: 'index.html', privacy: 'privacy.html', 'template-pages': TEMPLATE_PAGES_STYLESHEET },
        },
    },
    plugins: [
        pageBody(brand),
        tierEngine({
            offline: {
                dataFolders: ['templates', 'packs'],
                // jsPDF's optional parts (HTML rendering, sanitising, SVG drawing) get their own files in the build, but
                // the PDFs never use them, so the offline copy leaves them out (about 105 KB gzipped)
                skip: /^(html2canvas|purify\.es|index\.es)-/,
            },
        }),
        templatePages(),
    ],
    test: {
        include: ['tests/unit/**/*.test.ts'], // the browser tests in tests/e2e run with Playwright instead
        server: { deps: { inline: ['tier-engine'] } }, // the engine is TypeScript source: compiled, not loaded as is
    },
});
