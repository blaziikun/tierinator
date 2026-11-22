// src/core/local.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Tierinator's keys in localStorage, through the engine's adapter
//  (tier-engine/core createLocalStore). Every key starts with "pt_" or "ptl"
//  (lists are "ptl_<id>", names from the first versions), and nothing else is
//  read, backed up or deleted. Calls behave as localStorage's: get gives null
//  when storage is off, set throws when it's full. Imports only the engine, so
//  any module can use it without an import loop.
// ─────────────────────────────────────────────────────────────────────────────
import { createLocalStore } from 'tier-engine/core';

export const local = createLocalStore(['pt_', 'ptl']);
