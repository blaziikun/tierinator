// src/features/onboarding/onboarding.ts
// ─────────────────────────────────────────────────────────────────────────────
//  First visit: the tips window, once (after the start screen). Later: a gentle
//  reminder to back up, since lists live only in this browser (after two weeks with
//  15+ ranked, at most once a week). And the About & privacy window.
// ─────────────────────────────────────────────────────────────────────────────

import { stopSaving } from '../../core/persist';
import { session } from '../../core/state';
import { deleteEverything } from '../../core/storage';
import { byId, findById } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { ask, closePopovers } from '../../lib/ui';
import { backUpAllLists } from '../files/bundles';

const DAY_MS = 86_400_000;

/** A number kept in this browser (0 if missing). */
const readNumber = (key: string): number => Number(localStorage.getItem(key)) || 0;

export function showWelcomeOnce(): void {
    // the start screen comes first, and a shared list being previewed needs no tips
    if (!byId('start').classList.contains('hid') || !byId('sharebar').classList.contains('hid')) return;
    try {
        if (localStorage.getItem('pt_tips')) return;
        localStorage.setItem('pt_tips', '1');
    } catch {
        return;
    }
    byId('tipsm').classList.add('show');
}

export function nudgeBackup(): void {
    let lastBackup = 0;
    let firstSeen = 0;
    let snoozedUntil = 0;
    try {
        lastBackup = readNumber('pt_lastbackup');
        firstSeen = readNumber('pt_firstseen');
        snoozedUntil = readNumber('pt_nudgesnooze');
        if (!firstSeen) {
            firstSeen = Date.now();
            localStorage.setItem('pt_firstseen', String(firstSeen));
        }
    } catch {
        return;
    }
    const ranked = session.lists.reduce((total, list) => total + (list.count || 0), 0);
    const since = Date.now() - (lastBackup || firstSeen);
    if (ranked < 15 || since < 14 * DAY_MS || Date.now() < snoozedUntil || findById('nudge')) return;
    const days = Math.floor(since / DAY_MS);
    const nudge = document.createElement('div');
    nudge.id = 'nudge';
    setHtml(
        nudge,
        html`<span>${lastBackup ? `It's been ${days} days since your last backup.` : "You haven't backed up your lists yet."} They only live in this browser, so clearing site data would lose them.</span><button class="accent" id="nudgego">Back up all lists</button><button id="nudgelater">Remind me next week</button>`,
    );
    document.body.append(nudge);
    byId('nudgego').onclick = () => void backUpAllLists();
    byId('nudgelater').onclick = () => {
        try {
            localStorage.setItem('pt_nudgesnooze', String(Date.now() + 7 * DAY_MS));
        } catch {}
        nudge.remove();
    };
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupOnboarding(): void {
    byId('tipsok').onclick = () => byId('tipsm').classList.remove('show');
    byId('aboutbtn').addEventListener('click', closePopovers);
    byId('wipebtn').onclick = async () => {
        const question =
            'Delete every list, picture, theme and setting Tierinator has saved in this browser? This can’t be undone. Back up first (File → Back up all lists) if you might want them.';
        if (!(await ask(question, 'Delete everything', true))) return;
        stopSaving();
        await deleteEverything();
        location.reload();
    };
    for (const id of ['statsm', 'tipsm', 'aboutm'])
        byId(id).addEventListener('click', (e) => {
            if (e.target === e.currentTarget) byId(id).classList.remove('show');
        });
}
