// src/features/offline/offline.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The installable app: registers the service worker (sw.js beside this file),
//  which keeps the app on the device so it opens offline. When a new version is
//  waiting, a small notice offers to reload; it never reloads by itself.
// ─────────────────────────────────────────────────────────────────────────────
import { byId } from '../../lib/dom';

/** Where the build puts the service worker (vite.config.ts). At the top, so it looks after every page. */
const SERVICE_WORKER_URL = '/sw.js';
/** How often a tab that stays open asks for a new version, when it's brought back into view. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

const offline = {
    registration: null as ServiceWorkerRegistration | null,
    /** Set by the Reload button: only then does a change of worker reload the page. */
    reloading: false,
    lastUpdateCheck: Date.now(),
};

interface ScriptUrlPolicy {
    createScriptURL(url: string): unknown;
}
interface TrustedTypesFactory {
    createPolicy(name: string, rules: { createScriptURL(url: string): string }): ScriptUrlPolicy;
}

/**
 * The service worker's address as a TrustedScriptURL. The security policy requires one for
 * register(), and this policy will make one for that single address only.
 */
function trustedServiceWorkerUrl(): string {
    const policy = (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes?.createPolicy('tierinator-sw', {
        createScriptURL: (url) => {
            if (url !== SERVICE_WORKER_URL) throw new TypeError(`Not the service worker: ${url}`);
            return url;
        },
    });
    return (policy ? policy.createScriptURL(SERVICE_WORKER_URL) : SERVICE_WORKER_URL) as string;
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE NOTICE
// ═════════════════════════════════════════════════════════════════════════════

function showUpdateNotice(): void {
    byId('updatebox').classList.remove('hid');
}

const hideUpdateNotice = (): void => byId('updatebox').classList.add('hid');

/** Starts the waiting version. The page reloads when it takes over; the open list is saved on the way out (persist.ts). */
function reloadIntoNewVersion(): void {
    const waiting = offline.registration?.waiting;
    if (!waiting) {
        location.reload(); // another tab already started it: this page only needs to load it
        return;
    }
    offline.reloading = true;
    waiting.postMessage('skip-waiting');
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE SERVICE WORKER
// ═════════════════════════════════════════════════════════════════════════════

/** Notices a new version arriving: installed while an older one still looks after this page. */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateNotice();
    registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
            // with no controller yet this is the first install: the app just became available offline
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateNotice();
        });
    });
}

/** A tab left open for days still hears about new versions (browsers only check on page loads). */
function checkForUpdate(): void {
    if (document.visibilityState !== 'visible' || Date.now() - offline.lastUpdateCheck < UPDATE_CHECK_MS) return;
    offline.lastUpdateCheck = Date.now();
    offline.registration?.update().catch(() => {}); // offline: try again next time
}

async function registerServiceWorker(): Promise<void> {
    try {
        offline.registration = await navigator.serviceWorker.register(trustedServiceWorkerUrl(), { scope: '/', updateViaCache: 'none' });
    } catch {
        // not allowed here (some private windows): the app works as before, online only
    }
    // a browser that blocks workers may also answer with no registration at all
    if (!offline.registration) return;
    watchForUpdates(offline.registration);
    document.addEventListener('visibilitychange', checkForUpdate);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupOffline(): void {
    // development builds have no sw.js (the build writes it)
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    byId('updatereload').onclick = reloadIntoNewVersion;
    byId('updatelater').onclick = hideUpdateNotice;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (offline.reloading) location.reload();
        // another tab took the new version: this one still runs the old code until it reloads
        else if (hadController) showUpdateNotice();
    });
    // after the page has loaded, so keeping the app's files doesn't slow down the first visit
    if (document.readyState === 'complete') void registerServiceWorker();
    else addEventListener('load', () => void registerServiceWorker(), { once: true });
}
