// src/features/export/layout.ts
// ─────────────────────────────────────────────────────────────────────────────
//  What every export (SVG, PNG, PDF) shares: where the title, each tier, label and
//  picture, the unranked items and the credit go (rows, or a chart's grid of cells),
//  text measured to fit, each picture drawn in the tile's shape. Formats: export.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { dexLabel, entryById } from '../../core/items';
import { currentListMeta, state } from '../../core/state';
import { cropView, fitPicture, tileBox } from '../../core/tile-box';
import type { ItemId, LabelMode, Tier } from '../../core/types';
import { applyLabelCase, fontStack } from '../appearance/theme';
import { spriteCrop, spriteSrc } from '../sprites/sprites';
import { SITE_ADDRESS } from '../templates/template-addresses';
import { lastRowWidth, measureRowWidth, orderedIds } from '../tier-board/board';
import { pictureFit } from '../tier-board/tile-shape';
import { type Box, layoutChartGrid, tilesAcrossCell } from './chart-grid';
import {
    CREDIT_HEIGHT,
    picturesAcross,
    stackPage,
    TITLE_PADDING,
    titleHeight,
    UNRANKED_HEADING_HEIGHT,
    unrankedHeight,
} from './page-bands';

// ═════════════════════════════════════════════════════════════════════════════
//  TEXT
// ═════════════════════════════════════════════════════════════════════════════

/** A canvas used only to measure text. */
export const measureCanvas = document.createElement('canvas').getContext('2d')!;

export const headFont = (size: number): string => `${state.theme.wLabel} ${size}px ${fontStack(state.theme.fHead)}`;
export const uiFont = (size: number): string => `${state.theme.wUi} ${size}px ${fontStack(state.theme.fUi)}`;

/** Waits until the theme's fonts have loaded, so measuring and drawing use them. */
export async function fontsReady(): Promise<void> {
    try {
        await Promise.all([document.fonts.load(headFont(32)), document.fonts.load(titleFont(32)), document.fonts.load(uiFont(12))]);
        await document.fonts.ready;
    } catch {}
}

/** Wraps text into lines no wider than `width` (words longer than a line are broken). */
export function wrapText(text: string, width: number, font: string): string[] {
    measureCanvas.font = font;
    const fits = (line: string) => measureCanvas.measureText(line).width <= width;
    const lines: string[] = [];
    let line = '';
    const breakLongWord = (word: string): string => {
        let part = '';
        for (const char of word) {
            if (!fits(part + char) && part) {
                lines.push(part);
                part = char;
            } else part += char;
        }
        return part;
    };
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        const longer = line ? line + ' ' + word : word;
        if (fits(longer)) line = longer;
        else {
            if (line) lines.push(line);
            line = fits(word) ? word : breakLongWord(word);
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
}

export interface FittedLabel {
    fontSize: number;
    lines: string[];
    lineHeight: number;
}

/** The largest font size (up to the theme's) at which a tier label fits its box. */
export function fitLabel(text: string, width: number, height: number): FittedLabel {
    const spacing = (size: number) => {
        if ('letterSpacing' in measureCanvas) measureCanvas.letterSpacing = state.theme.ls * size + 'px';
    };
    try {
        for (let size = Math.round(state.theme.fsLabel * 1.1); size >= 7; size--) {
            spacing(size);
            const lines = wrapText(text, width, headFont(size));
            if (lines.length * size * 1.15 <= height) return { fontSize: size, lines, lineHeight: size * 1.15 };
        }
        return { fontSize: 7, lines: wrapText(text, width, headFont(7)), lineHeight: 8 };
    } finally {
        if ('letterSpacing' in measureCanvas) measureCanvas.letterSpacing = '0px';
    }
}

/** Shortens text with "…" until it fits. */
export function ellipsize(text: string, width: number, font: string): string {
    measureCanvas.font = font;
    if (measureCanvas.measureText(text).width <= width) return text;
    let short = text;
    while (short.length > 1 && measureCanvas.measureText(short + '…').width > width) short = short.slice(0, -1);
    return short + '…';
}

/** The caption under a picture: name, number, both, or nothing. */
export function itemLabel(id: ItemId, mode: LabelMode): string {
    const name = entryById.get(id)!.name;
    if (mode === 'name') return name;
    if (mode === 'num') return dexLabel(id);
    if (mode === 'both') return `${dexLabel(id)} ${name}`.trim();
    return '';
}

/** "my-pokemon-tier-list": the list's name, safe as a file name. */
export const fileStem = (): string =>
    (currentListMeta()?.name || state.theme.name || 'tierlist')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'tierlist';

// ═════════════════════════════════════════════════════════════════════════════
//  LAYOUT
// ═════════════════════════════════════════════════════════════════════════════

/** One tier (a full-width row, or a chart cell), or the unranked items' section under them. */
export interface ExportRow extends Box {
    tier: Tier;
    /** Its label: the left end of a row, or the band across the top of a cell or of the unranked section. */
    label: Box;
    /** Top-left corner of its first picture. */
    itemsX: number;
    itemsY: number;
    /** Pictures across it. */
    columns: number;
    /** The unranked items: a quiet heading on the panel colour rather than a tier's coloured label. */
    unranked?: true;
}

/** A line of text placed on the export: left-aligned at x, or right-aligned at x when `alignRight`. */
export interface ExportText {
    lines: string[];
    font: string;
    fontSize: number;
    lineHeight: number;
    /** Middle of the first line. */
    top: number;
    x: number;
    alignRight?: true;
}

export interface ExportLayout {
    /** A chart: the rows are cells, with their labels on top. */
    chart: boolean;
    /** The tiers, then the unranked section if there is one. */
    rows: ExportRow[];
    tileWidth: number;
    tileHeight: number;
    gap: number;
    padding: number;
    width: number;
    /** The whole picture: title, tiers, unranked items, notes and credit. */
    height: number;
    captionSize: number;
    captionGap: number;
    /** Space under each picture for its caption (0 = no captions). */
    captionHeight: number;
    radius: number;
    title: ExportText | null;
    notes: { lines: { text: string; first: boolean }[]; top: number; height: number };
    credit: ExportText | null;
}

/** What every picture in the export shares: its size (the list's tile shape), the spacing, the caption under it. */
interface PictureMetrics {
    tileWidth: number;
    tileHeight: number;
    gap: number;
    padding: number;
    captionHeight: number;
}

/** The tiers on their own, starting at the top: rows or a chart's cells, and their size. */
interface TierArea {
    chart: boolean;
    rows: ExportRow[];
    width: number;
    height: number;
}

/** What the exports' corner line says (the address comes from the one constant all the site's pages use). */
export const CREDIT_LINE = `Made with ${SITE_ADDRESS.replace(/^https?:\/\//, '')}`;
const CREDIT_FONT_SIZE = 10;
/** The unranked section's heading. */
export const UNRANKED_HEADING = 'Not ranked';

export const titleFont = (size: number): string => `${state.theme.wHead} ${size}px ${fontStack(state.theme.fHead)}`;
/** A title in proportion to the tier labels, within reason. */
const titleFontSize = (): number => Math.min(40, Math.max(20, Math.round(state.theme.fsLabel * 1.75)));

function pictureMetrics(): PictureMetrics {
    const theme = state.theme;
    const tile = tileBox(state.tileShape, state.tileSize);
    return {
        tileWidth: tile.width,
        tileHeight: tile.height,
        gap: 2,
        padding: 6,
        captionHeight: state.exportOptions.labelMode === 'off' ? 0 : Math.max(0, Math.round(theme.lblFs * 1.3 + theme.lblGap) + 2),
    };
}

/**
 * Lays the export out like the screen (same tile size and shape, as many pictures across as the
 * tier rows are wide), with the title above and the unranked items, notes and credit below.
 */
export function layoutExport(): ExportLayout {
    measureRowWidth();
    const theme = state.theme;
    const options = state.exportOptions;
    const metrics = pictureMetrics();
    const tiers = state.layout === 'chart' ? layoutChart(metrics) : layoutRows(metrics);
    const { width } = tiers;

    const titleSize = titleFontSize();
    const titleLines = options.includeTitle ? titleText(width - 16, titleFont(titleSize)) : [];
    const titleLineHeight = Math.round(titleSize * 1.2);

    const unrankedIds = options.includeUnranked ? orderedIds('pool') : [];
    const unrankedAcross = picturesAcross(width - 12 - metrics.padding * 2, metrics.tileWidth, metrics.gap);
    const notes = noteLines([...tiers.rows.map((row) => row.tier), { label: UNRANKED_HEADING, items: unrankedIds }], width);
    const bands = stackPage({
        titleHeight: titleHeight(titleLines.length, titleLineHeight),
        tiersHeight: tiers.height,
        unrankedHeight: unrankedHeight(unrankedIds.length, unrankedAcross, metrics),
        notesHeight: notes.height,
        creditHeight: options.includeCredit ? CREDIT_HEIGHT : 0,
        sectionGap: Math.max(theme.gap, 6),
    });

    const rows = tiers.rows.map((row) => shiftRow(row, bands.tiersTop));
    if (unrankedIds.length) rows.push(unrankedRow(unrankedIds, unrankedAcross, bands.unrankedTop, width, metrics));
    return {
        chart: tiers.chart,
        rows,
        ...metrics,
        width,
        height: bands.height,
        captionSize: theme.lblFs,
        captionGap: theme.lblGap,
        radius: Math.min(theme.radius, 20),
        title: titleLines.length
            ? {
                  lines: titleLines,
                  font: titleFont(titleSize),
                  fontSize: titleSize,
                  lineHeight: titleLineHeight,
                  top: TITLE_PADDING.top + titleLineHeight / 2,
                  x: 8,
              }
            : null,
        notes: { ...notes, top: bands.notesTop },
        credit: options.includeCredit
            ? {
                  lines: [CREDIT_LINE],
                  font: uiFont(CREDIT_FONT_SIZE),
                  fontSize: CREDIT_FONT_SIZE,
                  lineHeight: CREDIT_FONT_SIZE,
                  top: bands.creditTop + CREDIT_HEIGHT / 2,
                  x: width - 8,
                  alignRight: true,
              }
            : null,
    };
}

/** The list's name in at most two lines; a longer one ends in "…". */
function titleText(width: number, font: string): string[] {
    const name = (currentListMeta()?.name || '').trim() || 'Tier list';
    const lines = wrapText(name, width, font);
    return lines.length <= 2 ? lines : [lines[0]!, ellipsize(lines.slice(1).join(' '), width, font)];
}

const shiftRow = (row: ExportRow, down: number): ExportRow =>
    down ? { ...row, y: row.y + down, label: { ...row.label, y: row.label.y + down }, itemsY: row.itemsY + down } : row;

/** The pool's items as a section as wide as the tiers, its heading in a band across the top. */
function unrankedRow(ids: ItemId[], across: number, top: number, width: number, metrics: PictureMetrics): ExportRow {
    const theme = state.theme;
    return {
        tier: { id: 'unranked', label: UNRANKED_HEADING, subtitle: '', color: theme.panel, textColor: theme.muted, items: ids },
        unranked: true,
        x: 6,
        y: top,
        width: width - 12,
        height: unrankedHeight(ids.length, across, metrics),
        label: { x: 6, y: top, width: width - 12, height: UNRANKED_HEADING_HEIGHT },
        itemsX: 6 + metrics.padding,
        itemsY: top + UNRANKED_HEADING_HEIGHT + metrics.padding,
        columns: across,
    };
}

/** Tier rows, as wide as the board's (but never cramped). */
function layoutRows(metrics: PictureMetrics): TierArea {
    const theme = state.theme;
    const { tileWidth, tileHeight, gap, padding, captionHeight } = metrics;
    const available = Math.max(lastRowWidth - 10, tileWidth * 6, 600);
    const columns = Math.max(4, Math.floor((available + gap) / (tileWidth + gap)));
    const width = theme.lw + padding * 2 + columns * (tileWidth + gap) - gap + 12;
    let y = 0;
    const rows = state.tiers
        .filter((tier) => state.exportOptions.includeEmptyTiers || tier.items.length)
        .map((tier) => {
            const lines = Math.max(1, Math.ceil(tier.items.length / columns));
            const height = Math.max(lines * (tileHeight + captionHeight) + (lines - 1) * gap + padding * 2, tileHeight + padding * 2, 64);
            const row: ExportRow = {
                tier,
                x: 6,
                y,
                width: width - 12,
                height,
                label: { x: 6, y, width: theme.lw, height },
                itemsX: 6 + theme.lw + padding,
                itemsY: y + padding,
                columns,
            };
            y += height + theme.gap;
            return row;
        });
    return { chart: false, rows, width, height: Math.max(y - theme.gap, 10) };
}

/**
 * A chart laid out like the screen: its cells as wide as the board's, with the label bands
 * on top. Every cell is kept, empty or not: a chart with a hole in it would read wrong.
 */
function layoutChart(metrics: PictureMetrics): TierArea {
    const theme = state.theme;
    const { tileWidth, gap, padding } = metrics;
    const tilesAcross = tilesAcrossCell(Math.max(lastRowWidth - 10, 0), tileWidth, gap);
    // a band fits the longest label in up to two lines at fitLabel's largest size (smaller if it must), plus any subtitle
    const twoLines = Math.round(theme.fsLabel * 1.1) * 1.15 * 2;
    const bandHeightFor = (cellWidth: number) => {
        const tallest = Math.max(
            ...state.tiers.map((tier) => {
                const fitted = fitLabel(applyLabelCase(tier.label), cellWidth - 16, twoLines);
                return fitted.lines.length * fitted.lineHeight + (tier.subtitle ? 14 : 0);
            }),
        );
        return Math.max(Math.ceil(tallest) + 12, 34);
    };
    const grid = layoutChartGrid({
        ...metrics,
        itemCounts: state.tiers.map((tier) => tier.items.length),
        columns: state.chartColumns,
        tilesAcross,
        cellGap: Math.max(theme.gap, 6),
        margin: 6,
        bandHeightFor,
    });
    const rows = state.tiers.map((tier, i): ExportRow => {
        const cell = grid.cells[i]!;
        return {
            tier,
            ...cell,
            label: { x: cell.x, y: cell.y, width: cell.width, height: grid.bandHeight },
            itemsX: cell.x + padding,
            itemsY: cell.y + grid.bandHeight + padding,
            columns: tilesAcross,
        };
    });
    return { chart: true, rows, width: grid.width, height: grid.height };
}

/** Notes listed under the tiers (in tier order, then the unranked items'), wrapped to the export's width. */
function noteLines(
    groups: { label: string; items: ItemId[] }[],
    width: number,
): { lines: { text: string; first: boolean }[]; height: number } {
    if (!state.exportOptions.includeNotes) return { lines: [], height: 0 };
    const lines: { text: string; first: boolean }[] = [];
    for (const { label, items } of groups)
        for (const id of items) {
            const note = state.notes[id];
            if (note)
                wrapText(`${entryById.get(id)!.name} (${label}): ${note}`, width - 28, uiFont(11)).forEach((text, i) => {
                    lines.push({ text, first: i === 0 });
                });
        }
    return { lines, height: lines.length ? 30 + lines.length * 15 : 0 };
}

/** Top-left corner of the index-th picture in a row. */
export function itemPosition(layout: ExportLayout, row: ExportRow, index: number): { x: number; y: number } {
    const column = index % row.columns;
    const line = Math.floor(index / row.columns);
    return {
        x: row.itemsX + column * (layout.tileWidth + layout.gap),
        y: row.itemsY + line * (layout.tileHeight + layout.captionHeight + layout.gap),
    };
}

/** Where the unranked section's heading goes: quiet, at the left of its band. */
export function unrankedHeadingText(row: ExportRow, layout: ExportLayout): ExportText {
    const size = 13;
    return {
        lines: [row.tier.label],
        font: titleFont(size),
        fontSize: size,
        lineHeight: size,
        top: row.label.y + row.label.height / 2 + 3,
        x: row.label.x + layout.padding + 2,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICTURES
// ═════════════════════════════════════════════════════════════════════════════

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        if (/^https?:/.test(url)) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

const pictureCanvas = document.createElement('canvas');

/** A picture's pixel size at the chosen detail: `detail` pixels along the tile's longer side. */
export function detailedSize(layout: ExportLayout, detail: number): { width: number; height: number } {
    const scale = detail / Math.max(layout.tileWidth, layout.tileHeight);
    return { width: Math.max(1, Math.round(layout.tileWidth * scale)), height: Math.max(1, Math.round(layout.tileHeight * scale)) };
}

/**
 * An item's picture drawn on a `width` × `height` canvas (the tile's shape), whole or filling it,
 * cropped like on screen. Small pixel art is scaled without smoothing, so it stays crisp. (The
 * canvas is reused: draw it somewhere before the next call.)
 */
export async function drawPicture(id: ItemId, { width, height }: { width: number; height: number }): Promise<HTMLCanvasElement> {
    const img = await loadImage(spriteSrc(id));
    const fit = pictureFit(id);
    const crop = spriteCrop(id);
    const source = crop
        ? cropView(crop, width / height, fit)
        : { x: 0, y: 0, width: img.naturalWidth || width, height: img.naturalHeight || height };
    pictureCanvas.width = width;
    pictureCanvas.height = height;
    const g = pictureCanvas.getContext('2d')!;
    g.clearRect(0, 0, width, height);
    const placed = fitPicture(source, { width, height }, fit);
    g.imageSmoothingEnabled = !placed.crisp;
    if (!placed.crisp) g.imageSmoothingQuality = 'high';
    g.drawImage(img, source.x, source.y, source.width, source.height, placed.x, placed.y, placed.width, placed.height);
    return pictureCanvas;
}
