// The pool's order: as added, A to Z, Z to A, shuffled (new each time it's chosen). Only the screen changes; the
// order is saved with the list, and Quick rank and stream mode go through the pool in the order it shows.
import type { Page } from '@playwright/test';
import { expect, openPokemonList, openSite, test } from './fixtures';

const NAMES = ['Pretzel', 'apple pie', 'Brownie', 'Waffle', 'Croissant', 'Éclair', 'Donut', 'Muffin 10', 'Muffin 2'];
const A_TO_Z = ['apple pie', 'Brownie', 'Croissant', 'Donut', 'Éclair', 'Muffin 2', 'Muffin 10', 'Pretzel', 'Waffle'];

async function listWithItems(page: Page): Promise<number[]> {
    await openSite(page);
    await page.click('#startempty');
    return page.evaluate(async (names) => {
        const ids: number[] = [];
        for (const name of names) ids.push(await window.__app.ownItems.addItem({ name }));
        window.__app.board.placeAllTiles();
        return ids;
    }, NAMES);
}

const poolNames = (page: Page): Promise<string[]> => page.locator('#pgrid .pi .pname').allTextContents();
const savedOrder = (page: Page): Promise<string[]> =>
    page.evaluate(() => window.__app.state.state.ownItems.map((item: { name: string }) => item.name));

async function choose(page: Page, choice: string): Promise<void> {
    await page.click('#psortbtn');
    await page.click(`#psortmenu [data-choice="${choice}"]`);
}

test('A to Z, Z to A and back to the order added, without touching the saved order', async ({ page, errors }) => {
    await listWithItems(page);
    const button = page.locator('#psortbtn');
    await expect(button).toHaveAccessibleName('Pool order: Order added');
    expect(await poolNames(page)).toEqual(NAMES);

    await choose(page, 'az');
    await expect(button).toHaveAccessibleName('Pool order: A to Z');
    expect(await poolNames(page)).toEqual(A_TO_Z);
    await choose(page, 'za');
    expect(await poolNames(page)).toEqual([...A_TO_Z].reverse());
    expect(await savedOrder(page)).toEqual(NAMES);

    await page.click('#psortbtn');
    await expect(page.locator('#psortmenu [aria-checked="true"]')).toHaveText('Z to A');
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();

    // saved with the list
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
    await expect.poll(() => poolNames(page)).toEqual([...A_TO_Z].reverse());
    await choose(page, 'added');
    expect(await poolNames(page)).toEqual(NAMES);
    expect(errors).toEqual([]);
});

test('shuffled: a new shuffle each time it is chosen, and the rest stay put when one is ranked', async ({ page, errors }) => {
    const ids = await listWithItems(page);
    await choose(page, 'shuffled');
    const first = await poolNames(page);
    expect([...first].sort()).toEqual([...NAMES].sort());
    await choose(page, 'shuffled');
    await expect(page.locator('#toast')).toHaveText('Shuffled again');
    const second = await poolNames(page);
    expect(second).not.toEqual(first);

    // ranking one item leaves the others in their places
    const ranked = NAMES[3]!;
    await page.evaluate((id) => {
        window.__app.state.state.tiers[0].items.push(id);
        window.__app.board.placeAllTiles();
        window.__app.persist.saveNow();
    }, ids[3]);
    expect(await poolNames(page)).toEqual(second.filter((name) => name !== ranked));

    // the same shuffle after a reload
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
    await expect.poll(() => poolNames(page)).toEqual(second.filter((name) => name !== ranked));
    expect(await savedOrder(page)).toEqual(NAMES);
    expect(errors).toEqual([]);
});

test('works from the keyboard', async ({ page, errors }) => {
    await listWithItems(page);
    await page.locator('#psortbtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#psortmenu [data-choice="added"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await poolNames(page)).toEqual(A_TO_Z);
    await expect(page.locator('#psortbtn')).toBeFocused();
    expect(errors).toEqual([]);
});

test('Quick rank and stream mode go through the pool in the order it shows', async ({ page, errors }) => {
    await listWithItems(page);
    await choose(page, 'az');
    await page.keyboard.press('q');
    await expect(page.locator('#qrname')).toHaveText('apple pie');
    await page.keyboard.press('Escape');

    await choose(page, 'za');
    await page.click('#listbtn');
    await page.click('#lstream');
    await page.selectOption('#streamorder', 'pool');
    await page.selectOption('#streamwhich', 'unranked');
    await page.click('#streamgo');
    await expect(page.locator('#snowname')).toHaveText('Waffle');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
});

test('a Pokémon list calls the order added Pokédex order', async ({ page, errors }) => {
    await openPokemonList(page);
    await expect(page.locator('#psortbtn')).toHaveAccessibleName('Pool order: Pokédex order');
    await page.click('#psortbtn');
    await expect(page.locator('#psortmenu [data-choice="added"]')).toHaveText('Pokédex order');
    expect(errors).toEqual([]);
});
