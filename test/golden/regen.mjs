/*
 * Reseed the golden hashes:  bun test/golden/regen.mjs
 * Renders each example at 240x280 and writes the sha256 of the raw RGB
 * framebuffer to hashes.json. Run it only when a pixel change is intended,
 * and eyeball the frames first (bun run example:hello / example:counter).
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { renderExample, sha256 } = require('../load.js');

const out = {};
for (const name of ['counter', 'hello']) {
  const t = renderExample('examples/' + name + '/app.jsx', 240, 280);
  out[name] = sha256(t.backend.raw);
  console.log(name + ' ' + out[name]);
}

const file = join(dirname(fileURLToPath(import.meta.url)), 'hashes.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('wrote ' + file);
