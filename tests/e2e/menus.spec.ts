// The two menus each have one job and nothing was lost in sorting them out: the list menu is which list (yours,
// new, this one, packs), File is this list's files and the outside world. The Pool menu (beside, below, hidden)
// with B and P, old top bar layouts, and the bar still fitting 1280 px.
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, openPokemonList, openSite, test } from './fixtures';

/** A tap on the phone, a click on the desktop. */
const press = (target: Locator): Promise<void> => (test.info().project.name === 'phone' ? target.tap() : target.click());

/** A new list of your own with these items in the pool. */
async function listWithItems(page: Page, names: string[]): Promise<number[]> {
    await openSite(page);
    await page.click('#startempty');
    return page.evaluate(async (names) => {
        const ids: number[] = [];
        for (const name of names) ids.push(await window.__app.ownItems.addItem({ name }));
        window.__app.board.placeAllTiles();
        return ids;
    }, names);
}

async function seriousProblems(page: Page, only: string): Promise<string[]> {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include(only).analyze();
    return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

const FILE_MENU = ['#savebtn', '#loadbtn', '#sharebtn', '#expbtn', '#backupbtn', '#aboutbtn'];
const LIST_MENU = [
    '#lnew',
    '#lnewpk',
    '#lnewchart',
    '#ltpl',
    '#lgroup',
    '#lname',
    '#ldup',
    '#ldup0',
    '#lstream',
    '#ldel',
    '#pbopen',
    '#lsavepack',
];

test('every action the two menus had is still in one of them, and only in one', async ({ page, errors }) => {
    await listWithItems(page, ['Lighthouse', 'Windmill']);

    await press(page.locator('#filebtn'));
    for (const id of FILE_MENU) await expect(page.locator(`#filepop ${id}`)).toBeVisible();
    await expect(page.locator('#filepop button')).toHaveCount(FILE_MENU.length);
    const fileLabels = await page.locator('#filepop button').allInnerTexts();
    expect(await seriousProblems(page, '#filepop')).toEqual([]);
    await page.keyboard.press('Escape');

    await press(page.locator('#listbtn'));
    for (const id of LIST_MENU) await expect(page.locator(`#listpop ${id}`)).toBeVisible();
    await expect(page.locator('#listpop .lhead')).toHaveText(['New', 'This list', 'Packs']);
    // packs are opened where every file is: the Packs part says so instead of a second loader
    await expect(page.locator('#packup')).toHaveCount(0);
    await expect(page.locator('#listpop')).toContainText('File → Load…');
    const listLabels = await page.locator('#listpop button').allInnerTexts();
    expect(listLabels.filter((label) => fileLabels.includes(label))).toEqual([]);
    expect(await seriousProblems(page, '#listpop')).toEqual([]);

    // the lists in it are buttons, the open one marked
    await expect(page.locator('#listrows .lrow[aria-current="true"]')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('a Pokémon list shows its pack in the list menu, with its own exports and Remove', async ({ page, errors }) => {
    await openPokemonList(page);
    await press(page.locator('#listbtn'));
    await expect(page.locator('#pkpack')).toBeVisible();
    await expect(page.locator('#packinfo')).toContainText('Pokémon');
    await expect(page.locator('#packdel')).toHaveAccessibleName('Remove the Pokémon pack');
    await expect(page.locator('#packdefexp')).toBeVisible();
    await expect(page.locator('#lsavepack')).toBeHidden(); // only lists of your own things become packs
    await expect(page.locator('#nopacks')).toBeHidden();
    expect(errors).toEqual([]);
});

test('a pack file opens with File → Load… and then shows under Packs', async ({ page, errors }) => {
    await listWithItems(page, ['Lighthouse']);
    const pack = {
        type: 'tierpack',
        format: 2,
        id: 'robots',
        name: 'Robots',
        noun: 'robots',
        items: [
            ['Boltz', [], []],
            ['Gearo', [], []],
        ],
    };
    await press(page.locator('#filebtn'));
    const chooser = page.waitForEvent('filechooser');
    await press(page.locator('#loadbtn'));
    await (await chooser).setFiles({ name: 'robots-pack.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
    await expect(page.locator('#cmsg')).toHaveText('Start a new Robots tier list now?');
    await page.click('#ccancel');

    await press(page.locator('#listbtn'));
    const row = page.locator('#gplist .gprow');
    await expect(row).toContainText('Robots');
    await expect(row).toContainText('2 robots');
    await expect(row.locator('[data-gpdel]')).toHaveAccessibleName('Remove the Robots pack');
    await expect(page.locator('#nopacks')).toBeHidden();
    expect(errors).toEqual([]);
});

test('the shortcuts open the same things as before', async ({ page, errors }) => {
    await listWithItems(page, ['Lighthouse']);
    await page.keyboard.press('l');
    await expect(page.locator('#listpop')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    await expect(page.locator('#exppanel')).toBeVisible();
    await page.keyboard.press('Escape');

    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await chooser;
    const download = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+s');
    expect((await download).suggestedFilename()).toMatch(/^my-tier-list_.+\.(json|zip)$/); // a .zip when it has pictures of its own
    expect(errors).toEqual([]);
});

test.describe('the Pool menu', () => {
    const checked = (page: Page) => page.locator('#poolmenu [aria-checked="true"]');

    test('puts the pool beside or below the tiers or hides it; B and P still do the same', async ({ page, errors }) => {
        await listWithItems(page, ['Lighthouse', 'Windmill']);
        const main = page.locator('#main');
        const pool = page.locator('#psec');
        const button = page.locator('#poolplacebtn');
        const beside = test.info().project.name !== 'phone'; // phones start with the pool below

        await press(button);
        await expect(page.locator('#poolmenu')).toBeVisible();
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(checked(page)).toHaveAttribute('data-choice', beside ? 'side' : 'below');
        expect(await seriousProblems(page, '#poolmenu')).toEqual([]);
        await press(page.locator(`#poolmenu [data-choice="${beside ? 'below' : 'side'}"]`));
        await expect(page.locator('#poolmenu')).toBeHidden();
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        if (beside) await expect(main).not.toHaveClass(/\bsb\b/);
        else await expect(main).toHaveClass(/\bsb\b/);

        await page.keyboard.press('b');
        if (beside) await expect(main).toHaveClass(/\bsb\b/);
        else await expect(main).not.toHaveClass(/\bsb\b/);
        await page.keyboard.press('p');
        await expect(pool).toHaveClass(/phid/);
        await page.keyboard.press('b'); // as before: B does nothing while the pool is hidden
        await press(button);
        await expect(checked(page)).toHaveAttribute('data-choice', 'hidden');
        await press(page.locator('#poolmenu [data-choice="side"]'));
        await expect(pool).not.toHaveClass(/phid/);
        await expect(main).toHaveClass(/\bsb\b/);

        // beside or below is saved with the list; hidden is remembered in this browser
        await press(button);
        await press(page.locator('#poolmenu [data-choice="below"]'));
        await page.reload();
        await page.waitForFunction(() => !!window.__app?.state.session.listId);
        await expect(main).not.toHaveClass(/\bsb\b/);
        await press(button);
        await press(page.locator('#poolmenu [data-choice="hidden"]'));
        await page.reload();
        await page.waitForFunction(() => !!window.__app?.state.session.listId);
        await expect(pool).toHaveClass(/phid/);
        expect(errors).toEqual([]);
    });

    test('works from the keyboard: arrows move, Enter chooses, Esc and Tab go back to the button', async ({ page, errors }) => {
        await listWithItems(page, ['Lighthouse']);
        const button = page.locator('#poolplacebtn');
        await button.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#poolmenu')).toBeVisible();
        await expect(checked(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#poolmenu')).toBeHidden();
        await expect(button).toBeFocused();

        await page.keyboard.press('Enter');
        await page.keyboard.press('End');
        await expect(page.locator('#poolmenu [data-choice="hidden"]')).toBeFocused();
        await page.keyboard.press('ArrowDown'); // round to the top
        await expect(page.locator('#poolmenu [data-choice="side"]')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#poolmenu')).toBeHidden();
        await expect(button).toBeFocused();

        await page.keyboard.press('Enter');
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await expect(page.locator('#psec')).toHaveClass(/phid/);
        await expect(button).toBeFocused();
        expect(errors).toEqual([]);
    });
});

test('a top bar layout saved before the Pool menu keeps the pool and Hide bar where the old group was', async ({ page, errors }) => {
    await openSite(page);
    const oldOrder = ['view', 'logo', 'list', 'file', 'tabs', 'size', 'labels', 'hover', 'undo', 'tier', 'stream', 'style', 'keys'];
    const saveOldLayout = (hide: string[]) =>
        page.evaluate(
            ([order, hide]) => localStorage.setItem('pt_bar', JSON.stringify({ order, hide, size: 'm', wrap: 'scroll' })),
            [oldOrder, hide],
        );
    const order = (key: string) => page.locator(`#toolbar [data-bar="${key}"]`).evaluate((group) => group.style.getPropertyValue('--o'));

    await saveOldLayout(['logo', 'stream']);
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
    expect([await order('pool'), await order('hidebar'), await order('logo')]).toEqual(['0', '1', '2']);
    await expect(page.locator('#poolplacebtn')).toBeVisible();
    await expect(page.locator('#hbbtn')).toBeVisible();

    // the old group hidden: both its parts stay hidden
    await saveOldLayout(['logo', 'stream', 'view']);
    await page.reload();
    await page.waitForFunction(() => !!window.__app?.state.session.listId);
    await expect(page.locator('#toolbar [data-bar="pool"]')).toHaveClass(/barhid/);
    await expect(page.locator('#toolbar [data-bar="hidebar"]')).toHaveClass(/barhid/);
    await page.keyboard.press('s');
    await expect(page.locator('#barlist .barrow[data-k="pool"] .bn')).toHaveText('Pool: beside, below or hidden');
    await expect(page.locator('#barlist .barrow[data-k="hidebar"] input')).not.toBeChecked();
    expect(errors).toEqual([]);
});

test.describe('at 1280 px wide', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test('the top bar fits without scrolling', async ({ page }) => {
        test.skip(test.info().project.name === 'phone', 'a desktop window size');
        await listWithItems(page, ['Lighthouse']);
        const { scrollWidth, clientWidth } = await page.locator('#toolbar').evaluate((bar) => ({
            scrollWidth: bar.scrollWidth,
            clientWidth: bar.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
});
