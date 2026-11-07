// src/features/keyboard/keyboard.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Keyboard shortcuts (? shows them all). Keys go to the first layer that wants
//  them: an open window (quick rank, head to head, editors…) before the screen
//  behind it, so the same key can mean different things in different places.
// ─────────────────────────────────────────────────────────────────────────────
import { undo } from '../../core/history';
import { isPokemonList, state } from '../../core/state';
import { byId } from '../../lib/dom';
import { closePopovers, toast } from '../../lib/ui';
import { openAddItems } from '../add-items/add-items';
import { closeAppearance } from '../appearance/panel';
import { downloadListFile } from '../files/files';
import { clearFind, finder, openFind } from '../find/find';
import { closeItemEditor, itemEditor, stepItemEditor } from '../items/item-editor';
import { switchPoolSide, switchView, togglePool, toggleTopBar } from '../layout/layout';
import { closeQuickPicker, quickPicker, stepQuickPicker } from '../quick-picker/quick-picker';
import { placeQuickRankItem, quickRankBack, startQuickRank } from '../quick-rank/quick-rank';
import { customStudio, stepCustomStudio } from '../studio/custom-studio';
import { nextUnpicked, stepPokemon, studio } from '../studio/studio';
import { clearSelection, moveSelectionTo, selectAllIn } from '../tier-board/board';
import { pointer } from '../tier-board/drag';
import { hideTip } from '../tier-board/hover-tip';

/** A layer gets each key first-come; true = handled (later layers don't see it). */
type KeyLayer = (e: KeyboardEvent, typing: boolean) => boolean;

const isOpen = (id: string): boolean => byId(id).classList.contains('show');
const close = (id: string): true => {
    byId(id).classList.remove('show');
    return true;
};
const click = (id: string): true => {
    byId(id).click();
    return true;
};
const withModifier = (e: KeyboardEvent): boolean => e.metaKey || e.ctrlKey;

/** ← / → step through something. */
function arrows(e: KeyboardEvent, step: (direction: number) => void): boolean {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1);
    return true;
}

// ── windows on top ──
const shortcutsWindow: KeyLayer = (e) => e.key === 'Escape' && isOpen('keysm') && close('keysm');

const quickRankWindow: KeyLayer = (e) => {
    if (!isOpen('qr') || withModifier(e)) return false;
    const key = e.key;
    if (/^[1-9]$/.test(key)) {
        const tier = state.tiers[Number(key) - 1];
        if (tier) placeQuickRankItem(tier.id);
    } else if (key === 'ArrowRight' || key.toLowerCase() === 's') click('qrskip');
    else if (key === 'ArrowLeft' || key === 'Backspace') quickRankBack();
    else if (key === 'Escape') click('qrx');
    e.preventDefault();
    return true;
};

const headToHeadWindow: KeyLayer = (e) => {
    if (!isOpen('h2h') || withModifier(e)) return false;
    const button = { ArrowLeft: 'h2ha', ArrowRight: 'h2hb', '=': 'h2heq', Escape: 'h2hx' }[e.key];
    if (button) click(button);
    e.preventDefault();
    return true;
};

/** Escape closes the pack builder, unless one of its own questions or progress is showing. */
const packBuilderWindow: KeyLayer = (e) => {
    if (e.key !== 'Escape' || !isOpen('pbm')) return false;
    if (!isOpen('progmod') && !isOpen('cconf')) close('pbm');
    return true;
};

const simpleWindows: KeyLayer = (e) => e.key === 'Escape' && ['statsm', 'tipsm', 'aboutm'].some((id) => isOpen(id) && close(id));

const itemEditorWindow: KeyLayer = (e, typing) => {
    if (!itemEditor.id) return false;
    if (e.key === 'Escape') {
        closeItemEditor();
        return true;
    }
    return !typing && arrows(e, stepItemEditor);
};

const addItemsWindow: KeyLayer = (e) => e.key === 'Escape' && isOpen('addm') && close('addm');

/** Escape, from the most specific thing open to the least. */
const escapeKey: KeyLayer = (e) => {
    if (e.key !== 'Escape') return false;
    if (quickPicker.id) closeQuickPicker();
    else if (byId('appear').classList.contains('open')) closeAppearance();
    else if (finder.open && !state.searchQuery) clearFind();
    else if (state.topBarHidden && state.view === 'tier') toggleTopBar(false, true);
    else {
        closePopovers();
        clearSelection();
        hideTip();
    }
    return true;
};

const quickPickerWindow: KeyLayer = (e, typing) => {
    if (!quickPicker.id || typing) return false;
    arrows(e, stepQuickPicker);
    return true;
};

// ── Ctrl/⌘ shortcuts ──
const fileShortcuts: KeyLayer = (e, typing) => {
    if (typing || !withModifier(e) || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key === 's') downloadListFile();
    else if (key === 'o') click('loadinp');
    else return false;
    e.preventDefault();
    return true;
};

const editShortcuts: KeyLayer = (e, typing) => {
    if (typing || !withModifier(e) || state.view !== 'tier' || quickPicker.id) return false;
    const key = e.key.toLowerCase();
    if (key === 'z') undo(e.shiftKey);
    else if (key === 'y') undo(true);
    else if (key === 'a') selectAllIn(pointer.area);
    else return false;
    e.preventDefault();
    return true;
};

// ── single keys ──
const singleKeys: KeyLayer = (e, typing) => {
    if (typing || withModifier(e) || e.altKey) return false;
    if (document.querySelector('.modal.show') || byId('ted').classList.contains('open')) return true;
    const key = e.key.toLowerCase();
    const everywhere: Record<string, () => void> = {
        '?': () => byId('keysm').classList.add('show'),
        s: () => click('stylebtn'),
        l: () => {
            closePopovers();
            click('listbtn');
        },
        e: () => {
            closePopovers();
            click('expbtn');
        },
        i: () => click('statsbtn'), // stats load on first use
        t: () => switchView(state.view === 'tier' ? 'studio' : 'tier'),
    };
    if (key === 'q' && state.view === 'tier') startQuickRank();
    else if (key === 'v' && state.view === 'tier') click('streambtn');
    else if (everywhere[key]) everywhere[key]();
    else if (state.view === 'tier') tierListKeys(e, key);
    else if (state.view === 'studio') studioKeys(e);
    return true;
};

function tierListKeys(e: KeyboardEvent, key: string): void {
    if (key === 'h') toggleTopBar();
    else if (key === 'p') togglePool();
    else if (key === 'a') {
        e.preventDefault();
        openAddItems('up');
    } else if (key === 'b' && !state.poolHidden) switchPoolSide();
    else if (key === '/' || key === 'f') {
        e.preventDefault();
        if (state.poolHidden) openFind();
        else byId<HTMLInputElement>('psearch').select();
    } else if (/^[1-9]$/.test(key) && state.selection.size) {
        const tier = state.tiers[Number(key) - 1];
        if (tier) {
            moveSelectionTo(tier.id);
            toast(`Moved to ${tier.label}`);
        }
    } else if ((key === '0' || e.key === 'Delete' || e.key === 'Backspace') && state.selection.size) {
        e.preventDefault();
        click('seltopool');
    }
}

function studioKeys(e: KeyboardEvent): void {
    if (!isPokemonList()) {
        if (customStudio.mode === 'pick') arrows(e, stepCustomStudio);
        return;
    }
    if (studio.mode !== 'pokemon') return;
    if (e.key.toLowerCase() === 'n') nextUnpicked();
    else arrows(e, stepPokemon);
}

const LAYERS: KeyLayer[] = [
    shortcutsWindow,
    quickRankWindow,
    headToHeadWindow,
    packBuilderWindow,
    simpleWindows,
    itemEditorWindow,
    addItemsWindow,
    escapeKey,
    quickPickerWindow,
    fileShortcuts,
    editShortcuts,
    singleKeys,
];

// ── wiring (runs once at start-up, from main.ts) ──
export function setupKeyboard(): void {
    byId('keysbtn').onclick = () => byId('keysm').classList.add('show');
    document.addEventListener('keydown', (e) => {
        const typing = e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
        LAYERS.some((layer) => layer(e, typing));
    });
}
