// src/features/studio/studio.ts
// ─────────────────────────────────────────────────────────────────────────────
//  The Sprite Studio (Pokémon lists): browse and pick each Pokémon's sprite.
//
//    list        the Pokémon list on the left, with search / generation / picked filters
//    views       One Pokémon (every version), My sprites (all picks), By Style (one game for all)
//    uploads     your own picture as a Pokémon's sprite
//
//  Lists of your own items use the custom studio instead (custom-studio.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { dexLabel, entries, entryById, isRankable, rankableEntries } from '../../core/items';
import { autosave } from '../../core/persist';
import { isPokemonList, onListReset, state, studioRowById } from '../../core/state';
import type { ItemId } from '../../core/types';
import { byId, findById } from '../../lib/dom';
import { html, setHtml } from '../../lib/html';
import { markPixelArt } from '../../lib/images';
import { ask, forEachLimited, hideProgress, showProgress, toast, updateProgress } from '../../lib/ui';
import { baseSetIndexOf, describeSpritePath, spriteDirByPath, spriteDirs, spriteExists, spritePath } from '../../pokemon/data';
import { onLocalSpritesChange } from '../../pokemon/local-source';
import { renderNetState } from '../../pokemon/sprite-urls';
import { onFormsChange, onFormsClick, rankableIdFor } from '../forms/forms';
import { switchView } from '../layout/layout';
import { openQuickPicker, quickPicker, renderQuickPicker } from '../quick-picker/quick-picker';
import { pickSprite, pickUpload, resetToDefault, spriteSrc } from '../sprites/sprites';
import {
    applyCollapsed,
    forgetLazyImages,
    hydrateImages,
    NET_NOTE,
    onFiltersChange,
    passesFilters,
    pickCard,
    spriteCard,
    toggleFavourite,
    versionSections,
} from '../sprites/versions';
import { renderCustomStudio } from './custom-studio';
import { onGalleryClick } from './gallery';

export type StudioMode = 'pokemon' | 'style' | 'mine';

export const studio = {
    mode: 'mine' as StudioMode,
    /** The Pokémon shown in the One Pokémon view. */
    currentId: 1 as ItemId,
    /** By Style: index of the chosen sprite folder in spriteDirs. */
    styleDir: null as number | null,
    // list filters
    query: '',
    generation: 'all',
    picked: 'all' as 'all' | 'picked' | 'unpicked',
};

// ═════════════════════════════════════════════════════════════════════════════
//  THE LIST
// ═════════════════════════════════════════════════════════════════════════════

/** Builds the Pokémon list (once per list opened; filtering only hides rows). Pictures load only once scrolled into view. */
export function buildStudioList(): void {
    const rows = document.createDocumentFragment();
    for (const entry of entries) {
        if (entry.custom) continue;
        const row = document.createElement('div');
        row.className = 'sr';
        row.dataset.id = String(entry.id);
        setHtml(
            row,
            html`<img alt="" loading="lazy" decoding="async"><span class="srn">${dexLabel(entry.id)}</span><span class="srname">${entry.name}</span><span class="srok">✓</span>`,
        );
        const img = row.querySelector('img')!;
        img.onload = () => markPixelArt(img);
        img.src = spriteSrc(entry.id);
        row.classList.toggle('picked', !!state.picks[entry.id]);
        row.onclick = () => showPokemon(entry.id);
        studioRowById.set(entry.id, row);
        rows.append(row);
    }
    byId('strows').replaceChildren(rows);
}

/** Pokémon that pass the list's search, generation and picked filters, in Pokédex order. */
export function visibleStudioIds(): ItemId[] {
    const query = studio.query.trim().toLowerCase().replace(/^#/, '');
    const isNumber = /^\d+$/.test(query);
    return entries
        .filter(
            (entry) =>
                !entry.custom &&
                isRankable(entry.id) &&
                (!query || entry.lc.includes(query) || (isNumber && String(entry.dex).startsWith(query))) &&
                (studio.generation === 'all' || String(entry.gen) === studio.generation) &&
                (studio.picked === 'all' || (studio.picked === 'picked') === !!state.picks[entry.id]),
        )
        .map((entry) => entry.id);
}

/** Shows only the rows that pass the filters, and updates "Picked 12 / 151". */
export function filterStudioList(): void {
    const visible = new Set(visibleStudioIds());
    studioRowById.forEach((row, id) => {
        row.style.display = visible.has(id) ? '' : 'none';
        row.classList.toggle('cur', id === studio.currentId);
        row.classList.toggle('picked', !!state.picks[id]);
    });
    const pokemon = rankableEntries().filter((entry) => !entry.custom);
    const picked = pokemon.filter((entry) => state.picks[entry.id]).length;
    const progress = byId('stprog');
    progress.firstChild!.textContent = `Picked ${picked} / ${pokemon.length}`;
    progress.querySelector('i')!.style.width = (picked / pokemon.length) * 100 + '%';
}

/** ◧ List: hides the list for more room (remembered in this browser). */
function showStudioList(shown: boolean): void {
    byId('studio').classList.toggle('nolist', !shown);
    byId('stlistbtn').classList.toggle('cbtn', !shown);
    try {
        localStorage.setItem('pt_stlist', shown ? '1' : '0');
    } catch {}
}

function savedStudioListShown(): boolean {
    try {
        return localStorage.getItem('pt_stlist') !== '0';
    } catch {
        return true;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIEWS
// ═════════════════════════════════════════════════════════════════════════════

export function renderStudio(): void {
    if (state.view !== 'studio') return;
    forgetLazyImages();
    if (!studioRowById.size && isPokemonList()) buildStudioList(); // left until the studio is first shown (see openList)
    filterStudioList();
    if (studio.mode === 'pokemon') renderPokemonView();
    else if (studio.mode === 'mine') renderMySprites();
    else renderStyleView();
}

export function setStudioMode(mode: StudioMode): void {
    studio.mode = mode;
    byId('vm-mon').classList.toggle('on', mode === 'pokemon');
    byId('vm-style').classList.toggle('on', mode === 'style');
    byId('vm-mine').classList.toggle('on', mode === 'mine');
    byId('stmain').replaceChildren();
    renderStudio();
}

/** Shows one Pokémon in the One Pokémon view. */
function showPokemon(id: ItemId): void {
    studio.currentId = id;
    if (studio.mode !== 'pokemon') setStudioMode('pokemon');
    else renderStudio();
}

/** Opens the studio (from the tier list) on a Pokémon. */
export function openStudio(id: ItemId | null): void {
    if (!isPokemonList()) return;
    if (id) studio.currentId = id;
    switchView('studio');
    if (studio.mode !== 'pokemon') setStudioMode('pokemon');
}

// ── My sprites: every Pokémon with the sprite you chose; click one to see all its sprites ──
function renderMySprites(): void {
    const ids = visibleStudioIds();
    const picked = ids.filter((id) => state.picks[id]).length;
    const cards = ids.map((id) => {
        const pick = state.picks[id];
        return html`<div class="vc${pick ? '' : ' unpicked'}" data-id="${id}" title="${describeSpritePath(pick?.path)}"><div class="vimg"><img alt="" loading="lazy" src="${spriteSrc(id)}" data-px></div><div class="vl"><b>${dexLabel(id)}</b> ${entryById.get(id)!.name}</div></div>`;
    });
    setHtml(
        byId('stmain'),
        html`<div class="sthead"><div><h2>My sprites</h2><div class="meta">${ids.length} Pokémon in Pokédex order, ${picked} picked. Click one to see all its sprites</div></div></div><div class="stgrid mine spaced">${cards}</div>`,
    );
}

// ── One Pokémon: every version of its sprite ──
function renderPokemonView(): void {
    const id = studio.currentId;
    const entry = entryById.get(id)!;
    const pick = state.picks[id];
    const sections = versionSections(id);
    const main = byId('stmain');
    setHtml(
        main,
        html`<div class="sthead"><img class="big" id="stbig" alt="" data-px><div><h2>${dexLabel(id)} ${entry.name}</h2><div class="meta">${entry.types.join(' / ')}, Gen ${entry.gen}, ${sections.count} sprites shown</div><div class="cur" id="stcurlbl">Using: ${describeSpritePath(pick?.path)}</div></div>
            <div class="acts"><button data-act="prev" title="Previous [←]">‹</button><button data-act="next" title="Next [→]">›</button><button data-act="next-unpicked" title="Next not-picked [N]">Next unpicked</button>
            <button data-act="upload">Upload custom</button><button data-act="reset" id="streset"${pick ? '' : ' disabled'}>Default</button></div></div>${sections.html}`,
    );
    main.scrollTop = 0;
    findById<HTMLImageElement>('stbig')!.src = spriteSrc(id);
    hydrateImages(main);
    applyCollapsed(main);
    renderNetState();
    studioRowById.get(id)?.scrollIntoView({ block: 'nearest' });
}

export function stepPokemon(direction: number): void {
    const ids = visibleStudioIds();
    if (!ids.length) return;
    const index = ids.indexOf(studio.currentId);
    studio.currentId = ids[index < 0 ? 0 : (index + direction + ids.length) % ids.length]!;
    renderStudio();
}

export function nextUnpicked(): void {
    const ids = visibleStudioIds();
    const index = ids.indexOf(studio.currentId);
    const next = [...ids.slice(index + 1), ...ids.slice(0, Math.max(0, index))].find((id) => !state.picks[id]);
    if (!next) {
        toast('Everything shown is picked');
        return;
    }
    studio.currentId = next;
    renderStudio();
}

// ── By Style: one game's sprite for every Pokémon ──
const styleName = (dirIndex: number): string => {
    const info = spriteDirs[dirIndex]!.info;
    return info.sec + (info.tags.length ? ', ' + info.tags.join(', ') : '');
};

/** Fills the style menu with the folders the filters allow, grouped by game. */
export function buildStyleOptions(): void {
    const menu = findById<HTMLSelectElement>('stylesel');
    if (!menu) return;
    const dirs = spriteDirs
        .filter((dir) => passesFilters(dir.info.flags))
        .sort((a, b) => a.info.order - b.info.order || a.info.sec.localeCompare(b.info.sec) || a.i - b.i);
    const groups = new Map<string, typeof dirs>();
    for (const dir of dirs) groups.set(dir.info.sec, [...(groups.get(dir.info.sec) || []), dir]);
    setHtml(
        menu,
        html`${[...groups].map(([game, gameDirs]) => html`<optgroup label="${game}">${gameDirs.map((dir) => html`<option value="${dir.i}">${styleName(dir.i)}</option>`)}</optgroup>`)}`,
    );
    if (studio.styleDir == null || !dirs.some((dir) => dir.i === studio.styleDir))
        studio.styleDir = (spriteDirByPath.get('other/official-artwork') || dirs[0])?.i ?? null;
    menu.value = String(studio.styleDir);
}

function renderStyleView(): void {
    if (!findById('stylesel')) {
        setHtml(
            byId('stmain'),
            html`<div class="sthead"><div class="stg"><span class="tbl">Style</span><select id="stylesel"></select></div><span class="meta small" id="stylecount"></span>
                <span class="note">Click a Pokémon to see all its sprites. Ctrl/⌘-click to use this style.</span>
                <div class="acts"><button class="cbtn" id="applyun">Apply to unpicked</button><button id="applyall">Apply to all shown</button></div></div>${NET_NOTE}<div class="stgrid spaced" id="stylegrid"></div>`,
        );
        byId<HTMLSelectElement>('stylesel').onchange = (e) => {
            studio.styleDir = Number((e.target as HTMLSelectElement).value);
            renderStyleGrid();
        };
        byId('applyun').onclick = () => applyStyleToAll(false);
        byId('applyall').onclick = () => applyStyleToAll(true);
    }
    buildStyleOptions();
    renderStyleGrid();
    renderNetState();
}

function renderStyleGrid(): void {
    forgetLazyImages();
    const grid = byId('stylegrid');
    if (studio.styleDir == null) {
        setHtml(grid, html`<div class="empty">No sprite styles match the "Show" filters.</div>`);
        return;
    }
    const dir = spriteDirs[studio.styleDir]!;
    const ids = visibleStudioIds();
    let available = 0;
    const cards = ids.map((id) => {
        const label = `${dexLabel(id)} ${entryById.get(id)!.name}`;
        if (!spriteExists(String(id), baseSetIndexOf(id), dir.i))
            return html`<div class="vc missing" data-id="${id}" title="No ${dir.info.sec} sprite"><div class="vimg"></div><div class="vl">${label}</div></div>`;
        available++;
        const path = spritePath(dir, String(id));
        return spriteCard(path, label, { chosen: state.picks[id]?.path === path, itemId: id });
    });
    setHtml(grid, cards.length ? html`${cards}` : html`<div class="empty">No Pokémon match the list filters.</div>`);
    hydrateImages(grid);
    byId('stylecount').textContent = `${available} of ${ids.length} have this style`;
}

/** Apply to unpicked / all shown: gives every Pokémon shown this style's sprite. */
async function applyStyleToAll(overwrite: boolean): Promise<void> {
    if (studio.styleDir == null) return;
    const dir = spriteDirs[studio.styleDir]!;
    const ids = visibleStudioIds().filter((id) => (overwrite || !state.picks[id]) && spriteExists(String(id), baseSetIndexOf(id), dir.i));
    if (!ids.length) return toast('Nothing to apply');
    if (!(await ask(`Set "${styleName(dir.i)}" as the sprite for ${ids.length} Pokémon?`, 'Apply'))) return;
    showProgress('Applying style…', true);
    let failed = 0;
    await forEachLimited(
        ids,
        6,
        async (id) => {
            try {
                await pickSprite(id, spritePath(dir, String(id)), { quiet: true });
            } catch {
                failed++;
            }
        },
        (done) => updateProgress(`${done} / ${ids.length}`, (done / ids.length) * 100),
    );
    hideProgress();
    autosave();
    renderStudio();
    toast(`Applied to ${ids.length - failed} Pokémon${failed ? `, ${failed} failed (offline?)` : ''}`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  UPLOADS
// ═════════════════════════════════════════════════════════════════════════════

const uploadInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', className: 'hid' });
let uploadFor: ItemId | null = null;

/** Asks for a picture file and uses it as this Pokémon's sprite. */
export function uploadSprite(id: ItemId): void {
    uploadFor = id;
    uploadInput.click();
}

async function onUploadChosen(): Promise<void> {
    const file = uploadInput.files?.[0];
    uploadInput.value = '';
    if (!file || uploadFor == null) return;
    const id = uploadFor;
    if (!(await pickUpload(id, file))) return toast("That file isn't a picture this app can use (or it's over 25 MB)");
    renderStudio();
    if (quickPicker.id === id) renderQuickPicker();
    toast('Custom sprite set');
}

// ═════════════════════════════════════════════════════════════════════════════
//  CLICKS ON CARDS
// ═════════════════════════════════════════════════════════════════════════════

async function onStudioClick(e: MouseEvent): Promise<void> {
    if (!isPokemonList()) return;
    const target = e.target as HTMLElement;
    const inPokemonView = studio.mode === 'pokemon';

    const action = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (inPokemonView && action) {
        if (action === 'prev') stepPokemon(-1);
        else if (action === 'next') stepPokemon(1);
        else if (action === 'next-unpicked') nextUnpicked();
        else if (action === 'upload') uploadSprite(studio.currentId);
        else if (action === 'reset') {
            await resetToDefault(studio.currentId);
            renderStudio();
        }
        return;
    }
    if (toggleFavourite(e, inPokemonView ? studio.currentId : null)) return renderStudio();
    if (await onFormsClick(e, showPokemon)) return;

    // My sprites / By Style: a click opens that Pokémon's sprites; Ctrl/⌘/Shift-click in By Style uses the style straight away
    const card = target.closest<HTMLElement>('.vc');
    const quickPick = studio.mode === 'style' && (e.ctrlKey || e.metaKey || e.shiftKey);
    if (!inPokemonView && !quickPick) {
        if (card?.dataset.id && (studio.mode === 'style' || !card.classList.contains('missing'))) openQuickPicker(Number(card.dataset.id));
        return;
    }
    if (inPokemonView && (await onGalleryClick(e, studio.currentId))) return;
    if (!card) return;
    const id = inPokemonView ? studio.currentId : Number(card.dataset.id);
    if (!id) return;
    // in By Style, only this Pokémon's card is unmarked
    const others = inPokemonView
        ? byId('stmain').querySelectorAll('.vc.chosen')
        : [...card.parentElement!.querySelectorAll<HTMLElement>('.vc.chosen')].filter((other) => Number(other.dataset.id) === id);
    if (!(await pickCard(card, id, others))) return;
    findById<HTMLButtonElement>('streset')?.removeAttribute('disabled');
    filterStudioList();
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupStudio(): void {
    onListReset(() => byId('strows').replaceChildren());
    for (const onChange of [onFiltersChange, onLocalSpritesChange])
        onChange(() => {
            buildStyleOptions();
            renderStudio();
        });
    onFormsChange(() => {
        filterStudioList();
        if (state.view !== 'studio') return;
        studio.currentId = rankableIdFor(studio.currentId);
        renderStudio();
    });

    byId('stmain').addEventListener('click', (e) => void onStudioClick(e));
    document.body.append(uploadInput);
    uploadInput.onchange = () => void onUploadChosen();

    byId('vm-mon').onclick = () => setStudioMode('pokemon');
    byId('vm-style').onclick = () => setStudioMode('style');
    byId('vm-mine').onclick = () => setStudioMode('mine');

    // list filters
    const onListFilter = () => {
        // a list of your own has its own studio, which filters as it draws (and has no "Picked n / m" bar)
        if (!isPokemonList()) return renderCustomStudio();
        filterStudioList();
        if (studio.mode === 'style') renderStyleGrid();
    };
    byId<HTMLInputElement>('stq').oninput = (e) => {
        studio.query = (e.target as HTMLInputElement).value;
        onListFilter();
    };
    byId<HTMLSelectElement>('stgen').onchange = (e) => {
        studio.generation = (e.target as HTMLSelectElement).value;
        onListFilter();
    };
    byId<HTMLSelectElement>('ststat').onchange = (e) => {
        studio.picked = (e.target as HTMLSelectElement).value as typeof studio.picked;
        onListFilter();
    };

    // display options
    byId<HTMLInputElement>('vcsl').oninput = (e) => {
        state.studioCardSize = Number((e.target as HTMLInputElement).value);
        document.documentElement.style.setProperty('--vc', state.studioCardSize + 'px');
    };
    byId<HTMLInputElement>('vcsl').onchange = autosave;
    byId<HTMLInputElement>('trimck').onchange = (e) => {
        state.trimSprites = (e.target as HTMLInputElement).checked;
        autosave();
    };
    byId('stlistbtn').onclick = () => showStudioList(byId('studio').classList.contains('nolist'));
    showStudioList(savedStudioListShown());
}
