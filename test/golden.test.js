/*
 * Golden-frame tests: render two examples through the pure-js backend at
 * 240x280 and compare a sha256 of the raw RGB framebuffer against the
 * committed hashes. A mismatch means the pixels changed — if on purpose,
 * reseed with:  bun test/golden/regen.mjs
 */
import { test, expect } from 'bun:test';
const { renderExample, sha256 } = require('./load.js');
const hashes = require('./golden/hashes.json');

for (const name of ['counter', 'hello']) {
  test('golden: examples/' + name + ' @240x280', () => {
    const t = renderExample('examples/' + name + '/app.jsx', 240, 280);
    const actual = sha256(t.backend.raw);
    if (actual !== hashes[name]) {
      console.error(
        'golden mismatch for examples/' + name +
        '\n  expected ' + hashes[name] +
        '\n  actual   ' + actual +
        '\n  intentional pixel change? reseed with: bun test/golden/regen.mjs');
    }
    expect(actual).toBe(hashes[name]);
  });
}
