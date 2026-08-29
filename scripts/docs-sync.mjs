#!/usr/bin/env bun
/*
 * Copy docs/*.md into the Astro site, adding the frontmatter Starlight
 * wants and fixing up the paths that differ between "markdown read in a
 * repo" and "markdown served as a site".
 *
 * docs/ is the CANONICAL copy. Nothing here edits it, and everything
 * written under site/src/content/docs/ is disposable -- regenerate rather
 * than hand-edit, or the two will drift.
 *
 * Three fixups, each because the two contexts genuinely differ:
 *   - TITLE: Starlight needs one in frontmatter; the first `# heading`
 *     is it, and that heading is then dropped so the page does not show
 *     its title twice.
 *   - IMAGES: docs/img/x.png is `./img/x.png` in the repo and `/img/x.png`
 *     once served, so images are copied to site/public/img and the links
 *     rewritten.
 *   - LINKS: `other.md` becomes `/other` (Starlight routes by slug), and
 *     links that climb out of docs/ (../examples/...) are left alone but
 *     reported, since they cannot resolve on the site.
 *   - SIMULATOR: a figure named ex-<example>-<profile>.png is a picture of
 *     an example the site can actually RUN, so each one gets a link under
 *     it into /play/ with that example and that panel preselected. This is
 *     generated rather than written by hand because there are dozens of
 *     them and a hand-written link rots the moment a figure is renamed.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const OUT = join(ROOT, 'site', 'src', 'content', 'docs');
const IMG_SRC = join(DOCS, 'img');
const IMG_OUT = join(ROOT, 'site', 'public', 'img');

if (!existsSync(DOCS)) {
  console.error('no docs/ directory at ' + DOCS);
  process.exit(1);
}

/* Regenerate from scratch: a file deleted from docs/ must vanish here
   too, or the site keeps serving a page the repo no longer has. */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* One-line descriptions for the pages, used as the Starlight subtitle
   when the markdown does not carry its own. Keyed by slug. */
const BLURBS = {
  index: 'JSX for microcontrollers, Raspberry Pi, desktop and the browser.',
  'getting-started': 'From an empty directory to a UI on real glass.',
  simulator: 'Edit an example and run it, on the real engine, in the browser.',
  ui: 'h(), state, memo, scrolling, and the pointer model.',
  layout: 'Boxes, rows, flex, absolute positioning and scroll zones.',
  fonts: 'The bitmap fonts, sizes, metrics and text measurement.',
  components: 'Button, input, Keyboard and ArcFooter.',
  keyboards: 'Four layouts, how auto chooses, and what changes on round glass.',
  input: 'Text fields, carets, focus, and every way keys arrive.',
  devices: 'The boards, flashing, OTA and provisioning.',
  round: 'Designing for a circle: chords, arcs and the rules that follow.',
  sensors: 'Motion, GPIO and I2C from JavaScript.',
  'hardware-api': 'The native calls a script can reach.',
  contract: 'The ten gfx calls a backend must provide.',
  consistency: 'What each backend really implements, and where they differ.',
};

/* shoot.mjs profile -> the simulator's panel id. Only the panels the
   simulator offers are mapped; a figure on any other profile still gets a
   link, just without a preselected shape. */
const PLAY_SHAPE = {
  lcd169p: 'lcd169p', lcd147: 'lcd147', lcd147l: 'lcd147l',
  lcd35: 'lcd35', lcd35l: 'lcd35l', round128: 'round128'
};

/* only link examples that actually exist, so a renamed or deleted one
   stops producing a link instead of producing a broken one */
const EX_DIR = join(ROOT, 'examples');
const RUNNABLE = new Set(
  existsSync(EX_DIR)
    ? readdirSync(EX_DIR).filter((n) => existsSync(join(EX_DIR, n, 'app.jsx')))
    : []
);

let playLinks = 0;
let imgCount = 0;
if (existsSync(IMG_SRC)) {
  mkdirSync(IMG_OUT, { recursive: true });
  for (const f of readdirSync(IMG_SRC)) {
    if (statSync(join(IMG_SRC, f)).isFile()) {
      copyFileSync(join(IMG_SRC, f), join(IMG_OUT, f));
      imgCount++;
    }
  }
}

const slugs = new Set();
for (const f of readdirSync(DOCS)) {
  if (f.endsWith('.md')) slugs.add(f === 'README.md' ? 'index' : basename(f, '.md'));
}

const warnings = [];
let pages = 0;

for (const f of readdirSync(DOCS)) {
  if (!f.endsWith('.md')) continue;
  const slug = f === 'README.md' ? 'index' : basename(f, '.md');
  let md = readFileSync(join(DOCS, f), 'utf8');

  /* title from the first heading, which is then removed */
  let title = slug;
  const m = md.match(/^#\s+(.+)$/m);
  if (m) {
    title = m[1].trim();
    md = md.replace(m[0], '').replace(/^\s+/, '');
  }
  if (slug === 'index') title = 'mjsx';

  /* images: ./img/x.png and img/x.png both become /img/x.png */
  md = md.replace(/\]\(\.?\/?img\//g, '](/img/');

  /* a figure OF an example becomes a figure you can run */
  md = md.replace(/!\[([^\]]*)\]\(\/img\/ex-([a-z0-9]+)-([a-z0-9]+)\.png\)/g,
    (whole, alt, example, profile) => {
      if (!RUNNABLE.has(example)) return whole;
      const shape = PLAY_SHAPE[profile];
      const hash = 'ex=' + example + (shape ? '&shape=' + shape : '');
      playLinks++;
      return whole + '\n\n<a class="run-example" href="/play/#' + hash + '">' +
             '\u25b6 Run <code>' + example + '</code> in the simulator</a>';
    });

  /* internal links: other.md -> /other , README.md -> / */
  md = md.replace(/\]\((\.\/)?([A-Za-z0-9._-]+)\.md(#[^)]*)?\)/g, (whole, _dot, name, hash) => {
    const target = name === 'README' ? '' : name;
    if (name !== 'README' && !slugs.has(name)) {
      warnings.push(`${f}: links to ${name}.md which does not exist`);
      return whole;
    }
    return `](/${target}${hash || ''})`;
  });

  /* links that climb out of docs/ cannot resolve once served */
  const climbs = md.match(/\]\(\.\.\/[^)]+\)/g);
  if (climbs) {
    warnings.push(`${f}: ${climbs.length} link(s) outside docs/ will not resolve on the site (${climbs[0]})`);
  }

  const desc = BLURBS[slug];
  const fm = [
    '---',
    `title: ${JSON.stringify(title)}`,
    desc ? `description: ${JSON.stringify(desc)}` : null,
    '---',
    '',
    '<!-- GENERATED from docs/' + f + ' by scripts/docs-sync.mjs. Edit that file. -->',
    '',
  ].filter(Boolean).join('\n');

  writeFileSync(join(OUT, slug + '.md'), fm + md);
  pages++;
}

/* An index for the figure viewer: only images that actually carry ops,
   since the viewer replays rather than displays. */
const figures = [];
if (existsSync(IMG_OUT)) {
  for (const f of readdirSync(IMG_OUT).sort()) {
    if (!f.endsWith('.png')) continue;
    const buf = readFileSync(join(IMG_OUT, f));
    if (buf.includes('mjsx-ops')) {
      figures.push({ path: '/img/' + f, name: f.replace(/\.png$/, '') });
    }
  }
}
writeFileSync(join(ROOT, 'site', 'public', 'figures.json'), JSON.stringify(figures));

console.log(`synced ${pages} page(s) and ${imgCount} image(s) into site/`);
console.log(`  ${figures.length} figure(s) carry draw ops (viewer index written)`);
console.log(`  ${playLinks} example figure(s) linked into the simulator`);
for (const w of warnings) console.log('  warn: ' + w);
if (!imgCount) {
  console.log('  note: docs/img/ is empty or missing — run the shot harness to generate figures');
}
