/* What the generated site pages must be true about.
 *
 * Everything here is a bug that actually shipped. The docs are generated
 * from docs/*.md, and a generator failure is invisible: the build is green,
 * the page exists, and the thing on it is broken in a way only someone
 * opening that exact page would see.
 *
 *   - every <img src="./img/..."> in docs/shapes.md was rewritten only for
 *     markdown image syntax, not HTML attributes. Served at /shapes/, they
 *     resolved to /shapes/img/... and 404'd. The whole shape switcher was
 *     broken images and nobody could tell from the build output.
 *   - two switchers on one page shared a radio `name`, so they were ONE
 *     group: the second one's `checked` deselected the first, and neither
 *     showed anything until clicked.
 *   - a switcher generated inside a markdown TABLE CELL destroyed the table
 *     and left an empty <div class="shapes"> behind.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var GEN = path.join(ROOT, 'site/src/content/docs');
var IMG = path.join(ROOT, 'site/public/img');

var HAVE = fs.existsSync(GEN);
if (!HAVE) console.warn('\ndocs-site: SKIPPED — run `bun run docs:sync`.\n');
var maybe = HAVE ? it : it.skip;

function pages() {
  return fs.readdirSync(GEN).filter(function (f) { return /\.mdx?$/.test(f); });
}
function read(f) { return fs.readFileSync(path.join(GEN, f), 'utf8'); }

/* every <div class="shapes"> … </div> on a page, crudely but adequately:
   the generator emits them as one contiguous block with no blank lines */
function switchers(md) {
  var out = [], re = /<div class="shapes">([\s\S]*?)\n<\/div>/g, m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

describe('generated docs pages', function () {
  maybe('there are pages', function () {
    expect(pages().length).toBeGreaterThan(5);
  });

  maybe('no image path is page-relative', function () {
    /* a relative path resolves against /<slug>/ and 404s */
    var bad = [];
    pages().forEach(function (f) {
      var md = read(f);
      var rel = md.match(/(?:\]\(|src\s*=\s*["'])(?!\/)(?:\.\/)?img\//g);
      if (rel) bad.push(f + ': ' + rel.length + ' relative image path(s)');
    });
    expect(bad).toEqual([]);
  });

  maybe('every referenced image exists', function () {
    var missing = [];
    pages().forEach(function (f) {
      var md = read(f);
      var re = /(?:\]\(|src\s*=\s*")(\/img\/[A-Za-z0-9._-]+\.png)/g, m;
      while ((m = re.exec(md))) {
        if (!fs.existsSync(path.join(IMG, path.basename(m[1])))) {
          missing.push(f + ' -> ' + m[1]);
        }
      }
    });
    expect(missing).toEqual([]);
  });

  maybe('no two switchers on a page share a radio group', function () {
    /* sharing a name makes them one group: the last `checked` wins and
       every other switcher starts with nothing selected */
    var clashes = [];
    pages().forEach(function (f) {
      var names = {};
      switchers(read(f)).forEach(function (body) {
        var m = /name="([^"]+)"/.exec(body);
        if (!m) return;
        if (names[m[1]]) clashes.push(f + ': two switchers named ' + m[1]);
        names[m[1]] = true;
      });
    });
    expect(clashes).toEqual([]);
  });

  maybe('every switcher has tabs, panels, and exactly one default', function () {
    var bad = [];
    pages().forEach(function (f) {
      switchers(read(f)).forEach(function (body, i) {
        var tabs = (body.match(/type="radio"/g) || []).length;
        var figs = (body.match(/<figure>/g) || []).length;
        var checked = (body.match(/\schecked>/g) || []).length;
        if (tabs === 0 || figs === 0) bad.push(f + ' #' + i + ': empty switcher');
        else if (tabs !== figs) bad.push(f + ' #' + i + ': ' + tabs + ' tabs vs ' + figs + ' panels');
        else if (checked !== 1) bad.push(f + ' #' + i + ': ' + checked + ' default(s)');
      });
    });
    expect(bad).toEqual([]);
  });

  maybe('no switcher exceeds what the stylesheet can select', function () {
    /* the CSS writes one :nth-of-type pair per tab; past that a tab
       silently shows nothing when clicked */
    var css = fs.readFileSync(path.join(ROOT, 'site/src/styles/mjsx.css'), 'utf8');
    var supported = 0;
    for (var n = 1; n <= 20; n++) {
      if (css.indexOf('input:nth-of-type(' + n + '):checked') >= 0) supported = n;
      else break;
    }
    expect(supported).toBeGreaterThan(4);

    var over = [];
    pages().forEach(function (f) {
      switchers(read(f)).forEach(function (body, i) {
        var tabs = (body.match(/type="radio"/g) || []).length;
        if (tabs > supported) over.push(f + ' #' + i + ': ' + tabs + ' tabs, CSS covers ' + supported);
      });
    });
    expect(over).toEqual([]);
  });

  maybe('no switcher was generated inside a table row', function () {
    /* a block element in a table cell destroys the table */
    var bad = [];
    pages().forEach(function (f) {
      read(f).split('\n').forEach(function (line, n) {
        if (line.indexOf('<div class="shapes">') >= 0 && /^\s*\|/.test(line)) {
          bad.push(f + ':' + (n + 1) + ' switcher inside a table row');
        }
      });
    });
    expect(bad).toEqual([]);
  });

  maybe('embedded simulators point at the embed mode of a real example', function () {
    var bad = [];
    pages().forEach(function (f) {
      var re = /<iframe class="sim-embed" src="([^"]+)"/g, m;
      while ((m = re.exec(read(f)))) {
        var src = m[1];
        if (src.indexOf('?embed=1') < 0) bad.push(f + ': ' + src + ' is not embed mode');
        var ex = /#ex=([a-z0-9-]+)/.exec(src);
        if (!ex) { bad.push(f + ': ' + src + ' names no example'); continue; }
        if (!fs.existsSync(path.join(ROOT, 'examples', ex[1], 'app.jsx'))) {
          bad.push(f + ': ' + src + ' — no such example');
        }
      }
    });
    expect(bad).toEqual([]);
  });

  maybe('every simulator link names an example that exists', function () {
    var bad = [];
    pages().forEach(function (f) {
      var re = /class="run-example" href="\/play\/#ex=([a-z0-9-]+)/g, m;
      while ((m = re.exec(read(f)))) {
        if (!fs.existsSync(path.join(ROOT, 'examples', m[1], 'app.jsx'))) {
          bad.push(f + ': /play/#ex=' + m[1] + ' — no such example');
        }
      }
    });
    expect(bad).toEqual([]);
  });
});
