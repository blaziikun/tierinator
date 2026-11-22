// src/core/app.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The app's name and addresses (src/brand.ts), passed to startApp (start.ts)
//  and to the build (scripts/page-body.ts), which puts the same values into the
//  page. Everything else reads `app` from here instead of naming the site.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppConfig {
    /** A short id: the page's data-app, file names ("tierinator_…"). Lower-case letters and digits. */
    id: string;
    /** "Tierinator": the name people see. */
    name: string;
    /** One line under the name ("tier lists for anything"). */
    tagline: string;
    /** The live site, without a trailing slash: share links, the credit line, template pages. */
    url: string;
    /** The public source code. */
    source: string;
    /** The Pokémon app, once it's live: a Pokémon list here can be copied there (list menu → Copy to …). */
    pokemonApp?: { name: string; url: string };
}

/** The running app's settings, plus what only start-up knows. */
export const app: AppConfig & { offline: boolean } = {
    id: 'app',
    name: 'Tier list',
    tagline: '',
    url: '',
    source: '',
    offline: false,
};

/** The address people see, without "https://" ("tierinator.com"). */
export const siteName = (): string => app.url.replace(/^https?:\/\//, '');

/** Whether the tier list is out of sight (no other view hides it in Tierinator; kept for the keyboard and paste checks). */
export const engineView = { hidden: false };
