// src/features/packs/packs.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Packs: everything the app knows about a franchise, as one file.
//
//    the Pokémon pack     every Pokémon, form and sprite folder (comes with the site)
//    other packs          any franchise (Bakugan, Beyblade…): items, tags, pictures
//
//  Installing (from the site, a file, or the pack builder), starting a list from a
//  pack, and saving your own list as a pack. Packs are checked by core/pack-format.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { OWN_ITEM_ID_START } from '../../core/defaults';
import { entryById, familyOf, isOwnItem } from '../../core/items';
import { readGenericPack, readPokemonPack } from '../../core/pack-format';
import { saveNow } from '../../core/persist';
import { addListMeta, currentListMeta, saveListIndex, spriteBlobs, state } from '../../core/state';
import { dbRequest, readAll, storage } from '../../core/storage';
import type { GenericPack, ItemId, OwnItem, PackPicture, PackRow, Pick, PokemonPack } from '../../core/types';
import { isRecord } from '../../lib/checks';
import { byId, downloadBlob, nextTick, todayIso } from '../../lib/dom';
import { blobToDataUrl } from '../../lib/images';
import { ask, askText, closePopovers, hideProgress, progress, showProgress, toast, updateProgress } from '../../lib/ui';
import { installPokemonPack, pokedex } from '../../pokemon/data';
import { sourceLabel, useTextTile } from '../items/items';
import { openList, renderListMenu } from '../lists/lists';

/** Installed packs other than Pokémon, by id. */
export const genericPacks = new Map<string, GenericPack>();

// ═════════════════════════════════════════════════════════════════════════════
//  INSTALLING
// ═════════════════════════════════════════════════════════════════════════════

const keepInBrowser = (key: string, pack: GenericPack | PokemonPack): Promise<unknown> =>
    dbRequest('readwrite', (store) => store.put(pack, key), storage.db, 'packs').catch(() =>
        toast('Pack loaded for this session (browser storage unavailable)'),
    );

/** Checks and installs a pack (kept in this browser unless `store` is false). False if it isn't a valid pack. */
export async function installPack(raw: unknown, { store = true } = {}): Promise<boolean> {
    const generic = readGenericPack(raw);
    if (generic) {
        genericPacks.set(generic.id, generic);
        if (store) await keepInBrowser('gp:' + generic.id, generic);
        return true;
    }
    const pokemon = readPokemonPack(raw);
    if (!pokemon) {
        toast('That is not a valid pack');
        return false;
    }
    installPokemonPack(pokemon);
    if (store) await keepInBrowser('pokemon', pokemon);
    return true;
}

/** At start-up: the packs kept in this browser (checked again, in case they're from an older version). */
export async function installStoredPacks(): Promise<void> {
    try {
        for (const [key, raw] of await readAll(storage.db, 'packs')) {
            if (key === 'pokemon') {
                const pack = readPokemonPack(raw);
                if (pack) installPokemonPack(pack);
            } else if (String(key).startsWith('gp:')) {
                const pack = readGenericPack(raw);
                if (pack) genericPacks.set(pack.id, pack);
            }
        }
    } catch {}
}

const fetchJson = async (path: string): Promise<unknown> => {
    const response = await fetch(path, { cache: 'no-cache' });
    return response.ok ? response.json() : null;
};

/** The site's own Pokémon pack, if none is installed yet. */
export async function installPokemonPackIfAvailable(): Promise<boolean> {
    if (pokedex.pack) return true;
    try {
        const pack = await fetchJson('/packs/pokemon.json');
        return pack != null && (await installPack(pack));
    } catch {
        return false;
    }
}

/** Keeps an installed Pokémon pack up to date with the site's copy (nothing is installed unasked). */
export async function updatePokemonPack(): Promise<void> {
    if (!pokedex.pack) return;
    try {
        const pokemon = await fetchJson('/packs/pokemon.json');
        if (isRecord(pokemon) && pokedex.pack.version !== pokemon.version) await installPack(pokemon);
    } catch {}
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICTURES
// ═════════════════════════════════════════════════════════════════════════════

/** A pack picture's address: full addresses as they are, file names on the pack's own image server. */
export const packImageUrl = (pack: GenericPack, src: string): string =>
    /^(data:|https:)/.test(src) ? src : (pack.base || '') + src + (pack.thumb || '');

/** The pack row an item came from ("packId:row"), or null. */
export function packRowFor(item: { pk?: string }): { pack: GenericPack; row: PackRow } | null {
    if (!item.pk) return null;
    const [packId = '', index] = item.pk.split(':');
    const pack = genericPacks.get(packId);
    const row = pack?.items[Number(index)];
    return pack && row ? { pack, row } : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  A LIST FROM A PACK
// ═════════════════════════════════════════════════════════════════════════════

/** A new list with every item of a pack (pictures download as the list opens). */
export async function createListFromPack(packId: string): Promise<void> {
    const pack = genericPacks.get(packId);
    if (!pack) return;
    saveNow();
    const list = addListMeta(pack.name + ' tier list', 'custom');
    list.pack = packId;
    saveListIndex();
    const items: OwnItem[] = [];
    const tags: Record<string, string[]> = {};
    const picks: Record<string, Pick> = {};
    const families: Record<string, ItemId> = {};
    pack.items.forEach(([name, rowTags, pictures, wikiTitle, variantOf], index) => {
        const id = OWN_ITEM_ID_START + index;
        if (variantOf != null) families[id] = OWN_ITEM_ID_START + variantOf;
        items.push({
            id,
            name,
            pk: packId + ':' + index,
            ...(wikiTitle && pack.source?.api ? { w: { a: pack.source.api, t: wikiTitle } } : {}),
        });
        if (rowTags.length) tags[id] = rowTags;
        if (pictures[0]) picks[id] = { path: packImageUrl(pack, pictures[0][1]), ck: 1 };
    });
    try {
        // the stored list format (core/snapshot.ts)
        const stored = {
            kind: 'custom',
            pack: packId,
            listName: list.name,
            items,
            nextId: OWN_ITEM_ID_START + pack.items.length,
            tags,
            picks,
            fam: families,
            famM: {},
        };
        localStorage.setItem('ptl_' + list.id, JSON.stringify(stored));
    } catch {
        return toast('Browser storage is full');
    }
    closePopovers();
    await openList(list.id);
    for (const item of state.ownItems) if (!state.picks[item.id]) await useTextTile(item.id);
    toast(
        `New ${pack.name} list with ${items.length} ${pack.noun || 'items'}. Pictures download in the background; right-click any of them to choose another picture`,
        6000,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAKING PACKS
// ═════════════════════════════════════════════════════════════════════════════

/** "Ben 10 aliens" → "ben-10-aliens". */
const packIdFor = (name: string): string =>
    name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'pack';

/** Save as pack: every item of your list with its tags and pictures (the ones you added are built in). */
async function saveListAsPack(): Promise<void> {
    closePopovers();
    if (!state.ownItems.length) return toast('Nothing to pack yet');
    const name = (
        await askText(
            'Name for the pack (e.g. Bakugan, Beyblade, Ben 10 aliens)',
            currentListMeta()?.name?.replace(/ tier list$/i, '') || 'My pack',
        )
    )?.trim();
    if (!name) return;
    showProgress('Building pack…', true);
    const id = packIdFor(name);
    const rows: PackRow[] = [];
    for (const [index, item] of state.ownItems.entries()) {
        if (progress.cancelled) return hideProgress();
        const pick = state.picks[item.id];
        const pictures: PackPicture[] = [];
        const add = (picture: PackPicture) => {
            if (!pictures.some((other) => other[1] === picture[1])) pictures.push(picture);
        };
        // group 0 "Your pick", group 1 "Pictures"
        if (pick && /^https:/.test(pick.path)) add([0, pick.path, '']);
        else {
            const blob = spriteBlobs.get(item.id);
            if (blob && !pick?.text) add([0, await blobToDataUrl(blob), '']);
        }
        const packRow = packRowFor(item);
        for (const [, src, label] of packRow?.row[2] || []) add([1, packImageUrl(packRow!.pack, src), label || '']);
        for (const address of item.alts || []) add([1, address, sourceLabel(address)]);
        rows.push([item.name, state.tags[item.id] || [], pictures, item.w?.t]);
        if ((index + 1) % 25 === 0) {
            updateProgress(`${index + 1} / ${state.ownItems.length}`, ((index + 1) / state.ownItems.length) * 100);
            await nextTick();
        }
    }
    // variants point at their main item's row
    const rowOf = new Map(state.ownItems.map((item, index) => [item.id, index]));
    rows.forEach((row, index) => {
        const base = familyOf(state.ownItems[index]!.id);
        if (base != null && rowOf.has(base)) row[4] = rowOf.get(base);
    });
    const wiki = state.ownItems.find((item) => item.w)?.w;
    const fromPack = state.packId ? genericPacks.get(state.packId) : undefined;
    const pack: GenericPack = {
        type: 'tierpack',
        format: 2,
        id,
        name,
        noun: fromPack?.noun || 'items',
        version: todayIso(),
        about: `${name} pack made with Tierinator from “${currentListMeta()?.name || ''}”.`,
        ...(wiki ? { source: { api: wiki.a } } : {}),
        ...(fromPack?.facets ? { facets: fromPack.facets } : {}),
        groups: ['Your pick', 'Pictures'],
        items: rows,
    };
    hideProgress();
    downloadBlob(new Blob([JSON.stringify(pack)], { type: 'application/json' }), `${id}-pack.json`);
    toast(`Saved ${id}-pack.json with ${rows.length} items. Open it anywhere with File → Load…`, 5000);
}

/** The Pokémon pack with your picked sprites as everyone's defaults (new lists made from it start with them). */
async function exportPokemonPackWithDefaults(): Promise<void> {
    closePopovers();
    let pack: PokemonPack | null = null;
    try {
        pack = readPokemonPack(await dbRequest('readonly', (store) => store.get('pokemon'), storage.db, 'packs'));
    } catch {}
    if (!pack) return toast("The Pokémon pack isn't loaded. Reload the page and try again.");
    showProgress('Building pack with your sprites…');
    const defaults: NonNullable<PokemonPack['defaults']> = {};
    const ids = Object.keys(state.picks)
        .map(Number)
        .filter((id) => !isOwnItem(id) && entryById.has(id));
    for (const [index, id] of ids.entries()) {
        const pick = state.picks[id]!;
        if (/^(custom|gal:)/.test(pick.path)) {
            const blob = spriteBlobs.get(id);
            if (blob) defaults[id] = { img: await blobToDataUrl(blob), ...(pick.crop ? { crop: pick.crop } : {}) };
        } else defaults[id] = { path: pick.path };
        if ((index + 1) % 50 === 0) {
            updateProgress(`${index + 1} / ${ids.length}`, ((index + 1) / ids.length) * 100);
            await nextTick();
        }
    }
    const withDefaults: PokemonPack = {
        ...pack,
        version: todayIso(),
        by: state.theme.name || '',
        defaults,
        favs: state.favouriteSprites,
        about: (pack.about || '') + ' Default sprites chosen in “' + (currentListMeta()?.name || '') + '”.',
    };
    hideProgress();
    downloadBlob(new Blob([JSON.stringify(withDefaults)], { type: 'application/json' }), 'pokemon-pack.json');
    toast(`Pack saved with ${Object.keys(defaults).length} default sprites. New Pokémon lists made from it start with your picks`, 4500);
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupPacks(): void {
    // packs are opened like any other file (File → Load…); this notice is the one place that asks for one directly
    byId('needpackup').onclick = () => byId('loadinp').click();
    byId('gplist').addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const newList = target.closest<HTMLElement>('[data-gpnew]')?.dataset.gpnew;
        const remove = target.closest<HTMLElement>('[data-gpdel]')?.dataset.gpdel;
        if (newList) await createListFromPack(newList);
        const pack = remove ? genericPacks.get(remove) : undefined;
        if (!pack) return;
        if (
            !(await ask(
                `Remove the ${pack.name} pack from this browser? Lists made from it stay, but lose their extra picture choices until you add the pack again.`,
                'Remove',
                true,
            ))
        )
            return;
        genericPacks.delete(pack.id);
        await dbRequest('readwrite', (store) => store.delete('gp:' + pack.id), storage.db, 'packs').catch(() => {});
        renderListMenu();
        toast('Pack removed');
    });
    byId('lsavepack').onclick = () => void saveListAsPack();
    byId('packdefexp').onclick = () => void exportPokemonPackWithDefaults();
    byId('packdel').onclick = async () => {
        if (
            !(await ask(
                'Remove the Pokémon pack from this browser? Your Pokémon lists stay saved and open again when you re-upload it.',
                'Remove',
                true,
            ))
        )
            return;
        await dbRequest('readwrite', (store) => store.delete('pokemon'), storage.db, 'packs').catch(() => {});
        location.reload();
    };
}
