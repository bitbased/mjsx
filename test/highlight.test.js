/* The site's syntax highlighter.
 *
 * Three pages had grown three different highlighters, two of them a chain of
 * .replace() over already-escaped HTML. Every case below is a thing that
 * approach got wrong and that a real left-to-right tokenizer gets right, so
 * these tests are the reason /hl.js exists rather than a description of it.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');

var HL = path.join(__dirname, '..', 'site/public/hl.js');
var root = {};
new Function('window', fs.readFileSync(HL, 'utf8'))(root);
var hl = root.hl;

/* the text carried by every span of a given class */
function textOf(html, cls) {
  var re = new RegExp('<span class="' + cls + '">([\\s\\S]*?)</span>', 'g');
  var out = [], m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

describe('site highlighter', function () {
  it('does not colour keywords inside a block comment', function () {
    var out = hl('/* return a new function */\nvar x = 1;');
    expect(textOf(out, 'k')).toEqual(['var']);
    expect(textOf(out, 'c')).toEqual(['/* return a new function */']);
  });

  it('does not colour keywords inside a line comment', function () {
    var out = hl('// var y = function\nvar x;');
    expect(textOf(out, 'k')).toEqual(['var']);
  });

  it('does not colour keywords inside a string', function () {
    var out = hl('var s = "return new function";');
    expect(textOf(out, 'k')).toEqual(['var']);
    expect(textOf(out, 's')).toEqual(['"return new function"']);
  });

  it('does not end a string early on an escaped quote', function () {
    /* the classic /('[^']*')/ failure: it stops at the backslashed quote and
       everything after it is mis-parsed for the rest of the file */
    var out = hl("var s = 'it\\'s here'; var t = 1;");
    expect(textOf(out, 's')).toEqual(["'it\\'s here'"]);
    expect(textOf(out, 'k')).toEqual(['var', 'var']);
  });

  it('never emits a span nested inside a comment span', function () {
    /* what happens when a regex matches the markup a previous regex inserted */
    var out = hl('/* function clear() { return 0x44dd88; } */');
    var c = textOf(out, 'c');
    expect(c.length).toBe(1);
    expect(c[0].indexOf('<span')).toBe(-1);
  });

  it('escapes HTML in the source it is given', function () {
    var out = hl('var a = b < c && d > e;');
    expect(out.indexOf('&lt;')).toBeGreaterThan(-1);
    expect(out.indexOf('&gt;')).toBeGreaterThan(-1);
    /* the only < in the output should be the ones opening our own spans */
    expect(out.replace(/<\/?span[^>]*>/g, '').indexOf('<')).toBe(-1);
  });

  it('reads a hex colour as one number, not a 0 and a word', function () {
    var out = hl('var c = 0x44dd88;');
    expect(textOf(out, 'num')).toEqual(['0x44dd88']);
  });

  it('marks a called name, and only when it is really a call', function () {
    var out = hl('gfx.circle(1); var circle = 2;');
    expect(textOf(out, 'op')).toEqual(['circle']);
  });

  it('applies a caller vocabulary only to real identifiers', function () {
    /* the tencalls page colours the ten gfx calls; a mention of one inside a
       comment or a string is still a comment or a string */
    var names = { clear: 'fn', frect: 'fn' };
    var out = hl('/* clear */ "frect" clear: 1;', { names: names });
    expect(textOf(out, 'fn')).toEqual(['clear']);
    expect(textOf(out, 'c')).toEqual(['/* clear */']);
    expect(textOf(out, 's')).toEqual(['"frect"']);
  });

  it('leaves an unterminated comment or string as one token', function () {
    expect(textOf(hl('code; /* never closed'), 'c')).toEqual(['/* never closed']);
    expect(textOf(hl('var s = "never closed'), 's')).toEqual(['"never closed']);
  });

  it('round-trips the source text exactly', function () {
    /* colouring must not add, drop, or reorder a single character */
    var src = fs.readFileSync(path.join(__dirname, '..', 'site/public/hl.js'), 'utf8');
    var plain = hl(src).replace(/<\/?span[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(plain).toBe(src);
  });
});
