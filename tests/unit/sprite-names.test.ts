// Sprite folders named in words, and folded-section names saved by older versions (before the
// names lost their " — " and " · " separators) read as today's names.
import { describe, expect, it } from 'vitest';
import { currentSectionName, describeSpriteDir } from '../../src/pokemon/data';

describe('sprite folder names', () => {
    it('names a game folder with its generation, and lists the rest as tags', () => {
        const info = describeSpriteDir('versions/generation-v/black-white/animated/shiny');
        expect(info.sec).toBe('Gen V: Black / White');
        expect(info.tags).toEqual(['animated', 'shiny']);
    });

    it('reads folded sections saved by older versions as today’s names', () => {
        expect(currentSectionName('Gen V — Black / White')).toBe('Gen V: Black / White');
        expect(currentSectionName('Pokémon GO — costumes & events')).toBe('Pokémon GO: costumes & events');
        expect(currentSectionName('Lore & spin-offs · Pokkén')).toBe('Lore & spin-offs: Pokkén');
    });

    it('leaves names that never had a separator alone', () => {
        for (const name of ['Official artwork', 'Pokémon GO (3D icons)', 'Your images', '★ Favourites', 'Gen V: Black / White'])
            expect(currentSectionName(name)).toBe(name);
    });
});
