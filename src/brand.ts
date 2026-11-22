// src/brand.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What makes this app Tierinator on the shared engine (tier-engine): its name,
//  address, source and front door. main.ts starts the engine with it and
//  vite.config.ts builds the page with it, so the two always agree.
//  `url` is the one real address: the build puts it into the pages' canonical
//  and preview links, the template pages, sitemap.xml and robots.txt, and the
//  "Made with" line. Links made while you use the site (share links) use the
//  address you're on instead. Moving domain: change `url`, add the new domain
//  to wrangler.jsonc's routes (docs/hosting.md {8}).
// ─────────────────────────────────────────────────────────────────────────────
import type { AppConfig } from './core/app';

export const brand = {
    id: 'tierinator',
    name: 'Tierinator',
    tagline: 'tier lists for anything',
    url: 'https://tierinator.com',
    source: 'https://github.com/blaziikun/tierinator',
    // the Pokémon app, once it's live: a Pokémon list here can then be copied there (list menu → Copy to PokeRank…).
    // Off until then, so nothing links to a site that isn't there yet; the browser tests follow this line.
    // pokemonApp: { name: 'PokeRank', url: 'https://pokerank.sayel.dev' },
} satisfies AppConfig;
