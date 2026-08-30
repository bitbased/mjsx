/* The JSX transpiler.
 *
 * Two kinds of check. The unit cases pin the emitted shape, including the
 * ones that are easy to get wrong: `1 < 2` is not an element, a `<` inside
 * a string or a comment is not an element, and an expression child may
 * contain more JSX. The corpus check is the one that matters: every
 * example in the repo must transpile, and the result must PARSE and
 * evaluate as JavaScript — because these files are what gets pushed to a
 * board, where a syntax error is a brick rather than a stack trace.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');
var transpile = require('../packages/core/src/jsx.js').transpile;

var ROOT = path.resolve(__dirname, '..');

describe('jsx transpiler', function () {
  it('turns an element into an h() call', function () {
    expect(transpile('<box/>')).toBe('h("box", {})');
  });

  it('keeps lowercase tags as strings and capitalised ones as identifiers', function () {
    expect(transpile('<box/>')).toContain('h("box"');
    expect(transpile('<Button/>')).toContain('h(Button');
    expect(transpile('<UI.Thing/>')).toContain('h(UI.Thing');
  });

  it('handles string, expression and bare attributes', function () {
    var out = transpile('<box align="center" w={1 + 2} clip/>');
    expect(out).toContain('align: "center"');
    expect(out).toContain('w: (1 + 2)');
    expect(out).toContain('clip: true');
  });

  it('quotes only the keys that need it', function () {
    expect(transpile('<box a={1} data-x={2}/>')).toContain('{ a: (1), "data-x": (2) }');
  });

  it('nests children, one bare and several as an array', function () {
    expect(transpile('<box><row/></box>')).toBe('h("box", {}, h("row", {}))');
    expect(transpile('<box><row/><row/></box>')).toContain(', [h("row", {}), h("row", {})]');
  });

  it('passes expression children through, including nested JSX', function () {
    expect(transpile('<box>{kids}</box>')).toContain('(kids)');
    var nested = transpile('<box>{cond ? <a/> : <b/>}</box>');
    expect(nested).toContain('h("a", {})');
    expect(nested).toContain('h("b", {})');
  });

  it('drops JSX comments and whitespace-only lines between elements', function () {
    expect(transpile('<box>{/* note */}<row/></box>')).toBe('h("box", {}, h("row", {}))');
    expect(transpile('<box>\n  <row/>\n</box>')).toBe('h("box", {}, h("row", {}))');
  });

  it('keeps text children', function () {
    expect(transpile('<text>hello</text>')).toBe('h("text", {}, "hello")');
  });

  it('does not mistake less-than for an element', function () {
    expect(transpile('var a = 1 < 2;')).toBe('var a = 1 < 2;');
    expect(transpile('if (x<y && y<z) {}')).toBe('if (x<y && y<z) {}');
  });

  it('leaves < alone inside strings and comments', function () {
    expect(transpile('var s = "<box/>";')).toBe('var s = "<box/>";');
    expect(transpile('// <box/>\nvar a = 1;')).toBe('// <box/>\nvar a = 1;');
    expect(transpile('/* <box/> */ var a = 1;')).toBe('/* <box/> */ var a = 1;');
  });

  it('refuses what it does not support, with a line number', function () {
    expect(function () { transpile('var a = <>x</>;'); }).toThrow(/fragment/);
    expect(function () { transpile('var a = <box {...p}/>;'); }).toThrow(/spread/);
    expect(function () { transpile('var a = <box>;'); }).toThrow(/line 1/);
  });

  it('reports an unclosed element rather than emitting nonsense', function () {
    expect(function () { transpile('<box><row/>'); }).toThrow(/never closed/);
    expect(function () { transpile('<box></row>'); }).toThrow(/does not match/);
  });

  /* The corpus: every app in the repo, transpiled and then evaluated.
     `new Function` throws on a syntax error, which is exactly the failure
     that would otherwise reach a device as an unbootable bundle. */
  /* `(x | 0) << 4` is a shift, not a tag. It reads as JSX to a scanner that
     treats every '<' after a punctuator as an element opener: ')' does not
     open one, so the first '<' becomes a punctuator itself, and then the
     SECOND '<' looks like the start of a tag with no name. examples/clock
     hit exactly this while packing BCD. */
  it('leaves shift operators alone', function () {
    var out = transpile('var a = (((n / 10) | 0) << 4) | (n % 10);', 'shift');
    expect(out).toContain('<< 4');
    expect(out).not.toContain('h(');

    expect(transpile('var b = x >> 2;', 'shift')).toContain('>> 2');
    expect(transpile('var c = 1 << 3 << 2;', 'shift')).toContain('1 << 3 << 2');
    /* and the guard must not cost a real element its opener */
    expect(transpile('var d = cond ? <box/> : null;', 'shift')).toContain('h("box"');
  });

  describe('every example transpiles to valid JavaScript', function () {
    var dirs = [];
    ['examples', 'local-examples'].forEach(function (d) {
      var full = path.join(ROOT, d);
      if (!fs.existsSync(full)) return;
      fs.readdirSync(full).forEach(function (name) {
        var app = path.join(full, name, 'app.jsx');
        if (fs.existsSync(app)) dirs.push({ name: d + '/' + name, file: app });
      });
    });

    it('found examples to check', function () {
      expect(dirs.length).toBeGreaterThan(5);
    });

    dirs.forEach(function (ex) {
      it(ex.name, function () {
        var src = fs.readFileSync(ex.file, 'utf8');
        var out = transpile(src);
        expect(out).not.toContain('</');          /* no JSX survived */
        /* parses as a function body, with the ambient globals a device
           provides declared so free references are not the thing failing */
        var wrap = 'var h,UI,gfx,sys,em,Button,Keyboard,ArcFooter,Modal,Swatch,' +
                   'configStorage,module,net,require;\n' + out;
        expect(function () { new Function(wrap); }).not.toThrow();
      });
    });
  });
});
