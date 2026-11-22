# Hosting

> Where the site lives, how a push becomes a deploy, and every dashboard setting with the reason for it.
> Also how to run your own copy, how to keep the accounts behind it safe, and how new versions reach people's devices.

---

## How a push becomes the site {0}

```
git push (main) ──▶ GitHub Actions ──┬─ secrets: Gitleaks over every commit, branch and tag
                                     ├─ identity: build, then the identity guard (security.md {8})
                                     └─ test: audit, lint, types, knip, unit, browser, build
                                                  │ all green?
                                                  ▼
                                     deploy: wrangler deploy ──▶ Cloudflare ──▶ https://tierinator.com
                                                                                 (and tierinator.sayel.dev during the move: {8})
```

A commit that fails anything never reaches the site. After the set-up below, deploying is `git push`.

## Your own copy {1}

The address appears in a few places. For a fork, change all of them:

```
src/brand.ts                        ← url: the build fills it into index.html's and privacy.html's canonical and preview
                                       links ({{url}}), the template pages, sitemap.xml, robots.txt and the "Made with …"
                                       line on exports; source (About's source-code link, "Suggest a template");
                                       pokemonApp (where Pokémon lists go)
wrangler.jsonc                      ← "name", and "pattern" under routes (your domain)
.github/workflows/ci.yml            ← url: under environment
privacy.html                        ← the GitHub links under Contact
.github/ISSUE_TEMPLATE/config.yml   ← the security-report link
.github/ISSUE_TEMPLATE/template.yml ← the docs/templates.md link
scripts/check-template-titles.mjs   ← the repository address in its User-Agent
```

Links made while someone uses the site (share links) are built from the address they're on (`location.origin`), so
they need no change. `tests/unit/site-address.test.ts` fails if the old address turns up in anything the site is built
from. The two addresses, and retiring the old one: {8}.

The domain's DNS must be on Cloudflare (the registrar can be anywhere).

## One-time set-up {2}

### Cloudflare token {2.1}

- [ ] Dashboard → **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers**.
- [ ] **Account resources:** your account only. **Zone resources:** *Specific zone* → your domain only.
- [ ] **TTL:** an end date about a year out, with a calendar reminder to replace it before then.
- [ ] Copy it (shown once). Your **Account ID** is on the **Workers & Pages** page, right-hand panel.

### GitHub {2.2}

- [ ] **Settings → Environments → New environment** `production` → deployment branches: **Selected branches** → `main`.
- [ ] In that environment, **Add environment secret** twice: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Add the `PRIVATE_WORDS` repository secret ({2.3}); without it the identity check fails and nothing deploys.
- [ ] Push to `main`. The first deploy creates the Worker, the DNS record and the certificate by itself (give the
      certificate a few minutes). If the address already has a CNAME record, delete it first.

Check the headers once it's up:

```sh
curl -sI https://tierinator.com | grep -iE "content-security|strict-transport|x-content"
# should print three lines, one for each header
```

### Private words {2.3}

The identity guard ([security.md](security.md) {8}) needs the words that must never appear: names you keep private, their parts, old usernames,
personal email addresses, anything that leads to you rather than to the name you publish under. They live in two
places, never in the repository.

- [ ] **GitHub:** Settings → Secrets and variables → Actions → **New repository secret**. Name: `PRIVATE_WORDS`.
      Value: one word or phrase per line (commas also separate). A *repository* secret, not an environment one: the
      guard runs before the deploy, outside the `production` environment, and it's the only step given it. GitHub masks
      it in logs, and the guard never prints it anyway.
- [ ] **Your computer:** the same list in `~/.config/sayel/private-words`, one per line; lines starting with `#` are
      notes. Keep it to yourself: `chmod 600 ~/.config/sayel/private-words`. Then `pnpm guard` (and `pnpm guard --dist`
      after `pnpm build`) before you push. `PRIVATE_WORDS` in the environment works too; both are read, the
      variable's words first, and the report numbers them in that order ("private word #3").

```text
# ~/.config/sayel/private-words (an example: put your own)
Jane Doe
Doe
janedoe1987
jane.doe@mail.example
```

List each form you actually use (with and without a middle name, a nickname, a maiden name): matching ignores case,
accents and separators, but not spelling. Words under three letters are refused. Contributors without the list get a
warning and a pass; CI without the secret fails, and nothing is deployed.

## Settings, and why {3}

### GitHub repository {3.1}

| Where | Setting | Why |
| --- | --- | --- |
| Settings → General | Wiki and Projects **off**; Issues **on** | Nothing unused left open |
| About (repo front page, ⚙) | Description, website `https://tierinator.com`, topics `tier-list`, `tier-maker`, `ranking`, `typescript`, `vite` | How people find it |
| Settings → Rules → Rulesets | On `main`: **block force pushes** and **restrict deletions**. No required pull requests or checks | You push straight to `main`; the deploy already refuses to run unless every check passes |
| Settings → Actions → General | Workflow permissions: **read repository contents**; **don't** allow Actions to approve pull requests; **require approval for all outside contributors** | A stranger's pull request can't run anything until you've looked at it |
| Settings → Code security | **Secret scanning** and **push protection** on; **Dependabot alerts** on; **private vulnerability reporting** on | Leaked keys are blocked before they land; SECURITY.md points people to the private report button |

### Cloudflare {3.2}

| Where | Setting | Why |
| --- | --- | --- |
| Billing | **No payment method** | Without one nothing can be charged. Static files are free with no request limit; free Workers stop at their limits instead of billing. If you ever add a card, add a $1 budget alert the same day |
| My Profile → Authentication | Two-factor with a passkey or security key | The account can publish the site |
| SSL/TLS | **Full (strict)**, **Always Use HTTPS** on, minimum TLS **1.2** | Encrypted all the way, no old protocols |
| Security → Settings | **Browser Integrity Check** on. **Bot Fight Mode off** | Bot Fight Mode injects scripts the security policy blocks |
| Speed / Scrape Shield | **Rocket Loader**, **Email Obfuscation**, automatic **Web Analytics** and the **Labyrinth** crawler trap (Security → Settings → Bot traffic) off | They inject or rewrite scripts, which the policy (rightly) refuses |
| Security → WAF → Custom rules | Block requests whose path contains `/wp-`, `/.env`, `/.git` or ends in `.php` | Scanners looking for other sites' mistakes get turned away before they reach anything |
| Workers & Pages → tierinator | Leave `workers.dev` and preview URLs off (they're off in `wrangler.jsonc`) | The site exists at its own addresses only |

### Domain registrar {3.3}

- [ ] **WHOIS privacy** with a proxy service, so the public record shows the service's contact details instead of yours.
      Plain "redaction" usually still shows organisation, region and country.
- [ ] Two-factor sign-in; **domain lock** on; **auto-renew** on (an expired domain can be bought by someone else).
- [ ] DNS stays at Cloudflare; the registrar only holds the registration.

## Rolling back {4}

Dashboard → **Workers & Pages → tierinator → Deployments** → pick an earlier version → **Rollback**. Or:

```sh
pnpm exec wrangler rollback
```

Then fix forward with a normal commit.

## Monthly, five minutes {5}

- [ ] Merge the green Dependabot pull requests; read the changelog of any major version first.
- [ ] Glance at the Actions tab for anything red, and at Cloudflare's request graph.
- [ ] Check the API token's end date.
- [ ] Back up your own lists (File → Back up all lists) into a folder outside this repository (`backups/` is ignored by
      git as a safety net).

## Addresses, slashes and missing pages {6}

Cloudflare serves the files in `dist/` (`wrangler.jsonc`), with its default `html_handling` (`auto-trailing-slash`) and
`not_found_handling: "single-page-application"`:

| Request | Cloudflare | `pnpm preview` (and so the browser tests) |
| --- | --- | --- |
| `/t/planets/` | 200, `t/planets/index.html` | the same |
| `/t/planets` | 307 to `/t/planets/` | the same (`templatePages` in `vite.config.ts` adds the redirect) |
| `/t/planets/index.html` | 307, a redirect away from `index.html` | 200, the page |
| `/privacy.html` | 307 to `/privacy` | 200 (`/privacy` works too) |
| `/t/no-such-thing/`, any unknown address | 200, the app (`index.html`) | the same |
| `/templates/no-such-thing.json` (a `fetch`) | 200, the app's HTML: there's no Worker script, so every miss gets it | the same |

So every link the site writes uses the address with the slash (`/t/<id>/`), which is also each page's canonical
address and what `sitemap.xml` lists. An unknown template page isn't a 404 but the app itself; nothing links there.

`privacy.html`'s canonical link and its line in `sitemap.xml` say `/privacy`, the address Cloudflare redirects the file
to; links keep pointing at `/privacy.html`, which works on any server. Change the canonical link and `PRIVACY_CANONICAL`
in `scripts/template-pages.ts` together.

## Caching, offline, and how updates reach people {7}

Two layers keep files: Cloudflare's headers tell browsers what they may keep (`public/_headers`), and the service worker
(tier-engine's `vite/sw.js`, written into `dist/` by its Vite plugin with the folders Tierinator names: `templates`, `packs`) keeps a copy of the app on the device so it opens offline and can be installed.

| Files | Browser cache (`_headers`) | Service worker |
| --- | --- | --- |
| `/assets/*` (content-hashed) | Forever (`immutable`) | Kept when the version installs; answered from the copy |
| `/` and other pages | Cloudflare's default (checked each time) | Network first; the kept copy only when offline |
| `/sw.js` | `no-cache`: asked for on every visit | Not handled (the browser fetches it itself) |
| `/templates/*`, `/packs/*` | Cloudflare's default | Kept once opened; answered from the copy, refreshed behind it |
| Icons, manifest, favicon | Cloudflare's default | Kept when the version installs |
| Other sites (pictures, searches, fonts) | Theirs | Never touched |

How a deploy reaches someone:

```
deploy ──▶ next visit (or the tab comes back into view, at most hourly) ──▶ browser sees a different sw.js
       ──▶ new worker downloads the files that changed, in the background
       ──▶ "A new version is ready" [Reload] [Not now]
               Reload: the new version takes over and the page reloads (the open list is saved first)
               Not now / ignored: the new version starts once every Tierinator tab and window has been closed
```

- [ ] **Nothing to do per deploy.** The build writes `dist/sw.js` with this version's file list; its version name changes only
      when a file does, so a deploy that changes nothing offers no update.
- [ ] **A bad deploy:** roll back ({4}). The rolled-back `sw.js` is different again, so people get it the same way.
- [ ] **Templates and packs** show the kept copy first and fetch the new one behind it, so a changed template or pack
      shows on the visit after it was deployed.
- [ ] **Turning it off** (in an emergency): deploy a `sw.js` that deletes its caches and unregisters itself
      (`self.registration.unregister()`); never just delete the file: the host would answer with
      the app's page instead, the update check would fail, and the old worker would carry on.

## Two addresses {8}

The site's address is tierinator.com. tierinator.sayel.dev, its earlier address, serves the same site for as long as
lists made there still need moving.

```
tierinator.com ────────┐
                       ├──▶ one Worker (wrangler.jsonc routes), the same files, the same headers
tierinator.sayel.dev ──┘      canonical links, sitemap, robots.txt and "Made with" all say tierinator.com
                              share links say whichever address you're on
```

**Why both stay up.** A browser keeps each address's lists apart (localStorage and IndexedDB belong to one origin), so
lists made on tierinator.sayel.dev can't be seen from tierinator.com. Redirecting the old address straight away would
cut people off from their own lists. Both serve the site; the canonical links tell search engines which one counts.

**Moving your lists** (everything in one file: lists, their uploaded pictures, Studio gallery pictures, installed and
self-made packs, saved themes and edits to the built-in one, your default tiers, the palette, the top bar, which views
are hidden, Stream mode's options):

- [ ] On tierinator.sayel.dev: **File → Back up all lists**.
- [ ] On tierinator.com: **File → Load…** → the backup → **Restore**. The page reloads with everything in use.
      Restoring adds lists next to any already there; a setting you already chose there wins, except saved themes,
      which are added to yours.
- [ ] Check a list or two, then delete the old copies if you like (About → Delete everything, on the old address).

**Set-up, once** (done before the first deploy):

- [ ] tierinator.com is a zone in the same Cloudflare account (DNS on Cloudflare: {1}), with no CNAME on the apex.
- [ ] The API token ({2.1}) covers it: **My Profile → API Tokens →** the token **→ Edit → Zone resources**: add
      tierinator.com beside sayel.dev. Without it the deploy fails at the new route.
- [ ] The registrar settings ({3.3}) for the new domain, and Cloudflare's SSL/TLS, Security and Speed settings ({3.2})
      on its zone too: they're per zone.
- [ ] GitHub About → website: `https://tierinator.com` ({3.1}).

**Retiring the old address, later** (when you no longer use it, or after a few months):

- [ ] Delete the `tierinator.sayel.dev` line from `wrangler.jsonc`'s routes and deploy. Then add a redirect on the
      sayel.dev zone (**Rules → Redirect Rules**: hostname equals `tierinator.sayel.dev` → `https://tierinator.com`,
      path and query kept, 301), so old links and share links still land. A redirect to the new address can't bring
      lists with it: anyone with lists still there should back them up first.
