// src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Tierinator: every feature wired up (start.ts), started as this app.
// ─────────────────────────────────────────────────────────────────────────────
import './styles/app.css';
import { useTrustedTypesPolicy } from 'tier-engine/safe';
import { brand } from './brand';
import { startApp } from './start';

// the policy safe HTML uses, named before anything is drawn: public/_headers' CSP allows "tierinator-html"
useTrustedTypesPolicy('tierinator-html');

if (import.meta.env.MODE === 'test') void import('./testing').then((test) => test.exposeForTests());

// a copy for offline use only in real builds (`pnpm dev` has no service worker)
startApp({ ...brand, offline: import.meta.env.PROD });
