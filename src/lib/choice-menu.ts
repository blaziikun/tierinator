// src/lib/choice-menu.ts
// ─────────────────────────────────────────────────────────────────────────────
//  A button that opens a short menu of choices with one of them current (where
//  the pool goes, the pool's order). The items are radio items, so screen readers
//  say which is chosen; ↑ ↓ move, Enter or Space chooses, Esc closes.
// ─────────────────────────────────────────────────────────────────────────────
import { byId } from './dom';
import { closePopovers, onPopoversClose, placePopover } from './ui';

export interface ChoiceMenu {
    /** The button that opens it (aria-haspopup="menu" in the markup). */
    buttonId: string;
    /** The menu: a .pop.menu of buttons with role="menuitemradio" and data-choice. */
    menuId: string;
    /** The choice in use now, marked when the menu opens. */
    current: () => string;
    choose: (choice: string) => void;
}

const itemsOf = (menu: HTMLElement): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].filter((item) => item.offsetParent !== null);

/** Marks the current choice. */
function markChoice(menuId: string, choice: string): void {
    for (const item of byId(menuId).querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
        item.setAttribute('aria-checked', String(item.dataset.choice === choice));
}

export function setupChoiceMenu({ buttonId, menuId, current, choose }: ChoiceMenu): void {
    const button = byId(buttonId);
    const menu = byId(menuId);
    onPopoversClose(() => button.setAttribute('aria-expanded', 'false'));
    button.addEventListener('click', () => {
        const wasOpen = menu.classList.contains('open');
        closePopovers();
        if (wasOpen) return;
        markChoice(menuId, current());
        placePopover(menu, button);
        button.setAttribute('aria-expanded', 'true');
        (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? itemsOf(menu)[0])?.focus();
    });
    menu.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest<HTMLElement>('[data-choice]');
        if (!item) return;
        closePopovers();
        button.focus();
        choose(item.dataset.choice!);
    });
    menu.addEventListener('keydown', (e) => {
        const items = itemsOf(menu);
        const at = items.indexOf(document.activeElement as HTMLElement);
        const moveTo = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
        if (moveTo != null) items[(moveTo + items.length) % items.length]?.focus();
        else if (e.key === 'Escape' || e.key === 'Tab') {
            // back to the button: the menu sits at the end of the page, so Tab from it would land somewhere unrelated
            closePopovers();
            button.focus();
        } else return;
        e.preventDefault();
        e.stopPropagation(); // the app's own shortcuts mustn't act on the same key
    });
}
