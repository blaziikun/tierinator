// Pack builder: turns a wiki into a pack, step by step, then starts a list from it.
import { expect, openPokemonList, test } from './fixtures';
import { serveMockWiki } from './mock-wiki';

test('builds a pack from a wiki and starts a list from it', async ({ page, context, errors }) => {
    test.setTimeout(90_000);
    await serveMockWiki(context);
    await openPokemonList(page);
    await page.click('#listbtn');
    await page.click('#pbopen');
    await expect(page.locator('#pbm')).toBeVisible();

    await page.fill('#pbwiki', 'mockugan');
    await page.fill('#pbex', 'Drago');
    await page.click('#pbfind');
    await expect(page.locator('#pbload')).toBeEnabled({ timeout: 20_000 });
    await page.click('#pbload');
    await page.waitForFunction(() => window.__app.packBuilder.packBuilder.step === 2, null, { timeout: 30_000 });

    // leave out battle gear: Jetkor gets unticked
    await page.click('#pbcats .chip[data-c="Battle Gear"]');
    await expect(page.locator('#pbitems input[data-t="Jetkor"]')).not.toBeChecked();

    for (const step of [2, 3, 4]) await page.click(`#pbbox section[data-s="${step}"] [data-next]`);
    await page.click('#pbbuild');
    await page.waitForFunction(() => !!window.__app.packBuilder.packBuilder.pack, null, { timeout: 60_000 });
    const pack = await page.evaluate(() => window.__app.packBuilder.packBuilder.pack);
    expect(pack.items.length).toBe(18);
    expect(pack.facets.Attribute).toEqual(expect.arrayContaining(ATTRIBUTE_NAMES));
    expect(pack.items.find((row: unknown[]) => row[0] === 'Drago')[2].length).toBeGreaterThan(3); // gallery pictures found

    await page.click('#pbstart');
    await page.waitForFunction(() => window.__app.state.state.ownItems.length === 18, null, { timeout: 20_000 });
    await expect(page.locator('#pbm')).toBeHidden();
    expect(errors).toEqual([]);
});

const ATTRIBUTE_NAMES = ['Pyrus', 'Haos', 'Aquos', 'Subterra', 'Darkus', 'Ventus'];
