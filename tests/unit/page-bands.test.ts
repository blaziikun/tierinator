// An exported picture, top to bottom: title, tiers, unranked items, notes, credit.
import { describe, expect, it } from 'vitest';
import {
    CREDIT_HEIGHT,
    picturesAcross,
    stackPage,
    TITLE_PADDING,
    titleHeight,
    UNRANKED_HEADING_HEIGHT,
    unrankedHeight,
} from '../../src/features/export/page-bands';

const nothingElse = { titleHeight: 0, tiersHeight: 400, unrankedHeight: 0, notesHeight: 0, creditHeight: 0, sectionGap: 6 };

describe('export page bands', () => {
    it('with every extra off, the tiers fill the picture exactly as before', () => {
        expect(stackPage(nothingElse)).toEqual({ tiersTop: 0, unrankedTop: 400, notesTop: 400, creditTop: 400, height: 400 });
    });

    it('puts the title above the tiers and moves everything down by its height', () => {
        const title = titleHeight(1, 34);
        expect(title).toBe(34 + TITLE_PADDING.top + TITLE_PADDING.bottom);
        const bands = stackPage({ ...nothingElse, titleHeight: title });
        expect(bands.tiersTop).toBe(title);
        expect(bands.height).toBe(title + 400);
        expect(titleHeight(2, 33.6)).toBe(68 + TITLE_PADDING.top + TITLE_PADDING.bottom);
        expect(titleHeight(0, 34)).toBe(0);
    });

    it('stacks unranked items, notes and the credit under the tiers, in that order', () => {
        const bands = stackPage({
            titleHeight: 58,
            tiersHeight: 400,
            unrankedHeight: 120,
            notesHeight: 60,
            creditHeight: CREDIT_HEIGHT,
            sectionGap: 6,
        });
        expect(bands).toEqual({
            tiersTop: 58,
            unrankedTop: 58 + 400 + 6,
            notesTop: 58 + 400 + 6 + 120,
            creditTop: 58 + 400 + 6 + 120 + 60,
            height: 58 + 400 + 6 + 120 + 60 + CREDIT_HEIGHT,
        });
    });

    it('adds the credit as a small band at the very bottom', () => {
        const bands = stackPage({ ...nothingElse, creditHeight: CREDIT_HEIGHT });
        expect(bands.creditTop).toBe(400);
        expect(bands.height).toBe(400 + CREDIT_HEIGHT);
        expect(CREDIT_HEIGHT).toBeLessThan(30);
    });

    it('sizes the unranked section by its pictures, their shape and captions', () => {
        const picture = { tileHeight: 108, captionHeight: 0, gap: 2, padding: 6 };
        const across = picturesAcross(600, 72, 2);
        expect(across).toBe(8);
        // 10 pictures, 8 across: two lines
        expect(unrankedHeight(10, across, picture)).toBe(UNRANKED_HEADING_HEIGHT + 2 * 108 + 2 + 12);
        expect(unrankedHeight(10, across, { ...picture, captionHeight: 12 })).toBe(UNRANKED_HEADING_HEIGHT + 2 * 120 + 2 + 12);
        // landscape tiles: fewer across, shorter lines
        expect(picturesAcross(600, 117, 2)).toBe(5);
        expect(unrankedHeight(0, across, picture)).toBe(0);
        expect(picturesAcross(10, 200, 2)).toBe(1);
    });
});
