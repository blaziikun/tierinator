// playwright.config.ts
// ─────────────────────────────────────────────────────────────────────────────
//  End-to-end tests: a real browser clicks through the built site.
//  The site is built in "test" mode (adds the window.__app test handle) and served
//  locally; every outside website is replaced by a local stand-in (tests/e2e/fixtures.ts).
//  tests/visual holds opt-in screenshot comparisons (pnpm test:visual).
// ─────────────────────────────────────────────────────────────────────────────
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT) || 4173; // PORT=… runs a second copy side by side

export default defineConfig({
    testDir: 'tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI, // a stray test.only must not slip into CI
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'retain-on-failure',
        colorScheme: 'dark', // the site is dark whatever the system says; one test checks a light system too
        // a service worker answers requests before page.route sees them, so the stand-ins in fixtures.ts would be
        // bypassed; only tests/e2e/offline.spec.ts lets it run
        serviceWorkers: 'block',
    },
    projects: [
        // pnpm test:e2e
        { name: 'desktop', testDir: 'tests/e2e', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'phone', testDir: 'tests/e2e', use: { ...devices['Pixel 7'] } },
        // pnpm test:visual (see tests/visual/screens.spec.ts)
        { name: 'visual-desktop', testDir: 'tests/visual', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'visual-phone', testDir: 'tests/visual', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: `pnpm build:test && pnpm exec vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
