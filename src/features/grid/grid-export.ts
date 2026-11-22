// src/features/grid/grid-export.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The grid as a PNG to share: the list's name and the grid's, the headings,
//  each cell's pick with its name, and the "Made with" line when exports carry
//  it. Pictures are drawn as the tier list's exports draw them (export/layout.ts),
//  so crops and pixel art match.
// ─────────────────────────────────────────────────────────────────────────────

import { clearestTextOn } from 'tier-engine/core';
import { ellipsize } from 'tier-engine/export';
import { entryById } from '../../core/items';
import { currentListMeta, state } from '../../core/state';
import type { SavedGrid } from '../../core/types';
import { downloadBlob, todayIso } from '../../lib/dom';
import { hideProgress, showProgress, toast, updateProgress } from '../../lib/ui';
import { TYPE_COLORS } from '../../pokemon/data';
import { focusSummary, isFocusEmpty, valueLabel } from '../../pokemon/facets';
import { fontStack } from '../appearance/theme';
import { creditLine, drawPicture, fileStem, fontsReady, titleFont, uiFont } from '../export/layout';
import { cellKey, type GridModel } from './cells';

const PICTURE = 88;
const NAME_HEIGHT = 18;
const CELL_PAD = 6;
const GAP = 4;
const MARGIN = 24;

async function buildGridPng(grid: SavedGrid, model: GridModel): Promise<Blob | null> {
    await fontsReady();
    const theme = state.theme;
    const cols = model.cols ?? [null];
    const cellWidth = PICTURE + CELL_PAD * 2;
    const cellHeight = PICTURE + NAME_HEIGHT + CELL_PAD * 2;
    const g = document.createElement('canvas').getContext('2d')!;
    g.font = uiFont(13);
    const rowLabelWidth = Math.ceil(Math.max(...model.rows.map((row) => g.measureText(valueLabel(grid.rows, row.value)).width))) + 24;
    const headHeight = model.cols ? 30 : 0;
    const title = [
        currentListMeta()?.name || 'Tier list',
        grid.name,
        grid.layer && grid.layerValue ? valueLabel(grid.layer, grid.layerValue) : '',
    ]
        .filter(Boolean)
        .join(' · ');
    const subtitle = isFocusEmpty(grid.focus) ? '' : `Only ${focusSummary(grid.focus)}`;
    const titleHeight = 40 + (subtitle ? 20 : 0);
    const creditHeight = state.exportOptions.includeCredit ? 26 : 0;
    const width = MARGIN * 2 + rowLabelWidth + cols.length * (cellWidth + GAP);
    const height = MARGIN * 2 + titleHeight + headHeight + model.rows.length * (cellHeight + GAP) + creditHeight;
    const scale = Math.max(1, Math.min(2, Math.sqrt(4e7 / (width * height))));
    const canvas = g.canvas;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    g.scale(scale, scale);
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, width, height);
    g.textBaseline = 'middle';
    g.fillStyle = theme.text;
    g.font = titleFont(22);
    g.textAlign = 'left';
    g.fillText(ellipsize(title, width - MARGIN * 2, titleFont(22)), MARGIN, MARGIN + 14);
    if (subtitle) {
        g.font = uiFont(12);
        g.fillStyle = theme.muted;
        g.fillText(ellipsize(subtitle, width - MARGIN * 2, uiFont(12)), MARGIN, MARGIN + 40);
    }
    const top = MARGIN + titleHeight;
    const left = MARGIN + rowLabelWidth;
    const heading = (facet: SavedGrid['rows'], value: string, x: number, y: number, w: number, h: number, align: 'left' | 'center') => {
        const label = valueLabel(facet, value);
        const font = uiFont(12);
        if (facet === 'type') {
            const color = TYPE_COLORS[value] ?? '#8b93a7';
            g.fillStyle = color;
            g.beginPath();
            g.roundRect(x + 2, y + (h - 20) / 2, w - 4, 20, 10);
            g.fill();
            g.fillStyle = clearestTextOn(color);
            g.font = `700 11px ${fontStack(theme.fUi)}`;
            g.textAlign = 'center';
            g.fillText(ellipsize(label, w - 10, g.font), x + w / 2, y + h / 2);
            return;
        }
        g.fillStyle = theme.muted;
        g.font = font;
        g.textAlign = align;
        g.fillText(ellipsize(label, w - 8, font), align === 'center' ? x + w / 2 : x, y + h / 2);
    };
    if (model.cols)
        for (const [i, col] of cols.entries())
            heading(grid.cols!, col!.value, left + i * (cellWidth + GAP), top, cellWidth, headHeight, 'center');
    const total = model.rows.length * cols.length;
    let done = 0;
    showProgress('Building picture…', false);
    for (const [r, row] of model.rows.entries()) {
        const y = top + headHeight + r * (cellHeight + GAP);
        heading(grid.rows, row.value, MARGIN, y, rowLabelWidth - 12, cellHeight, 'left');
        for (const [c, col] of cols.entries()) {
            const x = left + c * (cellWidth + GAP);
            const cell = model.cells.get(cellKey(grid.layerValue, row.value, col?.value ?? null));
            const id = cell ? (cell.pin ?? cell.top) : null;
            g.fillStyle = theme.panel;
            g.beginPath();
            g.roundRect(x, y, cellWidth, cellHeight, Math.min(8, theme.radius));
            g.fill();
            g.textAlign = 'center';
            if (id == null) {
                g.fillStyle = theme.muted;
                g.font = uiFont(14);
                g.fillText('—', x + cellWidth / 2, y + cellHeight / 2);
            } else {
                try {
                    g.drawImage(
                        await drawPicture(id, { width: PICTURE * 2, height: PICTURE * 2 }),
                        x + CELL_PAD,
                        y + CELL_PAD,
                        PICTURE,
                        PICTURE,
                    );
                } catch {}
                const font = uiFont(11);
                g.font = font;
                g.fillStyle = theme.text;
                g.fillText(
                    ellipsize(entryById.get(id)?.name ?? '', cellWidth - 6, font),
                    x + cellWidth / 2,
                    y + CELL_PAD + PICTURE + NAME_HEIGHT / 2 + 1,
                );
            }
            if (++done % 12 === 0) updateProgress(`${done} / ${total}`, (done / total) * 95);
        }
    }
    if (creditHeight) {
        g.font = uiFont(10);
        g.fillStyle = theme.muted;
        g.textAlign = 'right';
        g.fillText(creditLine(), width - MARGIN, height - MARGIN / 2 - 6);
    }
    let png: Blob | null = null;
    try {
        png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch {}
    hideProgress();
    if (!png) toast('That picture is too big for this browser. Choose fewer rows or columns and try again');
    return png;
}

/** Downloads the grid as a PNG, or copies it to the clipboard. */
export async function exportGridPicture(grid: SavedGrid, model: GridModel, how: 'download' | 'copy'): Promise<void> {
    const name = `${fileStem()}_${
        grid.name
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase() || 'grid'
    }_${todayIso()}.png`;
    if (how === 'download') {
        const png = await buildGridPng(grid, model);
        if (!png) return;
        downloadBlob(png, name);
        toast('Grid exported');
        return;
    }
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return toast("This browser can't copy pictures. Use Download");
    try {
        // the clipboard is claimed straight away (Safari needs that); the picture follows
        const png = buildGridPng(grid, model).then((blob) => {
            if (!blob) throw new Error('no picture');
            return blob;
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        toast('Copied. Paste it into a chat');
    } catch {
        toast("Couldn't copy. Use Download instead");
    }
}
