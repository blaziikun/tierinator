# Security

> What could go wrong for a site like this, and what stops each thing.
> Checked against a common 50-point list of web app holes, plus rate limits, costs and data you leave behind.
> To report a problem, see [SECURITY.md](../SECURITY.md).

---

## What there is to protect {0}

There is no server, no account and no database. Nothing a visitor ranks is uploaded. That removes most of the usual
attacks outright. What's left:

| Thing | Where it lives | The risk |
| --- | --- | --- |
| A visitor's lists and pictures | Their browser (localStorage, IndexedDB) | Code running on the site could read or wipe them |
| The site | Cloudflare, deployed from GitHub | Whoever can publish can change it for everyone |
| The deploy token | GitHub's encrypted secrets, `production` environment | Used only by the deploy job |

So everything below guards two things: **nobody gets code to run on the site**, and **nobody but the owner can publish it**.

## Files, links and pictures people open {1}

Every file and link is hostile until checked.

- [x] **Pictures** (uploads, pastes, zips, backups, websites) all go through `checkedImage` (`src/lib/images.ts`): the real
      type comes from the bytes, never the name; SVGs are redrawn as PNGs so any script inside is gone; 25 MB at most, and
      the size in the file's header is read before anything is decoded, so a "decompression bomb" claiming more than 50
      million pixels is refused before it can freeze the tab. Pictures are shown from `blob:` addresses, which can't run code.
- [x] **List files, backups, packs:** 50 MB at most (backups 200 MB); read field by field (`core/snapshot.ts`,
      `core/pack-format.ts`). Sprite paths can't climb out of their collection, written plainly (`..`) or encoded (`%2e`).
      Unknown fields dropped, numbers clamped, colours must be real colours (no smuggled CSS), ids must exist. Picture
      addresses must be web addresses or paths inside the sprite collections (no `..` or `\` to walk out of them);
      embedded `data:image` pictures are decoded in place, never fetched. Pictures with web addresses load from those
      addresses, as on any web page, so open list files only from people you'd take a file from.
- [x] **Templates** (`public/templates`, added by pull request): read field by field all the same
      (`core/template-format.ts`): ids are plain words (they become an address), page titles can't smuggle in a second
      title, pictures only `https` on the known picture sites or Wikipedia's freely licensed lead pictures. A unit test
      reads every template, so a broken one fails CI.
- [x] **Picture credits** (authors and licences from Wikimedia, `features/credits/wiki-credits.ts`): authors arrive as
      HTML and are cut down to plain text as text (never parsed into a page), then checked and capped like any saved field
      (`core/snapshot.ts`) and escaped when shown. Their links only ever go to the file's page on Commons or Wikipedia.
- [x] **Zips:** any entry claiming more than 64 MB is refused, each file is unpacked once however many items point at it,
      and a list's pictures together stop at 256 MB. Path tricks are skipped.
- [x] **CSV files:** 5 MB at most, read as UTF-8 or Windows-1252, at most 5,000 rows of 50 cells; names and tier labels
      cut to the lengths a list allows, at most 50 tiers made; only `https:` picture addresses, which then load like any
      list file's pictures. Writing guards cells that start with `=`, `+`, `-` or `@` so spreadsheets don't run them.
- [x] **Share links:** URL-safe characters only, at most 4 MB once unpacked (`src/lib/link-data.ts`), then the same checks
      as a list file. A link opens as a preview and only becomes a list if the visitor keeps it. Its pictures from the
      sprite collections and the sites Add items searches load at once; pictures from any other site wait for a click
      ("Show pictures from …"), so whoever made the link can't learn who opened it.

## Markup and the security policy {2}

- [x] One way to make markup: `` html`…` `` (`src/lib/html.ts`) escapes every value; links must be `http(s)` or on this site.
- [x] A unit test fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` and
      inline `on…=` handlers anywhere else.
- [x] **Trusted Types** are required by the policy: even a slipped `innerHTML` is refused by the browser.
- [x] `public/_headers` sends, with every page: a strict Content-Security-Policy (scripts only from this site, no inline
      script, no `eval`, no plugins, no frames, no workers but the site's own ({2.1}), no foreign forms, no `<base>`),
      `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a Permissions-Policy that turns off camera,
      microphone, location and the like, `Cross-Origin-Opener-Policy`, and HSTS.
- [x] `pnpm preview` sends the same headers, so every browser test runs under them, and tests prove the defences hold:
      - `tests/e2e/script-injection.spec.ts`: markup and `javascript:` addresses in a list name, item name, tier label and
        subtitle, note, tag, CSV cell, share link, template link and template file all show as plain text and run nothing;
        and the policy itself refuses `eval`, `new Function`, a string timer, an inline script, an inline handler and a
        `javascript:` link, reporting each one (`securitypolicyviolation`). These run from a real click: the browser lets
        code sent through its automation channel use `eval` whatever the policy says, so testing there would prove nothing.
      - `tests/e2e/xss-sweep.spec.ts`: every text field the app has (searches, find, rename, tier editor, item editor,
        tags, variants, Studio, Style, picture links, web search and wiki import against local stand-ins, the pack builder,
        Combine rankings, the template gallery), filled with every attack in `tests/e2e/injection.ts`, then every window
        opened on the result. Outside addresses without a stand-in are refused, so it never reaches the internet.
      - Both use one watcher, installed before the page's own scripts: it records any element only an attack could make
        (an `on…` attribute, a `javascript:` address, `srcdoc`, a script, frame or object the app didn't load), every
        policy violation (the app on its own causes none), and any load of the probe picture the attacks point at. A test
        proves the watcher itself notices markup that gets through.

Two rules are loose on purpose: `img-src https:` and `connect-src https:`, because the app shows pictures and searches
from sites the visitor chooses (and any MediaWiki); and inline styles, because the Style panel sets colours live. CSS
can't run code; scripts stay locked to this site.

### The offline app {2.1}

Two directives were `'none'` until the app became installable, and are now `'self'`, nothing wider:

- [x] **`manifest-src 'self'`** lets the browser read `/manifest.webmanifest` (name, colours, icons), which is what makes
      the site installable. A manifest can't run code.
- [x] **`worker-src 'self'`** lets the page register `/sw.js`, the service worker that keeps the app for offline use.
      Only a script from this site can be a worker: no `blob:` or `data:` workers, nothing from another site.
- [x] **Trusted Types** treat a worker's address like a script's: `register()` refuses a plain string. The address comes
      from a second policy, `tierinator-sw` (`src/features/offline/offline.ts`), which makes exactly one address,
      `/sw.js`, and throws for anything else. It's named in the `trusted-types` directive beside `tierinator-html`, and
      neither can be created twice, so other code can't make its own. A browser test proves both.
- [x] **What the worker keeps:** only this site's own files (pages, `/assets`, icons, and templates and packs once used).
      Requests to other sites pass straight through, untouched and never stored, so a picture or search answer can't be
      replayed from the cache; pictures are kept by the app itself, as before. `sw.js` is sent with
      `Cache-Control: no-cache` and registered with `updateViaCache: 'none'`, so a fixed version reaches people on their
      next visit rather than up to a day later. `sw.js` gets the same headers as every page, so the worker runs under the
      same strict policy too.

## Rate limits, quotas, bots and money {3}

- [x] **Nothing to flood.** Every request is for a static file, which Cloudflare serves free with no request limit, and
      absorbs floods for. There's no sign-up, login or API to hammer, so no rate limits, quotas, throttling or
      CAPTCHA are needed today.
- [x] **No bill possible.** The Cloudflare account has no payment method (hosting.md {3.2}); free-plan Workers stop at their
      limits instead of charging.
- [x] **Other sites' limits are respected.** Searches go from each visitor's browser to those sites, with no keys, so they
      count against the visitor, not this site. Restoring hundreds of sprites runs four at a time with retries, so big
      lists don't trip GitHub's limits.
- [ ] **If a server is ever added** (architecture.md {4}): Turnstile on sign-up, per-address limits on sign-in and
      sign-up (about 10 a minute), per-account limits on the API (about 60 a minute), hard caps in code on accounts, saves
      per day and upload size, no R2 (it needs a payment method), and a Cloudflare budget alert.

## Data you leave behind {4}

- [x] No cookies, no sessions, no `sessionStorage`; nothing to clear on "log out" because there is no log-in.
- [x] **Delete everything** (About & privacy) removes every list, picture, theme and setting from the browser:
      localStorage keys and the IndexedDB database, then reloads. Other open tabs let go of the database so it isn't held up.
- [x] The offline copy of the app (the browser's Cache Storage, {2.1}) holds only this site's public files, the same for
      everyone, plus the templates and packs that were opened. Delete everything removes the templates and packs (they show
      what was opened) and keeps the app itself, so the page still loads offline; clearing the site's data in the browser
      removes that too.
- [x] Only one tab saves the open list at a time (older tabs are asked to reload), so a forgotten tab can't write an old
      copy over a list that was deleted or changed elsewhere.

## The 50 common holes, one by one {5}

| # | Hole | Here |
| --- | --- | --- |
| 1 | Exposed database credentials | No database |
| 2 | Public `.env` files | None exist; `.gitignore` covers `.env*` and `.dev.vars*`; only `dist/` is deployed |
| 3 | Hardcoded API keys | None; the app calls only keyless public APIs. Gitleaks scans every commit on every branch and tag in CI ({6}) |
| 4 | Weak or missing authentication | No accounts |
| 5 | No authorisation checks | Nothing is shared between visitors to authorise |
| 6 | Users reading others' data | Each browser holds only its own; a share link holds only what its sender chose, and can't make the browser report back to its sender |
| 7 | Open database permissions | No database |
| 8 | Misconfigured Firebase / Supabase / S3 | None used; no R2 |
| 9 | Unprotected admin routes | No admin; static files only |
| 10 | Debug pages in production | The test handle (`window.__app`) is only imported by test builds (`main.ts`), so production files don't contain it |
| 11 | Build logs leaking secrets | The Cloudflare secrets reach only the deploy step and `PRIVATE_WORDS` only the guard's step; GitHub masks them, and the guard never prints a word or a path containing one |
| 12 | Stack traces in errors | No server; the app shows short, plain messages |
| 13 | Leaked repos or commit history | Fresh history, noreply author, Gitleaks over every commit, the identity guard over every commit and file ({8}), no personal data or real exports in tests |
| 14 | Secrets in front-end JavaScript | There are none to leak |
| 15 | Client-side-only security checks | Nothing to protect on a server; all checks protect the visitor's own browser |
| 16 | Missing input validation | Every outside input checked by one module per format ({1}) |
| 17 | SQL injection | No SQL |
| 18 | NoSQL injection | IndexedDB keys are made by the app, never taken from input |
| 19 | Cross-site scripting | Escaping templates, Trusted Types, strict CSP, tests ({2}) |
| 20 | Cross-site request forgery | No server actions to forge |
| 21 | Insecure file uploads | Nothing is uploaded; files are checked in the browser ({1}) |
| 22 | Path traversal | No server file system; zip paths with `..` or `/` are skipped |
| 23 | Server-side request forgery | No server makes requests |
| 24 | Broken password resets | No passwords |
| 25 | Weak session management | No sessions |
| 26 | Weak or leaked JWT secrets | No tokens |
| 27 | Overly permissive CORS | No API; static files only |
| 28 | Missing rate limits | Nothing to limit today; the plan for a server is in {3} |
| 29 | Public test or staging sites | `workers_dev` and `preview_urls` are off: the site exists only at its own address |
| 30 | Default credentials | None exist |
| 31 | Unsigned webhooks | None |
| 32 | Front-end-only payment checks | No payments; support would go through GitHub Sponsors |
| 33 | Insecure direct object references (IDOR) | No server objects; a share link carries its list rather than pointing at one |
| 34 | APIs trusting user-supplied ids or roles | No API |
| 35 | Logs with tokens, emails or private data | No logs of ours, no `console.log` in the code; Cloudflare keeps only its standard request logs |
| 36 | Source maps in production | Off (`sourcemap: false`); the code is public anyway |
| 37 | Vulnerable dependencies | Two runtime libraries; `pnpm audit --prod --audit-level high` runs in CI's test job and fails it on anything high |
| 38 | Outdated packages | Dependabot weekly, a week after release, merged only when CI is green |
| 39 | Text read as instructions | Nothing in the app treats text as commands; everything shown is escaped ({2}) |
| 40 | Third-party tools reaching data | No third-party scripts, plugins or integrations run on the site |
| 41 | Over-privileged database users | No database; the deploy token can only deploy Workers on one domain |
| 42 | No audit logs | Every deploy is a GitHub Actions run tied to a commit; Cloudflare lists every version |
| 43 | No monitoring or alerting | GitHub emails failed runs and Dependabot alerts; Cloudflare emails account notices |
| 44 | No backup or restore plan | Code: git. Site: roll back any version in Cloudflare. Visitors: Back up all lists, with reminders |
| 45 | Exposed internal dashboards | None |
| 46 | Missing security headers | The full set ({2}) |
| 47 | Cookies without HttpOnly / Secure / SameSite | No cookies |
| 48 | Unencrypted sensitive data | No sensitive data is collected; everything travels over HTTPS with HSTS. Backup files are plain JSON of the visitor's own lists |
| 49 | Poor tenant isolation | No shared server, so no tenants |
| 50 | Code merged without review | Outside pull requests need approval before anything runs, and are read before they're merged; CI gates every push |

## Publishing {6}

- [x] Third-party GitHub Actions pinned to full commit hashes; the workflow token is read-only and not kept in the checkout.
- [x] The deploy job runs only for pushes to `main`, only after every check passes, only in the `production` environment
      (limited to `main`). Pull requests from forks never see secrets, and outside contributors' workflows need approval.
- [x] pnpm runs no package install scripts; versions are exact; the lock file pins every hash.
- [x] **Gitleaks over the whole history, every run.** The `secrets` job checks out every commit (`fetch-depth: 0`) and
      runs `gitleaks git --log-opts=--all`: every branch and tag, not just what a push adds. The Gitleaks GitHub Action
      wasn't enough: on a push it scans only `first^..last` of the pushed commits (so a secret already in the history is
      never looked at again), and it downloads its binary with no checksum and caches it. Instead the job builds
      Gitleaks 8.30.1 from source with the runner's Go (`go install …@v8.30.1`). Go checks the release against
      sum.golang.org's public, append-only log before building, and Gitleaks's own `go.sum` pins every library it
      uses, so neither a moved tag nor a changed library can change what runs. Findings are printed redacted.
- [ ] **Updating Gitleaks:** pick a release at least two weeks old and change the version in `ci.yml`.
- [x] **The identity guard** runs in its own job, the only step that sees the `PRIVATE_WORDS` secret, and the deploy
      waits for it ({8}).

## Legal, briefly {7}

*Not legal advice; the sensible defaults for a free, non-commercial site.*

| What people get sued or taken down for | Here |
| --- | --- |
| **Copyright** (hosting others' images, fonts, code) | No Pokémon images are stored or served; sprites load from their public collections. Fonts are OFL, credited; dependencies are MIT/BSD/Apache-compatible. Visitors' own pictures never leave their browser |
| **Trademarks** (implying affiliation, using a brand as your name or logo) | Original name and icon; a clear "unofficial, not affiliated" notice; Pokémon named only to say what the site does |
| **Privacy** (UK/EU GDPR, PECR cookie rules, US state laws) | No personal data collected; storage is strictly necessary for the service asked for, so no consent banner; the privacy page says exactly what other sites see; default fonts self-hosted (a German court fined a site over Google-hosted fonts), and pictures from unknown sites in a shared list wait for a click |
| **Accessibility** (US ADA suits, the EU Accessibility Act) | Mostly aimed at businesses selling things; still, WCAG 2.2 AA is the target, axe-core runs in CI, and the privacy page has an accessibility statement with a way to report barriers |
| **Content people share** | Share links live in the link itself, not on this site; the terms say visitors are responsible for what they add and share |
| **Warranty claims** | MIT licence and the terms: provided as it is, without warranty |

If a rights holder ever asks for something to be removed, remove it and reply; that's the whole process for a site like this.

## Keeping my name out of it: the identity guard {8}

I publish as "sayel" and keep my private details out of everything public. `scripts/identity-guard.ts` (`pnpm guard`) fails if
any of my private words shows up anywhere that is, or will be, public. The words are never in the repository.

| Where it looks | How |
| --- | --- |
| Every file git tracks, plus new files not ignored (or, outside a checkout, every file but `node_modules`, `dist`, test output) | Text by line; Latin-1 files too |
| Every file in every earlier commit, on every branch and tag | Each version git keeps, once; a word deleted last week is still in the history anyone can clone |
| File and folder names, now and in the history; branch and tag names | |
| Names and emails of every commit's author and committer, commit messages (so `Co-authored-by:` lines), taggers and tag messages | |
| Picture metadata | PNG: every chunk but the picture data, with `zTXt`, compressed `iTXt` and the `iCCP` colour profile unpacked. JPEG: Exif (including Windows' UTF-16 author fields), XMP, IPTC and comments. SVG is text, so its `<metadata>` and comments are read line by line |
| Other binary files (fonts, icons, GIF and WebP metadata…) | The bytes read as Latin-1, UTF-8 and UTF-16 |
| The built site, `dist/` (`pnpm guard --dist`, after `pnpm build`) | All of the above |

Files are read 4 MB at a time, so size doesn't matter; symbolic links are never followed (where one points is checked
as text). The report names the file and line, or the commit and field, and the word's number in the list ("matches
private word #3"): it never prints a word, and a path or branch name containing one is shown with that part
`[hidden]`. CI's logs are as public as the repository.

**What counts as a match.** Both the word and the text are first written one way: Unicode NFKC (full-width letters,
ligatures and no-break spaces become plain ones), invisible characters removed (zero-width spaces, soft hyphens), lower
case, accents off (`José` = `Jose`, and `ø ł ß æ` become `o l ss ae`), and camelCase split (`janeDoe` is two words). Then:

- **Whole words only**, so a short name doesn't match inside longer words (`Ann` isn't found in `annual`). Names in
  scripts written without spaces (Chinese, Japanese, Thai) match anywhere.
- **Up to three separators inside a word** (spaces, `.`, `_`, `-`, apostrophes): `j.o.h.n`, `Smith-Jones`, `O'Brien`.
- **Up to forty between the words of a phrase**, including a line break and the next line's comment marker (`//`, `#`,
  `*`, `>`) and an email's `@` or `+`: `Jane\n// Doe`, `jane.doe@`, `jane_doe`, `JaneDoe`, `janedoe` all match "Jane Doe".
- Words under three letters are refused (they'd match everywhere: "Li" is in every `<li>`); put them in a phrase.

**What it can't catch.** Anything not written with the word's letters in order: misspellings, nicknames, initials, a
middle name or initial inside a phrase (`Jane Q. Doe` doesn't match "Jane Doe": list each form you use), leetspeak,
translations or other alphabets, text inside pictures' pixels, anything compressed or encoded (zip files, WOFF2 fonts,
PDF streams, base64, URL-encoded text, compressed PNG chunks that unpack to more than 16 MB) and git history over 256 MB a
file (reported, not read). It also can't see what was never committed: the GitHub account, the Cloudflare account, the
domain's WHOIS record (hosting.md {3.3}), or anything already copied elsewhere.

**Setting it up:** hosting.md {2.3}. Without words, a contributor's `pnpm guard` says it skipped and passes; in CI
(`CI=true`) a missing or empty secret fails the job, and with it the deploy. Pull requests from forks never get
secrets, so they skip the job; the push to `main` that merges one runs it before anything deploys.

**When it finds something:** remove it. If it's in a commit that was never pushed, rewrite those commits
(`git rebase -i`, `git commit --amend --reset-author`). If it was pushed, rewrite the history (`git filter-repo`),
force-push with the ruleset's force-push block lifted for a moment, and treat the old history as public anyway: forks,
clones and caches keep it.

