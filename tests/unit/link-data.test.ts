// Share links: lists packed into a link and back, and links that try to be trouble.
import { describe, expect, it } from 'vitest';
import { packForLink, unpackFromLink } from '../../src/lib/link-data';

describe('link data', () => {
    it('comes back exactly as it went in, in characters that are safe in a link', async () => {
        const list = { listName: 'Fire types ✨ "quoted"', tiers: [{ label: 'SS', items: [4, 5, 6] }], notes: { 6: 'best' } };
        const packed = await packForLink(list);
        expect(packed).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(await unpackFromLink(packed, 1_000_000)).toEqual(list);
    });

    it('fits a big list (a thousand ranked Pokémon) in a link of a few KB', async () => {
        const ids = Array.from({ length: 1025 }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 1031) - ((b * 7919) % 1031));
        const tiers = Array.from({ length: 9 }, (_, i) => ({ label: String(i), items: ids.slice(i * 114, i * 114 + 114) }));
        const packed = await packForLink({ tiers });
        expect(packed.length).toBeLessThan(JSON.stringify({ tiers }).length);
        expect(packed.length).toBeLessThan(6_000);
    });

    it('turns garbage into null instead of throwing', async () => {
        for (const text of ['', '!!!', 'not base64 at all', 'AAAA', '<script>']) expect(await unpackFromLink(text, 1_000_000)).toBeNull();
    });

    it('refuses a link that would unpack to more than the limit (a "zip bomb" link)', async () => {
        const packed = await packForLink({ filler: 'a'.repeat(5_000_000) });
        expect(packed.length).toBeLessThan(20_000);
        expect(await unpackFromLink(packed, 1_000_000)).toBeNull();
    });
});
