// src/features/export/layout.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The open list and its theme as tier-engine/export wants them: the list
//  (exportInput: which tiers, the title, captions, notes, credit, per the Export
//  panel) and the look (exportLook, from the theme), and each item's picture.
//  The layout and the SVG and PNG drawing are the engine's; the PDF is export.ts's.
// ─────────────────────────────────────────────────────────────────────────────

import { tileBox } from 'tier-engine/core';
import {
    drawPicture as drawEnginePicture,
    type ExportInput,
    type ExportLook,
    type ExportPicture,
    fontsReady as engineFontsReady,
    exportFonts,
} from 'tier-engine/export';
import { siteName } from '../../core/app';
import { dexLabel, entryById } from '../../core/items';
import { currentListMeta, state } from '../../core/state';
import type { ItemId, LabelMode } from '../../core/types';
import { applyLabelCase, fontStack, labelTextColor, rowBackground } from '../appearance/theme';
import { spriteCrop, spriteSrc } from '../sprites/sprites';
import { measureRowWidth, orderedIds, rowWidth } from '../tier-board/board';
import { pictureFit } from '../tier-board/tile-shape';

/** The theme as the export draws it. */
export function exportLook(): ExportLook {
    const theme = state.theme;
    return {
        background: theme.bg,
        panel: theme.panel,
        text: theme.text,
        muted: theme.muted,
        headFamily: fontStack(theme.fHead),
        uiFamily: fontStack(theme.fUi),
        labelWeight: theme.wLabel,
        titleWeight: theme.wHead,
        uiWeight: theme.wUi,
        labelSize: theme.fsLabel,
        letterSpacing: theme.ls,
        labelWidth: theme.lw,
        gap: theme.gap,
        radius: theme.radius,
        captionSize: theme.lblFs,
        captionGap: theme.lblGap,
        labelCase: applyLabelCase,
        labelTextColor,
        rowBackground,
    };
}

/** What the exports' corner line says: the app's own address (app.ts). */
export const creditLine = (): string => `Made with ${siteName()}`;
/** The unranked section's heading. */
const UNRANKED_HEADING = 'Not ranked';

/** The caption under a picture: name, number, both, or nothing. */
export function itemLabel(id: ItemId, mode: LabelMode): string {
    const name = entryById.get(id)!.name;
    if (mode === 'name') return name;
    if (mode === 'num') return dexLabel(id);
    if (mode === 'both') return `${dexLabel(id)} ${name}`.trim();
    return '';
}

/** The open list as the Export panel's options say, laid out like the screen (same tile size and shape, rows as wide). */
export function exportInput(): ExportInput {
    measureRowWidth();
    const options = state.exportOptions;
    return {
        tiers: state.tiers,
        pool: options.includeUnranked ? orderedIds('pool') : [],
        layout: state.layout === 'chart' ? 'chart' : 'rows',
        chartColumns: state.chartColumns,
        tile: tileBox(state.tileShape, state.tileSize),
        rowWidth: rowWidth(),
        includeEmptyTiers: options.includeEmptyTiers,
        title: options.includeTitle ? (currentListMeta()?.name || '').trim() || 'Tier list' : null,
        credit: options.includeCredit ? creditLine() : null,
        caption: options.labelMode === 'off' ? null : (id) => itemLabel(id, options.labelMode),
        note: options.includeNotes ? (id) => state.notes[id] : null,
        name: (id) => entryById.get(id)!.name,
        look: exportLook(),
        unrankedHeading: UNRANKED_HEADING,
    };
}

/** Where an item's picture comes from, cropped and fitted as on screen. */
export const exportPicture = (id: ItemId): ExportPicture => ({ src: spriteSrc(id), crop: spriteCrop(id), fit: pictureFit(id) });

/** An item's picture on a canvas the tile's shape (the engine's drawPicture; the canvas is reused). */
export const drawPicture = (id: ItemId, size: { width: number; height: number }): Promise<HTMLCanvasElement> =>
    drawEnginePicture(exportPicture(id), size);

/** Waits until the theme's fonts have loaded, so measuring and drawing use them. */
export const fontsReady = (): Promise<void> => engineFontsReady(exportLook());

/** The theme's fonts at a size: tier labels, the title, and everything else. */
export const headFont = (size: number): string => exportFonts(exportLook()).head(size);
export const titleFont = (size: number): string => exportFonts(exportLook()).title(size);
export const uiFont = (size: number): string => exportFonts(exportLook()).ui(size);

/** "my-pokemon-tier-list": the list's name, safe as a file name. */
export const fileStem = (): string =>
    (currentListMeta()?.name || state.theme.name || 'tierlist')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'tierlist';
