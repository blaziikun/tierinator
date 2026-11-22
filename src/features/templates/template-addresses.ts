// src/features/templates/template-addresses.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What the app and an app's static template pages (Tierinator's
//  scripts/template-pages.ts) both need to agree on: the link that opens a
//  template, and the Pokémon pack's card. No imports, so a build script can use it too.
//  The site's own address and where to suggest a template come from the app's config (app.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** The search parameter of a template link: /?template=planets opens that template, as its gallery card does. */
export const TEMPLATE_PARAMETER = 'template';

/** The template link for an id that isTemplateId has already accepted. */
export const templateLink = (id: string): string => `/?${TEMPLATE_PARAMETER}=${id}`;

/** A GitHub issue form in the app's repo (.github/ISSUE_TEMPLATE/template.yml): name, category, items. */
export const suggestTemplateAddress = (source: string): string => `${source}/issues/new?template=template.yml`;

/** The Pokémon pack, shown with the templates; its link (/?template=pokemon) opens it the way its card does. */
export const POKEMON_PACK = {
    id: 'pokemon',
    title: 'Pokémon',
    category: 'Games',
    description: 'Every Pokémon and form, with sprites from every game.',
    searchText: 'pokémon pokemon pack sprites every form games',
};
