/* The subset checker, and the rule it exists to enforce.
 *
 * The second half is the point: every file that SHIPS TO A CHIP is
 * checked here, so modern syntax fails in CI rather than on a board that
 * will not boot. The first half keeps the checker itself honest — a
 * linter that cries wolf gets switched off, so the false-positive cases
 * matter as much as the detections.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');
var lint = require('../packages/core/src/es5lint.js').lint;

var ROOT = path.resolve(__dirname, '..');

function rules(code, level) {
  return lint(code, { level: level || 'mquickjs' }).map(function (f) { return f.rule; });
}

describe('es5 subset checker', function () {
  it('catches every ES6+ construct it claims to', function () {
    expect(rules('var f = function () {}; var g = () => 1;')).toContain('arrow');
    expect(rules('let x = 1;')).toContain('let');
    expect(rules('const y = 2;')).toContain('const');
    expect(rules('class A {}')).toContain('class');
    expect(rules('var s = `hi ${x}`;')).toContain('template-literal');
    expect(rules('f(...args);')).toContain('spread');
    expect(rules('var v = a?.b;')).toContain('optional-chaining');
    expect(rules('var v = a ?? b;')).toContain('nullish');
    expect(rules('var v = 2 ** 3;')).toContain('exponent');
    expect(rules('for (var v of xs) {}')).toContain('for-of');
    expect(rules('async function g() {}')).toContain('async');
    expect(rules('function g() { await h(); }')).toContain('await');
    expect(rules('import x from "y";')).toContain('modules');
    expect(rules('export var a = 1;')).toContain('modules');
    expect(rules('function* g() {}')).toContain('generator');
  });

  it('reports the line a problem is on', function () {
    var found = lint('var a = 1;\nvar b = 2;\nlet c = 3;', { level: 'mquickjs' });
    expect(found.length).toBe(1);
    expect(found[0].line).toBe(3);
  });

  /* A linter nobody trusts is a linter nobody runs. */
  describe('does not cry wolf', function () {
    var clean = [
      ['an arrow inside a string', 'var s = "a => b";'],
      ['a keyword inside a line comment', '// let x = 1\nvar a = 1;'],
      ['a keyword inside a block comment', '/* class A {} */ var a = 1;'],
      ['a regex containing a slash', 'var re = /a\\/b/g;'],
      ['division that is not a regex', 'var q = (a + b) / 2;'],
      ['keywords as properties', 'x.class = 1; y.const = 2; z.let = 3;'],
      ['keywords as object keys', 'var o = { const: 1, class: 2, of: 3 };'],
      ['identifiers that begin with a keyword', 'var letter = 1; var constant = 2;'],
      ['multiplication, not exponent', 'var m = a * b * c;'],
      ['a ternary, not nullish', 'var t = a ? b : c;'],
      ['a label, not an object key', 'outer: for (;;) { break outer; }'],
      ['dots inside a string', 'var s = "1...5";'],
      ['ES5 getters', 'var o = { get x() { return 1; } };'],
    ];
    clean.forEach(function (c) {
      it(c[0], function () {
        expect(lint(c[1], { level: 'mquickjs' })).toEqual([]);
      });
    });
  });

  it('relaxes for the levels above the chip', function () {
    var modern = 'var f = () => 1; let x = `hi`;';
    expect(lint(modern, { level: 'mquickjs' }).length).toBeGreaterThan(0);
    expect(lint(modern, { level: 'modern' })).toEqual([]);
    /* quickjs takes ES2020 syntax but still loads a flat script */
    expect(lint(modern, { level: 'quickjs' })).toEqual([]);
    expect(rules('import x from "y";', 'quickjs')).toContain('modules');
  });

  /* ---- the rule itself ---- */
  describe('everything that ships to a chip is in the subset', function () {
    /* the same set `bun run lint` checks — one definition, so the CLI
       cannot pass while CI fails */
    var files = require('../scripts/device-files.js').deviceFiles(ROOT);

    it('found the device code', function () {
      expect(files.length).toBeGreaterThan(10);
    });

    files.forEach(function (file) {
      it(path.relative(ROOT, file), function () {
        var found = lint(fs.readFileSync(file, 'utf8'), { level: 'mquickjs' });
        var msg = found.map(function (f) { return 'line ' + f.line + ': ' + f.message; }).join('\n');
        expect(msg).toBe('');
      });
    });
  });
});
