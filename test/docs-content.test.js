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
