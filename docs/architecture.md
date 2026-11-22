# Architecture

> How Tierinator's code is laid out, the few rules that keep it that way, and how it sits on the engine.
> Organised like a wardrobe sorted into labelled boxes: not one big pile, not a moulded slot for every sock.
> Lift a box out, change it, put it back, and the others don't notice.

---

## The shape of it {0}

A static site. Vite builds `index.html`, the TypeScript and the CSS into a handful of files; Cloudflare serves them.
Everything runs in the visitor's browser and lists are saved in the browser's own storage. No server, no database,
no account. Why each part is built this way, and what happens when it goes wrong: [defence.md](defence.md).

```
tier-engine/   github.com/blaziikun/tier-engine (MIT): the board and nothing above it
   │           core   the list model, the saved format (version 10), undo, storage adapters, share links, checks
   │           board  mountBoard: tiers or a chart, the pool, drag, keyboard moves, tiles, selection; board.css
   │           safe   html`…`, setHtml, the Trusted Types policy      vite   preview headers, the offline worker
   ▼
tierinator/    this repository: every screen and feature, the Pokémon data, the templates, the browser tests
```

The engine never knows what an item is or which app it's in. Tierinator mounts its board on `#tsec` and `#pgrid`
(features/tier-board/board.ts) and plugs in its items, pictures and screens through the board's options and hooks
({1.1}). Pokémon lists are Tierinator's own: the pack, sprites, forms, Focus and the grid all live here.

```
tierinator/
├── index.html              the head (title, description, icons) and <!-- app:body -->
├── html/body.html          the page's fixed markup: bars, popovers, windows, sectioned by feature. Put into index.html
│                           at build by scripts/page-body.ts, with the name and addresses from src/brand.ts filled in
├── privacy.html            privacy, terms and accessibility
├── src/
│   ├── main.ts             names the Trusted Types policy (tierinator-html), loads the styles, startApp(brand)
│   ├── brand.ts            the AppConfig: name, tagline, address, source, the Pokémon app to copy lists to (off for now)
│   ├── start.ts            startApp: each feature's setup, then storage, packs, the last list
│   ├── testing.ts          test builds only: window.__app for the browser tests
│   ├── lib/                tools that know nothing about tier lists
│   ├── core/               the list itself, no screens: Tierinator's list type (extends the engine's BoardList), its
│   │                       saved fields (snapshot.ts, on the engine's format), undo (history.ts, on the engine's),
│   │                       storage (local.ts and storage.ts, on the engine's adapters), items, packs, templates
│   ├── pokemon/            Pokémon data tables, species facts, facets for Focus and the grid, sprite addresses
│   ├── features/           one folder per feature: its .ts and .css side by side
│   └── styles/             base.css (variables, shared measures and controls), windows.css, fonts/, privacy.css,
│                           template-pages.css, app.css (every stylesheet, in order, the engine's board.css among them)
├── public/                 _headers (security), icons, manifest, templates/, packs/pokemon.json
├── scripts/                page-body.ts, template-pages.ts (at build, {2.1}), check-template-titles.mjs, identity-guard.ts
├── tests/                  unit/ (Vitest), e2e/ (Playwright + axe, WCAG 2.2 AA), visual/ (screenshots)
└── docs/                   this, defence.md, decisions.md, security.md, features.md, hosting.md, templates.md
```

To work on the engine and this app together, keep `tier-engine/` next to this folder and link it while you work
(`pnpm add tier-engine@link:../tier-engine`, never committed); releasing an engine version: the engine's
docs/hosting.md.

## The boxes {1}

```
src/lib/                    ← could be copied into another project as-is
├── images.ts               is it really a picture? size limits, SVG → PNG, trimming, cropping, smaller copies of big uploads
├── zip.ts                  reading zips safely (zip-bomb limits), writing them
├── choice-menu.ts          a button's menu of radio-like choices (the Pool menu, the pool's order)
└── dom, ui, net            small helpers: byId, toasts (with Undo) and questions, fetch with timeouts

(Safe HTML, share-link packing, CSV, the backup file, the checks for untrusted data and colour maths are the engine's:
tier-engine/safe and tier-engine/core.)

src/core/                   ← the list and its rules
├── types.ts                every shape: a list in memory, pack files
├── state.ts                the open list (state), which lists exist (session), the hooks
├── defaults.ts             a new list: tiers, the built-in theme, settings
├── snapshot.ts             the saved format ⇄ memory, every field checked
├── pack-format.ts          reading pack files, every field checked
├── csv-format.ts           the open list as CSV rows (Export → CSV); reading a CSV is the engine's readCsvRows
├── template-format.ts      reading template files (public/templates), every field checked
├── group-ranking.ts        Combine rankings: reading each person's list, matching items (Pokémon by id, pack items by
│                           row, the rest by name), the group's list; the maths is the engine's combineRankings
├── grid-format.ts          saved grids (Pokémon lists): the ready-made ones, and reading them back, every field checked
├── picture-sites.ts        the picture addresses trusted without asking (share links, templates)
├── persist.ts              autosave, one tab at a time
├── history.ts              undo / redo: tiers, families, deleted items, the look and the layout
├── storage.ts              IndexedDB (pictures, packs, gallery), delete everything
└── items.ts                what can be ranked: entries, forms, variant families

src/features/               ← one box per thing you can do
├── tier-board/             tiers (as rows, or a chart's grid of cells), tiles and their shape, the pool, dragging,
│                           keyboard ranking, selection, the tier editor
├── sprites/ studio/        picking sprites, every version of one, the studios
├── add-items/ wiki/        adding your own things, web search, wiki import
├── files/ packs/ share/    saving, loading, backups, packs, share links
├── lists/ start/           opening and creating lists, the first-visit screen
├── templates/              the template gallery, free pictures for its items from Wikipedia, template links (/?template=)
├── group/                  Combine rankings: several people's links or files into the group's list
├── offline/                the installable app: sw.js (the service worker, written into dist/sw.js by the engine's vite/plugin.js),
│                           offline.ts (registers it, offers "Reload" when a new version is waiting)
├── credits/                who made each Wikimedia picture and its licence: the lookup, the item editor's line, the window
├── appearance/ layout/     themes and the Style panel, the views (tier list, grid, studio) and the top bar
├── focus/                  Focus ▾ (Pokémon lists): show only some Pokémon, in the pool and the tiers at once
├── grid/                   the Grid view: favourites per cell from the ranking (cells.ts, pure), pins, saved grids,
│                           its picture (grid-export.ts); loads on first use
├── pokemon-app/            New Pokémon list, and Copy to PokeRank… (a Pokémon list sent to the Pokémon app in a link)
├── export/ stats/          Export ▾ (layout.ts gives the engine the list and the theme; export.ts: SVG and PNG through
│                           tier-engine/export, the PDF drawn here on the engine's layout), the stats window
├── stream/                 stream mode: a presenter view for ranking live on video (below)
└── …                       quick-rank, head-to-head, find, tags, variants, forms, keyboard, onboarding
```

### On the engine {1.1}

`features/tier-board/board.ts` mounts the engine's board once, at start-up, and is the only file that holds its handle.
The rest of the app keeps calling the same functions as before (`placeAllTiles`, `renderTiers`, `inFocus`,
`moveSelectionTo`…), which pass through to it.

| The board's option | Tierinator gives it |
| --- | --- |
| `list` | `state` (core/state.ts): Tierinator's list, which extends the engine's `BoardList` |
| `source` | the open list's entries (core/items.ts) and their pictures (features/sprites): `spriteSrc`, `spriteCrop`, text tiles; a broken picture heals or falls back |
| `history` | `listHistory` (core/history.ts), so families, the look and grids undo in the same steps |
| `visible`, `matches`, `searching` | Focus (Pokémon lists), the search box and the tag filter |
| `decorate`, `tierControls`, `tierStyle` | tag dots and the "+3" family badge; ⇅ head to head; the theme's label and row colours |
| `onTileOpen`, `onTierOpen` | the item editor or the quick picker; the tier editor |
| `onSelect`, `onFilter`, `onPlace` | the selection bar; the pool count, Focus line, ⇅ buttons, ranked hits and Find; the pool's order button and the ranked count |
| `tileStore`, `ghost`, `marquee`, `tiersHeader` | `tileById` (core/state.ts), `#dghost`, `#marq`, the Focus line |

The saved format is the engine's `writeList` / `readList` plus Tierinator's own keys (`kind`, `pack`, `items`, `fam`,
`theme`, `F`, `favs`, `formCats`, `grids`…) beside them in the same object (core/snapshot.ts). Old files load as
before; the unit tests in tests/unit/snapshot.test.ts open files from every earlier version.

The look: the engine's `board.css` comes first in app.css, then `features/tier-board/board.css`, whose rules use the
page's ids (`#tsec`, `#pgrid`) and so win wherever they say something different.

### Internal names {1.2}

The browser tab shows the open list's name (top-bar.ts, `renderListButton`), and the site's name only when no list is
open.

Some internal names say `tierinator` and stay that way: the Trusted Types policies (`tierinator-html`, named with the
engine's `useTrustedTypesPolicy` in main.ts, and `tierinator-sw`, both in `_headers`), the service worker's
caches (`tierinator-app-…`, `tierinator-data`), the template format (`tierinator-template`) and the `app` field in a
sprite pack's manifest. Renaming them would only strand what's already on people's devices. Visitors never see them.

### Stream mode

`features/stream` loads the first time Stream mode (or the V key) is used. Its options window picks a background
(the theme, or a green or magenta screen for chroma key), names on or off, the order (as in the pool, or shuffled from a
seed) and whether to start from empty tiers. The view (`#stream`) covers the window, and the screen too where the
Fullscreen API is allowed; everything else in `<body>` is hidden while it's open. It draws its own copy of the tiers
from `state.tiers` (cloning each board tile's picture, so crops and fallbacks match) rather than restyling `#tsec`, so
the board's hover tips, selection and tier controls can't appear on camera. Each placement is an ordinary
`pushHistory` + `placeAllTiles` + `autosave`, so undo, saving and the board need nothing new. While it's open its own
key handler (capture, on `window`) takes every key before the shortcut layers in `features/keyboard`. The plain
logic (queue order, seeded shuffle, what comes next, the remembered options in `pt_stream`) is `stream-queue.ts`,
with unit tests.

## The rules between boxes {2}

1. **`lib` imports nothing from the app.**
2. **`core` and `pokemon` import only `lib` and each other.** Never a feature.
   A unit test (`tests/unit/layers.test.ts`) reads every import in `src` and `scripts` and fails on one that breaks
   these two rules, or that reaches from `src` into `scripts` or `tests` (scripts may use `src`, never the other way),
   naming the file, line and import.
   Tierinator imports the engine only through its package entries (`tier-engine/core`, `/board`, `/export`, `/safe`,
   `/vite`, `/board.css`), never its files; the engine knows nothing about Tierinator.
3. **Features may use anything,** including each other's exported functions.
4. **A lower layer that needs to tell features something offers a hook** instead of importing them:

   | Hook | In | Runs when |
   | --- | --- | --- |
   | `onListReset` | core/state | another list is about to open |
   | `onListOpen` | core/state | a list has opened and been drawn |
   | `onHistoryRestore` | core/history | undo or redo put an earlier state back |
   | `onDeletionCrossed` | core/history | undo or redo reached the step where items were deleted (features/items brings them back, or deletes them again) |
   | `onPopoversClose` | lib/ui | any popover closes |
   | `onFiltersChange` | features/sprites/versions | the sprite filters change |
   | `onFormsChange` | features/forms | forms are split out or merged |
   | `onLocalSpritesChange` | pokemon/local-source | a pokemon.zip or folder was loaded |

   One slot works the other way round: `gridView.render` in `features/layout` is empty until the grid's code loads (on
   first use) and fills it, so switching views can draw the grid without the layout importing it.

5. **Markup only through `` html`…` `` and `setHtml`.** A unit test fails on `innerHTML`, `eval` and friends anywhere
   else, and on inline `onclick=`.
6. **Anything from outside is `unknown` until checked:** files, links, storage, websites, packs. One checking module per
   format (`core/snapshot.ts`, `core/pack-format.ts`, `core/template-format.ts`, `core/csv-format.ts`,
   `core/grid-format.ts`, `checks.ts` (tier-engine/core)).
7. **Every outside picture is checked before it's kept:** uploads, links, wiki and template pictures go through
   `checkedImage` (real type, size and pixel caps); sprite-collection pictures, from fixed addresses, get the type check
   and the 25 MB cap in `fetchSpriteBlob`.

The service worker (`the engine's vite/sw.js`) runs apart from the page and imports nothing; it's plain JavaScript,
written into the build by the engine's `vite/plugin.js` with this version's file list filled in. How it caches and how
updates arrive: each app's hosting.md {7}.

Knip (`pnpm knip`) fails the build on unused files, exports or dependencies, so dead code can't pile up.

### Pages made at build time (Tierinator) {2.1}

Besides the app and the privacy page, Tierinator's `pnpm build` writes one small page per template, for search engines:

```
public/templates/*.json ──▶ scripts/template-pages.ts ──▶ dist/t/<id>/index.html   a template's page
   (read through                   (pure functions,      dist/t/index.html         every template, by category
   core/template-format.ts)         unit-tested)         dist/sitemap.xml          every page worth finding
```

- [ ] **The plugin** is `templatePages()` in Tierinator's `vite.config.ts`. It loads `scripts/template-pages.ts`
      through Vite (`runnerImport`, with the engine compiled rather than left to Node) rather than importing it, so the
      config itself has no extension-less imports for Node to trip on.
      `pnpm dev` serves the same pages fresh on every visit; `pnpm preview` adds the trailing slash as Cloudflare does.
- [ ] **The pages** are plain HTML with no JavaScript, built with the same `` html`…` `` templates as the app (everything
      escaped), and link to the app's `src/template-pages.css` (which imports the engine's). That stylesheet is a build
      entry of its own, so it and the
      self-hosted fonts get hashed names like the app's; the plugin finds the name it got.
- [ ] **Shared with the gallery:** `features/templates/template-addresses.ts` (the `/?template=<id>` link and
      `suggestTemplateAddress(source)`, the suggestion form's address). It imports nothing, so the build can use it too.
      The Pokémon card on the pages is the pack's template link (`/?template=pokemon`), which makes a Pokémon list.

## Inside a file {3}

Every file has the same shape:

```ts
// src/features/quick-rank/quick-rank.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Quick rank (#qr): the pool's items one at a time, big; press a tier's button
//  (or 1–9) to put it there, Skip (→) to leave it, Back (←) to undo the last one.
// ─────────────────────────────────────────────────────────────────────────────
import …                                             ← sorted by Biome

const quickRank = { queue: [] as ItemId[], position: 0, placed: [] as ItemId[] };   ← its state: one object

// ═════════════════════════════════════════════════════════════════════════════
//  A BIG SECTION
// ═════════════════════════════════════════════════════════════════════════════

/** One line on what it does, and why when that isn't obvious. */
export function startQuickRank(): void { … }

// ── wiring (runs once at start-up, from start.ts) ──
export function setupQuickRank(): void { … }       ← last; importing a file runs nothing
```

- [ ] **Header:** the path, then what the file is for in plain words. More than four lines means it may be two files.
- [ ] **Names in full:** `tileSize`, `poolAsSidebar`, `stepQuickPicker(direction)`. Functions are verbs, values are
      nouns, checks are questions (`isRankable`). British spelling, like the interface.
- [ ] **Comments say why,** or what something means to a person. The code says how.
- [ ] **Typical size 100–600 lines.** Past about 800, look for the seam.
- [ ] **4 spaces, single quotes, up to 140 characters.** Biome enforces it, warnings included.

> ⚠️ The saved format keeps its old short keys (`sz`, `famM`, `F`…) and the storage keeps its old names (`pt_…`, the
> `poketier4` database), so every list ever saved still opens. The short keys live only in `core/snapshot.ts`; the
> `ptl_<list>` and `pt_…` storage names are read and written where each setting lives, so search for `'pt` before
> renaming one.

## Saving, sharing, and adding a server later {4}

Everything that leaves the browser or comes back goes through one format, `core/snapshot.ts`:

```
the open list (state)
   ├── autosave ─────────▶ localStorage (lists) + IndexedDB (pictures)      ← only the newest tab saves
   ├── File → Save ──────▶ .json, or .zip with its pictures
   ├── Back up all lists ▶ one file with everything
   └── Copy share link ──▶ the list compressed into the link after "#"      ← never reaches a server
```

A server (accounts, sync, share links with pictures) would be one more way in and out of that same format, added
beside the others rather than threaded through the features:

- [ ] a `worker/` folder: a Worker added to `wrangler.jsonc`, storing encrypted list blobs in D1, off unless someone signs in;
- [ ] a "sync" or "publish" provider next to the file and link ones in `features/share`;
- [ ] Turnstile on sign-up, per-account rate limits and size caps in code, and free tiers only (see security.md {3}).

## Adding a feature {5}

1. `src/features/<name>/<name>.ts` with the header, its state object and `setup<Name>()`.
2. Markup in `html/body.html` under a comment naming the feature, or built with `` html`…` `` (tier-engine/safe).
3. `<name>.css` beside it, imported from `styles/app.css` in the right place (later files win ties).
4. Call `setup<Name>` from `wireFeatures()` in `start.ts`, or `loadOnFirstUse` if it's big and rarely opened.
5. Unit tests for any parsing or maths; a browser test for what you see (axe runs WCAG 2.2 AA on new windows).
6. `pnpm verify`, then `pnpm test:e2e`. If the board itself had to change, that change goes in the engine, with its
   own unit tests ({6.1}).

## Group ranking {5a}

The list menu → Combine rankings… (`features/group`, loaded on first use) takes 2–30 share links or list files of the same
list, checks each like any list that's opened (`core/snapshot.ts`, through `readRankedList`), and makes a new list.
The maths is in `core/group-ranking.ts`, with no screens, so it's unit tested on its own:

- **Same item:** a Pokémon by its id; a pack item by its pack row and name; anything else by its name, ignoring case,
  accents and spacing. Items only some people ranked still count, with fewer votes; the same thing twice in one list
  counts once, at its higher place.
- **Score:** each list's tiers are evenly spaced from 1 (top) to 0 (bottom), so lists with different numbers of tiers
  compare; a lone tier is 1. The pool doesn't count. An item's group score is the mean of its scores.
- **Spread:** the standard deviation of its scores. It's in the same units as the score (shown in tiers), and one
  person far off counts for more than several slightly off, which is what "people disagreed" means.
- **Group tiers:** the tier labels most lists share (else the first list's), with that list's colours. Each item goes
  in the tier nearest its mean (exactly halfway goes up), then by score, votes and name.
- **Pictures:** a share link can't carry uploads, so the group list takes the first picture that can travel: sprite
  collections, or web addresses on the sites share links trust (`core/picture-sites.ts`). A picture from any other site
  becomes a text tile, as a link would hold it back. Uploads come along from your own open list and from list `.zip` files.

Nothing is fetched apart from those pictures (and the Pokémon pack, as for any Pokémon list).

## Tests {6}

```
tier-engine/tests/
└── unit/          Vitest: the saved format and its migrations, undo, storage prefixes, share links, escaping, the code rules

tierinator/tests/
├── unit/          Tierinator's saved fields (every old format), packs, templates and their pages, group ranking, Focus and
│                  the grid, CSV, the identity guard, the code rules
├── e2e/           Playwright: the built site in Chromium, desktop and phone, a light system setting too, real security headers,
│                  every outside site stubbed, and an axe-core accessibility sweep
│   ├── fixtures.ts      shared set-up, and the error collector every test checks
│   └── mock-wiki.ts     a fake MediaWiki for the wiki features
└── visual/        optional: ~30 screens compared pixel by pixel, for CSS work (Tierinator)
```

Every browser test fails if the page threw an error or the security policy blocked anything. The engine has no browser
tests of its own: its board isn't a page until an app mounts it, so this suite is its browser tests too.

### Changing the engine and releasing it {6.1}

```sh
# work on the engine and an app side by side (folders next to each other)
cd tierinator && pnpm add tier-engine@link:../tier-engine     # don't commit this change
pnpm dev                                                      # edits in ../tier-engine reload here
pnpm verify && pnpm test:e2e

# release: the engine's docs/hosting.md {1}; then here
pnpm add github:blaziikun/tier-engine#v1.0.0                  # commit package.json and pnpm-lock.yaml
```

A version number says what an app can expect: the last number for fixes, the middle for something new that changes
nothing an app relies on, the first for a change to anything the engine exports (its CHANGELOG.md says what).

## When something breaks {7}

| Symptom | Fix |
| --- | --- |
| `Executable doesn't exist` from Playwright | `pnpm exec playwright install chromium` |
| Port 4173 or 5173 in use | another dev or preview server is running (both apps use them); stop it, or `PORT=4174 pnpm test:e2e` / `pnpm dev --port 5174` |
| The build says `index.html: "<!-- app:body -->" is missing` | the mark is missing from `index.html`; it goes right after `<body …>` |
| An app builds but the page is a step behind the engine | it's on a tagged version; link it while working ({6.1}) or move it to the new tag |
| A browser test fails only on CI | download the `test-results` artifact from the run, open its `trace.zip` with `pnpm exec playwright show-trace` |
| "Refused to…" or Trusted Types errors in the console | something wrote HTML without `setHtml`, or loaded from a site the policy doesn't allow (security.md {2}) |
| Knip says an export is unused | delete it, or stop exporting it if only its own file uses it |
| Types fine in the editor, `pnpm check` fails | point the editor at the project's TypeScript (`node_modules/typescript`) |

## Quick reference {8}

```sh
pnpm dev                    # develop (in an app)
pnpm verify                 # lint + types + knip + unit tests (+ build, in an app)
pnpm test:e2e               # browser tests (a few minutes)
pnpm test:visual            # pixel checks; first run with --update-snapshots
pnpm exec playwright test tests/e2e/share.spec.ts --project=desktop --headed   # watch one file run
```
