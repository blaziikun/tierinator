// src/lib/ui.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The app's shared little windows: toast messages, the confirm / choice / text
//  question box (#cconf), the progress window (#progmod) and pop-up menus (.pop).
//  Features never build their own versions of these.
// ─────────────────────────────────────────────────────────────────────────────
import { byId } from './dom';

// ── toast: a short message at the bottom, sometimes with one button (Undo) ──
interface ToastAction {
    label: string;
    title?: string;
    run: () => void;
    /** Where focus goes if it's on the button when the toast goes away (else it would be lost). */
    refocus?: () => HTMLElement | null;
}

const toastTimer = { id: undefined as ReturnType<typeof setTimeout> | undefined, endsAt: 0, held: false };
let toastAction: ToastAction | null = null;

function hideToast(): void {
    clearTimeout(toastTimer.id);
    const element = byId('toast');
    const hadFocus = element.contains(document.activeElement);
    element.classList.remove('show');
    if (hadFocus) toastAction?.refocus?.()?.focus();
    toastAction = null;
}

const startToastTimer = (durationMs: number): void => {
    clearTimeout(toastTimer.id);
    toastTimer.endsAt = Date.now() + durationMs;
    toastTimer.id = setTimeout(hideToast, durationMs);
};

/** Shows a message for a moment. */
export function toast(message: string, durationMs = 2600): void {
    showToast(message, durationMs, null);
}

/** Shows a message with a button (Undo); returns the button, so a keyboard user's focus can be moved to it. */
export const toastWithAction = (message: string, durationMs: number, action: ToastAction): HTMLButtonElement =>
    showToast(message, durationMs, action)!;

function showToast(message: string, durationMs: number, action: ToastAction | null): HTMLButtonElement | null {
    const element = byId('toast');
    element.textContent = message;
    toastAction = action;
    toastTimer.held = false;
    let button: HTMLButtonElement | null = null;
    if (action) {
        button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        if (action.title) button.title = action.title;
        button.onclick = () => {
            hideToast();
            action.run();
        };
        element.append(button);
    }
    element.classList.toggle('acts', !!action);
    element.classList.add('show');
    startToastTimer(durationMs);
    return button;
}

/** A toast with a button waits while the pointer or focus is on it, then gives a little time to read on. */
function holdToast(held: boolean): void {
    if (!toastAction || held === toastTimer.held) return;
    toastTimer.held = held;
    if (held) clearTimeout(toastTimer.id);
    else startToastTimer(Math.max(2500, toastTimer.endsAt - Date.now()));
}

// ── questions ──
let answer: ((ok: boolean) => void) | null = null;

function settle(ok: boolean): void {
    byId('cconf').classList.remove('show');
    answer?.(ok);
    answer = null;
}

/** Asks a yes/no question. Resolves true for the main button. */
export function ask(message: string, okLabel = 'OK', danger = false, cancelLabel = 'Cancel'): Promise<boolean> {
    byId('cinp').classList.add('hid');
    return new Promise((resolve) => {
        answer = resolve;
        byId('cmsg').textContent = message;
        byId('cok').textContent = okLabel;
        byId('ccancel').textContent = cancelLabel;
        byId('cok').className = danger ? 'danger' : 'accent';
        byId('cconf').classList.add('show');
    });
}

/** Asks with a third option. Resolves 'ok', 'alt', or null for Cancel. */
export function askChoice(message: string, okLabel: string, altLabel: string): Promise<'ok' | 'alt' | null> {
    const asked = ask(message, okLabel);
    const alt = byId<HTMLButtonElement>('calt');
    alt.textContent = altLabel;
    alt.classList.remove('hid');
    return new Promise((resolve) => {
        let done = false;
        alt.onclick = () => {
            if (done) return;
            done = true;
            byId('cconf').classList.remove('show');
            alt.classList.add('hid');
            answer = null;
            resolve('alt');
        };
        void asked.then((ok) => {
            if (done) return;
            done = true;
            alt.classList.add('hid');
            resolve(ok ? 'ok' : null);
        });
    });
}

/** Asks for a line of text. Resolves null for Cancel. */
export async function askText(message: string, initial = ''): Promise<string | null> {
    const asked = ask(message, 'OK');
    const input = byId<HTMLInputElement>('cinp');
    input.classList.remove('hid');
    input.value = initial;
    setTimeout(() => {
        input.focus();
        input.select();
    }, 30);
    const ok = await asked;
    input.classList.add('hid');
    return ok ? input.value : null;
}

// ── progress window ──
/** `cancelled` turns true when the person presses Cancel; long loops check it. */
export const progress = { cancelled: false };

export function showProgress(title: string, cancellable = false): void {
    progress.cancelled = false;
    byId('progtitle').textContent = title;
    byId('progtxt').textContent = '';
    byId('progfill').style.width = '0%';
    byId('progcancel').classList.toggle('hid', !cancellable);
    byId('progmod').classList.add('show');
}

/** Updates the progress text and, if given, the bar (0–100). */
export function updateProgress(message: string, percent?: number | null): void {
    byId('progtxt').textContent = message;
    if (percent != null) byId('progfill').style.width = Math.min(100, percent) + '%';
}

export const hideProgress = (): void => byId('progmod').classList.remove('show');

/** Runs `work` on every item, `limit` at a time; stops early when the person cancels. */
export async function forEachLimited<T>(
    items: readonly T[],
    limit: number,
    work: (item: T) => Promise<void>,
    onEach?: (doneCount: number) => void,
): Promise<void> {
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < items.length) {
            if (progress.cancelled) return;
            await work(items[next++]!);
            onEach?.(++done);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ── pop-up menus ──
const closeHooks: (() => void)[] = [];

/** Something to do whenever pop-ups close (e.g. the tier editor undoing an unsaved preview). */
export function onPopoversClose(hook: () => void): void {
    closeHooks.push(hook);
}

/** Opens a pop-up under `anchor`, kept inside the window. */
export function placePopover(popover: HTMLElement, anchor: Element): void {
    const box = anchor.getBoundingClientRect();
    popover.classList.add('open');
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    popover.style.left = Math.max(8, Math.min(box.left, innerWidth - width - 8)) + 'px';
    popover.style.top = Math.max(8, Math.min(box.bottom + 6, innerHeight - height - 8)) + 'px';
    byId('ov').classList.add('show');
}

export function closePopovers(): void {
    closeHooks.forEach((hook) => {
        hook();
    });
    document.querySelectorAll('.pop').forEach((p) => {
        p.classList.remove('open');
    });
    byId('ov').classList.remove('show');
}

/** A visible element to hang a menu from when it's opened with the keyboard. */
export const popoverAnchor = (...ids: string[]): HTMLElement => {
    for (const id of ids) {
        const element = byId(id);
        if (element.offsetParent) return element;
    }
    return byId('toolbar');
};

// ── wiring (runs once at start-up, from main.ts) ──
export function setupUi(): void {
    // declarative buttons in templates: data-close="modalId", data-open="modalId", data-click="buttonId"
    document.addEventListener('click', (e) => {
        const element = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-close],[data-open],[data-click]') : null;
        if (!element) return;
        if (element.tagName === 'A') e.preventDefault();
        if (element.dataset.close) byId(element.dataset.close).classList.remove('show');
        if (element.dataset.open) byId(element.dataset.open).classList.add('show');
        if (element.dataset.click) byId(element.dataset.click).click();
    });
    byId('cinp').onkeydown = (e) => {
        if (e.key === 'Enter') byId('cok').click();
    };
    byId('cok').onclick = () => settle(true);
    byId('ccancel').onclick = () => settle(false);
    byId('progcancel').onclick = () => {
        progress.cancelled = true;
        updateProgress('Cancelling…');
    };
    byId('ov').onclick = closePopovers;
    const toastElement = byId('toast');
    toastElement.addEventListener('pointerenter', () => holdToast(true));
    toastElement.addEventListener('pointerleave', () => holdToast(toastElement.contains(document.activeElement)));
    toastElement.addEventListener('focusin', () => holdToast(true));
    toastElement.addEventListener('focusout', () => holdToast(toastElement.matches(':hover')));
}
