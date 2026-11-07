// src/features/export/export.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Export ▾: the tier list as a picture to share, or as a spreadsheet.
//
//    SVG    sharp at any size; tier labels in your fonts (loaded from Google Fonts)
//    PNG    download, copy to the clipboard, or share (phones)
//    PDF    fonts can't be embedded, so labels are drawn as pictures (with hidden,
//           searchable text underneath)
//    CSV    the items and their tiers (core/csv-format.ts)
//
//  The three pictures share one layout (layout.ts), so they look the same: the title,
//  the tiers (a chart's cells drawn like rows, labels in a band across the top), the
//  unranked items, notes and the "Made with …" line.
// ─────────────────────────────────────────────────────────────────────────────
import type { jsPDF } from 'jspdf';
import { listAsCsv } from '../../core/csv-format';
import { dexLabel, entryById } from '../../core/items';
import { autosave } from '../../core/persist';
import { currentListMeta, spriteBlobs, state } from '../../core/state';
import type { ItemId, LabelMode } from '../../core/types';
import { hexToRgb } from '../../lib/color';
import { byId, downloadBlob, escapeHtml, nextTick, todayIso } from '../../lib/dom';
import { blobToDataUrl } from '../../lib/images';
import { closePopovers, hideProgress, placePopover, popoverAnchor, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { applyLabelCase, fontStack, googleFontUrl, labelTextColor, rowBackground } from '../appearance/theme';
import { switchView } from '../layout/layout';
import { defaultSpriteUrl } from '../sprites/sprites';
import { pictureFit } from '../tier-board/tile-shape';
import {
    CREDIT_LINE,
    detailedSize,
    drawPicture,
    type ExportLayout,
    type ExportRow,
    type ExportText,
    ellipsize,
    type FittedLabel,
    fileStem,
    fitLabel,
    fontsReady,
    headFont,
    itemLabel,
    itemPosition,
    layoutExport,
    measureCanvas,
    uiFont,
    unrankedHeadingText,
} from './layout';

/** Where a tier's label goes: fitted to its box, centred with the subtitle under it. */
function placeLabel(row: ExportRow): FittedLabel & { top: number; subtitleHeight: number } {
    const box = row.label;
    const subtitleHeight = row.tier.subtitle ? 14 : 0;
    const fitted = fitLabel(applyLabelCase(row.tier.label), box.width - 16, box.height - 10 - subtitleHeight);
    const top = box.y + box.height / 2 - (fitted.lines.length * fitted.lineHeight + subtitleHeight) / 2 + fitted.lineHeight / 2;
    return { ...fitted, top, subtitleHeight };
}

/**
 * Goes through the layout, row by row and picture by picture, with progress and Cancel.
 * False if cancelled.
 */
async function walkLayout(
    layout: ExportLayout,
    drawRow: (row: ExportRow) => void,
    drawItem: (id: ItemId, position: { x: number; y: number }) => Promise<void>,
    progressShare = 100,
): Promise<boolean> {
    const total = layout.rows.reduce((count, row) => count + row.tier.items.length, 0);
    let done = 0;
    for (const row of layout.rows) {
        drawRow(row);
        for (const [index, id] of row.tier.items.entries()) {
            if (progress.cancelled) {
                hideProgress();
                toast('Export cancelled');
                return false;
            }
            await drawItem(id, itemPosition(layout, row, index));
            if (++done % 10 === 0) {
                updateProgress(`${done} / ${total}`, (done / total) * progressShare);
                await nextTick();
            }
        }
    }
    return true;
}

/** Fonts loaded, layout made, progress shown; null (with a message) if there's nothing to export. */
async function startExport(title: string): Promise<ExportLayout | null> {
    closePopovers();
    await fontsReady();
    const layout = layoutExport();
    if (!layout.rows.some((row) => !row.unranked)) {
        toast('No tiers to export');
        return null;
    }
    showProgress(title, true);
    return layout;
}

const captionMode = (): LabelMode => state.exportOptions.labelMode;

// ═════════════════════════════════════════════════════════════════════════════
//  SVG
// ═════════════════════════════════════════════════════════════════════════════

async function exportSvg(): Promise<void> {
    const layout = await startExport('Building SVG…');
    if (!layout) return;
    const theme = state.theme;
    const { width, tileWidth, tileHeight } = layout;
    const fullHeight = layout.height;
    const headFamily = escapeHtml(fontStack(theme.fHead)).replace(/'/g, '');
    const uiFamily = escapeHtml(fontStack(theme.fUi)).replace(/'/g, '');
    const fontImports = [googleFontUrl(theme.fHead), googleFontUrl(theme.fUi)]
        .filter((url): url is string => !!url)
        .map((url) => `@import url('${url.replace(/&/g, '&amp;')}');`)
        .join('');
    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}">`,
        `<title>${escapeHtml(theme.name)}, ${todayIso()}</title><defs><style>${fontImports}</style></defs><rect width="${width}" height="${fullHeight}" fill="${theme.bg}"/>`,
    ];
    const captionFont = uiFont(layout.captionSize);
    let rowNumber = 0;
    const text = (placed: ExportText, family: string, weight: number, color: string) =>
        placed.lines
            .map(
                (line, i) =>
                    `<text x="${placed.x}" y="${(placed.top + i * placed.lineHeight).toFixed(1)}"${placed.alignRight ? ' text-anchor="end"' : ''} dominant-baseline="central" font-family="${family}" font-weight="${weight}" font-size="${placed.fontSize}" fill="${color}">${escapeHtml(line)}</text>`,
            )
            .join('');
    if (layout.title) parts.push(text(layout.title, headFamily, theme.wHead, theme.text));

    const drawRow = (row: ExportRow) => {
        const box = `x="${row.x}" y="${row.y}" width="${row.width}" height="${row.height}"`;
        if (row.unranked) {
            parts.push(`<rect ${box} rx="${layout.radius}" fill="${theme.panel}"/>`);
            parts.push(text(unrankedHeadingText(row, layout), headFamily, theme.wHead, theme.muted));
            return;
        }
        const tier = row.tier;
        const textColor = labelTextColor(tier);
        rowNumber++;
        const labelBox = `x="${row.label.x}" y="${row.label.y}" width="${row.label.width}" height="${row.label.height}"`;
        parts.push(
            `<clipPath id="r${rowNumber}"><rect ${box} rx="${layout.radius}"/></clipPath>` +
                `<g clip-path="url(#r${rowNumber})"><rect ${box} fill="${rowBackground(tier.color)}"/><rect ${labelBox} fill="${tier.color}"/></g>`,
        );
        const label = placeLabel(row);
        const centreX = row.label.x + row.label.width / 2;
        const lines = label.lines
            .map((line, i) => `<tspan x="${centreX}" y="${(label.top + i * label.lineHeight).toFixed(1)}">${escapeHtml(line)}</tspan>`)
            .join('');
        parts.push(
            `<text text-anchor="middle" dominant-baseline="central" font-family="${headFamily}" font-weight="${theme.wLabel}" letter-spacing="${theme.ls}em" font-size="${label.fontSize}" fill="${textColor}">${lines}</text>`,
        );
        if (tier.subtitle) {
            const subtitleY = (label.top + label.lines.length * label.lineHeight - label.lineHeight / 2 + 9).toFixed(1);
            parts.push(
                `<text x="${centreX}" y="${subtitleY}" text-anchor="middle" dominant-baseline="central" font-family="${uiFamily}" font-weight="${theme.wUi}" font-size="9" fill="${textColor}" opacity=".8">${escapeHtml(tier.subtitle)}</text>`,
            );
        }
    };

    const drawItem = async (id: ItemId, { x, y }: { x: number; y: number }) => {
        let picture: string;
        const blob = spriteBlobs.get(id);
        try {
            // vector sprites stay vector; everything else is drawn at the chosen detail
            picture =
                blob?.type === 'image/svg+xml'
                    ? await blobToDataUrl(blob)
                    : (await drawPicture(id, detailedSize(layout, state.exportOptions.imageSize))).toDataURL('image/png');
        } catch {
            picture = defaultSpriteUrl(id);
        }
        const caption = layout.captionHeight
            ? `<text x="${x + tileWidth / 2}" y="${(y + tileHeight + layout.captionGap + layout.captionSize * 0.9).toFixed(1)}" text-anchor="middle" font-family="${uiFamily}" font-weight="${theme.wUi}" font-size="${layout.captionSize}" fill="${theme.muted}">${escapeHtml(ellipsize(itemLabel(id, captionMode()), tileWidth + 2, captionFont))}</text>`
            : '';
        const note = state.notes[id] ? ': ' + escapeHtml(state.notes[id]) : '';
        // a drawn picture already has the tile's shape; a vector one is fitted (or filled, and cut off at the tile) here
        const aspect = pictureFit(id) === 'cover' ? 'slice' : 'meet';
        parts.push(
            `<g><title>${dexLabel(id)} ${escapeHtml(entryById.get(id)!.name)}${note}</title><image x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" preserveAspectRatio="xMidYMid ${aspect}" xlink:href="${escapeHtml(picture)}"/>${caption}</g>`,
        );
    };

    if (!(await walkLayout(layout, drawRow, drawItem))) return;
    if (layout.notes.height) {
        const top = layout.notes.top;
        parts.push(
            `<text x="14" y="${top + 20}" font-family="${uiFamily}" font-weight="700" font-size="12" fill="${theme.text}">Notes</text>`,
        );
        layout.notes.lines.forEach((line, i) => {
            parts.push(
                `<text x="${line.first ? 14 : 24}" y="${top + 38 + i * 15}" font-family="${uiFamily}" font-weight="${theme.wUi}" font-size="11" fill="${theme.muted}">${escapeHtml(line.text)}</text>`,
            );
        });
    }
    if (layout.credit) parts.push(text(layout.credit, uiFamily, theme.wUi, theme.muted));
    parts.push('</svg>');
    updateProgress('Saving…', 100);
    downloadBlob(new Blob(parts, { type: 'image/svg+xml' }), `${fileStem()}_${todayIso()}.svg`);
    hideProgress();
    toast('SVG exported');
}

// ═════════════════════════════════════════════════════════════════════════════
//  PNG
// ═════════════════════════════════════════════════════════════════════════════

/** The tier list as a PNG, as detailed as the browser allows (phones have smaller canvas limits). */
async function buildPng(): Promise<Blob | null> {
    const layout = await startExport('Building picture…');
    if (!layout) return null;
    const theme = state.theme;
    const { tileWidth, tileHeight } = layout;
    const fullHeight = layout.height;
    const isIos = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const maxPixels = isIos ? 1.6e7 : 6e7;
    const scale = Math.max(
        1,
        Math.min(
            state.exportOptions.imageSize / Math.max(tileWidth, tileHeight),
            12000 / Math.max(layout.width, fullHeight),
            Math.sqrt(maxPixels / (layout.width * fullHeight)),
        ),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(layout.width * scale);
    canvas.height = Math.round(fullHeight * scale);
    const g = canvas.getContext('2d')!;
    g.scale(scale, scale);
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, layout.width, fullHeight);
    const write = (placed: ExportText, color: string) => {
        g.font = placed.font;
        g.fillStyle = color;
        g.textAlign = placed.alignRight ? 'right' : 'left';
        g.textBaseline = 'middle';
        placed.lines.forEach((line, i) => {
            g.fillText(line, placed.x, placed.top + i * placed.lineHeight);
        });
    };
    if (layout.title) write(layout.title, theme.text);

    const drawRow = (row: ExportRow) => {
        const tier = row.tier;
        if (row.unranked) {
            g.fillStyle = theme.panel;
            g.beginPath();
            g.roundRect(row.x, row.y, row.width, row.height, layout.radius);
            g.fill();
            write(unrankedHeadingText(row, layout), theme.muted);
            return;
        }
        g.save();
        g.beginPath();
        g.roundRect(row.x, row.y, row.width, row.height, layout.radius);
        g.clip();
        g.fillStyle = rowBackground(tier.color);
        g.fillRect(row.x, row.y, row.width, row.height);
        g.fillStyle = tier.color;
        g.fillRect(row.label.x, row.label.y, row.label.width, row.label.height);
        g.restore();
        const label = placeLabel(row);
        const centreX = row.label.x + row.label.width / 2;
        g.font = headFont(label.fontSize);
        g.letterSpacing = theme.ls * label.fontSize + 'px';
        g.fillStyle = labelTextColor(tier);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        label.lines.forEach((line, i) => {
            g.fillText(line, centreX, label.top + i * label.lineHeight);
        });
        g.letterSpacing = '0px';
        if (tier.subtitle) {
            g.font = uiFont(9);
            g.globalAlpha = 0.8;
            g.fillText(tier.subtitle, centreX, label.top + label.lines.length * label.lineHeight - label.lineHeight / 2 + 9);
            g.globalAlpha = 1;
        }
    };

    const pictureSize = detailedSize(layout, Math.min(1024, Math.round(Math.max(tileWidth, tileHeight) * scale)));
    const drawItem = async (id: ItemId, { x, y }: { x: number; y: number }) => {
        try {
            g.drawImage(await drawPicture(id, pictureSize), x, y, tileWidth, tileHeight);
        } catch {
            // no picture: its name instead
            const font = uiFont(Math.max(7, Math.round(Math.min(tileWidth, tileHeight) / 7)));
            g.font = font;
            g.fillStyle = theme.muted;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(ellipsize(entryById.get(id)!.name, tileWidth - 4, font), x + tileWidth / 2, y + tileHeight / 2);
        }
        if (layout.captionHeight) {
            const font = uiFont(layout.captionSize);
            g.font = font;
            g.fillStyle = theme.muted;
            g.textAlign = 'center';
            g.textBaseline = 'alphabetic';
            g.fillText(
                ellipsize(itemLabel(id, captionMode()), tileWidth + 2, font),
                x + tileWidth / 2,
                y + tileHeight + layout.captionGap + layout.captionSize * 0.9,
            );
        }
    };

    if (!(await walkLayout(layout, drawRow, drawItem, 95))) return null;
    if (layout.notes.height) {
        const top = layout.notes.top;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.fillStyle = theme.text;
        g.font = `700 12px ${fontStack(theme.fUi)}`;
        g.fillText('Notes', 14, top + 20);
        g.fillStyle = theme.muted;
        g.font = uiFont(11);
        layout.notes.lines.forEach((line, i) => {
            g.fillText(line.text, line.first ? 14 : 24, top + 38 + i * 15);
        });
    }
    if (layout.credit) write(layout.credit, theme.muted);
    updateProgress('Saving…', 99);
    let png: Blob | null = null;
    try {
        png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch {}
    hideProgress();
    if (!png) toast('That picture is too big for this browser. Lower "Detail" and try again');
    return png;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PDF
// ═════════════════════════════════════════════════════════════════════════════

/** PDF's built-in fonts only know Latin-1: other characters are swapped or dropped. */
const pdfSafe = (text: string): string =>
    String(text)
        .replace(/♀/g, ' F')
        .replace(/♂/g, ' M')
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

/** A tier label drawn in your font at high resolution (PDFs can't embed web fonts). */
function labelPicture(label: FittedLabel, width: number, height: number, color: string, resolution: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * resolution);
    canvas.height = Math.ceil(height * resolution);
    const g = canvas.getContext('2d')!;
    g.scale(resolution, resolution);
    g.font = headFont(label.fontSize);
    g.letterSpacing = state.theme.ls * label.fontSize + 'px';
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const top = height / 2 - ((label.lines.length - 1) * label.lineHeight) / 2;
    label.lines.forEach((line, i) => {
        g.fillText(line, width / 2, top + i * label.lineHeight);
    });
    return canvas;
}

/**
 * Text in a web font (the title, the unranked heading) as a picture where the layout puts it, with
 * hidden, searchable text over it, as tier labels are done.
 */
function addTextPicture(doc: jsPDF, placed: ExportText, color: string, k: number): void {
    measureCanvas.font = placed.font;
    const width = Math.ceil(Math.max(...placed.lines.map((line) => measureCanvas.measureText(line).width))) + 4;
    const height = placed.lines.length * placed.lineHeight + 6;
    const resolution = 6;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * resolution);
    canvas.height = Math.ceil(height * resolution);
    const g = canvas.getContext('2d')!;
    g.scale(resolution, resolution);
    g.font = placed.font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    placed.lines.forEach((line, i) => {
        g.fillText(line, 2, 3 + placed.lineHeight / 2 + i * placed.lineHeight);
    });
    const left = placed.alignRight ? placed.x - width : placed.x - 2;
    const top = placed.top - placed.lineHeight / 2 - 3;
    doc.addImage(canvas, 'PNG', left * k, top * k, width * k, height * k, `text${left}-${top}`, 'FAST');
    doc.setFontSize(Math.max(2, placed.fontSize * 0.6) * k);
    doc.text(pdfSafe(placed.lines.join(' ')), (left + 2) * k, placed.top * k, { baseline: 'middle', renderingMode: 'invisible' });
}

async function exportPdf(): Promise<void> {
    const layout = await startExport('Building PDF…');
    if (!layout) return;
    const theme = state.theme;
    const { tileWidth, tileHeight } = layout;
    const fullHeight = layout.height;
    const k = Math.min(1, 14000 / Math.max(layout.width, fullHeight)); // PDF pages max out at 14 400 pt
    const { jsPDF } = await import('jspdf'); // loaded only when someone exports a PDF
    const doc = new jsPDF({
        unit: 'pt',
        format: [layout.width * k, fullHeight * k],
        orientation: layout.width > fullHeight ? 'landscape' : 'portrait',
        compress: true,
    });
    doc.setProperties({ title: `${pdfSafe(theme.name)} ${todayIso()}`, creator: pdfSafe(theme.name) });
    doc.setFillColor(...hexToRgb(theme.bg));
    doc.rect(0, 0, layout.width * k, fullHeight * k, 'F');
    const radius = layout.radius * k;
    if (layout.title) addTextPicture(doc, layout.title, theme.text, k);

    const drawRow = (row: ExportRow) => {
        if (row.unranked) {
            doc.setFillColor(...hexToRgb(theme.panel));
            if (radius) doc.roundedRect(row.x * k, row.y * k, row.width * k, row.height * k, radius, radius, 'F');
            else doc.rect(row.x * k, row.y * k, row.width * k, row.height * k, 'F');
            addTextPicture(doc, unrankedHeadingText(row, layout), theme.muted, k);
            return;
        }
        const tier = row.tier;
        const box = row.label;
        const x = row.x * k;
        const y = row.y * k;
        const rowWidth = row.width * k;
        const rowHeight = row.height * k;
        const labelX = box.x * k;
        const labelWidth = box.width * k;
        const bandHeight = box.height * k;
        doc.setFillColor(...hexToRgb(rowBackground(tier.color)));
        if (radius) doc.roundedRect(x, y, rowWidth, rowHeight, radius, radius, 'F');
        else doc.rect(x, y, rowWidth, rowHeight, 'F');
        doc.setFillColor(...hexToRgb(tier.color));
        if (radius) {
            doc.roundedRect(labelX, box.y * k, labelWidth, bandHeight, radius, radius, 'F');
            // square off the inner corners: the right ones of a row's label, the bottom ones of a cell's band
            if (layout.chart) doc.rect(labelX, (box.y + box.height) * k - radius, labelWidth, radius, 'F');
            else doc.rect(labelX + labelWidth - radius, y, radius, rowHeight, 'F');
        } else doc.rect(labelX, box.y * k, labelWidth, bandHeight, 'F');
        const label = placeLabel(row);
        const labelHeight = label.lines.length * label.lineHeight + 4;
        const labelTop = box.y + box.height / 2 - (label.lines.length * label.lineHeight + label.subtitleHeight) / 2 - 2;
        doc.addImage(
            labelPicture(label, box.width, labelHeight, labelTextColor(tier), 8),
            'PNG',
            labelX,
            labelTop * k,
            labelWidth,
            labelHeight * k,
            // cells side by side share a y, so a chart's labels are told apart by x too
            layout.chart ? `label${row.x}-${row.y}` : 'label' + row.y,
            'FAST',
        );
        doc.setFontSize(Math.max(2, label.fontSize * 0.6) * k);
        doc.text(pdfSafe(tier.label), labelX + labelWidth / 2, (box.y + box.height / 2) * k, {
            align: 'center',
            baseline: 'middle',
            renderingMode: 'invisible',
        });
        if (tier.subtitle) {
            doc.setTextColor(...hexToRgb(labelTextColor(tier)));
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9 * k);
            doc.text(pdfSafe(tier.subtitle), labelX + labelWidth / 2, (labelTop + labelHeight + 7) * k, {
                align: 'center',
                baseline: 'middle',
            });
        }
    };

    const pictureSize = detailedSize(layout, state.exportOptions.imageSize);
    const drawItem = async (id: ItemId, { x, y }: { x: number; y: number }) => {
        try {
            doc.addImage(await drawPicture(id, pictureSize), 'PNG', x * k, y * k, tileWidth * k, tileHeight * k, 'sprite' + id, 'FAST');
        } catch {}
        doc.setFont('helvetica', 'normal');
        if (layout.captionHeight) {
            doc.setFontSize(layout.captionSize * k);
            doc.setTextColor(...hexToRgb(theme.muted));
            const caption = ellipsize(itemLabel(id, captionMode()), tileWidth + 2, `${layout.captionSize}px Helvetica, Arial, sans-serif`);
            doc.text(pdfSafe(caption), (x + tileWidth / 2) * k, (y + tileHeight + layout.captionGap + layout.captionSize * 0.6) * k, {
                align: 'center',
                baseline: 'middle',
            });
        } else {
            // hidden text, so the PDF can still be searched for names
            doc.setFontSize(Math.max(2, Math.min(tileWidth, tileHeight) * 0.12) * k);
            doc.text(pdfSafe(`${dexLabel(id)} ${entryById.get(id)!.name}`), (x + 2) * k, (y + tileHeight / 2) * k, {
                renderingMode: 'invisible',
            });
        }
    };

    if (!(await walkLayout(layout, drawRow, drawItem, 95))) return;
    if (layout.notes.height) {
        const top = layout.notes.top;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12 * k);
        doc.setTextColor(...hexToRgb(theme.text));
        doc.text('Notes', 14 * k, (top + 20) * k);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11 * k);
        doc.setTextColor(...hexToRgb(theme.muted));
        layout.notes.lines.forEach((line, i) => {
            doc.text(pdfSafe(line.text), (line.first ? 14 : 24) * k, (top + 38 + i * 15) * k);
        });
    }
    if (layout.credit) {
        // the interface font can't be embedded either: Helvetica, as for the notes
        const credit = layout.credit;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(credit.fontSize * k);
        doc.setTextColor(...hexToRgb(theme.muted));
        doc.text(pdfSafe(credit.lines[0]!), credit.x * k, credit.top * k, { align: 'right', baseline: 'middle' });
    }
    updateProgress('Saving…', 98);
    await nextTick();
    doc.save(`${fileStem()}_${todayIso()}.pdf`);
    hideProgress();
    toast('PDF exported');
}

// ═════════════════════════════════════════════════════════════════════════════
//  PNG: COPY AND SHARE
// ═════════════════════════════════════════════════════════════════════════════

async function copyPng(): Promise<void> {
    closePopovers();
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return toast("This browser can't copy pictures. Use PNG");
    try {
        // the clipboard is claimed straight away (Safari needs that); the picture follows
        const png = buildPng().then((blob) => {
            if (!blob) throw new Error('no picture');
            return blob;
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        toast('Copied. Paste it into a chat');
    } catch {
        toast("Couldn't copy. Use PNG instead");
    }
}

async function sharePng(): Promise<void> {
    closePopovers();
    const png = await buildPng();
    if (!png) return;
    const file = new File([png], `${fileStem()}.png`, { type: 'image/png' });
    try {
        await navigator.share({ files: [file], title: currentListMeta()?.name || 'Tier list' });
    } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) downloadBlob(png, file.name);
    }
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupExport(): void {
    byId('expbtn').onclick = () => {
        closePopovers();
        if (state.view !== 'tier') switchView('tier');
        placePopover(byId('exppanel'), popoverAnchor('filebtn', 'listbtn'));
    };
    const option = <K extends keyof typeof state.exportOptions>(
        id: string,
        key: K,
        read: (input: HTMLInputElement) => (typeof state.exportOptions)[K],
    ) => {
        byId<HTMLInputElement>(id).onchange = (e) => {
            state.exportOptions[key] = read(e.target as HTMLInputElement);
            autosave();
        };
    };
    option('explbl', 'labelMode', (input) => input.value as LabelMode);
    option('exppx', 'imageSize', (input) => Number(input.value));
    option('expempty', 'includeEmptyTiers', (input) => input.checked);
    option('expnotes', 'includeNotes', (input) => input.checked);
    option('exptitle', 'includeTitle', (input) => input.checked);
    option('exppool', 'includeUnranked', (input) => input.checked);
    option('expcredit', 'includeCredit', (input) => input.checked);
    byId('expcreditline').textContent = CREDIT_LINE;

    byId('svgbtn').onclick = () => void exportSvg();
    byId('pdfbtn').onclick = () => void exportPdf();
    byId('pngbtn').onclick = async () => {
        closePopovers();
        const png = await buildPng();
        if (!png) return;
        downloadBlob(png, `${fileStem()}_${todayIso()}.png`);
        toast('PNG exported');
    };
    byId('pngcopy').onclick = () => void copyPng();
    byId('csvbtn').onclick = () => {
        closePopovers();
        downloadBlob(new Blob([listAsCsv()], { type: 'text/csv;charset=utf-8' }), `${fileStem()}_${todayIso()}.csv`);
        toast('CSV exported');
    };
    const canShareFiles = !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] });
    byId('pngshare').classList.toggle('hid', !canShareFiles);
    byId('pngshare').onclick = () => void sharePng();
}
