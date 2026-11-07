// scripts/check-template-titles.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Checks every template item's Wikipedia title against Wikipedia itself: pages
//  that don't exist, disambiguation pages, and pages without a freely licensed
//  lead picture (those items become text tiles, which is fine but worth knowing).
//  Needs the internet, so it isn't part of CI.   pnpm check:templates
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';

const FOLDER = 'public/templates/';
const API = 'https://en.wikipedia.org/w/api.php';
const TITLES_PER_REQUEST = 50; // Wikipedia's limit without a bot account
const USER_AGENT = 'tierinator-template-check (https://github.com/blaziikun/tierinator)';

/** Each title → the templates that use it. */
const templatesOfTitle = new Map();
for (const file of readdirSync(FOLDER).filter((name) => name.endsWith('.json') && name !== 'index.json')) {
    const template = JSON.parse(readFileSync(FOLDER + file, 'utf8'));
    for (const item of template.items) {
        if (item.wiki) templatesOfTitle.set(item.wiki, [...(templatesOfTitle.get(item.wiki) ?? []), template.id]);
    }
}

const titles = [...templatesOfTitle.keys()];
const missing = [];
const ambiguous = [];
const withoutPicture = [];

for (let start = 0; start < titles.length; start += TITLES_PER_REQUEST) {
    const batch = titles.slice(start, start + TITLES_PER_REQUEST);
    const query = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        redirects: '1',
        prop: 'pageprops|pageimages',
        ppprop: 'disambiguation',
        piprop: 'name',
        pilicense: 'free',
        titles: batch.join('|'),
    });
    const response = await fetch(`${API}?${query}`, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) throw new Error(`Wikipedia answered ${response.status}; try again later`);
    const answer = await response.json();
    // Wikipedia answers under each page's real title: follow its spelling fixes and redirects back
    const renamed = new Map([...(answer.query.normalized ?? []), ...(answer.query.redirects ?? [])].map((step) => [step.from, step.to]));
    const pages = new Map(answer.query.pages.map((page) => [page.title, page]));
    for (const title of batch) {
        let current = title;
        for (let step = 0; step < 4 && renamed.has(current); step++) current = renamed.get(current);
        const page = pages.get(current);
        const where = `${title}  (${templatesOfTitle.get(title).join(', ')})`;
        if (!page || page.missing || page.invalid) missing.push(where);
        else if (page.pageprops && 'disambiguation' in page.pageprops) ambiguous.push(where);
        else if (!page.pageimage) withoutPicture.push(where);
    }
    await new Promise((resolve) => setTimeout(resolve, 300)); // one request at a time, gently
}

const section = (heading, lines) => `\n${heading} (${lines.length})${lines.length ? `:\n  ${lines.join('\n  ')}` : ''}`;
console.log(`${titles.length} titles checked`);
console.log(section('Missing pages', missing));
console.log(section('Disambiguation pages', ambiguous));
console.log(section('No free lead picture (text tiles)', withoutPicture));
if (missing.length || ambiguous.length) process.exitCode = 1;
