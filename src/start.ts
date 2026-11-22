// src/start.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Start-up, called by an app's main.ts with its config (app.ts). The app's
//  name and look go in first; then every feature wires up its own buttons once
//  (setupX), and the app opens its storage, packs and your last list.
// ─────────────────────────────────────────────────────────────────────────────
import { type AppConfig, app } from './core/app';
import { BUILT_IN_THEME, DEFAULT_THEME } from './core/defaults';
import { setupHistory } from './core/history';
import { setupPersist } from './core/persist';
import { onListOpen, state } from './core/state';
import { DATABASE_NAME, openDatabase, storage } from './core/storage';
import { setupAddItems } from './features/add-items/add-items';
import { buildAppearancePanel, setupPanel } from './features/appearance/panel';
import { setupPictureCredits } from './features/credits/credits';
import { announceRestore } from './features/files/bundles';
import { setupFiles } from './features/files/files';
import { setupSpritePacks } from './features/files/sprite-packs';
import { setupFind } from './features/find/find';
import { setupFocus } from './features/focus/focus';
import { setupForms } from './features/forms/forms';
import { setupHeadToHead } from './features/head-to-head/head-to-head';
import { setupItemDeletion } from './features/items/delete-items';
import { setupItemEditor } from './features/items/item-editor';
import { setupItems } from './features/items/items';
import { setupKeyboard } from './features/keyboard/keyboard';
import { setupLayout } from './features/layout/layout';
import { applyTopBar, setupTopBar } from './features/layout/top-bar';
import { createList, openStartingList, setupLists } from './features/lists/lists';
import { setupOffline } from './features/offline/offline';
import { nudgeBackup, setupOnboarding, showWelcomeOnce } from './features/onboarding/onboarding';
import { installStoredPacks, setupPacks, updatePokemonPack } from './features/packs/packs';
import { setupPokemonApp } from './features/pokemon-app/pokemon-app';
import { setupQuickPicker } from './features/quick-picker/quick-picker';
import { setupQuickRank } from './features/quick-rank/quick-rank';
import { openShareLinkIfAny, setupShare } from './features/share/share';
import { setupVersions } from './features/sprites/versions';
import { setupStartScreen } from './features/start/start';
import { setupCustomStudio } from './features/studio/custom-studio';
import { loadGallery, setupGallery } from './features/studio/gallery';
import { setupStudio } from './features/studio/studio';
import { setupTags } from './features/tags/tags';
import { openTemplateLinkIfAny } from './features/templates/template-link';
import { setupBoard } from './features/tier-board/board';
import { setupChart } from './features/tier-board/chart';
import { setupHoverTip } from './features/tier-board/hover-tip';
import { setupTierEditor } from './features/tier-board/tier-editor';
import { setupTileShape } from './features/tier-board/tile-shape';
import { setupVariants } from './features/variants/variants';
import { byId } from './lib/dom';
import { watchImageEvents } from './lib/images';
import { setupUi, toast } from './lib/ui';
import { setupLocalSource } from './pokemon/local-source';
import { probeNetwork } from './pokemon/sprite-urls';

/** Puts the app's name and look in place: everything reads them from `app` and DEFAULT_THEME. */
function configure(config: AppConfig & { offline: boolean }): void {
    Object.assign(app, config);
    Object.assign(DEFAULT_THEME, BUILT_IN_THEME, { name: config.name });
    state.theme = { ...DEFAULT_THEME };
    document.documentElement.dataset.app = config.id;
}

/** Starts the app. `offline`: keep a copy for use without a connection (production builds). */
export function startApp(config: AppConfig & { offline: boolean }): void {
    configure(config);
    wireFeatures();
    void start();
}

function wireFeatures(): void {
    // Order matters only for pasted pictures: the first feature that wants a paste takes it
    // (item editor → custom studio → gallery → new items).
    watchImageEvents();
    setupUi();
    setupItemEditor();
    setupItemDeletion();
    setupCustomStudio();
    setupGallery();
    setupItems();
    for (const setup of [
        setupHistory,
        setupPersist,
        setupFiles,
        setupSpritePacks,
        setupLocalSource,
        setupLists,
        setupPacks,
        setupAddItems,
        setupBoard,
        setupChart,
        setupTileShape,
        setupHoverTip,
        setupTierEditor,
        setupFind,
        setupFocus,
        setupTags,
        setupVariants,
        setupForms,
        setupVersions,
        setupStudio,
        setupQuickPicker,
        setupQuickRank,
        setupHeadToHead,
        setupPanel,
        setupLayout,
        setupTopBar,
        setupKeyboard,
        setupOnboarding,
        setupShare,
        setupStartScreen,
        setupPictureCredits,
        setupOffline,
        setupPokemonApp,
    ])
        setup();

    /**
     * Big features that are opened rarely load the first time one of their buttons is
     * pressed (a smaller first download). Their setup wires the real buttons, then the
     * press is replayed.
     */
    function loadOnFirstUse(buttonIds: string[], load: () => Promise<void>): void {
        for (const id of buttonIds) {
            const button = byId(id);
            button.onclick = async () => {
                for (const other of buttonIds) byId(other).onclick = null; // load once
                await load();
                button.click();
            };
        }
    }
    loadOnFirstUse(['pbopen', 'wkpack'], () => import('./features/pack-builder/pack-builder').then((module) => module.setupPackBuilder()));
    loadOnFirstUse(['statsbtn'], () => import('./features/stats/stats').then((module) => module.setupStats()));
    loadOnFirstUse(['expbtn'], () => import('./features/export/export').then((module) => module.setupExport()));
    loadOnFirstUse(['addtab-wiki'], () => import('./features/wiki/category-import').then((module) => module.setupCategoryImport()));
    loadOnFirstUse(['streambtn', 'lstream'], () => import('./features/stream/stream').then((module) => module.setupStream()));
    loadOnFirstUse(['startgal', 'ltpl'], () => import('./features/templates/templates').then((module) => module.setupTemplates()));
    loadOnFirstUse(['lgroup'], () => import('./features/group/group').then((module) => module.setupGroup()));
    loadOnFirstUse(['tab-grid'], () => import('./features/grid/grid').then((module) => module.setupGrid()));
}

// ── start-up ──
async function start(): Promise<void> {
    try {
        storage.db = await openDatabase(DATABASE_NAME, 3);
    } catch {
        storage.db = null; // private browsing etc.: lists still work, pictures last only this visit
    }
    await installStoredPacks();
    await loadGallery();
    buildAppearancePanel();
    applyTopBar();
    // a damaged list or link must never leave a blank page: say so, and carry on with a fresh list
    try {
        await openStartingList();
    } catch {
        toast("Your last list couldn't be opened, so here's a new one. File → Load can bring back a saved copy.", 8000);
        await createList('custom');
    }
    try {
        await openShareLinkIfAny();
        await openTemplateLinkIfAny();
    } catch {
        toast("That link couldn't be opened: it's damaged or from a newer version.", 6000);
    }
    const probeIfPokemon = () => {
        if (state.kind === 'pokemon') probeNetwork();
    };
    probeIfPokemon();
    onListOpen(probeIfPokemon);
    void updatePokemonPack();
    announceRestore();
    setTimeout(showWelcomeOnce, 600);
    setTimeout(nudgeBackup, 4000);
}
