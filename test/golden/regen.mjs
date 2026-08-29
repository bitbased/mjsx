/*
 * Reseed the golden hashes:  bun test/golden/regen.mjs
 *
 * Renders EVERY example (every directory under examples/ with an app.jsx)
 * at all three shapes in test/golden/matrix.js — 240x280, 320x172, and
 * 240x240 round — and writes the sha256 of each raw RGB framebuffer to
 * hashes.json. Run it only when a pixel change is intended, and eyeball
 * the frames first (bun run gallery, or bun run example:hello).
 *
 * The hashes are deterministic by construction (see matrix.js: frozen
 * sys.millis, fresh backend/core/example per cell). Two consecutive runs
 * must produce an identical file; if they don't, something in core or an
 * example grew a clock or a random, and that is the bug to fix — not the
 * hash to re-roll.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { matrix, renderCell, HASHES_FILE } = require('./matrix.js');

const out = {};
const failed = [];
for (const cell of matrix()) {
  try {
    out[cell.key] = renderCell(cell.name, cell.shape);
    console.log(cell.key + '  ' + out[cell.key]);
  } catch (e) {
    failed.push(cell.key + ': ' + e.message);
    console.error('FAIL ' + cell.key + '  ' + e.message);
  }
}

/* Sorted keys so the file is stable under any directory-order change. */
const sorted = {};
for (const k of Object.keys(out).sort()) sorted[k] = out[k];
writeFileSync(HASHES_FILE, JSON.stringify(sorted, null, 2) + '\n');
console.log('\nwrote ' + Object.keys(sorted).length + ' hashes to ' + HASHES_FILE);

if (failed.length) {
  console.error('\n' + failed.length + ' cell(s) did not render; hashes.json is INCOMPLETE:');
  for (const f of failed) console.error('  ' + f);
  process.exit(1);
}
