#!/usr/bin/env bun
/*
 * Bundle the REAL rasterizer for the documentation site.
 *
 * The site's figure viewer does not approximate anything: it pulls the
 * draw ops out of a PNG and replays them through the same pure-js backend
 * the screenshots were made with, in the browser. That means shipping the
 * backend and the whole font system as one file — the same bundle the
 * HTTP mirror builds on the fly, written to disk instead so a static host
 * can serve it.
 *
 *   bun scripts/build-viewer.mjs      ->  site/public/mjsx-backend.js
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'backends/http/src/client-backend.js');
const OUT = join(ROOT, 'site/public/mjsx-backend.js');

const built = await Bun.build({
  entrypoints: [ENTRY],
  target: 'browser',
  format: 'iife',
  minify: true
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const text = await built.outputs[0].text();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log('wrote ' + OUT + '  ' + Math.round(text.length / 1024) + ' kB');
