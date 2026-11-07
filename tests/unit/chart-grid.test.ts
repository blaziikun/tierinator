// A chart's export layout: cells in a grid, equal widths, each grid row as tall as its fullest cell.
import { describe, expect, it } from 'vitest';
import { layoutChartGrid, tilesAcrossCell } from '../../src/features/export/chart-grid';

const base = {
    columns: 3,
    tilesAcross: 2,
    tileWidth: 50,
    tileHeight: 50,
    gap: 2,
    padding: 6,
    captionHeight: 0,
    cellGap: 6,
    margin: 6,
    bandHeightFor: () => 30,
};

describe('chart export layout', () => {
    it('places nine cells three across, each row as tall as its fullest cell', () => {
        // cell 1 holds 5 pictures (3 lines of 2); the other rows need one line
        const grid = layoutChartGrid({ ...base, itemCounts: [0, 5, 1, 0, 0, 0, 2, 0, 0] });
        const cellWidth = 2 * 52 - 2 + 12;
        const oneLine = 30 + 50 + 12;
        const threeLines = 30 + 3 * 50 + 2 * 2 + 12;
        expect(grid.cells).toHaveLength(9);
        expect(grid.cells[0]).toEqual({ x: 6, y: 0, width: cellWidth, height: threeLines });
        expect(grid.cells[2]).toEqual({ x: 6 + 2 * (cellWidth + 6), y: 0, width: cellWidth, height: threeLines });
        expect(grid.cells[3]).toEqual({ x: 6, y: threeLines + 6, width: cellWidth, height: oneLine });
        expect(grid.cells[8]!.y).toBe(threeLines + 6 + oneLine + 6);
        expect(grid.width).toBe(12 + 3 * cellWidth + 2 * 6);
        expect(grid.height).toBe(threeLines + 2 * oneLine + 2 * 6);
        expect(grid.bandHeight).toBe(30);
    });

    it('leaves room for captions and asks for the band height at the real cell width', () => {
        let askedWidth = 0;
        const grid = layoutChartGrid({
            ...base,
            tilesAcross: 3,
            captionHeight: 10,
            itemCounts: [4],
            bandHeightFor: (width) => {
                askedWidth = width;
                return 40;
            },
        });
        expect(askedWidth).toBe(3 * 52 - 2 + 12);
        expect(grid.cells[0]!.height).toBe(40 + 2 * 60 + 2 + 12);
    });

    it('a grid row that is not full keeps the full width; no cells is still a valid size', () => {
        expect(layoutChartGrid({ ...base, itemCounts: [1, 1, 1, 1] }).cells[3]!.x).toBe(6);
        expect(layoutChartGrid({ ...base, itemCounts: [] })).toMatchObject({ cells: [], height: 10 });
    });

    it('fits at least two pictures across a cell, more when it is wide', () => {
        expect(tilesAcrossCell(0, 88, 2)).toBe(2);
        expect(tilesAcrossCell(90, 88, 2)).toBe(2);
        expect(tilesAcrossCell(4 * 90 - 2, 88, 2)).toBe(4);
    });
});
