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

console.log(`synced ${pages} page(s) and ${imgCount} image(s) into site/`);
for (const w of warnings) console.log('  warn: ' + w);
if (!imgCount) {
  console.log('  note: docs/img/ is empty or missing — run the shot harness to generate figures');
}
