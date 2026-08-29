#!/usr/bin/env bun
/*
 * Check that everything shipping to a chip stays inside the ES5 subset
 * MicroQuickJS implements.
 *
 *   bun run lint                     the device code (the rule CI enforces)
 *   bun run lint path/to/file.js     just these files
 *   bun run lint --level quickjs     ES2020 syntax, but still a flat script
 *   bun run lint --level modern      no restriction (a no-op; for scripting)
 *   bun run lint --list              which files the default set covers
 *
 * The same check runs in `bun test`, over the same file set (see
 * scripts/device-files.js). This exists because a linter you can only
 * reach through the test runner is one nobody runs while writing code,
 * and `npm run lint` is where a JS developer looks first.
 */
import { readFileSync } from 'fs';
import { relative, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lint = req('../packages/core/src/es5lint.js').lint;
const { deviceFiles } = req('./device-files.js');

/* relative inside the repo, as-given outside it: ../../../../tmp/x.js
   helps nobody */
const show = (f) => {
  const r = relative(ROOT, f);
  return r.startsWith('..') ? f : r;
};

const argv = process.argv.slice(2);
if (argv[0] === '-h' || argv[0] === '--help') {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n').slice(2, 16).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(0);
}

const levelAt = argv.indexOf('--level');
const level = levelAt >= 0 ? argv[levelAt + 1] : 'mquickjs';
if (['mquickjs', 'quickjs', 'modern'].indexOf(level) < 0) {
  console.error('unknown level: ' + level + '  (mquickjs | quickjs | modern)');
  process.exit(2);
}

const explicit = argv.filter((a, i) =>
  a[0] !== '-' && !(levelAt >= 0 && i === levelAt + 1));
const files = explicit.length ? explicit : deviceFiles(ROOT);

if (argv.includes('--list')) {
  for (const f of files) console.log(show(f));
  console.log('\n' + files.length + ' file(s), level ' + level);
  process.exit(0);
}

let problems = 0, bad = 0;
for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); }
  catch (e) { console.error('cannot read ' + f + ': ' + e.message); process.exitCode = 2; continue; }
  const found = lint(src, { level: level });
  if (!found.length) continue;
  bad++;
  console.log(show(f));
  for (const p of found) {
    /* file:line, so an editor or terminal can jump straight to it */
    console.log('  ' + show(f) + ':' + p.line + '  ' + p.rule + '  ' + p.message);
    problems++;
  }
  console.log();
}

if (problems) {
  console.log(problems + ' problem(s) in ' + bad + ' of ' + files.length +
              ' file(s), level ' + level);
  process.exit(1);
}
console.log(files.length + ' file(s) clean at level ' + level +
            (explicit.length ? '' : '  (the code that ships to a chip)'));
