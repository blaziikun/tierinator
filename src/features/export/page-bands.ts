// src/features/export/page-bands.ts
// ─────────────────────────────────────────────────────────────────────────────
//  How an exported picture stacks up, top to bottom: the title, the tiers, the
//  unranked items, the notes and the "Made with …" line. Plain arithmetic with no
//  page involved, so the unit tests can check it (layout.ts does the measuring).
// ─────────────────────────────────────────────────────────────────────────────

/** The height of each part; 0 for a part that's left out. */
export interface PageParts {
    titleHeight: number;
    tiersHeight: number;
    unrankedHeight: number;
    notesHeight: number;
    creditHeight: number;
    /** Between the tiers and the unranked items. */
    sectionGap: number;
}

/** Where each part starts, and the whole picture's height. */
export interface PageBands {
    tiersTop: number;
    unrankedTop: number;
    notesTop: number;
    creditTop: number;
    height: number;
}

/** Room above and below the title's lines. */
export const TITLE_PADDING = { top: 14, bottom: 10 } as const;
/** The "Made with …" line's band: small, under everything else. */
export const CREDIT_HEIGHT = 22;
/** The unranked section's heading, above its pictures. */
export const UNRANKED_HEADING_HEIGHT = 24;

/** With no title, unranked items or credit, the tiers start at the top exactly as they always did. */
export function stackPage(parts: PageParts): PageBands {
    const tiersTop = parts.titleHeight;
    const tiersBottom = tiersTop + parts.tiersHeight;
    const unrankedTop = parts.unrankedHeight ? tiersBottom + parts.sectionGap : tiersBottom;
    const notesTop = unrankedTop + parts.unrankedHeight;
    const creditTop = notesTop + parts.notesHeight;
    return { tiersTop, unrankedTop, notesTop, creditTop, height: creditTop + parts.creditHeight };
}

/** A title of `lines` lines `lineHeight` apart, with its padding; no lines, no band. */
export const titleHeight = (lines: number, lineHeight: number): number =>
    lines > 0 ? Math.ceil(lines * lineHeight) + TITLE_PADDING.top + TITLE_PADDING.bottom : 0;

/** How many pictures `tileWidth` wide fit across `width` (always at least one). */
export const picturesAcross = (width: number, tileWidth: number, gap: number): number =>
    Math.max(1, Math.floor((width + gap) / (tileWidth + gap)));

/** The unranked section: its heading, then `count` pictures in lines of `across`, padded all round. */
export function unrankedHeight(
    count: number,
    across: number,
    picture: { tileHeight: number; captionHeight: number; gap: number; padding: number },
): number {
    if (!count) return 0;
    const lines = Math.ceil(count / across);
    return UNRANKED_HEADING_HEIGHT + lines * (picture.tileHeight + picture.captionHeight) + (lines - 1) * picture.gap + picture.padding * 2;
}
