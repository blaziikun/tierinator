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
import { hexToRgb } from 'tier-engine/core';
import {
    detailedSize,
    type ExportInput,
    type ExportLayout,
    type ExportRow,
    type ExportRun,
    type ExportText,
    ellipsize,
    exportFonts,
    type FittedLabel,
    layoutExport,
    measureContext,
    placeLabel,
    renderPng,
    renderSvg,
    unrankedHeadingText,
    walkLayout,
} from 'tier-engine/export';
import { listAsCsv } from '../../core/csv-format';
import { dexLabel, entryById } from '../../core/items';
import { autosave } from '../../core/persist';
import { currentListMeta, spriteBlobs, state } from '../../core/state';
import type { ItemId, LabelMode } from '../../core/types';
import { byId, downloadBlob, nextTick, todayIso } from '../../lib/dom';
import { blobToDataUrl } from '../../lib/images';
import { closePopovers, hideProgress, placePopover, popoverAnchor, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { googleFontUrl } from '../appearance/theme';
import { switchView } from '../layout/layout';
import { defaultSpriteUrl } from '../sprites/sprites';
import { creditLine, drawPicture, exportInput, exportLook, exportPicture, fileStem, fontsReady, itemLabel } from './layout';

/** Fonts loaded, layout made, progress shown; null (with a message) if there's nothing to export. */
async function startExport(title: string): Promise<{ layout: ExportLayout; input: ExportInput } | null> {
    closePopovers();
    await fontsReady();
    const input = exportInput();
    const layout = layoutExport(input);
    if (!layout.rows.some((row) => !row.unranked)) {
        toast('No tiers to export');
        return null;
    }
    showProgress(title, true);
    return { layout, input };
}

/** Pictures, progress and Cancel, as every export shares them. */
const exportRun = (): ExportRun => ({
    picture: exportPicture,
    detail: state.exportOptions.imageSize,
    progress: (done, total, percent) => updateProgress(`${done} / ${total}`, percent),
    cancelled: () => progress.cancelled,
});

function exportCancelled(): void {
    hideProgress();
    toast('Export cancelled');
}

// ═════════════════════════════════════════════════════════════════════════════
//  SVG
// ═════════════════════════════════════════════════════════════════════════════

async function exportSvg(): Promise<void> {
    const started = await startExport('Building SVG…');
    if (!started) return;
    const theme = state.theme;
    const svg = await renderSvg(started.layout, started.input, {
        ...exportRun(),
        // vector sprites stay vector
        vector: async (id) => {
            const blob = spriteBlobs.get(id);
            return blob?.type === 'image/svg+xml' ? blobToDataUrl(blob) : null;
        },
        fallback: defaultSpriteUrl,
        describe: (id) => `${dexLabel(id)} ${entryById.get(id)!.name}${state.notes[id] ? ': ' + state.notes[id] : ''}`,
        documentTitle: `${theme.name}, ${todayIso()}`,
        fontImports: [googleFontUrl(theme.fHead), googleFontUrl(theme.fUi)].filter((url): url is string => !!url),
    });
    if (!svg) return exportCancelled();
    updateProgress('Saving…', 100);
    downloadBlob(svg, `${fileStem()}_${todayIso()}.svg`);
    hideProgress();
    toast('SVG exported');
}

// ═════════════════════════════════════════════════════════════════════════════
//  PNG
// ═════════════════════════════════════════════════════════════════════════════

/** The tier list as a PNG, as detailed as the browser allows (phones have smaller canvas limits). */
async function buildPng(): Promise<Blob | null> {
    const started = await startExport('Building picture…');
    if (!started) return null;
    const result = await renderPng(started.layout, started.input, exportRun());
    if ('failed' in result && result.failed === 'cancelled') {
        exportCancelled();
        return null;
    }
    hideProgress();
    if ('png' in result) return result.png;
    toast('That picture is too big for this browser. Lower "Detail" and try again');
    return null;
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
    g.font = exportFonts(exportLook()).head(label.fontSize);
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
    const measure = measureContext();
    measure.font = placed.font;
    const width = Math.ceil(Math.max(...placed.lines.map((line) => measure.measureText(line).width))) + 4;
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
    const started = await startExport('Building PDF…');
    if (!started) return;
    const { layout, input } = started;
    const look = input.look;
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
            addTextPicture(doc, unrankedHeadingText(row, layout, look), theme.muted, k);
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
        doc.setFillColor(...hexToRgb(look.rowBackground(tier.color)));
        if (radius) doc.roundedRect(x, y, rowWidth, rowHeight, radius, radius, 'F');
        else doc.rect(x, y, rowWidth, rowHeight, 'F');
        doc.setFillColor(...hexToRgb(tier.color));
        if (radius) {
            doc.roundedRect(labelX, box.y * k, labelWidth, bandHeight, radius, radius, 'F');
            // square off the inner corners: the right ones of a row's label, the bottom ones of a cell's band
            if (layout.chart) doc.rect(labelX, (box.y + box.height) * k - radius, labelWidth, radius, 'F');
            else doc.rect(labelX + labelWidth - radius, y, radius, rowHeight, 'F');
        } else doc.rect(labelX, box.y * k, labelWidth, bandHeight, 'F');
        const label = placeLabel(row, look);
        const labelHeight = label.lines.length * label.lineHeight + 4;
        const labelTop = box.y + box.height / 2 - (label.lines.length * label.lineHeight + label.subtitleHeight) / 2 - 2;
        doc.addImage(
            labelPicture(label, box.width, labelHeight, look.labelTextColor(tier), 8),
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
            doc.setTextColor(...hexToRgb(look.labelTextColor(tier)));
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
            const caption = ellipsize(
                itemLabel(id, state.exportOptions.labelMode),
                tileWidth + 2,
                `${layout.captionSize}px Helvetica, Arial, sans-serif`,
            );
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

    if (!(await walkLayout(layout, exportRun(), drawRow, drawItem, 95))) return exportCancelled();
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

// ── wiring (runs once at start-up, from start.ts) ──
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
    byId('expcreditline').textContent = creditLine();

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
