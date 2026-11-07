// src/features/files/files.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The File menu: save the open list, back up every list, and load any file the
//  app understands (a list, a backup, a pack, a list-with-pictures zip, a sprite
//  pack or a pokemon.zip). Every file is treated as untrusted: size-limited,
//  parsed carefully, and checked again when it's opened.
// ─────────────────────────────────────────────────────────────────────────────
import { isOwnItem } from '../../core/items';
import { readGenericPack, readPokemonPack } from '../../core/pack-format';
import { saveNow, toSnapshot } from '../../core/persist';
import { session, spriteBlobs, state } from '../../core/state';
import type { GenericPack, PokemonPack } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId, downloadBlob, todayIso } from '../../lib/dom';
import { ask, closePopovers, hideProgress, placePopover, showProgress, toast } from '../../lib/ui';
import { fileStem } from '../export/layout';
import { nameFromFile } from '../items/items';
import { createList, openList, renderListMenu } from '../lists/lists';
import { createListFromPack, installPack } from '../packs/packs';
import { backUpAllLists, exportListBundle, importList, MAX_BACKUP_BYTES, restoreBackup } from './bundles';
import { openZip } from './sprite-packs';

/** Largest .json the app opens (a list with thousands of items is well under 10 MB). */
export const MAX_JSON_BYTES = 50 * 1024 * 1024;

/** Saves the open list as a .json file (or a .zip with its pictures, if it has uploaded ones). */
export function downloadListFile(): void {
    if (state.ownItems.length && [...spriteBlobs.keys()].some(isOwnItem)) {
        void exportListBundle();
        return;
    }
    saveNow();
    downloadBlob(new Blob([JSON.stringify(toSnapshot(), null, 1)], { type: 'application/json' }), `${fileStem()}_${todayIso()}.json`);
    toast(
        Object.keys(state.picks).length
            ? 'Saved. Picked sprites come back from their source; for offline or your own pictures, export a sprite pack too'
            : 'Saved',
    );
}

/** Installs a pack; false if it couldn't be (the pack explains why). */
async function install(pack: PokemonPack | GenericPack): Promise<boolean> {
    showProgress('Installing pack…');
    const installed = await installPack(pack);
    hideProgress();
    return !!installed;
}

/** A pack of anything (Bakugan, Beyblade…): install it, then offer a list. */
async function installGenericPackFile(pack: GenericPack): Promise<void> {
    if (!(await install(pack))) return;
    renderListMenu();
    toast(`${pack.name} pack installed: ${pack.items.length} ${pack.noun || 'items'}`, 3500);
    if (await ask(`Start a new ${pack.name} tier list now?`, 'New ' + pack.name + ' list', false, 'Not now'))
        await createListFromPack(pack.id);
}

/** The Pokémon pack: install it, then reopen the list that was waiting for it (or offer one). */
async function installPokemonPackFile(pack: PokemonPack): Promise<void> {
    if (!(await install(pack))) return;
    toast(`${pack.name} pack installed: ${pack.roster.length} Pokémon`, 3500);
    if (session.needsPack) {
        if (session.listId) await openList(session.listId);
        return;
    }
    renderListMenu();
    const hasPokemonList = session.lists.some((list) => list.kind === 'pokemon');
    if (
        !hasPokemonList &&
        (await ask(
            'Pack installed. Start a new Pokémon tier list now? Or open your saved list file with File → Load…',
            'New Pokémon list',
            false,
            'Not now',
        ))
    )
        await createList('pokemon');
}

/** Opens any file the app understands. */
export async function openFile(file: File): Promise<void> {
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) return openZip(file);
    // a backup may be bigger than anything else, so the type decides the cap once it's read
    if (file.size > MAX_BACKUP_BYTES) return toast('That file is too big to open (over 200 MB)');
    let parsed: unknown;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        return toast('That file is not JSON');
    }
    if (!isRecord(parsed)) return toast('That file is not a tier list or pack');
    if (file.size > MAX_JSON_BYTES && parsed.type !== 'backup') return toast('That file is too big to be a tier list or pack (over 50 MB)');
    const genericPack = readGenericPack(parsed);
    if (genericPack) return installGenericPackFile(genericPack);
    if (parsed.type === 'backup') return restoreBackup(parsed);
    if (parsed.type === 'tierpack' && parsed.id === 'pokemon') {
        const pokemonPack = readPokemonPack(parsed);
        return pokemonPack ? installPokemonPackFile(pokemonPack) : toast('That Pokémon pack is damaged');
    }
    if (Array.isArray(parsed.tiers)) return importList(parsed, nameFromFile(file));
    toast('That file is not a tier list or pack');
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupFiles(): void {
    byId('filebtn').onclick = (e) => {
        const wasOpen = byId('filepop').classList.contains('open');
        closePopovers();
        if (!wasOpen) placePopover(byId('filepop'), e.currentTarget as Element);
    };
    byId('savebtn').onclick = () => {
        closePopovers();
        downloadListFile();
    };
    byId('backupbtn').onclick = () => {
        closePopovers();
        void backUpAllLists();
    };
    byId('loadbtn').onclick = () => {
        closePopovers();
        byId('loadinp').click();
    };
    const input = byId<HTMLInputElement>('loadinp');
    input.onchange = () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) void openFile(file);
    };
}
