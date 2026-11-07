// Ranking from the keyboard alone, and CSV: export a list, read it back into another.

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openPokemonList, test } from './fixtures';

async function listWithTextItems(page: Page, names: string[]): Promise<void> {
    await openPokemonList(page);
    await page.evaluate(() => window.__app.lists.createList('custom', 'Keyboard list'));
    await page.waitForFunction(() => window.__app.state.state.kind === 'custom');
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="txt"]');
    await page.fill('#addtxt', names.join('\n'));
    await page.click('#addtxtgo');
    await expect.poll(() => page.locator('#pgrid .pi').count()).toBe(names.length);
}

/** Names in each tier, top to bottom. */
const tierNames = (page: Page) =>
    page.evaluate(() => {
        const { state } = window.__app.state;
        const nameOf = (id: number) => state.ownItems.find((item: { id: number }) => item.id === id)?.name;
        return state.tiers.map((tier: { items: number[] }) => tier.items.map(nameOf));
    });

test('rank without a mouse: arrows to move, a number to send, Alt+arrows to nudge', async ({ page, errors }) => {
    await listWithTextItems(page, ['Alpha', 'Beta', 'Gamma']);
    await page.focus('#pgrid');
    await page.keyboard.press('ArrowRight'); // onto the first item
    await expect(page.locator('#pgrid .pi').first()).toBeFocused();
    await page.keyboard.press('1'); // nothing selected: the focused item goes
    await expect.poll(() => tierNames(page).then((tiers) => tiers[0])).toEqual(['Alpha']);

    await page.focus('#pgrid');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space'); // select Gamma
    await page.keyboard.press('1');
    await expect.poll(() => tierNames(page).then((tiers) => tiers[0])).toEqual(['Alpha', 'Gamma']);

    await page.focus('#tsec');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Alt+ArrowRight'); // Alpha one place later
    await expect.poll(() => tierNames(page).then((tiers) => tiers[0])).toEqual(['Gamma', 'Alpha']);
    await expect(page.locator('#tsec .pi[aria-label="Alpha"]')).toBeFocused(); // focus follows the item
    await page.keyboard.press('Alt+ArrowDown'); // and down a tier
    await expect.poll(() => tierNames(page).then((tiers) => [tiers[0], tiers[1]])).toEqual([['Gamma'], ['Alpha']]);
    expect(errors).toEqual([]);
});

test('CSV: a list exported and opened in a new list comes back with its tiers', async ({ page, errors }) => {
    await listWithTextItems(page, ['Alpha', 'Beta, the second', '=1+1']);
    await page.evaluate(() => {
        const { state } = window.__app.state;
        const idOf = (name: string) => state.ownItems.find((item: { name: string }) => item.name === name).id;
        state.tiers[0].items.push(idOf('Beta, the second'));
        state.tiers[2].items.push(idOf('Alpha'));
        window.__app.board.placeAllTiles();
    });
    await page.click('#filebtn');
    await page.click('#expbtn');
    const download = page.waitForEvent('download');
    await page.click('#csvbtn');
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^keyboard-list_\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await file.path())!, 'utf8');
    expect(csv.replace(/^﻿/, '').split('\r\n')).toEqual([
        'Tier,Position,Name,Picture',
        'SS,1,"Beta, the second",',
        'A,1,Alpha,',
        ",,'=1+1,",
        '',
    ]);

    await page.evaluate(() => window.__app.lists.createList('custom', 'From a CSV'));
    await page.waitForFunction(() => window.__app.state.state.ownItems.length === 0);
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="txt"]');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#addcsv');
    await (await chooser).setFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect.poll(() => tierNames(page).then((tiers) => [tiers[0], tiers[2]])).toEqual([['Beta, the second'], ['Alpha']]);
    expect(await page.evaluate(() => window.__app.state.state.ownItems.map((item: { name: string }) => item.name))).toContain('=1+1');
    expect(errors).toEqual([]);
});
