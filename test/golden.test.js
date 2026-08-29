/*
 * Golden-frame tests: render EVERY example through the pure-js backend at
 * three display shapes — 240x280 portrait, 320x172 short landscape, and
 * 240x240 round glass (configStorage 'round'='1') — and compare a sha256
 * of the raw RGB framebuffer against the committed hashes. A mismatch
 * means the pixels changed; if on purpose, reseed with:
 *   bun test/golden/regen.mjs
 *
 * The shape list is the point: portrait is what the examples were drawn
 * for, the short landscape is where vertical space runs out, and the round
 * flag changes real layout decisions (overscroll, ArcFooter placement).
 * Determinism (frozen sys.millis, fresh core per render) lives in
 * test/golden/matrix.js so the test and the regen script share it.
 */
import { test, expect } from 'bun:test';
const { matrix, renderCell } = require('./golden/matrix.js');
const hashes = require('./golden/hashes.json');

const cells = matrix();

test('golden: hashes.json covers exactly the example x shape matrix', () => {
  const expected = cells.map((c) => c.key).sort();
  const actual = Object.keys(hashes).sort();
  if (expected.join() !== actual.join()) {
    const missing = expected.filter((k) => actual.indexOf(k) < 0);
    const stale = actual.filter((k) => expected.indexOf(k) < 0);
    console.error(
      'golden matrix out of sync' +
      (missing.length ? '\n  no hash for: ' + missing.join(', ') : '') +
      (stale.length ? '\n  hash for a cell that no longer exists: ' + stale.join(', ') : '') +
      '\n  reseed with: bun test/golden/regen.mjs');
  }
  expect(actual).toEqual(expected);
});

for (const cell of cells) {
  test('golden: examples/' + cell.name + ' @' + cell.shape.w + 'x' + cell.shape.h +
       (cell.shape.round ? ' round' : ''), () => {
    const actual = renderCell(cell.name, cell.shape);
    if (actual !== hashes[cell.key]) {
      console.error(
        'golden mismatch for ' + cell.key +
        '\n  expected ' + hashes[cell.key] +
        '\n  actual   ' + actual +
        '\n  intentional pixel change? reseed with: bun test/golden/regen.mjs');
    }
    expect(actual).toBe(hashes[cell.key]);
  });
}
