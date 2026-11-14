// The Focus bar's matching, where moved items land while some are hidden, saved grids read back from files, and
// what each grid cell holds.
import { describe, expect, it } from 'vitest';
import { GRID_PRESETS, gridFromPreset, readGrids } from '../../src/core/grid-format';
import type { Entry, SavedGrid } from '../../src/core/types';
import { autoName, buildGrid, cellKey, rankPlaces } from '../../src/features/grid/cells';
import { insertionIndex, reorderShown } from '../../src/features/tier-board/placement';
import { FACETS, focusSummary, isFocusEmpty, matchesFocus, readFocus } from '../../src/pokemon/facets';

const mon = (dex: number, types: string[], gen = 1, form: Entry['form'] = null, id = dex): Entry => ({
    id,
    dex,
    name: `#${dex}`,
    gen,
    types,
    lc: '',
    form,
});
const pikachu = mon(25, ['Electric']);
const raichu = mon(26, ['Electric']);
const bulbasaur = mon(1, ['Grass', 'Poison']);
const charizard = mon(6, ['Fire', 'Flying']);
const megaCharizardX = mon(6, ['Fire', 'Dragon'], 6, 'mega', 10034);
const mewtwo = mon(150, ['Psychic']);
const mew = mon(151, ['Psychic']);
const tauros = mon(128, ['Normal']);
const pichu = mon(172, ['Electric'], 2);
const own: Entry = { id: 100_001, dex: null, name: 'Mine', gen: 0, types: [], lc: '', form: null, custom: true };

describe('facets', () => {
    it("read a Pokémon's type, generation, stage, group and form", () => {
        expect(FACETS.type.of(bulbasaur)).toEqual(['Grass', 'Poison']);
        expect(FACETS.gen.of(pichu)).toEqual(['2']);
        expect(FACETS.stage.of(pichu)).toEqual(['baby']);
        expect(FACETS.stage.of(raichu)).toEqual(['final']);
        expect(FACETS.stage.of(tauros)).toEqual(['single']);
        expect(FACETS.group.of(bulbasaur)).toEqual(['starter']);
        expect(FACETS.group.of(mewtwo)).toEqual(['box']);
        expect(FACETS.group.of(mew)).toEqual(['mythical']);
        expect(FACETS.form.of(megaCharizardX)).toEqual(['mega']);
        expect(FACETS.form.of(charizard)).toEqual(['standard']);
        // a form counts for the species' stage and group
        expect(FACETS.stage.of(megaCharizardX)).toEqual(['final']);
        expect(FACETS.group.of(megaCharizardX)).toEqual(['starter']);
    });
    it('your own items have none, so a focus never shows them', () => {
        for (const facet of Object.values(FACETS)) expect(facet.of(own)).toEqual([]);
        expect(matchesFocus(own, { type: ['Normal'] })).toBe(false);
    });
});

describe('focus', () => {
    it('any value within a facet, every facet across', () => {
        const electricOrFire = { type: ['Electric', 'Fire'] };
        expect(matchesFocus(pikachu, electricOrFire)).toBe(true);
        expect(matchesFocus(charizard, electricOrFire)).toBe(true);
        expect(matchesFocus(bulbasaur, electricOrFire)).toBe(false);
        const finalElectric = { type: ['Electric'], stage: ['final', 'single'] };
        expect(matchesFocus(raichu, finalElectric)).toBe(true);
        expect(matchesFocus(pikachu, finalElectric)).toBe(false);
        expect(matchesFocus(pikachu, {})).toBe(true);
    });
    it('`only` narrows to set items', () => {
        const focus = { only: { ids: [25], label: 'A cell' }, type: ['Electric'] };
        expect(matchesFocus(pikachu, focus)).toBe(true);
        expect(matchesFocus(raichu, focus)).toBe(false);
        expect(isFocusEmpty({ only: { ids: [], label: '' } })).toBe(false);
        expect(isFocusEmpty({ type: [] })).toBe(true);
    });
    it('says what it shows, naming the stage shortcuts', () => {
        expect(focusSummary({ type: ['Electric', 'Ghost'], gen: ['4'] })).toBe('Electric or Ghost · Gen 4');
        expect(focusSummary({ stage: ['single', 'final'] })).toBe('Fully evolved');
        expect(focusSummary({ group: ['starter'], stage: ['first'] })).toBe('First stage · Starter line');
    });
    it('a focus from a file keeps only known facets and values, without repeats, and never `only`', () => {
        expect(readFocus({ type: ['Electric', 'Electric', 'Plasma', 7], gen: '4', bogus: ['x'], only: { ids: [1], label: 'x' } })).toEqual({
            type: ['Electric'],
        });
        expect(readFocus(null)).toEqual({});
    });
});

describe('placement while some are hidden', () => {
    const shownElectric = (id: number) => [25, 26, 81].includes(id);
    it('between two shown ones: straight after the left one', () => {
        expect(insertionIndex([25, 1, 4, 26], shownElectric, { nextTo: 26, after: false })).toBe(1);
        expect(insertionIndex([25, 1, 4, 26], shownElectric, { nextTo: 25, after: true })).toBe(1);
    });
    it('before the first shown one: right before it; on empty space: after the last shown one', () => {
        expect(insertionIndex([1, 4, 26, 7], shownElectric, { nextTo: 26, after: false })).toBe(2);
        expect(insertionIndex([25, 1, 4], shownElectric, {})).toBe(1);
        expect(insertionIndex([1, 4], shownElectric, {})).toBe(2);
    });
    it('with nothing hidden it is the ordinary before / after', () => {
        const all = () => true;
        expect(insertionIndex([1, 2, 3], all, { nextTo: 2, after: false })).toBe(1);
        expect(insertionIndex([1, 2, 3], all, { nextTo: 2, after: true })).toBe(2);
        expect(insertionIndex([1, 2, 3], all, {})).toBe(3);
    });
    it('sorting what is shown reuses their places and leaves the hidden ones be', () => {
        expect(reorderShown([25, 1, 26, 4, 81], [81, 25, 26])).toEqual([81, 1, 25, 4, 26]);
    });
});

describe('saved grids', () => {
    const exists = (id: number) => id < 2000;
    let n = 0;
    const makeId = () => `g${++n}`;
    it('a preset makes a grid you can change without changing the preset', () => {
        const starters = GRID_PRESETS.find((p) => p.name === 'Starters')!;
        const grid = gridFromPreset(starters, 'a');
        grid.focus.group!.push('legendary');
        expect(starters.focus?.group).toEqual(['starter']);
    });
    it('reading checks every field: facets, values, layer, pins, names, ids', () => {
        const [grid, second] = readGrids(
            [
                {
                    id: 'x',
                    name: '  Mine  ',
                    rows: 'gen',
                    rowValues: ['1', '1', '42'],
                    cols: 'type',
                    colValues: ['Fire', 'Plasma'],
                    layer: 'gen', // the same as the rows: dropped
                    layerValue: '1',
                    focus: { group: ['starter'], only: { ids: [1], label: 'x' } },
                    pins: { '*|1|Fire': 6, '*|1|Water': 99_999, '*|2|Grass': 'oops' },
                },
                { id: 'x', rows: 'stage', cols: null, layer: 'form', layerValue: 'mega' },
                { rows: 'height' },
                { rows: 'gen', cols: 'nonsense' },
                { rows: 'gen', cols: 'type', layer: 'weight' },
                'junk',
                { id: 'same', rows: 'gen', cols: 'gen' },
            ],
            exists,
            makeId,
        );
        expect(grid).toEqual({
            id: 'x',
            name: 'Mine',
            rows: 'gen',
            rowValues: ['1'],
            cols: 'type',
            colValues: ['Fire'],
            layer: null,
            layerValue: null,
            focus: { group: ['starter'] },
            pins: { '*|1|Fire': 6 },
        });
        expect(second).toMatchObject({ id: 'g1', name: 'Grid', rows: 'stage', cols: null, layer: 'form', layerValue: 'mega' });
        // an unknown facet anywhere drops the grid; the same facet both ways becomes one column (types alone pair up)
        const kept = readGrids(
            [
                { rows: 'gen', cols: 'nonsense' },
                { rows: 'gen', cols: 'gen' },
                { rows: 'type', cols: 'type' },
            ],
            exists,
            makeId,
        );
        expect(kept.map((g) => [g.rows, g.cols])).toEqual([
            ['gen', null],
            ['type', 'type'],
        ]);
        // past the cap, the newest pins are the ones kept
        const pins = Object.fromEntries(Array.from({ length: 5002 }, (_, i) => [`*|${i}|*`, 1]));
        const [many] = readGrids([{ rows: 'gen', pins }], exists, makeId);
        expect(Object.keys(many!.pins)).toHaveLength(5000);
        expect(many!.pins['*|5001|*']).toBe(1);
        expect(many!.pins['*|0|*']).toBeUndefined();
        expect(readGrids('nope', exists, makeId)).toEqual([]);
    });
});

describe('grid cells', () => {
    const entries = [bulbasaur, charizard, pikachu, raichu, mewtwo, mew, tauros, pichu, megaCharizardX];
    const grid = (over: Partial<SavedGrid>): SavedGrid => ({
        id: 'g',
        name: 'G',
        rows: 'gen',
        rowValues: [],
        cols: 'type',
        colValues: [],
        layer: null,
        layerValue: null,
        focus: {},
        pins: {},
        ...over,
    });
    // ranking: Raichu, Charizard, Pikachu, then Mew
    const ranks = rankPlaces([{ items: [26, 6] }, { items: [25] }, { items: [151] }]);

    it("each cell's pick is the best-ranked Pokémon that fits; unranked ones follow in Pokédex order", () => {
        const model = buildGrid(grid({}), entries, ranks);
        const electric = model.cells.get(cellKey(null, '1', 'Electric'))!;
        expect(electric.ids).toEqual([26, 25]);
        expect(electric.top).toBe(26);
        expect(electric.ranked).toBe(2);
        const grass = model.cells.get(cellKey(null, '1', 'Grass'))!;
        expect(grass.ids).toEqual([1]);
        expect(grass.top).toBeNull(); // nothing ranked: no pick
        expect(model.cells.get(cellKey(null, '1', 'Ice'))!.ids).toEqual([]);
        // a dual type sits under both types; a Mega counts for the generation it came in
        expect(model.cells.get(cellKey(null, '1', 'Flying'))!.ids).toEqual([6]);
        expect(model.cells.get(cellKey(null, '6', 'Dragon'))!.ids).toEqual([10034]);
    });
    it('a pin wins while it still fits the cell', () => {
        const pinned = buildGrid(
            grid({ pins: { [cellKey(null, '1', 'Electric')]: 25, [cellKey(null, '1', 'Grass')]: 26 } }),
            entries,
            ranks,
        );
        expect(pinned.cells.get(cellKey(null, '1', 'Electric'))!.pin).toBe(25);
        expect(pinned.cells.get(cellKey(null, '1', 'Electric'))!.top).toBe(26);
        expect(pinned.cells.get(cellKey(null, '1', 'Grass'))!.pin).toBeNull(); // Raichu isn't Grass
    });
    it('type × type: single types on the diagonal, dual types in both pairings', () => {
        const model = buildGrid(grid({ rows: 'type', cols: 'type' }), entries, ranks);
        expect(model.cells.get(cellKey(null, 'Electric', 'Electric'))!.ids).toEqual([26, 25, 172]);
        expect(model.cells.get(cellKey(null, 'Fire', 'Flying'))!.ids).toEqual([6]);
        expect(model.cells.get(cellKey(null, 'Flying', 'Fire'))!.ids).toEqual([6]);
        expect(model.cells.get(cellKey(null, 'Fire', 'Fire'))!.ids).toEqual([]);
    });
    it('one column, chosen values, the grid’s own focus and a layer', () => {
        const byType = buildGrid(grid({ rows: 'type', cols: null, rowValues: ['Psychic', 'Electric'] }), entries, ranks);
        expect(byType.rows.map((r) => r.value)).toEqual(['Psychic', 'Electric']); // in the order chosen
        expect(byType.cells.get(cellKey(null, 'Psychic', null))!.top).toBe(151);
        const starters = buildGrid(grid({ focus: { group: ['starter'], stage: ['first'] } }), entries, ranks);
        expect(starters.cells.get(cellKey(null, '1', 'Grass'))!.ids).toEqual([1]);
        expect(starters.cells.get(cellKey(null, '1', 'Fire'))!.ids).toEqual([]); // Charizard is a final stage
        const layered = buildGrid(grid({ layer: 'stage', layerValue: 'final' }), entries, ranks);
        expect(layered.cells.get(cellKey('final', '1', 'Electric'))!.ids).toEqual([26]);
        expect(layered.layerCounts.get('first')).toBe(2); // Bulbasaur, Pikachu
    });
    it('names itself from its axes', () => {
        expect(autoName({ rows: 'gen', cols: 'type' })).toBe('Gen × Type');
        expect(autoName({ rows: 'type', cols: null })).toBe('By type');
    });
});
