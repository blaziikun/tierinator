// src/features/export/chart-grid.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Where a chart's cells go in an export: a grid so many cells across, every cell
//  the same width, each grid row as tall as its fullest cell (like the board's CSS
//  grid). Plain arithmetic with no page involved, so the unit tests can check it.
// ─────────────────────────────────────────────────────────────────────────────

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ChartGridInput {
    /** How many pictures each cell holds, in cell order. */
    itemCounts: number[];
    /** Cells across. */
    columns: number;
    /** Pictures across one cell. */
    tilesAcross: number;
    /** A picture's size: square tiles have both the same. */
    tileWidth: number;
    tileHeight: number;
    /** Between pictures. */
    gap: number;
    /** Around the pictures inside a cell. */
    padding: number;
    /** Space under each picture for its caption. */
    captionHeight: number;
    /** Between cells. */
    cellGap: number;
    /** Left and right of the whole grid. */
    margin: number;
    /** The label band's height for a cell this wide (the same for every cell, so the bands line up). */
    bandHeightFor: (cellWidth: number) => number;
}

export interface ChartGrid {
    cells: Box[];
    bandHeight: number;
    width: number;
    height: number;
}

/** How many pictures fit across a cell whose picture area is `width` wide: at least 2, so a cell never shrinks to a single file. */
export const tilesAcrossCell = (width: number, tileWidth: number, gap: number): number =>
    Math.max(2, Math.floor((width + gap) / (tileWidth + gap)));

export function layoutChartGrid(input: ChartGridInput): ChartGrid {
    const { itemCounts, columns, tilesAcross, tileWidth, tileHeight, gap, padding, captionHeight, cellGap, margin } = input;
    const cellWidth = tilesAcross * (tileWidth + gap) - gap + padding * 2;
    const bandHeight = input.bandHeightFor(cellWidth);
    const picturesHeight = (count: number) => {
        const lines = Math.max(1, Math.ceil(count / tilesAcross));
        return Math.max(lines * (tileHeight + captionHeight) + (lines - 1) * gap + padding * 2, tileHeight + padding * 2);
    };
    const cells: Box[] = [];
    let y = 0;
    for (let first = 0; first < itemCounts.length; first += columns) {
        const gridRow = itemCounts.slice(first, first + columns);
        const height = bandHeight + Math.max(...gridRow.map(picturesHeight));
        gridRow.forEach((_count, column) => {
            cells.push({ x: margin + column * (cellWidth + cellGap), y, width: cellWidth, height });
        });
        y += height + cellGap;
    }
    return {
        cells,
        bandHeight,
        width: margin * 2 + columns * cellWidth + (columns - 1) * cellGap,
        height: Math.max(y - cellGap, 10),
    };
}
