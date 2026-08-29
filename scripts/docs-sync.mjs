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
import { inflateSync } from 'zlib';
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

/* ---- the figure index ------------------------------------------------
 * Every figure carries its own record (see docs/shots.md), so the site can
 * group them without a hand-maintained table. A FAMILY is one picture of
 * one thing across several panels — ex-counter-lcd35, ex-counter-lcd147,
 * ex-counter-round128 — and wherever a family has more than one member the
 * page shows a shape switcher instead of a single fixed screenshot.
 *
 * This is generated because it is the only way it stays true: figures get
 * added, renamed and re-shot constantly, and a hand-written switcher is
 * wrong the first time that happens.
 */
function figureMeta(file) {
  const buf = readFileSync(file);
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'zTXt') {
      const nul = data.indexOf(0);
      if (data.toString('latin1', 0, nul) === 'mjsx-shot') {
        try { return JSON.parse(inflateSync(data.subarray(nul + 2)).toString('utf8')); }
        catch (e) { return null; }
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}

/* the order panels appear in a switcher: smallest and roundest first, so
   the hard cases lead — that is where layout differences actually show */
const PROFILE_ORDER = ['round128', 'lcd147', 'lcd147l', 'lcd169p', 'lcd169',
                       'lcd35', 'lcd35l', 'wide'];

function shapeWords(size) {
  if (!size) return { word: '', dims: '' };
  const dims = size.w + '\u00d7' + size.h;
  const word = size.round ? 'round' : size.w > size.h ? 'landscape' : 'portrait';
  return { word: word, dims: dims };
}

const families = new Map();
if (existsSync(IMG_SRC)) {
  for (const f of readdirSync(IMG_SRC)) {
    if (!f.endsWith('.png')) continue;
    const meta = figureMeta(join(IMG_SRC, f));
    if (!meta || !meta.profile) continue;
    const base = f.replace(/\.png$/, '');
    /* the family is the name minus its trailing -<profile> */
    if (!base.endsWith('-' + meta.profile)) continue;
    const fam = base.slice(0, -(meta.profile.length + 1));
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam).push({
      file: f, profile: meta.profile, caption: meta.caption || '',
      size: meta.size || null, example: /^ex-/.test(fam) ? fam.slice(3) : null
    });
  }
  for (const list of families.values()) {
    list.sort((a, b) => {
      const ai = PROFILE_ORDER.indexOf(a.profile), bi = PROFILE_ORDER.indexOf(b.profile);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }
}

function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
}
function cap1(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

/* "run this one" — only for figures OF an example, and only for examples
   that still exist, so a deleted one stops producing a link rather than
   producing a broken one */
function runLink(m) {
  if (!m || !m.example || !RUNNABLE.has(m.example)) return '';
  const shape = PLAY_SHAPE[m.profile];
  playLinks++;
  return ' <a class="run-example" href="/play/#ex=' + m.example +
         (shape ? '&amp;shape=' + shape : '') + '">\u25b6 Run it</a>';
}

let switchers = 0;
let embeds = 0;
let swSeq = 0;
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
const broken = [];
let pages = 0;

for (const f of readdirSync(DOCS)) {
  if (!f.endsWith('.md')) continue;
  const slug = f === 'README.md' ? 'index' : basename(f, '.md');
  let md = readFileSync(join(DOCS, f), 'utf8');

  /* title from the first heading, which is then removed */
  swSeq = 0;                                   /* ids are per page */

  let title = slug;
  const m = md.match(/^#\s+(.+)$/m);
  if (m) {
    title = m[1].trim();
    md = md.replace(m[0], '').replace(/^\s+/, '');
  }
  if (slug === 'index') title = 'mjsx';

  /* Images, in BOTH syntaxes. Markdown `](./img/x.png)` is the obvious
     one; raw HTML `<img src="./img/x.png">` is the one that was missed,
     and docs/shapes.md is built entirely out of it. A relative path is
     resolved against the PAGE, so on /shapes/ every one of those became
     /shapes/img/... and 404'd — the whole shape switcher was broken
     images. The check below now fails loudly instead. */
  md = md.replace(/\]\(\.?\/?img\//g, '](/img/');
  md = md.replace(/(\ssrc\s*=\s*["'])\.?\/?img\//g, '$1/img/');
  md = md.replace(/(\ssrcset\s*=\s*["'])\.?\/?img\//g, '$1/img/');

  /* `<!-- simulator: <example> [panel] -->` embeds a LIVE simulator right
     there in the page. The docs are where someone is already reading about
     a thing, so that is where they should be able to run it; a link to a
     separate page is a worse version of the same idea. The iframe is the
     same /play/ in embed mode, so there is one simulator, not two. */
  md = md.replace(/<!--\s*simulator:\s*([a-z0-9-]+)(?:\s+([a-z0-9]+))?\s*-->/g,
    (whole, example, panel) => {
      if (!RUNNABLE.has(example)) {
        warnings.push(`${f}: <!-- simulator: ${example} --> names no such example`);
        return '';
      }
      const shape = panel && PLAY_SHAPE[panel] ? '&shape=' + PLAY_SHAPE[panel] : '';
      embeds++;
      return '<iframe class="sim-embed" src="/play/?embed=1#ex=' + example + shape +
             '" title="mjsx simulator running the ' + example + ' example" ' +
             'loading="lazy"></iframe>';
    });

  /* A single screenshot becomes a SHAPE SWITCHER wherever the same picture
     exists on more than one panel — which is most of them. The tab that
     starts selected is the one the page originally showed, so the prose
     around it still describes what you are looking at; the others are
     there to be flipped to.

     An italic paragraph directly under the image is the page's own caption
     for that one shot. The switcher carries a caption per shape, taken
     from each figure's own record, so the original is consumed rather than
     left behind contradicting four of the five tabs. */
  md = md.replace(
    /!\[([^\]]*)\]\(\/img\/([a-z0-9-]+)\.png\)(\n\n\*(?:[^*]|\*(?!\n))*\*)?/g,
    (whole, alt, base, ownCaption, offset, whole_md) => {
      /* A switcher is a BLOCK. If the image is not alone on its line it is
         inline content — a table cell, most often — and replacing it with a
         div destroys the construct around it. docs/keyboards.md has a
         layout table with a screenshot per row, and expanding those turned
         the table into fragments and an empty switcher. */
      const lineStart = whole_md.lastIndexOf('\n', offset) + 1;
      let lineEnd = whole_md.indexOf('\n', offset);
      if (lineEnd < 0) lineEnd = whole_md.length;
      const before = whole_md.slice(lineStart, offset);
      const firstLineOfMatch = whole.split('\n')[0];
      const after = whole_md.slice(offset + firstLineOfMatch.length, lineEnd);
      const inline = before.trim() !== '' || after.trim() !== '';

      const hit = [...families.entries()].find(([fam, list]) =>
        list.some((m) => fam + '-' + m.profile === base));
      if (!hit) return whole;
      const [fam, list] = hit;
      const here = list.find((m) => fam + '-' + m.profile === base);

      if (list.length < 2 || inline) return whole + runLink(here);

      switchers++;
      /* Unique PER OCCURRENCE, not per family. A page may show the same
         family twice (index.md pictures ex-hello in two places), and two
         radio groups sharing a name are ONE group: the second switcher's
         `checked` silently deselects the first, so neither showed a figure
         until it was clicked, and clicking one moved the other. */
      const id = 'sw-' + fam + '-' + (swSeq++);
      const tabs = [], panels = [];
      list.forEach((m, i) => {
        const { word, dims } = shapeWords(m.size);
        const rid = id + '-' + i;
        const on = m === here ? ' checked' : '';
        tabs.push(
          '  <input type="radio" name="' + id + '" id="' + rid + '"' + on + '>\n' +
          '  <label for="' + rid + '">\n' +
          '    <img src="/img/' + fam + '-' + m.profile + '.png" alt="">\n' +
          '    ' + word + '<br>' + dims + '\n' +
          '  </label>');
        /* the figure's own caption already names its panel, so the tab
           heading does not repeat it */
        /* the caption ends by naming its panel ("... On 240x240 round
           glass"), which the tab heading directly above it has just said.
           Drop that clause rather than print the size twice. */
        let cap = m.caption || (ownCaption ? ownCaption.trim().replace(/^\*|\*$/g, '') : '');
        cap = cap.replace(/\.?\s*On \d+x\d+(\s+round glass|\s*\([^)]*\))?\s*/i, '. ')
                 .replace(/\s*\.\s*\.\s*/g, '. ').replace(/^\s*\.\s*/, '').trim();
        if (cap && !/[.!?]$/.test(cap)) cap += '.';
        panels.push(
          '    <figure>\n' +
          '      <img src="/img/' + fam + '-' + m.profile + '.png" alt="' + esc(cap) + '">\n' +
          '      <figcaption><strong>' + cap1(word) + ', ' + dims + '.</strong> ' +
          esc(cap) + runLink(m) + '</figcaption>\n' +
          '    </figure>');
      });
      /* No blank line anywhere inside: in markdown a blank line ends a raw
         HTML block, and the remainder gets reparsed as markdown. */
      return '<div class="shapes">\n' + tabs.join('\n') + '\n' +
             '  <div class="shape-panels">\n' + panels.join('\n') + '\n  </div>\n</div>';
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

  /* Nothing may still point at a page-relative img/. This is an ERROR
     rather than a warning: a broken image looks like a broken feature, and
     it is invisible to anyone who does not open that exact page. */
  const relImg = md.match(/(?:\]\(|src\s*=\s*["']|srcset\s*=\s*["'])(?!\/)(?:\.\/)?img\/[^)"'\s]+/g);
  if (relImg) {
    broken.push(`${f}: ${relImg.length} page-relative image path(s) — ` +
                `${relImg[0]} would resolve under /${slug}/`);
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
console.log(`  ${switchers} shape switcher(s), ${embeds} embedded simulator(s), ${playLinks} simulator link(s)`);
for (const w of warnings) console.log('  warn: ' + w);
if (broken.length) {
  for (const b of broken) console.error('  ERROR: ' + b);
  console.error('\n  A page-relative image path 404s on the served site. Use /img/x.png.');
  process.exit(1);
}
if (!imgCount) {
  console.log('  note: docs/img/ is empty or missing — run the shot harness to generate figures');
}
