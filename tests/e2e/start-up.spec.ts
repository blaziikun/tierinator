// A first visit is empty; a Pokémon list loads every Pokémon, with the built-in sprites from PokeAPI.
import { expect, openPokemonList, openSite, test } from './fixtures';

test('first visit is empty: one blank list, no packs, no Pokémon data downloaded', async ({ page, errors }) => {
    const packRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/packs/')) packRequests.push(request.url());
    });
    await openSite(page);
    const start = await page.evaluate(() => ({
        lists: window.__app.state.session.lists.map((list: { name: string; kind: string }) => [list.name, list.kind]),
        items: window.__app.items.entries.length,
        pokemonPack: !!window.__app.data.pokedex.pack,
        otherPacks: window.__app.packs.genericPacks.size,
    }));
    expect(start).toEqual({ lists: [['My tier list', 'custom']], items: 0, pokemonPack: false, otherPacks: 0 });
    await expect(page.locator('#pgrid .pi')).toHaveCount(0);
    expect(packRequests).toEqual([]);
    expect(errors).toEqual([]);
});

test('a new Pokémon list has every Pokémon in the pool and replaces the empty starting list', async ({ page, errors }) => {
    await openPokemonList(page);
    expect(await page.evaluate(() => window.__app.state.session.lists.map((list: { name: string }) => list.name))).toEqual([
        'My Pokémon tier list',
    ]);
    await expect(page).toHaveTitle(/Tierinator/);
    await expect(page.locator('#pgrid .pi')).toHaveCount(1277);
    expect(errors).toEqual([]);
});

test('default sprites come from PokeAPI and are cropped like the old trimmed ones', async ({ page }) => {
    await openPokemonList(page);
    const bulbasaur = page.locator('#pgrid .pi[data-id="1"] img');
    await expect(bulbasaur).toHaveAttribute('src', /PokeAPI\/sprites\/.*\/1\.png$/);
    await expect(bulbasaur).toHaveClass(/crop/);
});

test('a sprite mirror that is down falls through to the next one', async ({ page }) => {
    await page.route(/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/25\.png/, (r) => r.abort());
    await openPokemonList(page);
    const pikachu = page.locator('#pgrid .pi[data-id="25"] img');
    await expect(pikachu).not.toHaveAttribute('src', /raw\.githubusercontent/);
    await expect.poll(() => pikachu.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test('the security policy is on: raw HTML and inline scripts are refused', async ({ page }) => {
    await openPokemonList(page);
    const result = await page.evaluate(() => {
        let rawHtml = 'allowed';
        try {
            document.createElement('div').innerHTML = '<img src=x>';
        } catch {
            rawHtml = 'refused';
        }
        (window as unknown as { __ran?: boolean }).__ran = false;
        try {
            const script = document.createElement('script');
            script.textContent = 'window.__ran = true'; // Trusted Types refuse this already
            document.body.append(script); // and the policy would block it running
        } catch {}
        const inlineScript = (window as unknown as { __ran?: boolean }).__ran ? 'ran' : 'blocked';
        return { rawHtml, inlineScript };
    });
    expect(result).toEqual({ rawHtml: 'refused', inlineScript: 'blocked' });
});
