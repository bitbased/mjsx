#!/usr/bin/env bun
/*
 * Render every page of the site in a real browser and look for the things
 * that only go wrong once rendered.
 *
 *   bun run audit            against the dev server (bun run site)
 *   bun run audit --build    build first and audit the real static output
 *   bun run audit --url http://localhost:4321
 *
 * WHY THIS EXISTS. Every defect it checks for actually shipped, was
 * invisible in the build output, and was found by a person opening the
 * page:
 *
 *   - <img src="./img/x.png"> in a page served at /shapes/ resolves to
 *     /shapes/img/x.png and 404s. Every image on the page was broken.
 *   - two shape switchers shared a radio name, so they became one group
 *     and neither showed a figure until clicked.
 *   - a ten-column table crushed its cells to 45px and set the word
 *     "clear" three characters wide, stacked vertically.
 *   - the ten-call reference table broke `gfx.rect(x, y, w, h, color,
 *     radius)` across two lines mid-argument, on the page where the exact
 *     signature is the entire point.
 *   - an embedded simulator rendered a white panel inside a dark article.
 *
 * A unit test cannot see any of that. This can, so it is a command rather
 * than a thing someone remembers to look at.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const urlAt = args.indexOf('--url');
const BASE = urlAt >= 0 ? args[urlAt + 1] : 'http://localhost:4321';
const WIDTHS = [1500, 900, 420];          /* desktop, tablet, phone */

/* ---- find a browser ---- */
const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
];
const CHROME = process.env.CHROME || CHROMES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('audit: no Chrome or Chromium found. Set CHROME=/path/to/chrome.');
  process.exit(2);
}

/* ---- the page list, from what the site actually serves ---- */
function pageList() {
  const out = new Set(['/']);
  const gen = join(ROOT, 'site/src/content/docs');
  if (existsSync(gen)) {
    for (const f of readdirSync(gen)) {
      if (!/\.mdx?$/.test(f)) continue;
      const slug = f.replace(/\.mdx?$/, '');
      /* '/' is the drafting demo in public/, not a docs page; the docs
         overview is the 'docs' slug like any other. */
      out.add('/' + slug + '/');
    }
  }
  /* the hand-written pages under public/, which have no markdown at all
     and so are exactly the ones a docs-only sweep would miss */
  const pub = join(ROOT, 'site/public');
  for (const dir of ['viewer', 'play', 'landing']) {
    const d = join(pub, dir);
    if (!existsSync(d)) continue;
    if (existsSync(join(d, 'index.html'))) out.add('/' + dir + '/');
    for (const sub of readdirSync(d)) {
      if (statSync(join(d, sub)).isDirectory() && existsSync(join(d, sub, 'index.html'))) {
        out.add('/' + dir + '/' + sub + '/');
      }
    }
  }
  return [...out].sort();
}

/* ---- CDP, minimally ---- */
async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('browser did not start');
}

function session(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const failedRequests = [];
  const ready = new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleErrors.push((d.exception && d.exception.description || d.text || '').split('\n')[0]);
    }
    if (m.method === 'Network.loadingFailed') {
      failedRequests.push(m.params.errorText);
    }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send, ready, consoleErrors, failedRequests,
           reset() { consoleErrors.length = 0; failedRequests.length = 0; } };
}

/* ---- the checks, run inside the page ----------------------------------
 * Each returns a list of human-readable problems. They are deliberately
 * about RENDERED geometry, because that is the class of bug that gets
 * past everything else.
 */
const CHECKS = `(() => {
  const problems = [];
  const px = (n) => Math.round(n);
  const name = (el) => el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');

  /* 1. the page itself must never scroll sideways */
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) {
    problems.push('page scrolls horizontally: ' + de.scrollWidth + ' > ' + de.clientWidth);
  }

  /* 2. nothing may stick out past the viewport */
  const vw = de.clientWidth;
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    /* parked far off-screen on purpose — the standard skip-link and
       visually-hidden patterns. Something accidentally misplaced lands
       just outside the viewport, not 10,000px away. */
    if (r.right < -1000 || r.left > vw + 4000) return;
    if (r.right > vw + 2 || r.left < -2) {
      /* only report the OUTERMOST offender, or one wide table reports
         every cell inside it */
      if (el.parentElement) {
        const pr = el.parentElement.getBoundingClientRect();
        if (pr.right > vw + 2 || pr.left < -2) return;
      }
      /* content inside a scroll container is CONTAINED, not escaping: a
         wide table in a .table-scroll is doing exactly what it should */
      let a = el.parentElement, contained = false;
      while (a && a !== document.body) {
        const ov = getComputedStyle(a).overflowX;
        if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') { contained = true; break; }
        a = a.parentElement;
      }
      if (contained) return;
      problems.push('sticks out of the viewport: ' + name(el) +
                    ' [' + px(r.left) + '..' + px(r.right) + '] vw=' + vw);
    }
  });

  /* 3. a code span in a TABLE CELL must not wrap. A column is a hard
        constraint, so a wrap there splits an identifier or a signature in
        half and the cell stops meaning what it says: "gfx.rect(x, y, w,"
        is not a signature. In prose a long command wrapping across lines
        is ordinary and fine, so it is not checked; what IS checked
        everywhere is a code span running outside its container, below. */
  document.querySelectorAll('td code, th code, td kbd, th kbd').forEach((el) => {
    if (el.getClientRects().length > 1) {
      problems.push('code span wraps in a table cell: ' +
                    JSON.stringify(el.textContent.slice(0, 46)));
    }
  });

  /* 3b. a code span must never run outside the column it sits in */
  document.querySelectorAll('code, kbd').forEach((el) => {
    if (el.closest('pre')) return;
    const par = el.parentElement;
    if (!par) return;
    const r = el.getBoundingClientRect(), pr = par.getBoundingClientRect();
    if (r.width && pr.width && r.right > pr.right + 2) {
      problems.push('code span overflows its container: ' +
                    JSON.stringify(el.textContent.slice(0, 40)));
    }
  });

  /* 4. tables must fit the column they are read in */
  document.querySelectorAll('table').forEach((t) => {
    const par = t.parentElement;
    if (!par) return;
    /* a table inside a scroll container is contained, which is the whole
       point of the container; and one that scrolls itself is too */
    const own = getComputedStyle(t).overflowX;
    if (own === 'auto' || own === 'scroll') return;
    const pov = getComputedStyle(par).overflowX;
    if (pov === 'auto' || pov === 'scroll') return;
    if (t.getBoundingClientRect().width > par.getBoundingClientRect().width + 2) {
      const cols = t.querySelectorAll('tr') [0] ? t.querySelectorAll('tr')[0].children.length : '?';
      problems.push('table overflows its container (' + cols + ' columns)');
    }
  });

  /* 5. a code BLOCK may be wide, but then it must scroll inside its own
        box rather than pushing the page */
  document.querySelectorAll('pre').forEach((p) => {
    const cs = getComputedStyle(p);
    if (p.scrollWidth > p.clientWidth + 2 &&
        cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && cs.overflowX !== 'hidden') {
      problems.push('pre overflows without overflow-x: ' + JSON.stringify(p.textContent.slice(0, 40)));
    }
  });

  /* 6. images */
  document.querySelectorAll('img').forEach((im) => {
    if (im.complete && im.naturalWidth === 0) {
      problems.push('broken image: ' + im.getAttribute('src'));
    }
    const r = im.getBoundingClientRect();
    if (r.width > vw + 2) problems.push('image wider than the viewport: ' + im.getAttribute('src'));
  });

  /* 7. shape switchers: exactly one panel visible, and a tab for each */
  document.querySelectorAll('.shapes').forEach((s, i) => {
    const tabs = s.querySelectorAll('input[type=radio]').length;
    const figs = s.querySelectorAll('.shape-panels > figure').length;
    const vis = [...s.querySelectorAll('.shape-panels > figure')]
      .filter((f) => getComputedStyle(f).display !== 'none').length;
    if (!tabs || !figs) problems.push('switcher #' + i + ' is empty');
    else if (tabs !== figs) problems.push('switcher #' + i + ': ' + tabs + ' tabs vs ' + figs + ' panels');
    else if (vis !== 1) problems.push('switcher #' + i + ': ' + vis + ' panels visible, want 1');
  });

  /* 8. ids must be unique — a duplicate silently breaks every label,
        anchor and aria reference pointing at it */
  const seen = {}, dupes = {};
  document.querySelectorAll('[id]').forEach((el) => {
    if (seen[el.id]) dupes[el.id] = true; else seen[el.id] = true;
  });
  Object.keys(dupes).forEach((d) => problems.push('duplicate id: #' + d));

  /* 9. same-page anchors must land somewhere */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    const id = a.getAttribute('href').slice(1);
    if (id && !document.getElementById(id) && !document.getElementsByName(id).length) {
      problems.push('anchor goes nowhere: #' + id);
    }
  });

  /* 10. a control with no accessible name is a control nobody can ask for */
  document.querySelectorAll('button, a').forEach((el) => {
    const label = (el.textContent || '').trim() ||
      el.getAttribute('aria-label') || el.getAttribute('title') ||
      (el.querySelector('img') && el.querySelector('img').getAttribute('alt'));
    if (!label) problems.push('unlabelled ' + el.tagName.toLowerCase() +
                              (el.className ? ' .' + String(el.className).split(' ')[0] : ''));
  });

  /* 11. text clipped by its own box */
  document.querySelectorAll('p, li, td, th, h1, h2, h3, h4, figcaption').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 2) {
      problems.push('text clipped: ' + JSON.stringify(el.textContent.slice(0, 40)));
    }
  });

  return problems;
})()`;

/* ---- links, collected across pages and checked once ---- */
const LINKS = `[...document.querySelectorAll('a[href]')]
  .map(a => a.getAttribute('href'))
  .filter(h => h && !/^(#|mailto:|https?:|\\/\\/)/.test(h))`;

async function main() {
  if (args.includes('--build')) {
    console.log('building…\n');
    const r = spawnSync('bun', ['run', 'site:build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }

  try { await fetch(BASE); }
  catch (e) {
    console.error('audit: nothing serving at ' + BASE + '. Start it with `bun run site`.');
    process.exit(2);
  }

  const port = 9333;
  const tmp = '/tmp/mjsx-audit-profile';
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port,
    '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmp, 'about:blank'],
    { stdio: 'ignore', detached: false });

  let failures = 0, checked = 0;
  const allLinks = new Set();
  try {
    const page = await connect(port);
    const s = session(page);
    await s.ready;
    await s.send('Runtime.enable');
    await s.send('Page.enable');
    await s.send('Network.enable');
    await s.send('Network.setCacheDisabled', { cacheDisabled: true });

    const ev = async (expr) => (await s.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

    const pages = pageList();
    console.log('auditing ' + pages.length + ' page(s) at ' + WIDTHS.length +
                ' width(s) against ' + BASE + '\n');

    for (const p of pages) {
      for (const w of WIDTHS) {
        await s.send('Emulation.setDeviceMetricsOverride',
          { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
        s.reset();
        await s.send('Page.navigate', { url: 'about:blank' });
        await new Promise((r) => setTimeout(r, 120));
        await s.send('Page.navigate', { url: BASE + p });
        await new Promise((r) => setTimeout(r, 1700));
        /* let lazy frames and figures settle */
        await ev("document.querySelectorAll('iframe').forEach(f=>f.scrollIntoView())");
        await new Promise((r) => setTimeout(r, 900));

        const problems = (await ev(CHECKS)) || [];
        const js = s.consoleErrors.filter((e) => e && !/favicon/i.test(e));
        for (const l of (await ev(LINKS)) || []) {
          /* resolve against THIS page: `oscilloscope/` on /landing/ is
             /landing/oscilloscope/, not /oscilloscope/ */
          allLinks.add(new URL(l, BASE + p).pathname + ' <- ' + p);
        }

        checked++;
        const all = problems.concat(js.map((e) => 'js error: ' + e));
        if (all.length) {
          failures += all.length;
          console.log('FAIL ' + p + '  @' + w + 'px');
          for (const t of all) console.log('       ' + t);
        } else if (w === WIDTHS[0]) {
          console.log('ok   ' + p);
        }
      }
    }

    /* ---- links, once, after the sweep ---- */
    console.log('\nchecking ' + allLinks.size + ' internal link target(s)…');
    let dead = 0;
    for (const entry of allLinks) {
      const [href, from] = entry.split(' <- ');
      try {
        const r = await fetch(BASE + href, { redirect: 'follow' });
        if (!r.ok) { console.log('       DEAD ' + r.status + '  ' + href + '   (on ' + from + ')'); dead++; }
      } catch (e) { console.log('       DEAD (' + e.message + ')  ' + href); dead++; }
    }
    failures += dead;
    if (!dead) console.log('       all resolve');

    s.ws.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
  }

  console.log('\n' + (failures
    ? failures + ' problem(s) across ' + checked + ' page-renders'
    : 'clean: ' + checked + ' page-renders, no problems'));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('audit failed: ' + e.message); process.exit(2); });
