// vite.config.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Build and unit-test settings. Vite already does the right thing for TypeScript
//  and CSS, so this only states the choices that matter for this app.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin, runnerImport } from 'vite';
import { defineConfig } from 'vitest/config';

const TEMPLATE_PAGES_STYLESHEET = 'src/styles/template-pages.css';

/**
 * The headers public/_headers gives every page ("/*"), so `vite preview` (and the
 * end-to-end tests that use it) runs under the same security policy as the real site.
 */
function siteHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    let inAllPages = false;
    for (const line of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n')) {
        if (!line.trim() || line.startsWith('#')) continue;
        if (!/^\s/.test(line)) inAllPages = line.trim() === '/*';
        else if (inAllPages) {
            const colon = line.indexOf(':');
            headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
        }
    }
    // the preview server is plain http on this computer
    delete headers['Strict-Transport-Security'];
    headers['Content-Security-Policy'] = headers['Content-Security-Policy']!.replace(' upgrade-insecure-requests;', '');
    return headers;
}

type PageMaker = typeof import('./scripts/template-pages');
const PAGE_MAKER = fileURLToPath(new URL('./scripts/template-pages.ts', import.meta.url));
/** /t/, /t/<id>/ and /sitemap.xml: what the page maker writes, as addresses. */
const TEMPLATE_PAGE_ADDRESS = /^\/(t\/([a-z0-9-]+\/)?|sitemap\.xml)$/;

/**
 * The template pages (/t/, /t/<id>/) and sitemap.xml, made by scripts/template-pages.ts: written
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
            const { module: pages } = await runnerImport<PageMaker>(PAGE_MAKER, { configFile: false, logLevel: 'error' });
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
                response.setHeader('Content-Type', path.endsWith('.xml') ? 'application/xml' : 'text/html; charset=utf-8');
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

/** The app's files besides /assets that the service worker keeps for offline use (og.png, packs and templates aren't needed to start). */
const OFFLINE_FILES = [
    'index.html',
    'privacy.html',
    'manifest.webmanifest',
    'favicon.svg',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
];

/** Replaces `placeholder` in `text`, and fails the build if it isn't there (sw.js was edited without this). */
function fillIn(text: string, placeholder: string, value: string): string {
    if (!text.includes(placeholder)) throw new Error(`src/features/offline/sw.js: "${placeholder}" is missing`);
    return text.replace(placeholder, value);
}

/**
 * jsPDF's optional parts (HTML rendering, sanitising, SVG drawing) get their own files in the build, but
 * my PDFs never use them, so the offline copy leaves them out (about 105 KB gzipped).
 */
const NEVER_LOADED = /^(html2canvas|purify\.es|index\.es)-/;

/**
 * Writes dist/sw.js from src/features/offline/sw.js with the files this build made, so the service worker
 * keeps exactly this version. The version name is a hash of those files: a build that changes nothing leaves
 * sw.js byte for byte the same, so nobody is offered an update that isn't one.
 */
function offlineApp(): Plugin {
    let outDir = 'dist';
    return {
        name: 'tierinator-offline-app',
        apply: 'build',
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
            const worker = readFileSync(new URL('./src/features/offline/sw.js', import.meta.url), 'utf8');
            const assets = readdirSync(resolve(outDir, 'assets')).filter((name) => !NEVER_LOADED.test(name));
            const files = [...OFFLINE_FILES, ...assets.map((name) => `assets/${name}`)];
            const hash = createHash('sha256').update(worker);
            for (const file of files) hash.update(file).update(readFileSync(resolve(outDir, file)));
            const paths = files.map((file) => (file === 'index.html' ? '/' : `/${file}`));
            let built = fillIn(worker, "const VERSION = 'dev';", `const VERSION = '${hash.digest('hex').slice(0, 16)}';`);
            built = fillIn(built, 'const APP_FILES = [];', `const APP_FILES = ${JSON.stringify(paths)};`);
            writeFileSync(resolve(outDir, 'sw.js'), built);
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
    plugins: [templatePages(), offlineApp()],
    preview: {
        headers: siteHeaders(),
    },
    test: {
        include: ['tests/unit/**/*.test.ts'], // the browser tests in tests/e2e run with Playwright instead
    },
});
