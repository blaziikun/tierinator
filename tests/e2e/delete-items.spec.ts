// Deleting your own items: at once, with Undo in the toast (or Ctrl/⌘ Z), and back exactly as they were: pictures,
// picture choices, tags, note, variants, credit and place, even after a reload. Several at once from the selection
// bar, which still fits a 390 px phone.
import type { Page } from '@playwright/test';
import { expect, openPokemonList, openSite, SPRITE_PNG, test } from './fixtures';

/** Pretzel and Waffle ranked in the top tier, Brownie a variant of Waffle in the pool; Waffle has an extra picture. */
async function snackList(page: Page): Promise<{ pretzel: number; waffle: number; brownie: number; donut: number }> {
    await openSite(page);
    await page.click('#startempty');
    return page.evaluate(
        async (png) => {
            const app = window.__app;
            const picture = (name: string) => new File([new Uint8Array(png)], name + '.png', { type: 'image/png' });
            await app.ownItems.addImageFiles(['Pretzel', 'Waffle', 'Brownie', 'Donut'].map(picture));
            const { state } = app.state;
            const [pretzel, waffle, brownie, donut] = state.ownItems.map((item: { id: number }) => item.id);
            state.tiers[0].items = [pretzel, waffle];
            state.tags[waffle] = ['sweet', 'breakfast'];
            state.notes[waffle] = 'Best with syrup';
            state.familyOf[brownie] = waffle;
            state.ownItems[1].credit = { file: 'Waffle.png', by: 'Example Photographer', licence: 'CC BY-SA 4.0' };
            await app.gallery.addExtraPicture(waffle, picture('Waffle again'));
            app.items.rebuildAliases();
            app.board.placeAllTiles();
            app.persist.saveNow();
            return { pretzel, waffle, brownie, donut };
        },
        [...SPRITE_PNG],
    );
}

/** What the list knows about an item, to compare before and after. */
const itemState = (page: Page, id: number) =>
    page.evaluate((id) => {
        const app = window.__app;
        const { state, spriteBlobs } = app.state;
        const item = state.ownItems.find((it: { id: number }) => it.id === id);
        return {
            item: item ? { ...item } : null,
            place: state.tiers.findIndex((tier: { items: number[] }) => tier.items.includes(id)),
            position: state.tiers.flatMap((tier: { items: number[] }) => tier.items.indexOf(id)).find((at: number) => at >= 0) ?? -1,
            pick: state.picks[id] ?? null,
            hasPicture: spriteBlobs.has(id),
            extraPictures: [...app.gallery.extraPictures.values()].filter((p: { id: number }) => p.id === id).length,
            tags: state.tags[id] ?? null,
            note: state.notes[id] ?? null,
            variants: Object.keys(state.familyOf).filter((key) => state.familyOf[key] === id),
        };
    }, id);

/** How many of the item's pictures (its own, and extra choices) this browser's storage holds. */
const storedPictures = (page: Page, id: number) =>
    page.evaluate(async (id) => {
        const { session } = window.__app.state;
        const own = await window.__app.storage.readByPrefix(`${session.listId}:${id}`);
        const extra = await window.__app.storage.readByPrefix(`${session.listId}:x${id}~`);
        return own.filter(([key]: [string]) => key === `${session.listId}:${id}`).length + extra.length;
    }, id);

const reload = async (page: Page) => {
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
};

test('Delete item goes at once; Undo brings it all back, and it stays back after a reload', async ({ page, errors }) => {
    const { waffle, brownie } = await snackList(page);
    const before = await itemState(page, waffle);
    expect(before).toMatchObject({ place: 0, position: 1, hasPicture: true, extraPictures: 1, variants: [String(brownie)] });

    await page.click(`#tsec .pi[data-id="${waffle}"]`, { button: 'right' });
    await page.click('#ieddel');
    await expect(page.locator('#cconf')).toBeHidden();
    await expect(page.locator(`.pi[data-id="${waffle}"]`)).toHaveCount(0);
    const toast = page.locator('#toast');
    await expect(toast).toContainText('Deleted “Waffle”');
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
    expect((await itemState(page, waffle)).item).toBeNull();
    // its variant stays, on its own, and its pictures wait in storage while Undo is offered
    expect(await page.evaluate((id) => window.__app.state.state.familyOf[id], brownie)).toBeUndefined();
    expect(await storedPictures(page, waffle)).toBe(2);

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator(`#tsec .pi[data-id="${waffle}"]`)).toBeVisible();
    expect(await itemState(page, waffle)).toEqual(before);

    await reload(page);
    await expect(page.locator(`#tsec .pi[data-id="${waffle}"]`)).toBeVisible();
    await expect.poll(() => itemState(page, waffle)).toEqual(before);
    expect(errors).toEqual([]);
});

test('Ctrl/⌘ Z brings an item back even after its pictures left storage, and redo deletes it again', async ({ page, errors }) => {
    const { waffle } = await snackList(page);
    const before = await itemState(page, waffle);
    await page.click(`#tsec .pi[data-id="${waffle}"]`, { button: 'right' });
    await page.click('#ieddel');
    await expect(page.locator(`.pi[data-id="${waffle}"]`)).toHaveCount(0);

    // the page hidden (another tab, a phone's home screen): nothing is kept waiting
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete (document as { visibilityState?: string }).visibilityState;
    });
    await expect.poll(() => storedPictures(page, waffle)).toBe(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('#toast')).toHaveText('Restored “Waffle”');
    expect(await itemState(page, waffle)).toEqual(before);
    await expect.poll(() => storedPictures(page, waffle)).toBe(2);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('#toast')).toHaveText('Deleted “Waffle” again');
    await expect(page.locator(`.pi[data-id="${waffle}"]`)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(`#tsec .pi[data-id="${waffle}"]`)).toBeVisible();

    await reload(page);
    await expect.poll(() => itemState(page, waffle)).toEqual(before);
    expect(errors).toEqual([]);
});

test('Undo after other changes brings the item back without undoing them', async ({ page, errors }) => {
    const { pretzel, waffle, donut } = await snackList(page);
    await page.click(`#tsec .pi[data-id="${waffle}"]`, { button: 'right' });
    await page.click('#ieddel');
    // Donut ranked while the toast is still up
    await page.click(`#pgrid .pi[data-id="${donut}"]`);
    await page.locator('#tsec .trow').nth(1).locator('.tlbl').click();
    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
    const tiers = await page.evaluate(() => window.__app.state.state.tiers.map((tier: { items: number[] }) => tier.items));
    expect(tiers[0]).toEqual([pretzel, waffle]);
    expect(tiers.flat()).toContain(donut);
    expect(errors).toEqual([]);
});

test('from the keyboard, Delete item moves focus to Undo, and Undo puts it back', async ({ page, errors }) => {
    const { waffle } = await snackList(page);
    await page.click(`#tsec .pi[data-id="${waffle}"]`, { button: 'right' });
    await page.locator('#ieddel').focus();
    await page.keyboard.press('Enter');
    const undo = page.locator('#toast').getByRole('button', { name: 'Undo' });
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(`#tsec .pi[data-id="${waffle}"]`)).toBeVisible();
    expect(errors).toEqual([]);
});

test('the selection bar deletes several of your items at once, with one Undo', async ({ page, errors }) => {
    const { pretzel, waffle, brownie } = await snackList(page);
    const states = async () => Promise.all([pretzel, waffle, brownie].map((id) => itemState(page, id)));
    const before = await states();

    await page.click(`#tsec .pi[data-id="${pretzel}"]`);
    await page.click(`#tsec .pi[data-id="${waffle}"]`, { modifiers: ['ControlOrMeta'] });
    await page.click(`#pgrid .pi[data-id="${brownie}"]`, { modifiers: ['ControlOrMeta'] });
    await expect(page.locator('#selcount')).toHaveText('3 selected');
    await page.click('#seldel');
    await expect(page.locator('#toast')).toContainText('Deleted 3 items');
    await expect(page.locator('#selbar')).toBeHidden();
    for (const id of [pretzel, waffle, brownie]) await expect(page.locator(`.pi[data-id="${id}"]`)).toHaveCount(0);

    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
    expect(await states()).toEqual(before);
    await reload(page);
    await expect.poll(states).toEqual(before);
    expect(errors).toEqual([]);
});

test("a pack's items (Pokémon) can't be deleted from the selection bar", async ({ page, errors }) => {
    await openPokemonList(page);
    await page.click('#pgrid .pi[data-id="25"]');
    await expect(page.locator('#selbar')).toBeVisible();
    await expect(page.locator('#seldel')).toBeHidden();
    expect(errors).toEqual([]);
});

test.describe('on a 390 px phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('the selection bar fits on one row with every button showing', async ({ page, errors }) => {
        const { pretzel, waffle, brownie } = await snackList(page);
        // ranked and unranked, two or more of your own: Tag, Group, To pool and Delete all show
        await page.evaluate(
            (ids) => {
                const { state } = window.__app.state;
                for (const id of ids) state.selection.add(id);
                state.selectionSource = 'mixed';
                window.__app.board.syncSelection();
            },
            [pretzel, waffle, brownie],
        );
        const bar = page.locator('#selbar');
        const buttons = bar.locator('button:visible');
        await expect(buttons).toHaveText(['Tag', 'Group', 'To pool', 'Delete', '✕']);
        await expect(bar.locator('.hint')).toBeHidden();
        const box = (await bar.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        const tops = await buttons.evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
        expect(errors).toEqual([]);
    });
});
