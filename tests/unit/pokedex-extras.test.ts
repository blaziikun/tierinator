// The packed species facts decode to the right values.
import { describe, expect, it } from 'vitest';
import type { Entry } from '../../src/core/types';
import { baseStatTotal, bodyColor, evolutionStage, specialCategory } from '../../src/features/stats/pokedex-extras';

const species = (dex: number, id = dex): Entry => ({ id, dex, name: '', gen: 1, types: [], lc: '', form: null });

describe('pokedex extras', () => {
    it('evolution stage', () => {
        expect(evolutionStage(species(172))).toBe('Baby'); // Pichu
        expect(evolutionStage(species(25))).toBe('First stage'); // Pikachu
        expect(evolutionStage(species(6))).toBe('Final stage'); // Charizard
        expect(evolutionStage(species(128))).toBe("Doesn't evolve"); // Tauros
    });
    it('legendary & special group', () => {
        expect(specialCategory(species(150))).toBe('Box legend'); // Mewtwo
        expect(specialCategory(species(151))).toBe('Mythical'); // Mew
        expect(specialCategory(species(1))).toBe('Starter line');
        expect(specialCategory(species(149))).toBe('Pseudo-legendary line'); // Dragonite
    });
    it('body colour and base stat total', () => {
        expect(bodyColor(species(25))).toBe('Yellow');
        expect(baseStatTotal(species(6))).toBe(534);
        expect(baseStatTotal(species(150))).toBe(680);
        expect(baseStatTotal(species(6, 10034))).toBe(634); // Mega Charizard X
    });
    it('your own items and unknown numbers have none', () => {
        expect(evolutionStage({ ...species(25), custom: true })).toBeNull();
        expect(baseStatTotal(species(2000))).toBeNull();
    });
});
