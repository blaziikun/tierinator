# Architecture

> How the code is laid out, the few rules that keep it that way, and how to add to it without breaking it.
> Organised like a wardrobe sorted into labelled boxes: not one big pile, not a moulded slot for every sock.
> Lift a box out, change it, put it back, and the others don't notice.

---

## The shape of it {0}

A static site. Vite builds `index.html`, the TypeScript and the CSS into a handful of files; Cloudflare serves them.
Everything runs in the visitor's browser and lists are saved in the browser's own storage. No server, no database, no
account.
Why each part is built this way, and what happens when it goes wrong: [defence.md](defence.md).

```
tierinator/
├── index.html              the app's fixed markup: bars, popovers, windows, sectioned by feature
├── privacy.html            privacy, terms and accessibility (its own small page)
├── public/                 copied as-is: _headers (security), favicon, app icons and manifest.webmanifest, preview
│                           image, robots.txt, packs/pokemon.json, templates/ (the template gallery's lists, see templates.md)
├── scripts/                code that runs in Node: template-pages.ts (at build, below), check-template-titles.mjs
│                           (pnpm check:templates: asks Wikipedia about every template title), identity-guard.ts
│                           (pnpm guard: no private words anywhere public, security.md {8})
├── src/
│   ├── main.ts             start-up: each feature's setup, then storage, packs, the last list. Nothing else
│   ├── testing.ts          test builds only: window.__app for the browser tests
│   ├── lib/                tools that know nothing about tier lists
│   ├── core/               the list itself, no screens
│   ├── pokemon/            Pokémon data tables, sprite addresses, the offline pokemon.zip
│   ├── features/           one folder per feature: its .ts and .css side by side
│   └── styles/             base.css (variables, shared measures and controls), windows.css, fonts/, privacy.css,
│                           template-pages.css, app.css (every stylesheet, in order)
├── tests/                  unit/ (Vitest), e2e/ (Playwright), visual/ (optional pixel checks)
└── docs/                   this, decisions.md, security.md, hosting.md, templates.md
```

## The boxes {1}

```
src/lib/                    ← could be copied into another project as-is
├── html.ts                 html`…` templates that escape everything, setHtml, the Trusted Types policy
├── images.ts               is it really a picture? size limits, SVG → PNG, trimming, cropping, smaller copies of big uploads
├── zip.ts                  reading zips safely (zip-bomb limits), writing them
├── link-data.ts            packing JSON into a link and back (share links), with a size cap
├── csv.ts                  reading and writing CSV the way spreadsheets do, with caps and a formula guard
├── checks.ts               reading untrusted data: isRecord, dig, asText…
├── choice-menu.ts          a button's menu of radio-like choices (the Pool menu, the pool's order)
└── dom, ui, net, color     small helpers: byId, toasts (with Undo) and questions, fetch with timeouts, colour maths

src/core/                   ← the list and its rules
├── types.ts                every shape: a list in memory, pack files
├── state.ts                the open list (state), which lists exist (session), the hooks
├── defaults.ts             a new list: tiers, the built-in theme, settings
├── snapshot.ts             the saved format ⇄ memory, every field checked
├── pack-format.ts          reading pack files, every field checked
├── csv-format.ts           a list as CSV rows and back (Export → CSV, Add items → Open a CSV)
├── template-format.ts      reading template files (public/templates), every field checked
├── group-ranking.ts        combining several people's lists: matching items, scores, the group's tiers
├── picture-sites.ts        the picture addresses trusted without asking (share links, templates)
├── persist.ts              autosave, one tab at a time
├── history.ts              undo / redo: tiers, families, deleted items, the look and the layout
├── storage.ts              IndexedDB (pictures, packs, gallery), delete everything
├── tile-box.ts             a tile's shape and size, and where its picture sits (the board and exports share it)
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
├── offline/                the installable app: sw.js (the service worker, built into dist/sw.js by vite.config.ts),
│                           offline.ts (registers it, offers "Reload" when a new version is waiting)
├── credits/                who made each Wikimedia picture and its licence: the lookup, the item editor's line, the window
├── appearance/ layout/     themes and the Style panel, the two views and the top bar
├── export/ stats/          PNG / SVG / PDF, the stats window
├── stream/                 stream mode: a presenter view for ranking live on video (below)
└── …                       quick-rank, head-to-head, find, tags, variants, forms, keyboard, onboarding
```

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

5. **Markup only through `` html`…` `` and `setHtml`.** A unit test fails on `innerHTML`, `eval` and friends anywhere
   else, and on inline `onclick=`.
6. **Anything from outside is `unknown` until checked:** files, links, storage, websites, packs. One checking module per
   format (`core/snapshot.ts`, `core/pack-format.ts`, `core/template-format.ts`, `core/csv-format.ts`, `lib/checks.ts`).
7. **Every outside picture is checked before it's kept:** uploads, links, wiki and template pictures go through
   `checkedImage` (real type, size and pixel caps); sprite-collection pictures, from fixed addresses, get the type check
   and the 25 MB cap in `fetchSpriteBlob`.

The service worker (`src/features/offline/sw.js`) runs apart from the page and imports nothing; it's plain JavaScript,
copied by the build with this version's file list filled in. How it caches and how updates arrive: hosting.md {7}.

Knip (`pnpm knip`) fails the build on unused files, exports or dependencies, so dead code can't pile up.

### Pages made at build time {2.1}

Besides the app and the privacy page, `pnpm build` writes one small page per template, for search engines:

```
public/templates/*.json ──▶ scripts/template-pages.ts ──▶ dist/t/<id>/index.html   a template's page
   (read through                   (pure functions,      dist/t/index.html         every template, by category
   core/template-format.ts)         unit-tested)         dist/sitemap.xml          every page worth finding
```

- [ ] **The plugin** is `templatePages()` in `vite.config.ts`. It loads `scripts/template-pages.ts` through Vite
      (`runnerImport`) rather than importing it, so the config itself has no extension-less imports for Node to trip on.
      `pnpm dev` serves the same pages fresh on every visit; `pnpm preview` adds the trailing slash as Cloudflare does.
- [ ] **The pages** are plain HTML with no JavaScript, built with the same `` html`…` `` templates as the app (everything
      escaped), and link to `src/styles/template-pages.css`. That stylesheet is a build entry of its own, so it and the
      self-hosted fonts get hashed names like the app's; the plugin finds the name it got.
- [ ] **Shared with the gallery:** `features/templates/template-addresses.ts` (the `/?template=<id>` link, the suggestion
      form's address, the Pokémon pack's card). It imports nothing, so the build can use it too.

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

// ── wiring (runs once at start-up, from main.ts) ──
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
2. Markup in `index.html` under a comment naming the feature, or built with `` html`…` ``.
3. `<name>.css` beside it, imported from `styles/app.css` in the right place (later files win ties).
4. Call `setup<Name>` from `main.ts`, or `loadOnFirstUse` if it's big and rarely opened.
5. A browser test in `tests/e2e/`; unit tests for any parsing or maths.
6. `pnpm verify`, then `pnpm test:e2e`.

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
tests/
├── unit/          Vitest: file formats and share links (hostile ones too), packs, escaping, colour maths, code rules
├── e2e/           Playwright: the built site in Chromium, desktop and phone, a light system setting too, real security headers,
│                  every outside site stubbed, and an axe-core accessibility sweep
│   ├── fixtures.ts      shared set-up, and the error collector every test checks
│   └── mock-wiki.ts     a fake MediaWiki for the wiki features
└── visual/        optional: ~30 screens compared pixel by pixel, for CSS work
```

Every browser test fails if the page threw an error or the security policy blocked anything.

## When something breaks {7}

| Symptom | Fix |
| --- | --- |
| `Executable doesn't exist` from Playwright | `pnpm exec playwright install chromium` |
| Port 4173 or 5173 in use | another dev or preview server is running; stop it, or `pnpm dev --port 5174` |
| A browser test fails only on CI | download the `test-results` artifact from the run, open its `trace.zip` with `pnpm exec playwright show-trace` |
| "Refused to…" or Trusted Types errors in the console | something wrote HTML without `setHtml`, or loaded from a site the policy doesn't allow (security.md {2}) |
| Knip says an export is unused | delete it, or stop exporting it if only its own file uses it |
| Types fine in the editor, `pnpm check` fails | point the editor at the project's TypeScript (`node_modules/typescript`) |

## Quick reference {8}

```sh
pnpm dev                    # develop
pnpm verify                 # lint + types + knip + unit tests + build
pnpm test:e2e               # browser tests (a few minutes)
pnpm test:visual            # pixel checks; first run with --update-snapshots
pnpm exec playwright test tests/e2e/share.spec.ts --project=desktop --headed   # watch one file run
```
