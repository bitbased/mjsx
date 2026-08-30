/* hl.js — one syntax highlighter, shared by every page on this site that
 * shows JavaScript.
 *
 * It exists because the pages had grown three different highlighters, two of
 * them a chain of .replace() over already-escaped HTML. That approach cannot
 * be made correct, and the bugs it produces are exactly the ones that got
 * reported: keywords coloured INSIDE comments and strings, regexes matching
 * the <span> markup they had just inserted, and anything containing an
 * escaped quote coming out mangled.
 *
 * This is a single left-to-right pass that asks one question per character —
 * what does this character START? — and consumes the whole token before
 * looking at anything else. A keyword inside a comment is never seen as a
 * keyword, because the comment is consumed whole before the scan resumes.
 *
 * Token classes emitted (style them yourself, per page palette):
 *   .c    comment        .s   string
 *   .k    keyword        .num number
 *   .op   callee (a word immediately followed by "(")
 */
(function (root) {
  'use strict';

  var KEYWORDS = {
    'var': 1, 'let': 1, 'const': 1, 'function': 1, 'return': 1, 'if': 1,
    'else': 1, 'for': 1, 'while': 1, 'break': 1, 'continue': 1, 'new': 1,
    'typeof': 1, 'instanceof': 1, 'this': 1, 'null': 1, 'undefined': 1,
    'true': 1, 'false': 1, 'in': 1, 'of': 1, 'delete': 1, 'void': 1, 'do': 1,
    'switch': 1, 'case': 1, 'default': 1, 'throw': 1, 'try': 1, 'catch': 1,
    'finally': 1
  };

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function span(cls, text) {
    return '<span class="' + cls + '">' + esc(text) + '</span>';
  }

  /* hl(src, opts)
     opts.names — {identifier: cssClass}, for pages that want to pick out a
     particular vocabulary (the ten gfx calls, say). Applied only to real
     identifier tokens, so a name appearing inside a comment or a string
     stays a comment or a string. */
  function hl(src, opts) {
    src = String(src == null ? '' : src);
    var names = (opts && opts.names) || null;
    var out = '', i = 0, n = src.length;
    while (i < n) {
      var c = src.charAt(i), c2 = src.charAt(i + 1);

      /* block comment — consumed whole, so nothing inside it is ever
         re-examined as code */
      if (c === '/' && c2 === '*') {
        var e = src.indexOf('*/', i + 2);
        e = e < 0 ? n : e + 2;
        out += span('c', src.slice(i, e)); i = e; continue;
      }
      /* line comment */
      if (c === '/' && c2 === '/') {
        var el = src.indexOf('\n', i);
        if (el < 0) el = n;
        out += span('c', src.slice(i, el)); i = el; continue;
      }
      /* string or template literal, honouring backslash escapes so that
         'it\'s' does not terminate early */
      if (c === '"' || c === "'" || c === '`') {
        var j = i + 1;
        while (j < n) {
          var cj = src.charAt(j);
          if (cj === '\\') { j += 2; continue; }
          if (cj === c) { j++; break; }
          j++;
        }
        out += span('s', src.slice(i, j)); i = j; continue;
      }
      /* number, including hex — 0x44dd88 is one token, not a 0 and a word */
      if (c >= '0' && c <= '9') {
        var k = i;
        while (k < n && /[0-9a-fA-FxX.]/.test(src.charAt(k))) k++;
        out += span('num', src.slice(i, k)); i = k; continue;
      }
      /* word: a keyword, a callee, or plain identifier */
      if (/[A-Za-z_$]/.test(c)) {
        var w = i;
        while (w < n && /[A-Za-z0-9_$]/.test(src.charAt(w))) w++;
        var word = src.slice(i, w);
        if (KEYWORDS[word]) out += span('k', word);
        else if (names && names[word]) out += span(names[word], word);
        else if (/^\s*\(/.test(src.slice(w))) out += span('op', word);
        else out += esc(word);
        i = w; continue;
      }
      out += esc(c); i++;
    }
    return out;
  }

  /* Paint a highlighted copy UNDER a transparent textarea, so the text the
     user edits is the text they see coloured. The two layers must agree on
     every metric that affects wrapping, or the caret drifts from the glyphs
     — the caller's stylesheet owns that; this owns keeping them in sync. */
  function attach(ta, pre) {
    if (!ta || !pre) return function () {};
    function paint() {
      /* the trailing newline matters: without it a textarea ending in a
         blank line scrolls one line further than the copy beneath it */
      pre.innerHTML = hl(ta.value + '\n');
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
    function sync() { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
    ta.addEventListener('input', paint);
    ta.addEventListener('scroll', sync);
    paint();
    return paint;
  }

  root.hl = hl;
  root.hlEsc = esc;
  root.hlAttach = attach;
})(typeof window !== 'undefined' ? window : this);
