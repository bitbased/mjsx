#!/usr/bin/env bun
/*
 * Run the documentation site locally.
 *
 *   bun run site              dev server, live reload
 *   bun run site --preview    build once and serve the real static output
 *   bun run site --port 5000  any astro flag passes straight through
 *
 * Three things happen before astro starts, and all three are the reason
 * this is a script rather than a chain of && in package.json:
 *
 *   1. site/ is INSTALLED if it is not. Forgetting that is the usual
 *      first-run failure, and the error astro gives for it is not a hint.
 *   2. docs/*.md and docs/img/* are SYNCED in, and the browser bundle of
 *      the pure-js backend is rebuilt. Both are generated; a stale copy
 *      is a confusing thing to test against.
 *   3. The interesting URLs are PRINTED. The landing-page candidates and
 *      the figure viewer live in site/public/ and so are not in the
 *      sidebar — without this list they are effectively unreachable
 *      unless you already know the paths.
 */
import { spawnSync, spawn } from 'child_process';
import { existsSync, readdirSync, statSync, watch } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');

const argv = process.argv.slice(2);
const preview = argv.includes('--preview');
const passthru = argv.filter((a) => a !== '--preview');

/* the port astro will actually use, so the printed URLs are not a guess */
const portAt = passthru.indexOf('--port');
const PORT = portAt >= 0 ? passthru[portAt + 1] : (preview ? '4321' : '4321');

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status || 1);
}

/* ---- 1. dependencies ---- */
if (!existsSync(join(SITE, 'node_modules'))) {
  console.log('site/ dependencies are not installed — installing (once)\n');
  run('bun', ['install'], { cwd: SITE });
  console.log();
}

/* ---- 2. generated content ---- */
run('bun', [join(ROOT, 'scripts', 'build-viewer.mjs')]);
run('bun', [join(ROOT, 'scripts', 'build-play.mjs')]);
run('bun', [join(ROOT, 'scripts', 'docs-sync.mjs')]);

/* ---- 3. the map ---- */
const LANDING = join(SITE, 'public', 'landing');
const styles = existsSync(LANDING)
  ? readdirSync(LANDING).filter((f) => statSync(join(LANDING, f)).isDirectory()).sort()
  : [];

const base = 'http://localhost:' + PORT;
const rows = [
  ['/', 'the documentation'],
  ['/play/', 'simulator: edit an example and run it on the real engine'],
  ['/viewer/', 'figure viewer: draw ops replayed, dpr 1-4x, text modes, overlay']
];
if (styles.length) {
  rows.push(['/landing/', 'landing-page candidates, side by side']);
  for (const s of styles) rows.push(['/landing/' + s + '/', '\u2514 ' + s]);
}
/* width from the longest URL, so the second column actually lines up */
const w = Math.max(...rows.map((r) => r[0].length)) + base.length + 2;
console.log('\n' + (preview ? 'PREVIEW (built output)' : 'DEV (live reload)') +
            '  \u2014  what is worth opening\n');
for (const [path, what] of rows) {
  const url = base + path;
  console.log('  ' + url + ' '.repeat(Math.max(1, w - url.length)) + what);
}
console.log('\n  ctrl-c to stop\n');

/* ---- keep the generated example bundle in step -----------------------
 * examples.json and mjsx-sim.js are BUILD ARTIFACTS: the simulator and the
 * landing pages fetch them, not examples/*.jsx. Editing an example while
 * the server runs therefore changes nothing on screen, and the page keeps
 * serving whatever was built last.
 *
 * That is not a theoretical hazard. A whole session was spent fixing bugs
 * in examples/asteroids that stayed fixed on disk and broken in the
 * browser, because nothing rebuilt this. Watching the directory costs a
 * few lines and removes the entire class.
 */
if (!preview) {
  const EX = join(ROOT, 'examples');
  let pending = null;
  watch(EX, { recursive: true }, (_ev, file) => {
    if (!file || !/\.jsx?$/.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      const r = spawnSync('bun', [join(ROOT, 'scripts', 'build-play.mjs')],
                          { cwd: ROOT, stdio: 'pipe' });
      console.log(r.status === 0
        ? '  rebuilt examples.json (' + file + ' changed)'
        : '  FAILED to rebuild examples.json — ' + String(r.stderr).trim());
    }, 150);
  });
}

/* ---- astro ---- */
if (preview) {
  run('bun', ['run', 'build'], { cwd: SITE });
  console.log();
}
const child = spawn('bun', ['run', preview ? 'preview' : 'dev', ...passthru],
                    { cwd: SITE, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
