// src/testing.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Test-only handle. Builds made with `--mode test` put the app's modules on
//  window.__app so Playwright tests can set up a list and check its state.
//  Production builds never include this file (see the import in main.ts).
// ─────────────────────────────────────────────────────────────────────────────

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
import * as quickPicker from './features/quick-picker/quick-picker';
import * as share from './features/share/share';
import * as sprites from './features/sprites/sprites';
import * as stats from './features/stats/stats';
import * as gallery from './features/studio/gallery';
import * as studio from './features/studio/studio';
import * as board from './features/tier-board/board';
import * as linkData from './lib/link-data';
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
