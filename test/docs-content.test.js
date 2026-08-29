/* The documentation's claims, checked against the code it describes.
 *
 * Prose rots quietly. A renamed export, a changed default, a component
 * that gained a prop — none of it breaks a build, and none of it is
 * visible in a diff of the file that changed. These tests read the docs
 * and ask the source whether they are still true.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DOCS = path.join(ROOT, 'docs');
var transpile = require('../packages/core/src/jsx.js').transpile;

function docs() {
  return fs.readdirSync(DOCS).filter(function (f) { return /\.md$/.test(f); });
}
function read(f) { return fs.readFileSync(path.join(DOCS, f), 'utf8'); }

/* every ```<lang> block, with the line it starts on */
function blocks(md, lang) {
  var out = [], lines = md.split('\n'), i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '```' + lang) {
      var start = i + 1, j = start;
      while (j < lines.length && lines[j].trim() !== '```') j++;
      out.push({ line: start + 1, code: lines.slice(start, j).join('\n') });
      i = j + 1;
    } else i++;
  }
  return out;
}

describe('documentation', function () {
  it('every JSX snippet is valid JSX', function () {
    /* The transpiler is the same one that runs when a bundle is pushed to
       a chip, so this is exactly the question that matters: would this
       snippet survive being pasted into an app? It caught nothing the day
       it was written — the point is the day someone changes the syntax. */
    var bad = [], count = 0;
    docs().forEach(function (f) {
      blocks(read(f), 'jsx').forEach(function (b) {
        count++;
        try { transpile(b.code); }
        catch (e) {
          bad.push('docs/' + f + ':' + b.line + '  ' + String(e.message).split('\n')[0]);
        }
      });
    });
    expect(count).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('every component the core exports is documented', function () {
    /* Swatch and Modal were exported, had figures generated for them, and
       appeared nowhere on the components page. A reference page that is
       missing entries is worse than a short one: it reads as complete. */
    var core = fs.readFileSync(path.join(ROOT, 'packages/core/src/mjsx.js'), 'utf8');
    var m = /module\.exports\s*=\s*\{([\s\S]*?)\};/.exec(core);
    expect(m).not.toBeNull();
    var exported = m[1].split(',').map(function (p) { return p.split(':')[0].trim(); })
                       .filter(Boolean);

    /* A component is an export DEFINED as `function Name(p)` — one that
       takes a props object and returns a tree. That is what separates
       Button and Modal from UI and FONT, which are capitalised singletons
       and belong on other pages. Asking the source beats a name rule. */
    var components = exported.filter(function (n) {
      return /^[A-Z]/.test(n) &&
             new RegExp('function\\s+' + n + '\\s*\\(\\s*p\\s*\\)').test(core);
    });
    expect(components.length).toBeGreaterThan(3);

    var docd = read('components.md');
    var missing = components.filter(function (n) {
      return docd.indexOf('## ' + n) < 0;
    });
    expect(missing).toEqual([]);
  });

  it('the components page shows every component it documents', function () {
    /* It documents things that are pictures. It had none. */
    var md = read('components.md');
    var sections = md.split(/^## /m).slice(1);
    var noFigure = sections
      .filter(function (s) { return !/!\[[^\]]*\]\([^)]+\)/.test(s); })
      .map(function (s) { return s.split('\n')[0].trim(); });
    expect(noFigure).toEqual([]);
  });

  it('names no example, doc or figure that does not exist', function () {
    var bad = [];
    docs().forEach(function (f) {
      var md = read(f);
      /* examples/<name> */
      /* stand-ins in command lines, not references to a real example */
      var PLACEHOLDER = ['yours', 'your-app', 'name', 'app'];
      var re = /`?examples\/([a-z0-9-]+)\//g, m;
      while ((m = re.exec(md))) {
        if (PLACEHOLDER.indexOf(m[1]) >= 0) continue;
        if (!fs.existsSync(path.join(ROOT, 'examples', m[1]))) {
          bad.push('docs/' + f + ': examples/' + m[1] + ' does not exist');
        }
      }
      /* sibling doc links */
      var dre = /\]\((?:\.\/)?([a-z0-9-]+)\.md(?:#[^)]*)?\)/g;
      while ((m = dre.exec(md))) {
        if (!fs.existsSync(path.join(DOCS, m[1] + '.md'))) {
          bad.push('docs/' + f + ': links to ' + m[1] + '.md which does not exist');
        }
      }
      /* figures */
      var ire = /img\/([A-Za-z0-9._-]+\.png)/g;
      while ((m = ire.exec(md))) {
        if (!fs.existsSync(path.join(DOCS, 'img', m[1]))) {
          bad.push('docs/' + f + ': figure ' + m[1] + ' does not exist');
        }
      }
    });
    expect(bad).toEqual([]);
  });

  it('the call counts in consistency.md match the source', function () {
    /* That page's whole premise is that every number in it was read out of
       a named file. Two of them had drifted — gfx.height claimed 16 call
       sites against 23, gfx.width 13 against 18 — which is exactly the
       kind of rot that makes a reader stop trusting the rest of a page
       that is otherwise correct. Counted here so it cannot happen again. */
    var core = fs.readFileSync(path.join(ROOT, 'packages/core/src/mjsx.js'), 'utf8');
    var md = read('consistency.md');
    var re = /^\| `(gfx|sys)\.([a-z]+)` \| (\d+) \|/gm, m;
    var wrong = [], checked = 0;
    while ((m = re.exec(md))) {
      var sym = m[1] + '.' + m[2], claimed = Number(m[3]);
      var actual = (core.match(new RegExp(m[1] + '\\.' + m[2] + '\\b', 'g')) || []).length;
      checked++;
      if (actual !== claimed) wrong.push(sym + ': doc says ' + claimed + ', source has ' + actual);
    }
    expect(checked).toBeGreaterThan(8);
    expect(wrong).toEqual([]);
  });

  it('the constants the docs quote are the constants in the code', function () {
    /* These numbers appear on four different pages each. A reader who
       checks one against the source and finds it right will trust the
       rest, which is exactly why a drifted one does so much damage. */
    var core = fs.readFileSync(path.join(ROOT, 'packages/core/src/mjsx.js'), 'utf8');
    var FACTS = [
      ['DRAG_SLOP', /var DRAG_SLOP = (\d+);/, '6'],
      ['qwerty threshold', /kbW >= (\d+) \? 'qwerty'/, '220'],
      ['t9 threshold', /kbW >= (\d+) \? 't9'/, '115'],
      ['auto-exclusive height', /!UI\._exclusive && UI\._focus && kh < (\d+)\)/, '30'],
      ['caret blink period', /sys\.millis\(\) - ist\.bt\) \/ (\d+)\)/, '530']
    ];
    var wrong = [];
    FACTS.forEach(function (f) {
      var m = f[1].exec(core);
      if (!m) { wrong.push(f[0] + ': not found in mjsx.js — has it been renamed?'); return; }
      if (m[1] !== f[2]) wrong.push(f[0] + ': code says ' + m[1] + ', the docs say ' + f[2]);
      /* and some page must actually quote it, or the test guards nothing */
      var quoted = docs().some(function (d) { return read(d).indexOf(f[2]) >= 0; });
      if (!quoted) wrong.push(f[0] + ': no page quotes ' + f[2] + ' any more');
    });
    expect(wrong).toEqual([]);
  });

  it('code quoted from the core still matches the core', function () {
    /* Several pages quote a function verbatim — kbChordHW appears on two,
       because a reader on the round-glass page should not have to jump to
       the keyboard page to see the formula. Duplication is right for
       reading and wrong for staying true, so the copies are checked
       against the source rather than against each other.

       Two things this must NOT flag, both of which it did at first:
       a block may quote SEVERAL functions (layout.md quotes padL/R/T/B
       together), so each is matched on its own; and a quote may be
       deliberately abbreviated with an ellipsis, which is an excerpt, not
       a stale copy. */
    var SOURCES = fs.readFileSync(path.join(ROOT, 'packages/core/src/mjsx.js'), 'utf8');
    /* Comments are stripped before comparing: a doc quote reasonably drops
       the source's internal asides, and reflows the result. What must not
       differ is the code. (A crude strip — it would mangle a // inside a
       string literal — but these are quotes of real functions, and a
       false match is the harmless direction here.) */
    var norm = function (t) {
      return t.replace(/\/\*[\s\S]*?\*\//g, ' ')
              .replace(/\/\/[^\n]*/g, ' ')
              .replace(/\s+/g, ' ').trim();
    };

    /* every top-level `function name(...) { … }` in a chunk of text */
    function fns(text) {
      var out = [], re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g, m;
      while ((m = re.exec(text))) {
        var open = text.indexOf('{', m.index);
        if (open < 0) continue;
        var depth = 0, i = open;
        for (; i < text.length; i++) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') { depth--; if (!depth) break; }
        }
        if (depth) continue;                       /* unbalanced: an excerpt */
        out.push({ name: m[1], text: text.slice(m.index, i + 1) });
        re.lastIndex = i + 1;
      }
      return out;
    }

    var source = {};
    fns(SOURCES).forEach(function (f) { if (!source[f.name]) source[f.name] = f.text; });

    var wrong = [], checked = 0;
    docs().forEach(function (f) {
      ['js', 'jsx'].forEach(function (lang) {
        blocks(read(f), lang).forEach(function (b) {
          if (/\.\.\.|…/.test(b.code)) return;      /* an abbreviated excerpt */
          fns(b.code).forEach(function (q) {
            if (!source[q.name]) return;           /* an illustration, not a quote */
            checked++;
            if (norm(source[q.name]) !== norm(q.text)) {
              wrong.push('docs/' + f + ':' + b.line + '  ' + q.name +
                         '() no longer matches packages/core/src/mjsx.js');
            }
          });
        });
      });
    });
    expect(checked).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  it('every page has a written label in the sidebar', function () {
    /* A page not placed in a group still appears, but under its raw
       filename — `shapes` and `shots` sat in lowercase next to written
       labels for weeks. The fallback exists so a new page is never
       unreachable, not as somewhere to leave it. */
    var cfg = fs.readFileSync(path.join(ROOT, 'site/astro.config.mjs'), 'utf8');
    var placed = [];
    var re = /\{ label: '[^']+', slug: '([a-z0-9-]+)' \}/g, m;
    while ((m = re.exec(cfg))) placed.push(m[1]);

    var unplaced = docs()
      .map(function (f) { return f === 'README.md' ? 'index' : f.replace(/\.md$/, ''); })
      .filter(function (slug) { return slug !== 'index' && placed.indexOf(slug) < 0; });
    expect(unplaced).toEqual([]);
  });

  it('every page says what it is for before it says anything else', function () {
    /* a heading followed straight by a heading, or by a table, gives a
       reader no way to tell whether they are on the right page */
    var bad = [];
    docs().forEach(function (f) {
      var lines = read(f).split('\n');
      var h1 = lines.findIndex(function (l) { return /^# /.test(l); });
      if (h1 < 0) { bad.push('docs/' + f + ': no title'); return; }
      var next = lines.slice(h1 + 1).find(function (l) { return l.trim(); });
      if (!next || /^(#|\||```)/.test(next.trim())) {
        bad.push('docs/' + f + ': nothing between the title and ' +
                 JSON.stringify((next || '').trim().slice(0, 30)));
      }
    });
    expect(bad).toEqual([]);
  });
});
