# Decisions

> Every tool and technique behind Tierinator: what was chosen, what it was compared with, and why.
> The test for each one: does it remove more than it adds?

---

## At a glance {0}

| Area | Chosen | Weighed against |
| --- | --- | --- |
| App | Static site, all in the browser, installable and offline | Server with accounts; desktop app; online only |
| Language | TypeScript, strictest settings | Plain JavaScript; JavaScript with JSDoc types |
| UI | The DOM directly, plus a small escaping `html` template | React, Svelte, Vue, Lit |
| Build | Vite | webpack, Parcel, esbuild alone |
| CSS | Plain CSS, one file per feature | SCSS, Tailwind, CSS Modules |
| Lint and format | Biome | ESLint + Prettier |
| Dead code | Knip | Nothing (and letting it pile up) |
| Tests | Vitest and Playwright, with axe-core | Jest, Cypress |
| Packages | pnpm, exact versions, no install scripts | npm, Yarn, Bun |
| Hosting | Cloudflare Workers static assets | Cloudflare Pages, GitHub Pages, Netlify, Vercel |
| Deploys | GitHub Actions, after every check passes | Cloudflare's own Git builds |
| Sharing | The list inside the link | A server storing shared lists |

## The app: a static site {1}

Ranking things doesn't need a server, and without one there are no logins to steal, no database to leak, no API to
flood and nothing that can run up a bill. The cost is that lists live in one browser; backups, list files and share
links cover moving them.

It also installs and opens offline: a small hand-written service worker (`src/features/offline/sw.js`) keeps the app's
own files. Offline modes are known for serving an old version after an update, so pages always come from the network
when it answers, and a new version waits for a "Reload" button instead of swapping code under someone mid-ranking.
Pictures from other sites still need the internet; the ones already shown are kept by the app itself (IndexedDB).
`vite-plugin-pwa` (Workbox) supports Vite 8, but was passed over: it brings Babel and Rollup into the build for a job of
about a hundred lines, its worker loads its runtime with `importScripts` and its page helper registers with a plain
string, both of which the Trusted Types policy refuses.

## TypeScript, strict {2}

At about 20,000 lines, renaming a field or moving a function safely needs a checker that reads the whole program.
Moving the original single-file app to TypeScript found real bugs on the way (a button passing a click event as a
number, a sprite-pack import calling a method that didn't exist). Strict mode, no `any`, and anything from outside typed
`unknown` until checked.

## No UI framework {3}

The busy parts are dragging among 1,300 tiles, box selection, live picture cropping and canvas exports: direct DOM
work, which a framework mostly gets out of the way of.

- **React** would add about 45 KB, a rewrite of every screen, and escape hatches (`ref`s, effects) in exactly those hot paths.
- **Svelte** is the best fit for a new, form-heavy app (UniverList uses it). Here it would still mean rewriting working
  screens. If many new screens arrive, Svelte for new features is the natural step.
- **Lit / lit-html** is closest in spirit, but the app needs escaping plus Trusted Types, which `lib/html.ts` does in
  under 80 readable lines.

## Vite {4}

Instant reloads while developing, content-hashed files for the real site, and lazy chunks for what most visits never
open:

| Downloads when | What |
| --- | --- |
| The page opens | The app (about 78 KB of JavaScript, gzipped) and the two default fonts |
| A Pokémon list opens | The Pokémon data, `public/packs/pokemon.json` |
| A picture scrolls into view | That picture (`loading="lazy"`) |
| Stats, Export, the pack builder, wiki import, the template gallery or Combine rankings opens | That feature's code |
| A PDF is exported | jsPDF |
| A zip is opened or saved | fflate |
| A first visit has finished loading | Everything above except the packs and pictures, quietly, for offline use (about 450 KB gzipped; after an update, only the files that changed) |

`vite.config.ts` only states real choices: modern browsers, no source maps, no inlining (so the security policy can stay
strict), two pages, a preview server that sends the real security headers so the tests run under them, and a small
plugin that writes `dist/sw.js` with the list of files the build made.

## CSS, type and colour {5}

**Plain CSS.** Theme colours, fonts and sizes are CSS variables that the Style panel changes live, which a preprocessor
can't do. Nesting, `color-mix()` and variables cover what SCSS was for. Tailwind would bury a themeable design system in
class strings.

**The default look** is quiet greys so the tier colours and the pictures carry the page. There is one, and it's dark,
whatever the system asks for: one look designed as a whole is better than two kept roughly in step, and the Style panel
already gives full control over every colour (a light page included). A light version used to be built in; lists saved
with it keep their colours, because a list stores its whole theme. The fonts:

- **Playfair Display** for headings and tier labels: a high-contrast serif that reads like a ranking's headline.
- **Instrument Sans** for the interface: a proportional sans, slightly narrow, so dense controls stay compact and
  every word reads as a word. Its figures are set tabular wherever counts sit in a column or change while you watch.
- **Geist Mono** only where characters have to line up or be typed exactly: shortcut keys and Pokédex numbers.
- All three are **served by the site itself** (latin subsets, 92 KB together; a browser fetches Geist Mono only once
  something on screen uses it), so a visit never contacts Google.
  Other fonts in the Style panel come from Google Fonts only when someone picks one. A list keeps the fonts it was saved
  with: lists made while the interface was set in Geist Mono still open in it.

**Measures** come from a few variables in `styles/base.css`, so every part agrees. Roundness grows with size, all from
the theme's Roundness: small chips 4 px, buttons and fields 7, floating panels 12, windows 14 (tiles and tier rows use
the theme's own value). Controls in a row share one height (28 px; 44 px on a phone, for a finger). Lines go from faint
rules between parts to the edge of a field you type in, which stands 3:1 against the panels. Everything that floats
(menus, popovers, the toast, windows) is one family: the panel grey, a firm edge and a long soft shadow. The chosen tab
or a switch that's on is lit 3:1 apart from its track; keyboard focus is a 2 px ring in the highlight colour.

**Loudness** is spent in one place: the start screen's "Make a tier list", Playfair at display size. The top bar's
buttons are words until the pointer is on them, the pool's are plain buttons with one filled (Add items), and the
pictures and tier colours carry the page. No texture, no gradient washes; motion only answers what you do: colours ease on
hover, menus and windows settle in as they open, and the toast rises a few pixels as it appears.

## Biome and Knip {6}

**Biome** formats and lints TypeScript, CSS and JSON with one config (`biome.jsonc`, every non-default rule explained).
Warnings fail the build. **Knip** fails it on unused files, exports and dependencies. ESLint plus Prettier would be two
tools, two configs and a dozen plugins for the same result.

## Tests {7}

- **Vitest** shares Vite's config. It covers what must be exactly right: reading list files (old formats and malicious
  ones), packs, share links, escaping, colour maths, and rules about the code itself.
- **Playwright** drives the built site in Chromium at desktop and phone sizes, under the real security headers, with every
  outside site replaced by a local stand-in. Each test fails on any page error or blocked request. An **axe-core** sweep
  checks accessibility on every window, and once with the system set to light.
- Jest would need its own TypeScript setup; Cypress is heavier and slower.

## Packages: pnpm {8}

- **pnpm** with `pnpm-lock.yaml`: fast, strict about undeclared dependencies, and it refuses to run packages' install
  scripts unless allowed (`pnpm-workspace.yaml` allows none). The version is pinned in `package.json`.
- **Exact versions** (`saveExact`). Dependabot proposes updates weekly, a week after each release; each one runs the full
  suite before it's merged.
- **Two runtime dependencies:** `fflate` (zips, a fraction of JSZip) and `jsPDF` (PDF export, loaded only when used).
  Validation is hand-written next to each format, the IndexedDB wrapper is about 150 lines, and nothing sanitises HTML
  because the app never accepts any. (jsPDF ships an optional HTML renderer that the build keeps as separate files; the page
  never loads them, and the offline copy leaves them out.)

## Hosting and deploys {9}

**Cloudflare Workers static assets:** free with no request limit for static files, reads `public/_headers`, and the
domain set-up lives in `wrangler.jsonc`. GitHub Pages can't send headers (so no security policy); Netlify and Vercel would
mean another account when the DNS is already at Cloudflare.

**GitHub Actions** deploys only after the secret scan, audit, lint, types, Knip, unit tests, browser tests and build all
pass. Cloudflare's own Git builds would deploy even when tests fail.

## Sharing without a server {10}

A share link holds the whole list, compressed, after the `#`. That part of a link never reaches a server, so there's
nothing to store, moderate, rate-limit or pay for. A ranked list of every Pokémon makes a link of about 3,200
characters (about 11,500 with a picked sprite for each), well inside what chat apps and browsers handle; pictures that exist only in someone's browser can't travel this way, and show as names instead.

## Left out, on purpose {11}

- [ ] **A router:** one page with two views.
- [ ] **A state library:** one `state` object for the open list, one `session` for which list is open.
- [ ] **Analytics, trackers, ads, cookies:** none. Cloudflare's own request counts (no script) are enough.
- [ ] **Emoji as icons:** words on buttons, and a few plain symbols where a word won't fit (↑ ↓ ✕ ▾ ★).
