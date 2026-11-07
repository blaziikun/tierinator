# Design defence

> Every part of Tierinator a visitor touches: how it works, why it's built this way and not the obvious other way,
> what happens when things go wrong, what its data costs, and where it stops working. The deeper docs hold the detail;
> this one holds the argument.

---

Each section names its files and functions, so any claim can be checked in the code. Every number is from the code or
from a measured `pnpm build` (7 November 2026); if the code changes, the code wins. Each section ends with its weak
spots, and {26} gathers them in the order I'd fix them.

**Contents**

0. [The whole system on one board](#the-whole-system-on-one-board-0)
1. [Start screen, lists and saving](#start-screen-lists-and-saving-1)
2. [The tier board](#the-tier-board-2)
3. [Tile shape and pool order](#tile-shape-and-pool-order-3)
4. [Adding items](#adding-items-4)
5. [Deleting items](#deleting-items-5)
6. [Templates](#templates-6)
7. [Packs, the Pokémon pack and the studio](#packs-the-pokémon-pack-and-the-studio-7)
8. [Undo and history](#undo-and-history-8)
9. [Style and the look](#style-and-the-look-9)
10. [Exports](#exports-10)
11. [Share links](#share-links-11)
12. [Backups and list files](#backups-and-list-files-12)
13. [Combine rankings](#combine-rankings-13)
14. [Stream mode](#stream-mode-14)
15. [Quick rank and head to head](#quick-rank-and-head-to-head-15)
16. [Stats](#stats-16)
17. [Offline and installable](#offline-and-installable-17)
18. [Security](#security-18)
19. [Keeping my name out of it: the identity guard](#keeping-my-name-out-of-it-the-identity-guard-19)
20. [Privacy](#privacy-20)
21. [Speed and memory](#speed-and-memory-21)
22. [Accessibility](#accessibility-22)
23. [Hosting, deploys and CI](#hosting-deploys-and-ci-23)
24. [What if the site gets popular](#what-if-the-site-gets-popular-24)
25. [Numbers to know](#numbers-to-know-25)
26. [Weak spots, in the order I'd fix them](#weak-spots-in-the-order-id-fix-them-26)

---

## The whole system on one board {0}

```
 git push main ──▶ Actions: Gitleaks, identity guard, audit, lint, types, Knip, unit, browser tests, build ──▶ wrangler deploy
                                                                                                                   │
 Cloudflare (Workers static assets: files from dist/, headers from public/_headers, no Worker code) ◀──────────────┘
   │  index.html, privacy.html, /assets/* (hashed), sw.js, manifest, icons
   │  /templates/*.json, /packs/pokemon.json                     ← data, fetched when used
   │  /t/<id>/ pages, /t/, sitemap.xml                           ← made at build time, no JavaScript
   ▼
 ┌─────────────────────────────── the visitor's browser ────────────────────────────────┐
 │  main.ts: every feature's setupX(), 7 big ones on first use, then start()            │
 │     features/  board, add-items, share, export, stream, group, templates, studio…    │
 │        │ use                                                                         │
 │     core/      state, snapshot (the one saved format), persist, history, storage     │
 │        │ use                                                                         │
 │     lib/       html (escaping + Trusted Types), images, zip, link-data, csv, net     │
 │                                                                                      │
 │  localStorage: pt_lists, ptl_<id>, pt_* settings      IndexedDB "poketier4":         │
 │                                                       sprites, gallery, packs        │
 │  sw.js + Cache Storage: this version's app files, opened templates and packs         │
 └───────┬──────────────────────────────────────────────────────────────────────────────┘
         │ straight from the browser; no server of mine in between
         ▼
   sprites: raw.githubusercontent.com, cdn.jsdelivr.net, archives.bulbagarden.net
   search:  Wikipedia (and any MediaWiki), AniList, Jikan, Kitsu, TVmaze, iTunes, Open Library, REST Countries
   pictures: wherever their addresses point; wsrv.nl when a site won't let a picture be copied
   fonts:   Google Fonts, only for a font other than the two the site serves itself
```

Everything else follows from eight decisions:

| Decision | Why | The alternative, and why it lost |
| --- | --- | --- |
| **No server, no accounts** | Ranking needs no server. Without one there's no login to steal, database to leak, API to flood or bill to run up | Accounts and sync: a real feature, but it buys a whole attack surface and a running cost for something files and links already cover. The way to add one later is in architecture.md {4} |
| **Everything in the browser** | Lists in `localStorage`, pictures in IndexedDB; the visitor's own device does the work | Server storage: see above. The cost is that lists live in one browser, so backups, list files and share links exist |
| **One saved format, checked on the way in** | `core/snapshot.ts` turns every list (storage, files, backups, links) into memory and back, checking every field | A checker per feature: more places to forget a check. Old short keys (`sz`, `famM`, `F`) stay so every old file opens |
| **Strict CSP and Trusted Types** | Scripts only from this site, no inline script, no `eval`; markup only through `` html`…` `` + `setHtml` | Sanitising HTML (DOMPurify): needed only if the app accepted HTML, which it never does. Escaping is simpler and total |
| **Plain TypeScript modules on the DOM, no framework** | The busy parts (dragging among 1,343 tiles, box select, canvas exports) are direct DOM work anyway | React: about 45 KB, a rewrite, and `ref`s in exactly the hot paths. decisions.md {3} |
| **Static hosting on Cloudflare, deployed only from green CI** | Free with no request limit for static files, reads `_headers`, domain already there | GitHub Pages can't send headers (no CSP). Netlify or Vercel: another account. Cloudflare's own Git builds deploy even when tests fail |
| **Rare things load on first use** | `loadOnFirstUse` in `main.ts` for 7 features; `import('jspdf')`, `import('fflate')` | One bundle: every visitor would download a 393 KB PDF library to rank five pictures |
| **A small hand-written service worker** | ~100 lines, network first for pages, a new version waits for "Reload" | `vite-plugin-pwa` (Workbox): brings Babel and Rollup into the build, and its `importScripts` and string registration break the Trusted Types policy |

Deeper: [architecture.md](architecture.md) (layers and rules), [decisions.md](decisions.md) (every tool choice),
[security.md](security.md) (threats), [hosting.md](hosting.md) (settings and caching).

**Common questions**

- **"So where's the back end?"** There isn't one. Cloudflare serves files; the browser does everything else. The only
  servers involved are the public ones a feature talks to directly (sprites, searches, Wikipedia), and they see the
  visitor's request as if the visitor had gone there.
- **"How do you stop the code turning into a ball of mud without a framework?"** Three layers with one-way imports
  (`lib` → nothing, `core` → `lib`, features → anything), hooks (`onListReset`, `onListOpen`, `onHistoryRestore`) when a
  lower layer must tell features something, one state object, and Knip failing the build on dead code.
- **"What's the single most important file?"** `core/snapshot.ts`: everything that's saved or shared passes through it,
  and it's where hostile input is turned into safe values.

---

## Start screen, lists and saving {1}

**How it works**

```
start() in main.ts
  openDatabase('poketier4', 3) ─ fails? storage.db = null (lists still work)
  installStoredPacks, loadGallery, buildAppearancePanel
  openStartingList (features/lists/lists.ts)
     pt_lists ─▶ session.lists          shared lists not kept (preview) are forgotten
     empty? recoverListIndex scans every ptl_* key and rebuilds the index
     still empty? one untouched "My tier list" ─▶ the start screen shows over it
     openList(pt_cur, or the first list)
  openShareLinkIfAny, openTemplateLinkIfAny, probeNetwork (Pokémon lists only), updatePokemonPack

openList(id): saveNow(old) ─▶ read ptl_<id> ─▶ resetListState ─▶ session.generation++
   ─▶ Pokémon list without the pack? fetch /packs/pokemon.json ─▶ readOwnItems ─▶ rebuildEntries
   ─▶ applySnapshot (readStored checks every field) ─▶ loadSavedPictures (IndexedDB keys "<id>:…")
   ─▶ draw ─▶ restorePickedSprites (4 at a time, 3 tries each)
```

Two menus split the work: the list menu (top left) is *which* list: new (blank, Pokémon, alignment chart, from a
template), switch, duplicate, delete, Combine rankings, Stream mode, packs. File is *this* list's files and the outside
world: save, load (lists, backups, zips and packs alike), share link, export, back up all lists, About & privacy.

The start screen (`features/start/start.ts`) shows while the open list is the untouched starting list; the first real
list (template, Pokémon, file) replaces it (`emptyStartingList`, `dropEmptyStartingList`).

| Where | Key | Holds |
| --- | --- | --- |
| localStorage | `pt_lists` | The index: `{ id, name, kind, updated, count, pack?, preview? }` per list |
| | `ptl_<listId>` | One list in the stored format (`StoredList`, `v: 10`) |
| | `pt_cur`, `pt_tab` | The list open last; the tab in charge of saving |
| | `pt_themes`, `pt_theme_default`, `pt_palette`, `pt_tiers`, `pt_bar`, `pt_view`, `pt_stream`, `pt_statk`, `pt_coll`, `pt_stlist`, `pt_tips`, `pt_firstseen`, `pt_lastbackup`, `pt_nudgesnooze` | Settings that belong to the browser, not a list |
| IndexedDB `poketier4` (v3) | `sprites`: `"<listId>:<itemId>"`, `"<listId>:x<itemId>~<n>"` | Each list's pictures as Blobs (picked, uploaded, extra choices) |
| | `gallery` | Your own pictures per Pokémon, shared by every list |
| | `packs`: `"pokemon"`, `"gp:<packId>"` | Installed packs |

**Saving.** `autosave()` (`core/persist.ts`) waits 500 ms after the last change, then `writeCurrentList` rewrites
`ptl_<id>` and the index row (`updated`, `count`). `saveNow` runs on `pagehide` and before another list opens. The first
time there's something worth keeping, it asks `navigator.storage.persist()` so the browser doesn't evict the site.

**One tab at a time.** Each tab writes a random id to `pt_tab` at start-up. The `storage` event fires in every *other*
tab; an older tab saves what it has, sets `otherTabInCharge`, stops saving and shows "Use this tab instead" (a reload,
which reads the newest saves and takes charge back).

**Why this and not that**

- **localStorage for lists:** it's synchronous, so the save in `pagehide` finishes before the page goes; an IndexedDB
  transaction started there may not. A list is small JSON (a fully ranked Pokémon list with a cropped pick for all
  1,343 entries is about 210 KB; 300 own items with web pictures and credits about 96 KB).
- **IndexedDB for pictures:** it stores Blobs as they are (no base64), has a far bigger quota, and doesn't block the page.
- **One key per list:** opening a list reads one key, and a bad write can only damage that one list.

**What happens if…**

- **Storage is blocked** (some private windows): `openDatabase` throws, `storage.db` is null, lists still save in
  localStorage, and the first picture saved says, once a visit, that this browser isn't keeping pictures and to save
  the list (`warnPicturesNotKept`, `core/storage.ts`). Every localStorage call is in `try`.
- **IndexedDB is full:** the same warning, once a visit.
- **localStorage is full or blocked:** `writeCurrentList` shows "Your changes aren't being saved…" with what to do, once,
  and again only after a save has worked in between, so it neither nags on every change nor goes quiet for good.
- **The index is lost** (cleared, or a crash between writes): `recoverListIndex` rebuilds it from the `ptl_` keys.
- **The browser clears site data:** gone, unless backed up. Hence the persist request and the backup reminder (after two
  weeks with 15+ ranked, at most weekly: `nudgeBackup`).
- **A slow download finishes after the list changed:** `setPick` compares `session.generation` and drops it.
- **Two tabs edit the same list:** the newer one wins; the older one stops writing the list (`tabs.spec.ts`).

**Why this data structure:** an index array (one small row per list) plus one key per list makes the list menu and
opening one list cheap. The cost: every save rewrites the whole list (fine at hundreds of KB), and the shared
quota is typically around 5 MB per site, so roughly two dozen fully picked Pokémon lists fit.

**Where it fails**

- A failed save shows a toast once, then a red "Not saved" mark beside the list's name stays until a save works
  (`data-unsaved` on the page, set in `core/persist.ts`). It says the problem; it can't free space by itself.
- The tab guard covers the open list only; an older tab can still write settings (themes, palette).

**Common questions**

- **"Why localStorage for lists but IndexedDB for pictures?"** Lists are small and must save synchronously as the page
  closes; pictures are big binary files that IndexedDB stores natively with a much larger quota.
- **"What if two tabs edit the same list?"** The newest tab takes charge through `pt_tab` and the `storage` event; the
  older one saves first, then stops and offers to reload. Without that, the last tab closed would write an old copy
  over the newer one.
- **"Why not store lists on a server?"** No accounts means nothing to breach and nothing to pay for. Moving lists is
  covered by backups, list files and links.
- **"What if the user clears their browser?"** The lists are gone; that's the honest cost. The app asks for persistent
  storage and nags for a backup once there's something worth losing.

---

## The tier board {2}

**How it works**

```
state (core/types.ts ListState, one object)
  tiers: Tier[]          { id, label, subtitle, color, textColor, items: ItemId[] }   ← array order is the ranking
  ownItems: OwnItem[]    { id ≥ 2,000,000, name, w?, credit?, alts?, pk?, pkx?, vars? }
  picks: {id: Pick}      { path, crop?, anim?, trim?, remote?, text? }
  familyOf: {variant → main}   combinedFamilies: {main → true}   tags, notes, theme, layout, tileShape, poolOrder…
derived (core/items.ts): entries, entryById, formsByDex, isRankable(id)
on screen (core/state.ts): tileById: Map<ItemId, HTMLElement>   ← one tile per item, made once, moved around
the pool: not stored ── every rankable entry not in a tier, shown in poolOrder ({3})
```

- **Entries:** a Pokémon list has 1,025 species and 318 forms from the pack (ids below 2,000,000) plus own items. A form
  is ranked on its own if its category is split or it has an override (`isRankable`). Variants are own items whose
  `familyOf` points at a main item; a combined family shows one tile with a "+N" badge and answers searches for its
  variants' names (`rebuildAliases`). Chains (a → b → c) are flattened when read.
- **Drawing:** `renderTiers` builds the rows; `placeAllTiles` moves existing tiles into a fragment per row and the rest
  into the pool. Tiles are created once (`ensureTile`). Images are `loading="lazy"`, so a 1,343-tile pool downloads only
  what's on screen. Filters hide tiles with `display: none`.
- **Dragging** (`tier-board/drag.ts`): pointer events. A press becomes a drag after 6 px; `elementFromPoint` finds the
  row and tile under the pointer, and before/after is half the tile's width. Near an edge (60 px) the area scrolls. On
  touch a moving finger scrolls; you tap to select, then tap a tier label. Empty space starts a box selection.
- **Selection:** a `Set<ItemId>` plus where it came from (`'pool'`, a tier id or `'mixed'`); Shift for ranges,
  Ctrl/⌘ to add from elsewhere.
- **Keyboard** (`tier-board/tile-keys.ts`): arrows move by where tiles are *drawn* (`neighbour` measures boxes, so it
  works for wrapped rows, the sidebar pool and charts), Space selects, 1–9 sends, Alt+arrows move one item.
- **Every change** is `pushHistory()` → change the arrays → `placeAllTiles()` → `autosave()`.

**Why this and not that**

- **Pointer events, not HTML5 drag and drop:** native drag and drop doesn't work on touch, can't carry a multi-selection
  nicely and gives little control over the ghost and scrolling.
- **An array per tier:** the order *is* the ranking; a move is remove plus `splice`. A linked list or position numbers
  would make the common case (drawing a row in order) harder for no gain at these sizes.
- **Tiles kept, not rebuilt:** a framework would diff a virtual tree on each move; here a move is the browser moving
  existing nodes, and pictures never reload.

**What happens if…**

- **A list file puts an item in two tiers, or names an item that doesn't exist:** `readTiers` keeps the first place and
  drops unknown ids. Colours that aren't `#rrggbb` become grey; labels are cut to 40 characters, subtitles to 60.
- **A file with 5,000 tiers or a million items:** `readTiers` keeps the first 100 tiers and `readOwnItems` the first
  20,000 items (a pack's limit). A repeated tier id gets a fresh one; a repeated item id keeps its first item.
- **A huge list** (a pack can have 20,000 items): every move re-places every tile and filters every tier, O(n). Fine at
  a few thousand; it would stutter at tens of thousands.
- **A picture fails to load:** the tile's `error` handler repairs it (`healSprite`: new address, then refetch), tries the
  next mirror for a default sprite, or shows the built-in sprite.

**Why this data structure:** the item → tile `Map` makes "where is this item's tile" O(1) and lets one tile serve tier
and pool. Storing only tiers (not the pool) means the pool can't disagree with them. Expensive: anything that needs "which
tier is X in" scans the tiers (`tier.items.includes`), and every move redraws all placements.

**Where it fails:** no virtual scrolling, so every tile is in the DOM, and every move re-places every tile (and sorts
the pool again when it's in A–Z or shuffled order). Fine at a few thousand items, the size of the biggest real lists;
at the 20,000 a pack allows it would stutter. I'd re-place only the rows a move touched.

**Common questions**

- **"Why not just use React?"** The work here is moving 1,343 existing nodes and drawing canvases. React adds about 45 KB,
  a rewrite of working screens, and escape hatches in exactly these paths. Escaping, the only thing I'd want from it,
  is `lib/html.ts` in 73 lines.
- **"How does it know where I dropped?"** `elementFromPoint` at the pointer; the row's `data-tid` and the tile's half.
- **"Why is the pool not saved?"** It's derived: everything rankable not in a tier. Saving it would be a second source
  of truth that could disagree.
- **"How does keyboard ranking find the tile below?"** It measures: the nearest row of tiles below, then the tile in it
  closest to the current tile's centre, because rows wrap and charts are grids.

---

## Tile shape and pool order {3}

**How it works**

- **Tile shape** (Style → Shape & spacing; `tier-board/tile-shape.ts`, the arithmetic in `core/tile-box.ts`): square,
  portrait 2:3 (posters, book covers) or landscape 16:9 (thumbnails), each picture shown whole (`contain`) or filling
  its tile (`cover`). Every shape holds as much picture as a size × size square: width × √ratio, height ÷ √ratio
  (`tileScale`), so the size slider means the same for every shape and the board stays about as full. The shape goes on
  the page as CSS variables that the board, chart and Stream stylesheets size tiles with. A picture with a crop box gets
  a view of the tile's shape centred on it (`cropView`); pixel art shown whole goes up in whole steps (`fitPicture`).
  Text tiles always show whole, since filling would cut their words off (`pictureFit`).
- **Pool order** (the pool's Order menu; `tier-board/pool-order.ts`): order added (Pokédex order on a Pokémon list),
  A to Z, Z to A, or shuffled. Names compare as people read them (`Intl.Collator`, numeric, case and accents aside, so
  "Item 2" comes before "Item 10"); equal names keep the order they were added in. A shuffle gives each item a place from
  a hash of its id and a seed (`shufflePlace`) instead of shuffling the list; choosing Shuffled again picks a new seed,
  never the one in use (`nextShuffleSeed`).
- **Where the pool goes:** one Pool menu (beside, below, hidden; `lib/choice-menu.ts`), with B still switching sides.
- **Saved per list:** `shape`, `fit`, `psort`, `pseed` in the stored format. Shape and fit are in every undo step and
  travel in share links; the pool's order is a view setting and stays behind. Only the screen changes: the ranking and
  the saved order of items never do.

**Why this and not that**

- **Equal area, not equal width:** a portrait tile as wide as a square one would make the board half as dense again;
  equal area keeps the slider honest.
- **One arithmetic module for board and exports:** what's exported is what's on screen, and the maths is unit-tested
  without a page (`tile-box.test.ts`).
- **A hash per item, not Fisher–Yates on the list:** with a list shuffle, ranking one item or bringing one back would
  reshuffle everything still in the pool; with a place per item, the rest stay still.

**What happens if…** an old list opens: square, whole, order added (the fields are missing, so the defaults apply). A
file names a shape or order that doesn't exist: `isTileShape`, `isTileFit` and `isPoolSort` refuse it; a seed that
isn't a safe whole number becomes 1. Undo crosses a shape change: the shape comes back with the tiers.

**Why this data structure:** two words and `{ by, seed }`; nothing to store per item. Expensive: in A–Z or shuffled
order the pool is sorted again every time tiles are placed, O(n log n) on every move.

**Where it fails:** fill always crops to the centre, so the top of a portrait photo (a face) can be cut, with no focus
point to choose. The pool has no order of its own making.

**Common questions**

- **"Why not let people drag the pool into their own order?"** The pool is derived (everything not ranked), so a manual
  order would be a second list to keep in step with the first; the four orders cover finding things and a fresh start.
- **"Why does choosing Shuffled again give a new order?"** It picks a new seed, never the same one, so the button
  always visibly does something.

---

## Adding items {4}

**How it works**

```
upload, paste, drop ─▶ checkedImage ─▶ preparePicture (trim, or crop box if animated) ─▶ shrinkPicture(1024) ─▶ setPick ─▶ IndexedDB
type a list ───────▶ textTile: a 256 px canvas, colour from a hash of the name, the largest font that fits
open a CSV ────────▶ decodeCsvBytes (UTF-8, else Windows-1252) ─▶ readCsvRows ─▶ names on the list reused ─▶ addItems(…, 4)
search the web ────▶ WEB_SOURCES (add-items/web-sources.ts, anime-sources.ts) ─▶ only https pictures ─▶ addItems
from a wiki ───────▶ wiki/engine.ts (one request per ~260 ms, slower on 429 or 5xx) ─▶ addItems(…, 5) + credits
image links ───────▶ one "name https://…" per line ─▶ addItems

a web picture: fetchSpriteBlob(url): getBytes (25 MB, 20 s) ─▶ sniff the bytes ─▶ checkedImage
   failed? the same through https://wsrv.nl/?url=…   failed again? showRemotePick: shown from its address, not copied
```

`addItem` (`features/items/items.ts`) gives the item an id from `nextItemId` (starting at 2,000,000), adds it to
`ownItems` and `entries`, and falls back to a text tile if the picture can't be used. `addItems` runs several at once
with a Cancel button.

**Why this and not that**

- **Copy pictures instead of hotlinking:** exports need the pixels (a cross-site picture without CORS taints a canvas),
  lists work offline, and sites move files. Hotlinking is only the last resort (`remote`).
- **wsrv.nl as the fallback:** a free image proxy that adds CORS, so a site that blocks copying still gives a copy. The
  cost: wsrv.nl sees the picture's address and the visitor's IP (said on the privacy page).
- **Uploads kept at 1,024 px:** the biggest export detail is 1,024 px a picture and the largest card is 256 px (768
  device pixels on a 3× phone). A 2,000 px photo decodes to 16 MB; the 1,024 px copy to 4 MB.
- **Free, keyless APIs:** no key to leak, and requests count against each visitor, not the site.

**What happens if…**

- **The file isn't a picture** (a renamed file, a 200 error page): `sniffImageType` reads the first bytes; no match, no item.
- **An SVG with a script inside:** redrawn as a PNG (512 px) through an `<img>`, where scripts never run.
- **A decompression bomb** (a tiny file claiming 60,000 px square): `headerSize` reads the header first; over 50 million
  pixels or 25 MB is refused before decoding. Canvas work stops at 40 million pixels.
- **An animated GIF, APNG or WebP:** never redrawn (that keeps frame one); trimmed with a crop box on screen instead.
- **A search site is down:** "Couldn't reach … Check your connection." The anime searches ask three sites at once and
  show what answered, with a note naming the one that didn't.
- **A wiki pushes back:** the engine slows down and retries with waits.

**Why this data structure:** a `Pick` is a path string plus flags. The path says where to get the picture again
(`'custom'`, `gal:…`, `xp:…` live only here; an `https` address or a sprite path can be refetched), which is what backups,
links and repairs all need. Expensive: the picture itself lives apart (IndexedDB), so a list is two stores to keep in step.

**Where it fails:** a picture whose header I can't read (some AVIFs) is measured by an `<img>` first, which reads the
size without decoding the pixels (`measuredSize` in `lib/images.ts`); if even that fails, it's refused. Sprite-collection pictures get the byte sniff and the 25 MB cap but not `checkedImage`'s
pixel cap (they come from fixed hosts). Template downloads run one at a time.

**Common questions**

- **"What if someone uploads a 50 MB picture?"** Refused: 25 MB is the cap, checked before reading it.
- **"Why not keep the original upload?"** Nothing in the app shows or exports more than 1,024 px, and four times the
  memory per picture adds up over hundreds of items.
- **"Isn't fetching any URL the user types dangerous?"** It's the visitor's own browser fetching an address they chose,
  with no referrer, a size cap, a timeout and a byte check; nothing fetched is ever run.
- **"What does a text tile cost?"** One 256 px PNG drawn on a canvas; the colour is a hash of the name, so it's stable.

---

## Deleting items {5}

**How it works**

```
Delete in the item editor, or Delete in the selection bar ─▶ deleteItems(ids)  (features/items/delete-items.ts)
  remember each: the OwnItem, its index, its tier and position, pick, Blob (or web address), tags, note, family, extra pictures
  pushHistory({ deletion: n, itemsExist: true }) ─▶ takeOut: out of tiers, ownItems, families, tags, notes, picks;
     blob: addresses revoked, tiles removed ─▶ toast "Deleted “Name”" [Undo], 8 s
  after 8 s, or when the page is hidden or another list opens ─▶ their pictures leave IndexedDB
Undo button ─▶ the same as Ctrl/⌘ Z if nothing has changed since; otherwise putBack, as a step of its own
Ctrl/⌘ Z across the marked step ─▶ putBack (pictures written back if they'd already left) ─▶ then the tiers come back
Ctrl/⌘ Shift Z ─▶ deleted again, as they are now
```

The last 20 deletions are kept (`KEPT_DELETIONS`); an older one can't come back, and undo past it restores the tiers
without its items. Only your own items can be deleted; Pokémon belong to the pack.

**Why this and not that**

- **Undo, not "Are you sure?":** a question gets clicked through out of habit and still loses the item; an undo is
  faster when it's right and forgiving when it's wrong.
- **Pictures stay in IndexedDB for the toast's time:** the common case, Undo straight away, writes nothing. They go
  when the page is hidden because a hidden page may never come back; a later Undo writes them back from memory.
- **A marker in the history, not the items in every step:** pictures are too big to copy into 80 snapshots ({8}).

**What happens if…** a main item and its variants go together: they come back first, then their families are rebuilt.
Something is renamed between undo and redo: redo remembers it as it is now, so the next Undo brings that back. The tab
closes within 8 s: `pagehide` clears the pictures and the deletion is final. Deleting by keyboard: focus moves to Undo
rather than being lost with the button that went.

**Why this data structure:** a `Map` of deletion number → what was removed, capped at 20, and history steps that carry
only the number. Cheap: deleting copies no pictures (the same Blobs are held). Expensive: up to 20 deletions' pictures
stay in memory until another list opens.

**Where it fails:** there's one toast, so any later message replaces the Undo button (Ctrl/⌘ Z still works); after a
reload, deletions are final.

**Common questions**

- **"What if I press Undo a minute later, after the pictures left storage?"** They're still in memory, so `putBack`
  writes them back to IndexedDB.
- **"How much memory does that hold?"** The pictures of at most 20 deletions, which were in memory while the items
  existed anyway.

---

## Templates {6}

**How it works**

```
public/templates/index.json ─▶ the gallery's cards (text only)          features/templates/templates.ts (lazy, 3.5 KB gzip)
public/templates/<id>.json  ─▶ readTemplate (core/template-format.ts) ─▶ createList ─▶ the template's own tiers, if any
en.wikipedia.org            ─▶ findFreePictures: pageimages, pilicense=free, 50 titles a request, 300 ms apart
                            ─▶ findPictureCredits: author and licence (imageinfo extmetadata), 50 files a request
upload.wikimedia.org        ─▶ each picture copied like any web picture; none? a text tile

build time: scripts/template-pages.ts ─▶ dist/t/<id>/index.html, dist/t/index.html, dist/sitemap.xml
link:       /?template=<id> ─▶ template-link.ts opens it at start-up, then removes the parameter
```

There are 124 templates of 12 to 57 items. A unit test reads every file (`tests/unit/templates.test.ts`), so a broken
template fails CI. Credits are stripped to plain text (`plainTextFromHtml`), then checked like any saved field
(`readPictureCredit`).

**Why this and not that**

- **JSON files in the repository, not a database:** a pull request is the moderation step; there's nothing to host or
  pay for; the tests read them all.
- **Wikipedia's lead picture with `pilicense=free`:** no picture of anything is stored here, so nothing copyrighted is
  hosted, and each picture keeps its author and licence.
- **Pages made at build time:** search engines get plain HTML with no JavaScript, built with the same escaping
  `` html`…` `` as the app.
- **`?template=` rather than `#`:** a plain link anyone can paste, and it can't be mistaken for a share link (`#l=`),
  which wins if both are present.

**What happens if…**

- **Wikipedia is down:** items get text tiles and a toast says why; Cancel stops the lookup and gives the rest text tiles.
- **A template file is missing:** Cloudflare answers any unknown address with the app's HTML and a 200, so `getJSON`
  fails to parse and a toast says to check the connection.
- **A broken or unknown link id:** `isTemplateId` refuses it, or the catalogue doesn't list it: a toast, normal start.
- **Offline:** a template opened before comes from the service worker's data cache.
- **A contributor adds a picture address on an unknown site:** `template-format.ts` drops it (only `https` on
  `isKnownPictureAddress`), and the item gets the Wikipedia picture or a text tile.

**Why this data structure:** one catalogue file (cards) plus one file per template means browsing costs one small
request and opening costs one more. Expensive: the catalogue line and the template must agree (title, category, count),
which the unit test enforces.

**Where it fails:** an unknown `/t/<id>/` is the app with a 200, not a 404; the pictures are only as good as each page's
lead picture (logos and posters aren't free, so they come out as text tiles).

**Common questions**

- **"How do you stop someone adding a copyrighted picture?"** There's no picture to add: an item names a Wikipedia page,
  and Wikipedia only answers with a lead picture it marks as freely licensed.
- **"Why not render template pages in the app?"** Search engines and link previews do best with plain HTML; these
  pages cost nothing to serve and run no script.
- **"What does the sitemap list?"** The app, `/t/`, every template page and the privacy page.

---

## Packs, the Pokémon pack and the studio {7}

**How it works**

```
a pack file (format 2, any franchise)        GenericPack: id, name, items: PackRow[], base?, thumb?, facets?, colors?
  PackRow = [name, tags, pictures: [group, source, label?][], wikiTitle?, variantOfRow?]
  picture source = https address | data:image/… under 2 MB | file name ─▶ base + name + thumb (base must be https)

the Pokémon pack: public/packs/pokemon.json, 363 KB (about 72 KB gzipped), no artwork
  roster (1,025), forms (318), index (sprite folders packed as dirs, sets, per-species stems), go, pmd, lore, defCrop
  installed into IndexedDB "packs" the first time a Pokémon list opens; each start compares its version with the site's

a sprite path ─▶ spriteUrlsFor (pokemon/sprite-urls.ts)
  PokeAPI path ─▶ raw.githubusercontent.com, else cdn.jsdelivr.net (the one that worked is tried first)
  go:… pmd:…   ─▶ the same two mirrors of PokeMiners and PMDCollab
  lore:…       ─▶ archives.bulbagarden.net only (can't copy? shown from the web)
  a pokemon.zip or folder loaded? read from it first (pokemon/local-source.ts), only the files shown
```

`core/pack-format.ts` checks every pack: at most 20,000 items and 200 pictures each, texts cut, unknown schemes refused,
a broken row refuses the whole pack (it would shift every variant index after it). The Sprite Studio (`features/studio`)
browses every sprite of a Pokémon, one style for all, or "my sprites"; for your own items it's a picture chooser. Its
1,300-row list is built the first time the studio is shown (`buildStudioList`), not when a list opens
(`tests/e2e/memory.spec.ts`). The pack builder (`features/pack-builder`, lazy) turns any MediaWiki into a pack through
`wiki/engine.ts`.

**Why this and not that**

- **Sprites load from public collections, not this site:** they're Nintendo's art; hosting them invites takedowns, and
  serving gigabytes would cost money. The pack is only an index of where they are.
- **A packed index, not a list of addresses:** many games share the same files, so folders are grouped into `sets`; the
  whole index fits in 363 KB.
- **The pack in IndexedDB, not localStorage:** 363 KB of JSON would eat a big share of the localStorage quota.

**What happens if…**

- **GitHub is blocked** (school or office networks): jsDelivr is tried; `probeNetwork` marks "blocked" after three
  failures and the pickers offer a `pokemon.zip` instead.
- **A sprite stops showing:** `healSprite` rebuilds its address, then refetches; `restorePickedSprites` fetches missing
  ones 4 at a time with 3 tries, 1.5 s × attempt apart, so a big list doesn't trip GitHub's limits.
- **The site's pack changes:** `updatePokemonPack` installs it when the version differs.
- **A hostile pack:** checked like a list; `base` must be `https`, `thumb` can't hold quotes or spaces.

**Why this data structure:** rows as arrays (not objects) keep a 20,000-item pack small; variants point at a row
index, so a family is one integer. Expensive: rows can't be reordered without renumbering variants, which is why one
broken row refuses the pack.

**Where it fails:** sprites depend on two public hosts I don't run; if a network blocks both, only the offline zip
helps. The index is rebuilt by hand when new games add sprites. (Two earlier gaps are closed: a pack's default sprite
paths now pass the same `isPicturePath` check as list files, and `probeNetwork` runs once a visit, only while a Pokémon
list is open, through `onListOpen` in `main.ts`.)

**Common questions**

- **"Why not host the sprites yourself?"** Copyright and cost. The app stores an index and the visitor's own browser
  fetches from the public collections.
- **"What if GitHub rate-limits a big list?"** Four at a time, retries with growing waits, the mirror, and the offline zip.
- **"What's in a pack that makes it safe to open?"** Only what `pack-format.ts` lets through: capped counts, cut texts,
  `https` or embedded pictures, and nothing that can become code.

---

## Undo and history {8}

**How it works:** `core/history.ts`. Before a change, `pushHistory()` pushes a JSON string of
`{ t: tiers, f: familyOf, m: combinedFamilies, th: theme, ly: layout, lc: chartColumns, ts: tileShape, tf: tileFit }`.
Undo pops it, pushes the current state onto redo, and puts it back through `sanitizeTiers` (unknown ids dropped);
`onHistoryRestore` listeners redraw. At most 80 steps; a new change empties redo; another list empties both.
`asOneUndoStep` makes several changes one step (a slider drag counts once).

A step can also be marked with a deletion: `del` (its number) and `kept` (whether the items exist on that side of it).
When undo or redo crosses a marked step, `onDeletionCrossed` hands it to `features/items/delete-items.ts`, which puts
the items back, or takes them out again, *before* the tiers are restored, because `sanitizeTiers` keeps only items that
exist ({5}).

**Why this and not that:** whole snapshots, not a command log. A command needs an exact inverse for every change; a
snapshot can't drift out of step with the code that made it. The cost is memory, and it's bounded. Deletion is the one
place a snapshot wasn't enough: items and their pictures are too big to copy into every step, so a step only names the
deletion and the items are kept in one place.

**What happens if…** a step comes from an older version (just a tiers array, or no tile shape): it's still read. Undo
after Stream mode's "from scratch": one step brings the old ranking back. Undo across a deletion older than the last 20:
the tiers come back without those items, as they always did.

**Why this data structure:** a stack of strings. Pushing is one `JSON.stringify` (a fully ranked Pokémon list's tiers
are about 6 KB), so 80 steps are well under 1 MB; a string can't be mutated by later changes.

**Where it fails:** only tiers, families, the look, the layout, the tile shape and deletions are recorded. Adding items,
changing a picture, tags and notes aren't undo steps (an added item goes by deleting it).

**Common questions**

- **"Why not the command pattern?"** More code and an inverse to get right for every action; snapshots are smaller than
  they look and can't be wrong.
- **"Why 80?"** Enough for a long session at well under a megabyte.
- **"How does Ctrl/⌘ Z bring back a deleted item with its picture?"** The step only says "deletion 7, the items existed
  here". The items, their places, tags, notes, families and picture Blobs are held by `delete-items.ts` for the last 20
  deletions; crossing the step puts them back, then the tiers are restored around them.

---

## Style and the look {9}

**How it works:** a `Theme` (`core/types.ts`) is colours, two fonts, weights, sizes, radius, spacing and logo style,
saved with each list and in a library (`pt_themes`). `applyTheme` (`features/appearance/theme.ts`) writes CSS variables,
so the Style panel changes the page live. Every theme from outside goes through `sanitizeTheme`: colours must be
`#rrggbb`, fonts must be in the `FONTS` list, numbers are clamped (radius 0–20, label column 70–260 px…), unknown keys
dropped. Playfair Display, Instrument Sans and Geist Mono are served by the site (38.4, 30.1 and 23.1 KB woff2); any
other font is a `<link>` to Google Fonts the first time it's used (`loadFont`). Text that would be hard to read on a
theme is swapped for black or white (`contrastRatio`).

- **Dark only.** One built-in look (`DEFAULT_THEME`, `core/defaults.ts`), and every new list starts with it. The light
  one that used to be built in is gone; a list saved with it still opens light, because a theme is stored whole, and
  `sanitizeTheme` treats it as an edited copy of the built-in look.
- **The interface font.** New lists set the interface in Instrument Sans at 13 px; lists saved while it was Geist Mono
  at 12 px keep that, for the same reason (a unit test opens one, `tests/unit/theme.test.ts`). Geist Mono stays for
  shortcut keys and Pokédex numbers, whatever the theme, since those have to line up.
- **The measures:** roundness, control height, lines and shadows are variables in `styles/base.css` worked out from the
  theme (`--r-chip`, `--r-ctl`, `--r-panel`, `--r-win` from Roundness; `--edge`, `--chosen` from the text colour), so a
  theme with other colours or roundness keeps the same proportions. The edge of a field and a chosen tab stand 3:1
  against the panels in the built-in look; text stands at least 4.5:1 (muted text on the lightest panel: 4.8:1).

**Why this and not that:** dark only, not two built-in looks: one look to design, check for contrast and test at two
widths, the same on screen, in exports and on a stream; tier colours and pictures read best on a quiet dark ground.
Anyone who wants light can make it in Style and save it as a theme. CSS variables, not a preprocessor: SCSS compiles
away, and these change while you watch. `style-src 'unsafe-inline'` is allowed for that reason; CSS can't run script,
and every value is checked first.

**What happens if…** a shared link carries a strange theme: it's sanitised like a file. It names a Google font: the
opener's browser asks Google for it (said on the privacy page). A theme makes text unreadable: the guard swaps it. An old
list saved with the light look: it opens as it was saved. An old list set in Geist Mono: it stays so, and its theme card
says "(edited)"; ↺ on the card brings the built-in look, Instrument Sans included.

**Where it fails:** the page no longer follows the system's light setting; someone who reads better on light (bright
rooms, some eyesight) has to make a light theme by hand. A theme can still be ugly; only readability is guarded. A
shared theme's font contacts Google without asking first.

**Common questions**

- **"Why dark only? Isn't that an accessibility problem?"** Contrast is checked either way; what dark-only loses is the
  automatic switch. I chose one look done well, with Style as the way to any other, over two looks half-tested.
- **"Doesn't `'unsafe-inline'` for styles undo the CSP?"** No: it's for styles only. Scripts stay locked to this site,
  and every colour is a checked hex value, so nothing can smuggle in a `url(…)`.
- **"Why self-host three fonts?"** So an ordinary visit never contacts Google (a German court fined a site over
  Google-hosted fonts), and the first paint doesn't wait on another site.
- **"Why a proportional sans for the interface, and mono only for keys and numbers?"** A monospace makes every label
  wide and every sentence look like code; a narrow sans fits more in the top bar and reads faster. Characters that have
  to line up or be typed exactly are where a monospace earns its width.

---

## Exports {10}

**How it works**

```
layoutExport (export/layout.ts): rows or chart cells, labels fitted, tiles placed ─┬─ SVG: strings, every text escapeHtml'd
                                                                                   ├─ PNG: one canvas, scaled
                                                                                   └─ PDF: jsPDF (loaded on use)
listAsCsv (core/csv-format.ts): Tier, Position, (Number), Name, Picture
```

- `fontsReady` waits for the theme's fonts so measuring and drawing agree.
- `drawPicture` draws each item on a reused canvas, cropped like on screen; pixel art is scaled in whole steps without
  smoothing. Pictures from other sites load with `crossOrigin = 'anonymous'`; one that won't is drawn as its name.
- **PNG scale** = min(detail ÷ tile size, 12,000 ÷ longest side, √(pixel budget ÷ area)), with a budget of 16 million
  pixels on iOS and 60 million elsewhere, never below 1.
- **SVG** keeps vector sprites as vectors and `@import`s Google Fonts for non-default fonts.
- **PDF:** fonts can't be embedded, so tier labels are drawn as pictures with hidden searchable text; text is cut to
  Latin-1.
- **CSV:** cells starting with `=`, `+`, `-` or `@` are guarded so spreadsheets don't run them.
- **Page bands** (`export/page-bands.ts`, plain arithmetic, unit-tested): top to bottom, the title (the list's name),
  the tiers, the unranked items (the pool in its on-screen order, under a quiet heading), the notes, and a small "Made
  with tierinator.sayel.dev" line (`CREDIT_LINE` in `layout.ts`, from `SITE_ADDRESS` in
  `templates/template-addresses.ts`). Each is an export option saved with the list (`exp.title`, `exp.pool`,
  `exp.credit`); title and credit start on. With all three off, the tiers start at the top exactly as before.
- **Tile shapes:** pictures are drawn in the list's tile shape and fit with the board's own arithmetic (`tileBox`,
  `cropView`, `fitPicture` in `core/tile-box.ts`), so the export matches the screen.

**Why this and not that:** drawing the layout myself, not screenshotting the page (html2canvas): exact control over
size and fonts, works under the CSP, and one layout feeds three formats so they match.

**What happens if…** the list is enormous: the scale shrinks; if the browser still can't make the PNG, "Lower Detail
and try again". A picture site blocks copying: that tile shows its name. The export takes long: Cancel stops it.

**Where it fails:** the SVG depends on Google Fonts when opened elsewhere; PDF text outside Latin-1 is dropped; a long
unranked pool makes a very tall picture (the PNG scale shrinks to stay in the pixel budget). jsPDF's optional parts are
still built, but the offline copy leaves them out ({17}).

**Common questions**

- **"Why does PDF need a 393 KB library?"** It doesn't for most people: it loads only when someone exports a PDF.
- **"Isn't the 'Made with' line advertising on people's pictures?"** It's one small line in a corner, on by default and
  one tick-box to remove. It's how someone who sees a shared picture finds the site, which has no other marketing.
- **"How do you stop the CSV being a formula injection?"** `csvCell` prefixes risky cells with `'`; reading them back
  removes it (`unguardCell`).

---

## Share links {11}

**How it works**

```
make:  toSnapshot ─▶ keep SHARED_FIELDS only (no view settings) ─▶ drop picks that can't travel (custom, gal:, xp:)
       ─▶ JSON ─▶ CompressionStream('deflate-raw') ─▶ base64url ─▶ https://<site>/#l=…
       over 30,000 characters? again with credits cut to file names ─▶ still over: "send it as a file"
open:  #l=… ─▶ only [A-Za-z0-9_-] ─▶ DecompressionStream, stopped past 4,000,000 bytes ─▶ JSON.parse ─▶ needs tiers[]
       ─▶ holdBackUnknownPictures: pictures not at a known address wait for "Show pictures from …"
       ─▶ stored as a preview list ─▶ openList (readStored checks everything) ─▶ Keep a copy, or Close
```

Measured lengths: 1,025 Pokémon ranked across 9 tiers with the theme, about 3,200 characters; the same with an animated
sprite picked for each, about 11,500; 300 own items with Wikimedia pictures and credits, about 15,000; around 600 such
items reach the 30,000 cap. The tile shape and fit travel with the list (`shape`, `fit` in `SHARED_FIELDS`), since
they change how it looks; the pool's order stays behind, like the other view settings.

**Why this and not that**

- **After the `#`:** the fragment is never sent to any server, mine included. Nothing to store, moderate, rate-limit or
  pay for, and no database of everyone's lists to leak.
- **A server with short links:** short and pretty, but it needs storage, abuse handling and a bill. The plan if it's ever
  wanted is architecture.md {4}.
- **The browser's own deflate:** no dependency; `CompressionStream` and `DecompressionStream` are built into current
  Chrome, Firefox and Safari.
- **Pictures as addresses only:** uploads can't travel; a pick's path is at most 500 characters (`isPicturePath`).

**What happens if…**

- **Someone shares a link with a 50 MB picture:** it can't hold one. Uploads stay behind (the sender is told how many
  will show as names); only addresses travel.
- **A "zip bomb" link:** decompression is read as a stream and stops at 4 MB (`tests/unit/link-data.test.ts`).
- **A link used as a tracker** (a picture on the sender's server, to learn who opened it): pictures from unknown sites
  are held back until the visitor asks. GitHub and jsDelivr serve anyone's files (and jsDelivr publishes download
  counts), so on those only the sprite collections' own folders count as known, checked after the browser has resolved
  the address, so `%2e%2e` can't climb out (`core/picture-sites.ts`).
- **A messaging app cuts the link short:** it fails to unpack: "That share link is broken or cut short".
- **The visitor doesn't keep it:** it's a preview; the next start forgets it.

**Why this data structure:** the stored format minus view settings, so opening a link is opening a list; one code path,
one set of checks. Expensive: links grow with the list; there's no picture data and no shortening.

**Where it fails:** big custom lists need a file; anyone with the link can read the list (it's in their history); a
shared theme's Google font is fetched without asking.

**Common questions**

- **"Can you see what people share?"** No. The part after `#` never reaches Cloudflare, so there's nothing to see.
- **"What stops a link running script?"** It's data: unpacked, parsed as JSON, checked by `snapshot.ts`, and shown
  through escaping templates under a CSP with Trusted Types.
- **"Why not a URL shortener?"** That's a server holding everyone's lists, which is the thing I designed away.

---

## Backups and list files {12}

**How it works**

| File | Inside |
| --- | --- |
| List `.json` | One `StoredList` (`v: 10`) |
| List `.zip` | `list.json` (with `bundle.files`: id → path) and `images/<id>.<ext>`; pictures stored as they are, JSON deflated |
| Backup `.json` | `{ app, type: 'backup', v: 1, created, lists: [{ meta, snap, imgs }], gallery, settings }`; only pictures that can't be fetched again, as `data:` addresses |
| Sprite pack `.zip` | `manifest.json`, `sprites/…`, `gallery/…` |
| `pokemon.zip` | A copy of PokeAPI's sprite folders, read only when a sprite is shown |

`openFile` (`features/files/files.ts`) routes by content: zip → `openZip`; JSON → a pack, a backup, or a list (has
`tiers`). Restoring adds lists beside yours; nothing is overwritten. A list file with a name you already have asks
"Replace" or "Add as new".

**Limits:** a backup up to 200 MB (`MAX_BACKUP_BYTES`, `bundles.ts`), any other JSON file 50 MB (`openFile` reads the
file, then its `type` decides the cap). A backup written bigger than 200 MB is still saved, with a toast saying it can't
be opened again and to save the biggest lists on their own. Inside a zip, any entry claiming more than 64 MB is refused,
a zip's `list.json` or `manifest.json` 20 MB, a list's pictures 256 MB together, each file unpacked once however many
items use it; paths with `..`, a leading `/` or a drive letter skipped; zips over 4 GB refused.

**Why this and not that**

- **My own zip reader (`lib/zip.ts`) with fflate only for inflating:** it reads the zip's table of contents and unpacks
  one file when asked, so a 500 MB sprite zip costs almost nothing until a sprite is shown; fflate (11.2 KB) loads the
  first time a zip is used. JSZip would be bigger and unpack more eagerly.
- **Backups as one JSON file:** readable, one file to keep. The cost is base64 (+33%) and building it in memory.

**What happens if…** the zip lies about sizes (a zip bomb): refused by the declared size before unpacking. The file
is an old format: `snapshot.ts` reads every version back to the first. The file is hostile: every list is checked when
opened, every picture goes through `checkedImage`, settings are restored only where none exist.

**Where it fails:** a backup is read whole (`file.text()`, then `JSON.parse`), so a 200 MB backup briefly needs several
times that in memory, which a phone may not have; its pictures travel as base64 text (+33%); and one over 200 MB can be
written but not read back. One fix covers all three: write backups as a zip with pictures as files, read lazily like
list zips.

**Common questions**

- **"What if someone sends a malicious backup?"** Lists are stored as given but checked field by field when opened;
  pictures are checked before they're stored; only known settings keys are restored, and only if missing.
- **"Why not zip everything?"** Small lists as JSON are readable and diff well; only lists with uploads need pictures.

---

## Combine rankings {13}

**How it works:** `features/group` (lazy) collects 2–30 links or list files; `core/group-ranking.ts` (no screens, unit
tested) does the maths.

```
each list ─▶ readRankedList (through readStored, like any list): refuses backups, packs, charts, nothing ranked
item key:  a Pokémon "pokemon:<id>"; a pack item "pack:<packId:row>:<name>"; anything else "name:<folded name>"
           (folded = NFKD, accents removed, lower case, spaces collapsed)
score:     tier i of T ─▶ 1 − i ÷ (T − 1)       (a lone tier is 1; the pool doesn't count)
group:     mean of the scores of those who ranked it;  spread = standard deviation (population)
tier:      position = (1 − mean) × (T − 1);  tier = ceil(position − 0.5)   ← exactly halfway goes up
order:     tier, then mean, then votes, then name
people:    each person's mean |score − group mean| over items someone else ranked too; the smallest is "closest"
tiers:     the label set most lists share (else the first list's), with its colours
```

Worked example, six tiers (S to E): three people put an item in S, A and B, scoring 1.0, 0.8 and 0.6. Mean 0.8,
position 1.0, so tier A. Spread √(0.08 ÷ 3) ≈ 0.16, which is 0.8 of a tier.

**Why this and not that**

- **Mean of positions, not a vote count (Borda) or pairwise (Condorcet):** tiers are coarse and full orders don't
  exist, so pairwise methods have mostly ties; the mean handles lists with different numbers of tiers once each is
  scaled to 0–1, and it's explainable in one sentence.
- **Standard deviation, not range:** one person far off counts for more than several slightly off, which is what
  "people disagreed" means; it's in the same units as the score.
- **Matching by name for own items:** people make their own copies of a list; ids differ, names mostly don't.

**What happens if…** someone ranked only some items: those count with fewer votes (shown). The same thing twice in one
list: counted once, at its higher place. Lists of different kinds (Pokémon and custom): refused. Pictures: the first
copy that can travel (sprites, or an address on a known site); uploads come only from your own list or `.zip` files.

**Where it fails:** different spellings ("Pokemon" vs "Pokémon" fold together, "Lord of the Rings" vs "The Lord of the
Rings" don't); different things with the same name merge; a tier-count difference is assumed evenly spaced; a person's own
scores are part of the mean they're compared with, which flatters everyone a little in small groups.

**Common questions**

- **"Why not the median?"** With three to five people the median ignores the minority entirely; the mean plus spread
  shows both where it landed and how much people agreed.
- **"Why refuse charts?"** A chart's cells (lawful good, chaotic evil) aren't better and worse, so a mean means nothing.

---

## Stream mode {14}

**How it works:** `features/stream` loads on first use (V or the menu). Options (background theme, green or magenta for
chroma key, names, pool order or shuffled, unranked only or from scratch) are kept in `pt_stream` and read through
`checkStreamOptions`. `#stream` covers the window (and the screen where fullscreen is allowed), hiding everything else;
it draws its own copy of the tiers from `state.tiers`, cloning each tile's picture, so hover tips and tier controls
can't appear on camera; it sizes tiles with the list's tile shape, through the same CSS variables as the board. Its key
handler runs in the capture phase on `window`, before every other shortcut. Each placement is an ordinary `pushHistory`
+ `placeAllTiles` + `autosave`. The order comes from `stream-queue.ts`: a Fisher–Yates shuffle driven by mulberry32 from
a seed, and `nextToRank` going round to skipped items.

**Why this and not that:** a separate view, not restyling the board: nothing interactive from the board can leak into a
broadcast. A seeded shuffle, not `Math.random` per step: the same seed gives the same order, so it's testable.

**What happens if…** "from scratch" with search filters that match nothing: the tiers are put back and the undo step
removed. Fullscreen is refused: it still covers the window. Esc pressed before the browser grants fullscreen: the
late "yes" is handed straight back, so nobody is left fullscreen on a hidden view. You leave and change your mind: one Ctrl/⌘+Z restores the
ranking from before "from scratch".

**Where it fails:** the seed is new each time, so a stream can't be repeated in the same order later.

**Common questions**

- **"Why capture-phase keys?"** So number keys place the item instead of reaching the board's own shortcuts underneath.

---

## Quick rank and head to head {15}

**How it works:** Quick rank (`features/quick-rank`) takes the pool *as currently shown* (search and filters first),
one item at a time, big; a tier button or 1–9 places it, → skips, ← takes the last one back; the next picture is preloaded.
Head to head (`features/head-to-head`) sorts one tier of 3 or more by binary insertion: each item is placed into the
sorted part by asking "this or that?". "Can't decide" counts as the earlier one being better, so equal items keep their
order. Stopping leaves the tier unchanged; finishing is one undo step.

| Items in the tier | 5 | 10 | 20 | 50 | 100 |
| --- | --- | --- | --- | --- | --- |
| Questions at most (Σ ⌈log₂(k+1)⌉) | 8 | 25 | 69 | 237 | 573 |

**Why this and not that:** binary insertion asks close to the minimum number of comparisons (about n·log₂n) and each
question is between the new item and one already placed, which people find easy. Merge sort asks about as many but
compares two unfamiliar halves; a full round robin asks n(n−1)/2 (4,950 for 100).

**What happens if…** answers contradict each other (A over B, B over C, C over A): nothing detects it; the result is
some consistent order from the answers given. Items are added to the tier meanwhile: they stay, after the sorted ones.

**Where it fails:** it sorts within a tier only; 100 items is still hundreds of questions.

**Common questions**

- **"How many questions for 20 items?"** At most 69; the progress shows "n of about N" with the same formula.

---

## Stats {16}

**How it works:** `features/stats` loads on first use (23.8 KB, 10.2 KB gzipped). `breakdowns.ts` sorts every ranked
item into values (type, generation, tags, a pack's own categories, sprite source…), counts each value per tier and scores
it by average tier (top 100, bottom 0). Pokémon facts the pack doesn't carry (evolution stage, legendary group, body
colour, base stat total) are packed into strings in `pokedex-extras.ts`, one or two characters per species. Nothing is
fetched. The last page viewed is `pt_statk`.

**Why this and not that:** a few hundred bytes of packed strings instead of a stats API call: works offline and tells
no one what you're looking at.

**Where it fails:** the packed Pokémon facts must be updated by hand when new species arrive.

---

## Offline and installable {17}

**How it works**

```
build: offlineApp() in vite.config.ts writes dist/sw.js with APP_FILES (27 files: jsPDF's unused parts are left out
       by NEVER_LOADED) and VERSION = a hash of their bytes
page:  setupOffline ─▶ after load, register(trustedServiceWorkerUrl(), { scope: '/', updateViaCache: 'none' })

sw.js fetch handler (same-site GET only; other sites pass through untouched)
  navigation          network first ─▶ offline: the kept page, or "/" (as the host does)
  /assets/*, APP_FILES cache first (hashed names never go stale)
  /templates/*, /packs/*  stale-while-revalidate in "tierinator-data"
install: keep every APP_FILE (reuse an earlier version's hashed file; one failure fails the install)
activate: delete older "tierinator-app-*" caches, claim pages
update: no skipWaiting ─▶ "A new version is ready" [Reload] [Not now] ─▶ Reload posts 'skip-waiting'
```

A tab left open checks for a new version when it comes back into view, at most hourly. `sw.js` is sent with
`Cache-Control: no-cache`. A build that changes nothing produces the same `sw.js`, so nobody is offered a fake update.

**Trusted Types:** `register()` needs a `TrustedScriptURL`. A second policy, `tierinator-sw`, makes exactly one address,
`/sw.js`, and throws for anything else; the CSP names only `tierinator-html` and `tierinator-sw` and forbids duplicates,
so no other code can make its own.

**Why this and not that:** network-first pages so a deploy is seen at once (the classic offline bug is serving last
week's app); waiting for "Reload" so code isn't swapped under someone mid-ranking; other sites never cached so a
picture or search answer can't be replayed from the cache.

**What happens if…** the worker can't register (some private windows): the app works online only. A bad deploy: roll
back; the rolled-back `sw.js` differs again, so it arrives the same way. `sw.js` is deleted: never do that, because the
host would answer with the app's HTML and the old worker would carry on; deploy one that unregisters itself instead
(hosting.md {7}). "Delete everything": removes the data cache (it shows what was opened) and keeps the app.

**Why this data structure:** two caches: one per version (deleted wholesale when replaced) and one long-lived for data.
Expensive: after the first visit every chunk is downloaded, about 0.97 MB raw and 379 KB gzipped, including ones a
visitor may never open (Stats, Export, jsPDF itself).

**Where it fails:** `NEVER_LOADED` in `vite.config.ts` is a hand-kept pattern of file names (html2canvas, DOMPurify,
canvg, about 105 KB gzipped). If jsPDF renamed those parts they'd be kept again (harmless, just bigger); if a future PDF
feature needed one, PDF export would fail offline until it came off the list. jsPDF itself (126.6 KB gzipped) is kept
for everyone, though few export PDFs.

**Common questions**

- **"How do you stop an offline app serving an old version forever?"** Pages are network first, `sw.js` is never cached
  by the browser, and the version name is a hash of the files.
- **"Doesn't allowing a worker weaken the CSP?"** `worker-src 'self'` only, no `blob:` or `data:` workers, and the
  Trusted Types policy accepts one address.

---

## Security {18}

**How it works:** two things to protect: nobody gets code to run on the site, and nobody but me can publish it.

```
outside data ──▶ unknown ──▶ one checking module per format ──▶ typed values ──▶ html`…` (escapes) ──▶ setHtml ──▶ the page
  files, links, storage,     snapshot, pack-format, template-format,                                   (the only innerHTML,
  websites                   csv-format, checks (dig, asText), images (checkedImage)                   through Trusted Types)
```

- **CSP** (`public/_headers`): `default-src 'self'`, `script-src 'self'`, no inline script, no `eval`, `object-src`,
  `frame-src`, `media-src`, `form-action` and `base-uri` all `'none'`, `frame-ancestors 'none'`, `worker-src` and
  `manifest-src 'self'`, `require-trusted-types-for 'script'`, `trusted-types tierinator-html tierinator-sw`.
- **Other headers:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a Permissions-Policy turning off
  camera, microphone, location, payment, USB and the like, `Cross-Origin-Opener-Policy: same-origin`, HSTS for a year.
- **Trusted Types:** `tierinator-html` passes strings through: it isn't a sanitiser, it's a choke point. The policy
  object is private to `lib/html.ts`, so `setHtml` is the only code that can write HTML, and it only accepts `SafeHtml`
  from `` html`…` ``. Any stray `innerHTML` is refused by the browser.
- **Tests:** `no-raw-html.test.ts` fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`,
  `new Function` and inline `on…=` anywhere else; every browser test runs under the real headers (`pnpm preview` reads
  `_headers`) and fails on any CSP violation; one proves an injected script is blocked. `xss-sweep.spec.ts` fills every
  text field with every attack in `tests/e2e/injection.ts` and opens every window on the result, with every outside
  address that has no stand-in refused; `script-injection.spec.ts` sends markup through names, labels, notes, tags, a CSV,
  a share link and a template link, and proves the policy refuses `eval`, inline scripts and inline handlers;
  `layers.test.ts` reads every import and fails if `lib` or `core` reaches into a feature.
- **Publishing:** Gitleaks is built from source with Go (an exact release, checked against Go's public checksum log)
  and scans every commit on every branch and tag on every run; the identity guard ({19}) must pass before a deploy.
- **Hostile files:** pictures by bytes, sizes and pixels ({4}); lists, packs, templates field by field ({1}, {7}, {6});
  zips by declared size and path ({12}); CSV capped at 5 MB, 5,000 rows, 50 cells ({4}); links by alphabet and unpacked
  size ({11}); `safeUrl` lets links be only `http(s)` or same-site.
- **Outside answers:** `getJSON` returns `unknown`; each source reads it with `dig`, `asText`, `asArray`. Wikimedia
  authors arrive as HTML and are cut to text without being parsed (`plainTextFromHtml`).

**Why this and not that:** escaping everything plus Trusted Types, not sanitising HTML: the app never needs to accept
HTML, so "never" is simpler and stronger than "clean it". Hand-written checks next to each format, not a schema library:
no runtime dependency, and each check knows the format's history.

**What happens if…** a list name is `<img src=x onerror=…>`: it's escaped and shows as text; even if it weren't, inline
handlers are blocked. A dependency is compromised: two runtime libraries, exact versions, a lock file with hashes, no
install scripts, `pnpm audit --prod` in CI. A third-party script sneaks in via Cloudflare (Rocket Loader, Bot Fight
Mode): the CSP refuses it, which is why those settings are off (hosting.md {3.2}).

**Where it fails:** `img-src https:` and `connect-src https:` are wide on purpose (the app searches and shows pictures
from sites the visitor picks); list files can make the browser fetch any `https` address they hold (the privacy page
says to open files only from people you'd take a file from).

**Common questions**

- **"Your Trusted Types policy returns the string unchanged. What's the point?"** It's the gate, not the filter: only
  `setHtml` holds it, and `setHtml` only takes escaped templates. Everything else that writes HTML is refused.
- **"What's the worst a malicious list file can do?"** Make the browser fetch pictures from addresses it names, like a
  web page can. It can't run code, read other lists, or break the app; unknown fields are dropped and numbers clamped.
- **"Why `'unsafe-inline'` for styles?"** Live theme colours. CSS can't run script, and values are checked hex.

---

## Keeping my name out of it: the identity guard {19}

**How it works:** I publish as "sayel" and keep my private details out of everything public. `scripts/identity-guard.ts`
(`pnpm guard`, and `pnpm guard --dist` after a build) fails if any of my private words shows up where it would become
public: every tracked file and every earlier version of every file on every branch and tag, file and branch names, the
names, emails and messages on commits and tags, picture metadata (PNG chunks, JPEG Exif, XMP and IPTC, SVG text), other
binary files read as text, and the built site. The words never live in the repository: CI reads them from the
`PRIVATE_WORDS` secret, my computer from `~/.config/sayel/private-words`. It never prints a word ("matches private word
#3"), because CI's logs are as public as the code. Both sides are normalised first (NFKC, invisible characters out, lower
case, accents off, camelCase split); words match whole, with a few separators allowed inside a word and up to forty
between a phrase's words, so `jane.doe@` and a name split across a comment's lines are found. Files are read 4 MB at a
time. The rules in full: security.md {8}.

In CI the identity job builds the site and runs the guard with `--dist`; the deploy waits for it. A missing or empty
secret fails the job in CI, so the guard can't be skipped by accident. Pull requests from forks never get secrets, so
they skip it, and the push that merges one runs it.

**Why this and not that:** Gitleaks finds keys, not names. A grep in a commit hook would miss the history, picture
metadata and the built site, and would put the words in the repository. Keeping the words outside it means a mistake
can't publish the list itself.

**What happens if…** it finds a word in a commit never pushed: rewrite those commits. Already pushed: rewrite the
history, force-push with the ruleset's block lifted for a moment, and treat the old history as public anyway (forks,
clones and caches keep it).

**Where it fails:** it matches the words' letters in order and nothing else: misspellings, nicknames, initials, other
alphabets, text inside pictures' pixels, anything compressed or encoded (zips, WOFF2 fonts, base64) and history files
over 256 MB (reported, not read) get past it, and it can't see what was never committed: the accounts, the domain's
WHOIS record, copies elsewhere.

**Common questions**

- **"Why not just be careful?"** Care doesn't check a font's metadata or a commit's author email made on another
  computer; the guard checks every commit, every time.
- **"Doesn't the secret itself leak the name?"** Only to the one step that runs the guard; the report never prints a word.

---

## Privacy {20}

**How it works:** nothing a visitor ranks or uploads is sent anywhere by the app. What leaves the browser is only what a
feature needs from another site, sent straight there:

| To | When | What it sees |
| --- | --- | --- |
| Cloudflare | Every visit | The usual request data (IP, address asked for); never the `#` part |
| GitHub raw, jsDelivr | Pokémon sprites, and one probe sprite a visit while a Pokémon list is open | IP, which sprite |
| Bulbagarden Archives | Spin-off art you look at | IP, which picture |
| Wikipedia, any MediaWiki you name | Searches, wiki imports, templates, credits | IP, search text or page titles |
| AniList, Jikan, Kitsu, TVmaze, iTunes, Open Library, REST Countries | A search you run | IP, the search text |
| Any picture address | Pictures you added or that a file names | IP (no referrer) |
| wsrv.nl | A picture a site won't let be copied | IP, that picture's address |
| Google Fonts | A font other than the two built in | IP, the font |

**What never leaves:** lists, rankings, uploaded pictures, notes, tags, themes, which lists exist. No analytics, cookies,
`sessionStorage`, trackers or ads; no `console.log`. Every fetch sends no referrer. "Delete everything" removes every `pt…`
key, the `poketier4` database and the data cache (`deleteEverything`).

**Why this and not that:** no analytics at all, not a "privacy-friendly" one: Cloudflare's request counts (no script)
answer "is anyone using it", and nothing else is needed. Self-hosted default fonts so an ordinary visit contacts no one
else.

**Where it fails:** every site in the table sees the visitor's IP; that's the price of having no server in between (a
proxy of mine would see everything instead). A shared theme's Google font is fetched without asking.

**Not done on purpose: an `Api-User-Agent` header on Wikimedia requests.** Wikimedia asks API clients to identify
themselves. A browser can't set `User-Agent`, and adding `Api-User-Agent` makes the request non-simple, so every search,
picture lookup and credit request would first need a CORS preflight (an extra `OPTIONS` round trip). The traffic is one
person's browser at human speed, and every request already carries the site's `Origin`, which says where it came from.

**Common questions**

- **"Do you need a cookie banner?"** No: there are no cookies, and the storage is strictly necessary for what the
  visitor asked for.
- **"What can the owner of a shared link learn?"** Nothing from the app: pictures on unknown sites are held back until
  the visitor chooses to show them.

---

## Speed and memory {21}

**How it works** (measured with `pnpm build` on 7 November 2026; gzip as Vite reports it)

| Downloads when | Files | Size (gzipped) |
| --- | --- | --- |
| The page opens | `app-*.js` + the shared chunk `items-*.js` + `preload-helper` | 224 KB (82.4 KB) of JavaScript |
| | `app-*.css`, `index.html` | 62.4 KB (13.3 KB), 55.2 KB (15.6 KB) |
| | Playfair Display, Instrument Sans (woff2); Geist Mono once a shortcut or Pokédex number shows | 68.5 KB; 23.1 KB |
| A Pokémon list first opens | `packs/pokemon.json` | 363 KB (about 72 KB) |
| Templates, Stream, wiki import, Export, Combine, pack builder, Stats | each its own chunk | 7.7 to 23.8 KB (3.4 to 10.2 KB) each |
| The wiki engine (import, pack builder) | `engine-*.js` | 23.3 KB (9.2 KB) |
| A zip is opened or saved | fflate | 11.2 KB (5.6 KB) |
| A PDF is exported | jsPDF | 392.8 KB (126.6 KB) |
| After the first visit, quietly | everything the service worker keeps (28 files) | about 1.01 MB (422 KB) |

So a first visit is about 172 KB over the wire before any picture. The shared chunk is called `items-*.js` only because
Rollup names a shared chunk after one of its modules; it holds most of the app.

**Memory:** uploads shrunk to 1,024 px; `blob:` addresses revoked when a picture is replaced or another list opens
(`resetListState`, `replaceSpriteUrl`, tested in `memory.spec.ts`); `ImageBitmap.close()` and canvas size 0 after
shrinking; the studio's 1,300-row list built only when shown; zips read lazily; images `loading="lazy"`.

**Why this and not that:** lazy loading by button (`loadOnFirstUse` replays the click after loading) rather than a router:
there's one page, so the button *is* the route.

**What happens if…** a slow phone opens a Pokémon list: 1,343 tiles are made but only visible pictures download.
The network is slow: nothing waits on outside sites to show the board.

**Where it fails:** the main chunk carries everything not lazily loaded, including the Sprite Studio and item editor
code most visits don't use; the offline copy takes every chunk, used or not ({17}); all tiles live in the DOM ({2}).

**Common questions**

- **"How big is it?"** About 82 KB of gzipped JavaScript to start, 172 KB in all before pictures.
- **"What would you split next?"** The studio and the pack-related code into their own chunks.

---

## Accessibility {22}

**How it works:** every drag has a keyboard way ({2}); Quick rank works from the keyboard alone. Tiles are
`role="button"` named after their item with `aria-pressed` for selection; the tiers and pool are labelled regions
(`#tsec`, `#pgrid`). Toasts and the share bar are `role="status"`, and Stream mode's "Now ranking" is `aria-live`.
Tier labels and buttons pick black or white text by luminance (`readableTextOn`); theme text is swapped when contrast is
too low. `prefers-reduced-motion` turns animation off. The Pool and Order menus are radio menus (`lib/choice-menu.ts`:
`menuitemradio`, arrows, Enter or Space, Esc), so a screen reader says which is chosen. Deleting by keyboard moves focus
to the toast's Undo button, and a toast with a button waits while the pointer or focus is on it. An axe-core sweep runs
in CI on the start screen, About, a Pokémon list and a chart (`accessibility.spec.ts`).

**Why this and not that:** WCAG 2.2 AA as the target, checked automatically on every push, rather than an audit once.

**Where it fails:** pictures are identified by names, not described (the known gap on the privacy page); automatic checks
don't prove a screen-reader user can rank comfortably; the site is dark only ({9}). I'd do one session with a screen
reader and fix what it finds.

**Common questions**

- **"How does someone rank without a mouse?"** Tab into the tiers or pool, arrows to move, Space to select, a number to
  send; or Q for one item at a time.

---

## Hosting, deploys and CI {23}

**How it works**

```
push or PR ─▶ secrets job: Gitleaks, built from source, over every commit on every branch and tag
           ─▶ identity job (pushes, and PRs from this repository): build ─▶ pnpm guard --dist with PRIVATE_WORDS
           ─▶ test job: install (frozen lock) ─▶ audit --prod (high) ─▶ lint ─▶ types ─▶ Knip ─▶ unit ─▶ Playwright ─▶ build
push to main, all three green ─▶ deploy job (environment "production", main only): build ─▶ wrangler deploy
```

`wrangler.jsonc` serves `dist/` as static assets with no Worker script, `not_found_handling: "single-page-application"`,
`workers_dev` and `preview_urls` off. Third-party actions are pinned to commit hashes; the token is read-only and not
kept in the checkout.

**Why it can't run up a bill:** the Cloudflare account has no payment method; static asset requests are free with no
request limit; with no Worker script there's nothing metered to run. Outside APIs are called by visitors' browsers, so
their limits count against visitors, not the site. Nothing here stores data per visitor.

**Why this and not that:** see the table in {0}. GitHub Actions rather than Cloudflare's Git builds because only Actions
can refuse to deploy when a test fails.

**What happens if…** a bad version ships: roll back in the dashboard or `wrangler rollback` ({17} for how the worker
follows). The deploy token leaks: it can only deploy Workers on one domain, and lives only in the `production`
environment. A stranger's pull request: their workflows need approval before anything runs, and a fork never sees secrets, so it
skips the identity job; the push that merges it runs it. `PRIVATE_WORDS` is missing: the identity job fails in CI, and
with it the deploy.

**Where it fails:** the deploy job builds again from the same commit rather than deploying the exact files the tests ran
against (same lock file, so in practice the same).

**Common questions**

- **"What does a deploy cost?"** Nothing: a static upload to the free plan.
- **"How do you roll back?"** One click or one command, then fix forward.

---

## What if the site gets popular {24}

- **Traffic:** static files on Cloudflare's network, free with no request limit. There is no server to scale, no
  database to shard, no queue. A million visitors is the same architecture as ten.
- **Outside sites:** the real limit. Each visitor's browser calls them directly, so per-IP limits apply per visitor,
  but a popular site sends a lot of total traffic to free services: wsrv.nl, the GitHub raw host, Wikipedia. Every
  request carries this site's `Origin`, so they can see where it comes from (and why I don't add `Api-User-Agent`:
  {20}). I'd prefer jsDelivr for sprites if GitHub complained, and pace Wikipedia lookups harder if Wikimedia did.
- **Abuse:** there's no user content on the site. Share links carry their content in the link; a nasty link is on my
  domain but not on my server, opens as a clearly labelled preview, and holds back unknown pictures.
- **Requests for features that need a server** (sync, short links, public galleries): one more provider beside files and
  links, with Turnstile, per-account limits, size caps in code and free tiers only (architecture.md {4},
  security.md {3}).
- **Rights holders:** no copyrighted images are hosted; if asked to remove something, remove it and reply.
- **Support load:** the app explains its own errors ("Lower Detail and try again", "send it as a file"), and backups are
  the visitor's to keep.

**Common questions**

- **"What breaks first?"** Not the site: a free outside service rate-limiting or blocking heavy use, most likely the
  image proxy. Every outside call already has a fallback (mirror, text tile, held-back picture, offline zip).

---

## Numbers to know {25}

| What | Number | Where |
| --- | --- | --- |
| Own item ids start at | 2,000,000 | `OWN_ITEM_ID_START`, `core/defaults.ts` |
| Pokémon entries | 1,025 species + 318 forms | `public/packs/pokemon.json` |
| Autosave delay | 500 ms | `core/persist.ts` |
| Undo steps | 80 | `core/history.ts` |
| Picture file / pixels / canvas | 25 MB / 50 million / 40 million | `lib/images.ts` |
| Uploads kept at | 1,024 px longest side | `LARGEST_UPLOAD_SIDE`, `sprites.ts` |
| SVG redrawn at | 512 px | `svgToPng` |
| Picture download timeout | 20 s | `PICTURE_TIMEOUT_MS` |
| Backup / any other JSON file | 200 MB / 50 MB | `MAX_BACKUP_BYTES`, `bundles.ts`; `MAX_JSON_BYTES`, `files.ts` |
| Tiers / own items in a list file | 100 / 20,000 | `MAX_TIERS`, `MAX_OWN_ITEMS`, `snapshot.ts` |
| Deletions that can be undone / Undo toast | last 20 / 8 s | `KEPT_DELETIONS`, `UNDO_TOAST_MS`, `delete-items.ts` |
| Tile shapes | square 1:1, portrait 2:3, landscape 16:9; whole or fill | `core/tile-box.ts` |
| Zip entry / zip JSON / a list's pictures | 64 MB / 20 MB / 256 MB | `lib/zip.ts`, `sprite-packs.ts` |
| CSV | 5 MB, 5,000 rows, 50 cells, 50 new tiers | `csv-import.ts`, `lib/csv.ts` |
| Share link / unpacked | 30,000 characters / 4,000,000 bytes | `share.ts` |
| Pack | 20,000 items, 200 pictures each | `pack-format.ts` |
| Templates | 124, of 12 to 57 items (format allows 1–300) | `public/templates` |
| Combine | 2 to 30 lists | `GROUP_SIZE` |
| Text | tier 40, subtitle 60, list 60, item 80, note 300, tag 24 | `snapshot.ts`, `items.ts` |
| Sprite restore | 4 at a time, 3 tries | `restorePickedSprites` |
| Wiki pacing | one request per ~260 ms, slower on 429 or 5xx | `wiki/engine.ts` |
| Wikipedia lookups | 50 titles a request, 300 ms apart | `wiki-pictures.ts` |
| Start-up JavaScript | 82.4 KB gzipped | `pnpm build` |
| Offline copy | 27 files, about 379 KB gzipped | `dist/sw.js` `APP_FILES` |

---

## Weak spots, in the order I'd fix them {26}

1. **Every move re-places every tile** and sorts an ordered pool again; no virtual scrolling. Fine to a few thousand
   items, not to the 20,000 a pack allows.
2. **Backups are one JSON file read whole:** up to 200 MB parsed in memory, pictures as base64, and one over 200 MB
   can be written but not read back. Write them as zips with pictures as files.
3. **Sprite-collection pictures** get the byte check and the 25 MB cap but not `checkedImage`'s pixel cap (they come
   from fixed hosts).
4. **Undo doesn't cover** adding items, changing pictures, tags or notes; deletions are final after a reload or another
   list, and only the last 20 can come back.
5. **One toast at a time:** a later message replaces the Undo toast (Ctrl/⌘ Z still works).
6. **The tab guard covers only the open list;** an older tab can still write themes and the palette.
7. **Dark only:** no automatic light look for people who read better on light ({9}).
8. **`NEVER_LOADED` is hand-kept** ({17}); template pictures download one at a time ({6}).
9. **The identity guard** can't see misspellings, initials, nicknames, encoded text or anything outside git ({19}).

**Not done on purpose:** an `Api-User-Agent` header on Wikimedia requests; it would add a CORS preflight to every
request, and `Origin` already says where they come from ({20}).


