// Script injection through the app's own paths, on the preview server (so under the site's real security policy):
// names, tier labels, notes and tags typed in, a CSV file, a share link and a template link carrying markup all show
// as text and run nothing; and the policy itself refuses eval, inline scripts and inline handlers, reporting each one.
import type { Page } from '@playwright/test';
import { expect, openSite, rankItems, test } from './fixtures';
import { ATTACKS, expectNothingInjected, watchForInjection } from './injection';

const ownItemIds = (page: Page): Promise<number[]> =>
    page.evaluate(() => window.__app.state.state.ownItems.map((item: { id: number }) => item.id));

test('the watcher notices markup that gets through, so the tests here can fail', async ({ page, context }) => {
    const { probeRequests } = await watchForInjection(context);
    await openSite(page);
    await page.evaluate(() => {
        const probe = document.createElement('xss-probe');
        const picture = document.createElement('img');
        picture.src = '/xss-probe.png';
        probe.append(picture);
        document.body.append(probe);
    });
    await expect.poll(() => probeRequests.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __injected: string[] }).__injected)).toEqual(['<xss-probe >']);
});

test('names, tier labels, notes and tags typed into the app show as text and run nothing', async ({ page, context, errors }) => {
    const { probeRequests } = await watchForInjection(context);
    await openSite(page);
    await page.click('#startempty');

    // every attack becomes an item's name
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="txt"]');
    await page.fill('#addtxt', ATTACKS.join('\n'));
    await page.click('#addtxtgo');
    await expect(page.locator('#pgrid .pi')).toHaveCount(ATTACKS.length);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pgrid .pi .pname')).toHaveText(ATTACKS);

    // the list's name
    await page.click('#listbtn');
    await page.fill('#lname', ATTACKS[0]!);
    await page.press('#lname', 'Enter');
    await expect(page.locator('#listrows .lname')).toHaveText([ATTACKS[0]!]);
    await page.keyboard.press('Escape');

    // a tier's label and subtitle
    await page.locator('#tsec .tlbl').first().click();
    await page.fill('#edlbl', ATTACKS[2]!);
    await page.fill('#edsub', ATTACKS[3]!);
    await page.click('#edsave');
    await expect(page.locator('#tsec .tlbl-main').first()).toHaveText(ATTACKS[2]!);
    await expect(page.locator('#tsec .tlbl-sub').first()).toHaveText(ATTACKS[3]!);

    // an item's name, note and tag, in the item editor
    const [first] = await ownItemIds(page);
    await page.click(`#pgrid .pi[data-id="${first}"]`, { button: 'right' });
    await expect(page.locator('#ied')).toHaveClass(/show/);
    await page.fill('#iedname', ATTACKS[4]!);
    await page.press('#iedname', 'Enter');
    await page.fill('#iednote', ATTACKS[7]!);
    await page.fill('#iedtagin', '<b onclick=__xssRan=1>');
    await page.press('#iedtagin', 'Enter');
    await expect(page.locator('#iedtags .tchip')).toContainText(['<b onclick=__xssRan=1>']);
    await page.click('#ieddone');

    // ranked, the name shows in the tier and the note when it's hovered
    await rankItems(page, [first!]);
    const tile = page.locator(`#tsec .pi[data-id="${first}"]`);
    await expect(tile.locator('.pname')).toHaveText(ATTACKS[4]!);
    await tile.hover();
    await expect(page.locator('#tip .tipnote')).toHaveText(ATTACKS[7]!);

    expect(await page.evaluate(() => window.__app.state.state.notes)).toEqual({ [first!]: ATTACKS[7] });
    await expectNothingInjected(page, probeRequests);
    expect(errors).toEqual([]);
});

test('a CSV file and a share link carrying markup open as text', async ({ page, context, errors }) => {
    const { probeRequests } = await watchForInjection(context);
    await openSite(page);
    await page.click('#startempty');

    const csv = [
        'Tier,Position,Name,Picture',
        ...ATTACKS.map(
            (attack, index) => `"${attack.replaceAll('"', '""')}",1,"${index} ${attack.replaceAll('"', '""')}",javascript:__xssRan=1`,
        ),
    ];
    await page.click('#addbtn');
    await page.click('#addtabs [data-t="txt"]');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#addcsv');
    await (await chooser).setFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.join('\r\n')) });
    await expect(page.locator('#tsec .tlbl-main')).toContainText(ATTACKS);
    await expect(page.locator('#tsec .pi .pname')).toContainText(ATTACKS.map((attack, index) => `${index} ${attack}`));
    // a javascript: address is never a picture
    expect(
        await page.evaluate(() =>
            Object.values(window.__app.state.state.picks).filter((pick) => JSON.stringify(pick).includes('javascript:')),
        ),
    ).toEqual([]);
    await page.keyboard.press('Escape');

    const link = await page.evaluate(
        (attacks) =>
            window.__app.linkData.packForLink({
                listName: attacks[0],
                kind: 'custom',
                items: attacks.map((name: string, index: number) => ({ id: 2000000 + index, name })),
                nextId: 2000000 + attacks.length,
                tiers: attacks.map((label: string, index: number) => ({
                    label,
                    subtitle: attacks[(index + 1) % attacks.length],
                    color: '#ff7f7f',
                    items: [2000000 + index],
                })),
                notes: { 2000000: attacks[1] },
                tags: { 2000000: [attacks[2]] },
            }),
        ATTACKS,
    );
    await page.goto('/#l=' + link);
    await expect(page.locator('#sharebar')).toBeVisible();
    await page.waitForFunction(() => window.__app?.state.currentListMeta()?.preview);
    await expect(page.locator('#tsec .tlbl-main')).toHaveText(ATTACKS);
    await expect(page.locator('#tsec .pi .pname')).toHaveText(ATTACKS);
    await page.locator('#tsec .pi').first().hover();
    await expect(page.locator('#tip .tipnote')).toHaveText(ATTACKS[1]!);

    await expectNothingInjected(page, probeRequests);
    expect(errors).toEqual([]);
});

test('a template link and a template carrying markup run nothing', async ({ page, context, errors }) => {
    const { probeRequests } = await watchForInjection(context);
    const hostile = {
        format: 'tierinator-template',
        version: 1,
        id: 'probe-template',
        title: ATTACKS[0],
        category: ATTACKS[1],
        description: ATTACKS[2],
        items: ATTACKS.map((name) => ({ name })),
    };
    const catalogue = [
        { id: hostile.id, title: hostile.title, category: hostile.category, count: ATTACKS.length, description: hostile.description },
    ];
    await page.route('**/templates/index.json', (route) => route.fulfill({ json: catalogue }));
    await page.route('**/templates/probe-template.json', (route) => route.fulfill({ json: hostile }));

    // an id that is itself an attack is refused before anything is fetched
    await page.goto('/?template=' + encodeURIComponent(ATTACKS[0]!));
    await page.waitForFunction(() => !!window.__app?.state.session.listId, null, { timeout: 20_000 });
    await expect(page.locator('#toast')).toContainText('That template link is broken');

    // a real id whose template (as if a hostile one were merged) is all markup
    await page.goto('/?template=probe-template');
    await page.waitForFunction(() => window.__app?.state.state.ownItems?.length === 10, null, { timeout: 20_000 });
    await expect(page.locator('#pgrid .pi .pname')).toHaveText(ATTACKS);
    // its card in the gallery, found by searching for markup
    await page.click('#listbtn');
    await page.click('#ltpl');
    await page.fill('#tplq', ATTACKS[0]!);
    const card = page.locator('#tplgrid .tplcard:not([data-pack])');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(ATTACKS[0]!);
    await expect(card).toContainText(ATTACKS[2]!);

    await expectNothingInjected(page, probeRequests);
    expect(errors).toEqual([]);
});

test('the policy itself refuses eval, inline scripts and inline handlers, and reports each one', async ({ page, context }) => {
    await watchForInjection(context);
    await openSite(page);
    // The attempts run from a real click, not inside page.evaluate: the browser lets code run through the
    // automation channel use eval whatever the policy says, which would prove nothing.
    await page.evaluate(() => {
        const watch = window as unknown as {
            __violations: string[];
            __attempts?: Record<string, { threw: boolean; violations: string[] }>;
        };
        const attempt = async (run: () => unknown): Promise<{ threw: boolean; violations: string[] }> => {
            const before = watch.__violations.length;
            let threw = false;
            try {
                run();
            } catch {
                threw = true;
            }
            await new Promise((resolve) => setTimeout(resolve, 100)); // violation reports are queued
            return { threw, violations: watch.__violations.slice(before).map((violation) => violation.split(':')[0]!) };
        };
        const button = document.createElement('button');
        button.id = 'policy-probe';
        button.textContent = 'Try to run scripts';
        button.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
        button.addEventListener('click', async () => {
            watch.__attempts = {
                // biome-ignore lint/security/noGlobalEval: this test proves the policy refuses it
                eval: await attempt(() => eval('__xssRan = "eval"')),
                newFunction: await attempt(() => new Function('__xssRan = "new Function"')()),
                stringTimer: await attempt(() => setTimeout('__xssRan = "timer"' as unknown as () => void, 0)),
                inlineScript: await attempt(() => {
                    const script = document.createElement('script');
                    script.text = '__xssRan = "inline script"';
                    document.body.append(script);
                }),
                inlineHandler: await attempt(() => {
                    const picture = document.createElement('img');
                    picture.setAttribute('onerror', '__xssRan = "inline handler"');
                    picture.src = '/no-such-picture.png';
                    document.body.append(picture);
                }),
                javascriptLink: await attempt(() => {
                    const link = document.createElement('a');
                    link.setAttribute('href', 'javascript:__xssRan = "javascript link"');
                    document.body.append(link);
                    link.click();
                }),
            };
        });
        document.body.append(button);
    });
    await page.click('#policy-probe');
    await page.waitForFunction(() => !!(window as unknown as { __attempts?: unknown }).__attempts);
    await page.waitForTimeout(300); // the picture's error and the link's navigation, had either been allowed
    const outcomes = await page.evaluate(() => {
        const watch = window as unknown as { __xssRan?: unknown; __attempts: Record<string, { threw: boolean; violations: string[] }> };
        return { attempts: watch.__attempts, ran: watch.__xssRan ?? null };
    });
    expect(outcomes.ran).toBeNull();
    expect(Object.keys(outcomes.attempts)).toHaveLength(6);
    for (const [what, outcome] of Object.entries(outcomes.attempts)) {
        // each attempt was refused, and the browser reported it to the page
        expect(outcome.violations.length, `${what}: ${JSON.stringify(outcome)}`).toBeGreaterThan(0);
        for (const directive of outcome.violations) {
            expect(['script-src', 'script-src-elem', 'script-src-attr', 'require-trusted-types-for']).toContain(directive);
        }
    }
});
