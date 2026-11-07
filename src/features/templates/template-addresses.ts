// src/features/templates/template-addresses.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What the app and the static template pages (scripts/template-pages.ts) both
//  need to agree on: the site's address, the link that opens a template, where to
//  suggest a new one, and the Pokémon pack's card. No imports, so the build can use it too.
// ─────────────────────────────────────────────────────────────────────────────

/** The site's own address, as in index.html's canonical link (docs/hosting.md lists every place it appears). */
export const SITE_ADDRESS = 'https://tierinator.sayel.dev';

/** The search parameter of a template link: /?template=planets opens that template, as its gallery card does. */
export const TEMPLATE_PARAMETER = 'template';

/** The template link for an id that isTemplateId has already accepted. */
export const templateLink = (id: string): string => `/?${TEMPLATE_PARAMETER}=${id}`;

/** A GitHub issue form (.github/ISSUE_TEMPLATE/template.yml): name, category, items. */
export const SUGGEST_TEMPLATE_ADDRESS = 'https://github.com/blaziikun/tierinator/issues/new?template=template.yml';

/** The Pokémon pack, shown with the templates; its link (/?template=pokemon) opens it the way its card does. */
export const POKEMON_PACK = {
    id: 'pokemon',
    title: 'Pokémon',
    category: 'Games',
    description: 'Every Pokémon and form, with sprites from every game.',
    searchText: 'pokémon pokemon pack sprites every form games',
};
