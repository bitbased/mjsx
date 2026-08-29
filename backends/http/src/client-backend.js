/* Browser entry for the REAL mjsx rasterizer: Bun bundles this (plus the
   pure-js backend and the core font/vector modules it pulls in) into the
   /mjsx-backend.js the mirror page loads. The mirror's HD:OFF mode
   replays the op stream through this instead of canvas paths, so what a
   browser shows is pixel-for-pixel what the panel would show -- bitmap
   fonts, Bresenham lines, scanline fills, everything. (ESM on purpose:
   Bun's iife build defines a CommonJS entry without invoking it, so a
   CJS entry's side effects never run.) */
import { createPureJsBackend } from '../../pure-js/src/backend.js';
import oprec from '../../../packages/core/src/oprec.js';
globalThis.createPureJsBackend = createPureJsBackend;
/* the mirror page replays with the SHARED implementation rather than its
   own copy of the switch, so the browser, the CLI and any future viewer
   cannot drift apart on what an op means */
globalThis.mjsxReplay = oprec.replay;
globalThis.mjsxBoxes = oprec.boxes;
