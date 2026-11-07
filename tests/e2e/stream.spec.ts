// Stream mode: number keys, skip, back, undo and Esc on a tier list; dragging (or tapping) into a chart's cells
// from scratch on a green screen; the controls hide; the options and the view pass the accessibility checks.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, test } from './fixtures';

const tiers = (page: Page): Promise<number[][]> =>
    page.evaluate(() => window.__app.state.state.tiers.map((tier: { items: number[] }) => tier.items));

/** A new empty list with these items of your own in the pool. */
async function listWithItems(page: Page, names: string[], { chart = false } = {}): Promise<number[]> {
    await openSite(page);
    await page.click('#startempty');
    if (chart) {
        await page.click('#listbtn');
        await page.click('#lnewchart');
        await page.waitForFunction(() => window.__app.state.state.layout === 'chart');
    }
    return page.evaluate(async (names) => {
        const ids: number[] = [];
        for (const name of names) ids.push(await window.__app.ownItems.addItem({ name }));
        window.__app.board.placeAllTiles();
        return ids;
    }, names);
}

/** From the list menu: the top bar's Stream mode button is hidden until turned on in Style. */
async function openStreamOptions(page: Page): Promise<void> {
    await page.click('#listbtn');
    await page.click('#lstream');
    await expect(page.locator('#streamm')).toBeVisible();
}

test('stream mode: digits place items, → skips, ← goes back, U and Ctrl+Z undo, Esc leaves', async ({ page, errors }) => {
    const [first, second, third, fourth] = await listWithItems(page, ['Lighthouse', 'Windmill', 'Water tower', 'Silo']);
    await openStreamOptions(page);
    await page.selectOption('#streamorder', 'pool');
    await page.selectOption('#streamwhich', 'unranked');
    await page.check('#streamnames');
    await page.click('#streamgo');

    const stage = page.locator('#stream');
    const name = page.locator('#snowname');
    await expect(stage).toBeVisible();
    await expect(page.locator('#toolbar')).toBeHidden();
    await expect(page.locator('#psec')).toBeHidden();
    await expect(stage.locator('.srow')).toHaveCount((await tiers(page)).length);
    await expect(name).toHaveText('Lighthouse');
    await expect(page.locator('#sprog')).toHaveText('0 of 4 ranked');

    await page.keyboard.press('1');
    await expect(name).toHaveText('Windmill');
    await page.keyboard.press('2');
    await page.keyboard.press('ArrowRight'); // Water tower stays in the pool for now
    await expect(name).toHaveText('Silo');
    await page.keyboard.press('3');
    // the end of the queue: round again to the one skipped
    await expect(name).toHaveText('Water tower');
    expect((await tiers(page)).slice(0, 3)).toEqual([[first], [second], [fourth]]);
    await expect(stage.locator('.srow').nth(1).locator('.stile')).toHaveCount(1);
    await expect(stage.locator('.srow').nth(1).locator('.sname')).toHaveText('Windmill');
    await expect(page.locator('#sprog')).toHaveText('3 of 4 ranked');

    // undo gives the last one back and shows it again
    await page.keyboard.press('u');
    await expect(name).toHaveText('Silo');
    await page.keyboard.press('Control+z');
    await expect(name).toHaveText('Windmill');
    expect((await tiers(page)).slice(0, 3)).toEqual([[first], [], []]);

    // back shows an item already placed; Space skips on to the next one still to rank
    await page.keyboard.press('ArrowLeft');
    await expect(name).toHaveText('Lighthouse');
    await expect(page.locator('#snowwhere')).toContainText('Now in');
    await page.keyboard.press(' ');
    await expect(name).toHaveText('Windmill');

    await page.keyboard.press('Escape');
    await expect(stage).toBeHidden();
    await expect(page.locator('#toolbar')).toBeVisible();
    const after = await tiers(page);
    expect(after[0]).toEqual([first]);
    expect(after.slice(1).flat()).toEqual([]);
    await expect(page.locator('#tsec .tcont').first().locator(`.pi[data-id="${first}"]`)).toHaveCount(1);
    await expect(page.locator(`#pgrid .pi[data-id="${third}"]`)).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('stream mode on a chart, from scratch on a green screen: drag or tap into cells, then All ranked', async ({
    page,
    errors,
    isMobile,
}) => {
    const [paladin, trickster] = await listWithItems(page, ['Paladin', 'Trickster'], { chart: true });
    await page.evaluate((paladin) => {
        window.__app.state.state.tiers[0].items.push(paladin);
        window.__app.board.renderTiers();
    }, paladin);
    await openStreamOptions(page);
    await page.selectOption('#streambg', 'green');
    await page.selectOption('#streamorder', 'shuffled');
    await page.selectOption('#streamwhich', 'all');
    await page.click('#streamgo');

    const stage = page.locator('#stream');
    await expect(stage).toHaveAttribute('data-bg', 'green');
    expect(await stage.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(0, 177, 64)');
    await expect(page.locator('#sboard.chart .srow')).toHaveCount(9);
    expect((await tiers(page)).flat()).toEqual([]); // from scratch: the tiers start empty
    const firstUp = (await page.locator('#snowname').textContent()) === 'Paladin' ? paladin : trickster;

    const cell = page.locator('#sboard .srow').nth(4);
    if (isMobile) await cell.click();
    else {
        const from = (await page.locator('#snowpic').boundingBox())!;
        const to = (await cell.boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 3 });
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
        await expect(cell).toHaveClass(/over/);
        await page.mouse.up();
    }
    expect((await tiers(page))[4]).toEqual([firstUp]);
    await page.keyboard.press('9');
    await expect(page.locator('#sdone')).toBeVisible();
    await expect(page.locator('#sdone h2')).toHaveText('All ranked');
    await expect(page.locator('#sprog')).toHaveText('2 of 2 ranked');
    await page.click('#sdoneleave');
    await expect(stage).toBeHidden();
    const after = await tiers(page);
    expect(after[4]).toEqual([firstUp]);
    expect(after[8]).toEqual([firstUp === paladin ? trickster : paladin]);

    // emptying the tiers was one undo step of its own: the earlier ranking comes back
    for (let step = 0; step < 3; step++) await page.keyboard.press('Control+z');
    expect((await tiers(page))[0]).toEqual([paladin]);
    expect((await tiers(page)).flat()).toEqual([paladin]);
    expect(errors).toEqual([]);
});

test('V opens stream mode; H hides the controls; the options and the view pass the accessibility checks', async ({ page, errors }) => {
    await listWithItems(page, ['Comet', 'Meteor']);
    const serious = async (selector: string) =>
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include(selector).analyze()).violations
            .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
            .map((violation) => violation.id);
    await page.locator('body').press('v');
    await expect(page.locator('#streamm')).toBeVisible();
    expect(await serious('#streamm')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#streamm')).toBeHidden();

    await page.locator('body').press('v');
    await page.click('#streamgo');
    await expect(page.locator('#stream')).toBeVisible();
    expect(await serious('#stream')).toEqual([]);
    await page.keyboard.press('h');
    await expect(page.locator('#skeys')).toBeHidden();
    await expect(page.locator('#skeysshow')).toBeVisible();
    await page.keyboard.press('h');
    await expect(page.locator('#skeys')).toBeVisible();
    await page.click('#sleave');
    await expect(page.locator('#stream')).toBeHidden();
    expect((await tiers(page)).flat()).toEqual([]);
    expect(errors).toEqual([]);
});

test('from scratch with a search that matches nothing: stream mode stays closed and the tiers stay as they were', async ({
    page,
    errors,
}) => {
    const [comet] = await listWithItems(page, ['Comet', 'Meteor']);
    await page.evaluate((comet) => {
        window.__app.state.state.tiers[0].items.push(comet);
        window.__app.board.placeAllTiles();
    }, comet);
    await page.fill('#psearch', 'asteroid');
    await openStreamOptions(page);
    await page.selectOption('#streamwhich', 'all');
    await page.click('#streamgo');
    await expect(page.locator('#toast')).toContainText('Nothing in the pool matches');
    await expect(page.locator('#streamm')).toBeVisible();
    await expect(page.locator('#stream')).toBeHidden();
    expect((await tiers(page))[0]).toEqual([comet]);
    expect(await page.evaluate(() => window.__app.history.undoStack.length)).toBe(0);
    expect(errors).toEqual([]);
});
