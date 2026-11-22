// src/testing.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Test-only handle. Builds made with `--mode test` put the app's modules on
//  window.__app so Playwright tests can set up a list and check its state.
//  Production builds never include this file (an app's main.ts imports it only in test mode).
// ─────────────────────────────────────────────────────────────────────────────

import * as linkData from 'tier-engine/core';
import * as history from './core/history';
import * as items from './core/items';
import * as persist from './core/persist';
import * as state from './core/state';
import * as storage from './core/storage';
import * as find from './features/find/find';
import * as itemDeletion from './features/items/delete-items';
import * as ownItems from './features/items/items';
import * as layout from './features/layout/layout';
import * as lists from './features/lists/lists';
import * as packBuilder from './features/pack-builder/pack-builder';
import * as packs from './features/packs/packs';
import * as pokemonApp from './features/pokemon-app/pokemon-app';
import * as quickPicker from './features/quick-picker/quick-picker';
import * as share from './features/share/share';
import * as sprites from './features/sprites/sprites';
import * as stats from './features/stats/stats';
import * as gallery from './features/studio/gallery';
import * as studio from './features/studio/studio';
import * as board from './features/tier-board/board';
import * as data from './pokemon/data';

export function exposeForTests(): void {
    Object.assign(window, {
        __app: {
            state,
            items,
            lists,
            persist,
            board,
            sprites,
            pokemonApp,
            stats,
            find,
            layout,
            quickPicker,
            packs,
            packBuilder,
            history,
            data,
            studio,
            gallery,
            ownItems,
            itemDeletion,
            storage,
            share,
            linkData,
        },
    });
}
