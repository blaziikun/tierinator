# Templates

> Ready-made lists anyone can open and rank: planets, dog breeds, flags. Each one is a small JSON file in this repository,
> added by pull request. No server and no account: the gallery fetches a file from this site when it's opened, and the
> pictures come straight from Wikipedia's freely licensed images.

---

## What a template is {0}

A name for the list, a category, and the things to rank, each with the English Wikipedia page its picture comes from.
Opening one in the gallery (start screen → **Browse templates**, or **the list menu (top left) → New list from a template…**) makes a
new list of the visitor's own, with every item in the pool, and then asks Wikipedia for each page's lead picture:

```
public/templates/index.json ──▶ the gallery's cards (text only: no pictures are fetched to browse)
public/templates/<id>.json  ──▶ a new list: its name, its tiers if it has its own, its items
en.wikipedia.org            ──▶ each page's lead picture, if freely licensed (50 pages per request, one request at a time)
en.wikipedia.org            ──▶ who made each of those pictures and its licence (50 files per request), for its credit
upload.wikimedia.org        ──▶ the pictures themselves, copied into the visitor's list like any web picture
```

If a picture can't be copied directly, the app asks wsrv.nl (an image service) for a copy, as it does for any web picture;
if that fails too, the item gets a text tile.

Items whose page has no free picture get a text tile, as typed items do. The visitor can change any picture afterwards.
Each picture's author and licence are saved with its item and shown in the item editor and under About & privacy →
picture credits, with a link to the file's page on Wikimedia Commons (if that lookup fails, the link alone). A changed
picture loses its credit.
Nothing in this repository is a picture of anything in a template, so nothing copyrighted is ever hosted here.

## The file format {1}

`public/templates/<id>.json`:

```json
{
    "format": "tierinator-template",
    "version": 1,
    "id": "planets",
    "title": "Planets and dwarf planets",
    "category": "Space",
    "description": "The eight planets of the Solar System and its five recognised dwarf planets.",
    "tiers": ["Favourite", "Good", "Fine", "Boring"],
    "items": [
        { "name": "Mercury", "wiki": "Mercury (planet)" },
        { "name": "Pluto", "wiki": "Pluto" },
        { "name": "France", "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/…/256px-Flag_of_France.svg.png" }
    ]
}
```

| Field | Needed | What it is |
| --- | --- | --- |
| `format`, `version` | yes | Always `"tierinator-template"` and `1` |
| `id` | yes | Lower-case words joined by hyphens (`dog-breeds`), the same as the file name; at most 60 characters. Not `pokemon` (that link opens the Pokémon pack) |
| `title` | yes | The list's name, at most 60 characters |
| `category` | yes | One of the existing categories (Animals, Art, Books, Films and TV, Food and drink, Games, History, Music, Mythology, Places, Science, Space, Sports, Technology, Vehicles); a new one only if none fits, added here too |
| `description` | no | One sentence for the card, at most 300 characters |
| `tiers` | no | Tier labels, top first, at most 20 of 40 characters; leave it out for the usual tiers |
| `items` | yes | 1 to 300 things to rank |
| `items[].name` | yes | Short and clean, as it should appear on the tile: "Mercury", not "Mercury (planet)"; at most 80 characters |
| `items[].wiki` | one of these | The exact title of an English Wikipedia page |
| `items[].image` | | An `https` address on one of the known picture sites, used instead of the page's picture |

And one line in `public/templates/index.json`, with the same `id`, `title`, `category` and `description`, and `count`
(how many items):

```json
{ "id": "planets", "title": "Planets and dwarf planets", "category": "Space", "count": 13, "description": "…" }
```

`src/core/template-format.ts` reads both files. Anything else in them is dropped, texts are cut to the limits above, and
a page title or picture address that breaks the rules is left out (the item then gets a text tile).

## The rules {2}

- [ ] **No copyrighted pictures, ever.** Never add a picture file to the repository. Point at a Wikipedia page and the
      app shows its lead picture only if Wikipedia marks it as freely licensed (`pilicense=free`).
- [ ] **Pictures from known sites only.** An `image` must be `https` on one of the sites in `src/core/picture-sites.ts`
      (Wikimedia, flagcdn and the others Add items already uses). Prefer `wiki`: it needs no address at all.
- [ ] **Exact page titles.** Copy the title from the top of the Wikipedia page, with its brackets: `Boxer (dog)`,
      `Orange (fruit)`. A redirect works too, but a disambiguation page shows the wrong picture or none.
- [ ] **Pages whose lead picture is free.** Most animals, foods, places, flags and instruments are. Logos, film posters,
      album covers and box art usually aren't, and would all come out as text tiles.
- [ ] **Family-friendly.** Things people of any age could rank in public. No real private people.
- [ ] **A good size.** Roughly 10 to 60 items: enough to make tiers interesting, few enough to rank in one sitting.
      Pick the best-known, not every one there is.
- [ ] **One idea per template,** not already covered by another (add to that one instead).

## Its own page, and links into the app {2.1}

Every template gets a small page of its own, so a search for "dog breeds tier list" can find it. `pnpm build` makes
them from the template files (nothing to write by hand; see architecture.md {2.1}):

| Address | What's on it |
| --- | --- |
| `/t/<id>/` | The title, the description, a **Rank these** link into the app, the items as plain text (no pictures, nothing loaded from other sites), and the other templates in its category |
| `/t/` | Every template by category, the Pokémon pack, and **Suggest a template** |
| `/sitemap.xml` | The app, `/t/`, every template page and the privacy page (`robots.txt` points to it) |

**Rank these** is a template link: `/?template=<id>` opens the app and that template at once, as its card in the gallery
would, without the start screen (`/?template=pokemon` opens the Pokémon pack). The parameter is then taken out of the
address, so reloading opens the list rather than a second copy. A link with a broken id, or one no template has, opens
the app as usual with a short message. A share link (`#l=…`) in the same address wins. A search parameter rather than a
`#` because it's a plain link anyone can paste, and because it can't be mistaken for a share link.

Try the pages with `pnpm dev` (`http://localhost:5173/t/`), or `pnpm build` then `pnpm preview`.

## Suggesting one {2.2}

Not everyone wants to write JSON. **Missing one? Suggest a template** (in the gallery, and on `/t/`) opens a GitHub
issue form, `.github/ISSUE_TEMPLATE/template.yml`: a name, a category, the items one per line (with a Wikipedia page
after a `|` where the name is ambiguous) and optional notes, labelled `template` (GitHub adds only labels that exist: create it once under Issues → Labels). Whoever picks it up turns it into a
pull request as below. A new category in a template should also be added to the form's list.

## Adding one by pull request {3}

1. Make `public/templates/<id>.json` as above. Check each page title by opening
   `https://en.wikipedia.org/wiki/<title>` and looking at the picture at the top.
2. Add its line to `public/templates/index.json`.
3. Run `pnpm test:unit`. `tests/unit/templates.test.ts` reads every template and fails if one can't be read whole, if
   its catalogue line doesn't match (title, category, count), if an id is used twice, if an item has no picture
   source or appears twice, if the category isn't one of those listed above, if it has no description,
   or if it has fewer than 10 or more than 60 items.
4. Run `pnpm check:templates` (needs the internet). It asks Wikipedia about every title and lists missing pages,
   disambiguation pages, and items that will be text tiles because their picture isn't freely licensed.
5. Try it: `pnpm dev`, then **Browse templates** and open yours. Its page is at `/t/<id>/`.
6. Open the pull request, saying where the list of items came from.

Changing how templates work (the gallery, the picture lookup) is ordinary code: see [architecture.md](architecture.md).
The gallery is `src/features/templates/`, loaded the first time it's opened.
