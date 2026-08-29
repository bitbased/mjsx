/*
 * JSX -> JS, small enough to run anywhere the UI does.
 *
 * WHY THIS EXISTS. Pushing an app to a device needed `tsc` on the
 * machine -- the one real dependency in a project that otherwise has
 * none, and an awkward one, because Bun's own transpiler MODERNISES the
 * ES5 that MicroQuickJS requires (arrow functions and `let` come back out
 * of it) so the obvious substitute is wrong. This does the one job that
 * is actually needed and nothing else.
 *
 * WHAT IT DOES. Rewrites JSX elements into h() calls and leaves every
 * other byte alone. It is NOT a JavaScript compiler: app code is already
 * in the ES5 subset by house rule, so there is nothing to downlevel. That
 * is what keeps this a few hundred lines instead of a project.
 *
 * WHERE IT RUNS. Written in the same ES5 subset it serves, with no
 * dependencies and no Node API, so the same file works in the CLI, in a
 * browser for an online playground, and inside MicroQuickJS itself --
 * which is what a device would need to accept source rather than a
 * pre-built bundle.
 *
 * SUPPORTED: elements and self-closing elements; lowercase names as
 * string tags and Capitalised (or dotted) names as identifiers;
 * attributes as name="str", name={expr} and bare name (true); children as
 * text, {expr}, nested elements and {/* comments *\/}; JSX nested inside
 * an expression child.
 * NOT SUPPORTED, because nothing here uses them: fragments (<>) and
 * spread attributes ({...props}). Both throw with a line number rather
 * than emitting something subtly wrong.
 */

function jsxTranspile(src, opts) {
  var pragma = (opts && opts.pragma) || 'h';
  var out = '';
  var i = 0;
  var n = src.length;

  function lineOf(pos) {
    var line = 1;
    for (var k = 0; k < pos && k < n; k++) if (src.charAt(k) === '\n') line++;
    return line;
  }
  function fail(pos, msg) {
    throw new Error('jsx: ' + msg + ' (line ' + lineOf(pos) + ')');
  }

  function isIdentStart(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
  }
  function isIdentPart(c) {
    return isIdentStart(c) || (c >= '0' && c <= '9');
  }

  /* Does the `<` at `pos` open JSX, or is it less-than? Decided by the
     previous meaningful character: an operand before it means comparison,
     an operator or opener means an expression is starting. */
  function opensJsx(pos) {
    var k = pos - 1;
    while (k >= 0) {
      var c = src.charAt(k);
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { k--; continue; }
      /* skip back over a line comment's body is not needed: a `<` inside
         one never reaches here, since scanning handles comments */
      break;
    }
    if (k < 0) return true;
    var p = src.charAt(k);
    if ('([{,;:=+-*/%&|^!?~<>'.indexOf(p) !== -1) return true;
    /* `return <box/>`, `case <x/>`, `typeof` etc: a keyword before it */
    var end = k + 1, start = k;
    while (start >= 0 && isIdentPart(src.charAt(start))) start--;
    var word = src.substring(start + 1, end);
    return word === 'return' || word === 'case' || word === 'in' ||
           word === 'of' || word === 'do' || word === 'else' ||
           word === 'typeof' || word === 'void' || word === 'delete';
  }

  /* Scan forward from `from` to the end of a balanced {...}, honouring
     strings, comments, and any JSX inside. Returns the index of the
     closing brace. */
  function matchBrace(from) {
    var depth = 0;
    var k = from;
    while (k < n) {
      var c = src.charAt(k);
      if (c === '"' || c === "'" || c === '`') { k = skipString(k); continue; }
      if (c === '/' && src.charAt(k + 1) === '/') { k = skipLineComment(k); continue; }
      if (c === '/' && src.charAt(k + 1) === '*') { k = skipBlockComment(k); continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return k; }
      k++;
    }
    fail(from, 'unbalanced { in an expression');
  }
  function skipString(k) {
    var q = src.charAt(k);
    k++;
    while (k < n) {
      var c = src.charAt(k);
      if (c === '\\') { k += 2; continue; }
      if (c === q) return k + 1;
      k++;
    }
    fail(k, 'unterminated string');
  }
  function skipLineComment(k) {
    while (k < n && src.charAt(k) !== '\n') k++;
    return k;
  }
  function skipBlockComment(k) {
    k += 2;
    while (k < n && !(src.charAt(k) === '*' && src.charAt(k + 1) === '/')) k++;
    return k + 2;
  }

  function jsString(s) {
    return JSON.stringify(s);
  }

  /* An object key only needs quoting when it is not a plain identifier;
     leaving the quotes off matches what every other JSX compiler emits
     and keeps the pushed bundle a little smaller. */
  function jsKey(k) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : jsString(k);
  }

  /* ---- the JSX grammar ---- */

  function parseName(k) {
    var start = k;
    if (!isIdentStart(src.charAt(k))) fail(k, 'expected an element or attribute name');
    k++;
    while (k < n && (isIdentPart(src.charAt(k)) || src.charAt(k) === '-' ||
                     src.charAt(k) === '.' || src.charAt(k) === ':')) k++;
    return { name: src.substring(start, k), end: k };
  }

  function skipWs(k) {
    while (k < n && ' \t\r\n'.indexOf(src.charAt(k)) !== -1) k++;
    return k;
  }

  /* Returns { code, end } where code is the h(...) call. */
  function parseElement(k) {
    if (src.charAt(k) !== '<') fail(k, 'expected <');
    k++;
    if (src.charAt(k) === '>') fail(k, 'fragments (<>) are not supported');
    var nm = parseName(k);
    var tag = nm.name;
    k = nm.end;

    /* props */
    var props = [];
    for (;;) {
      k = skipWs(k);
      var c = src.charAt(k);
      if (c === '>' || (c === '/' && src.charAt(k + 1) === '>')) break;
      if (c === '{') fail(k, 'spread attributes ({...x}) are not supported');
      var an = parseName(k);
      k = skipWs(an.end);
      if (src.charAt(k) !== '=') {
        /* bare attribute: <box clip> means clip={true} */
        props.push(jsKey(an.name) + ': true');
        continue;
      }
      k = skipWs(k + 1);
      if (src.charAt(k) === '"' || src.charAt(k) === "'") {
        var e = skipString(k);
        var lit = src.substring(k + 1, e - 1);
        props.push(jsKey(an.name) + ': ' + jsString(lit));
        k = e;
      } else if (src.charAt(k) === '{') {
        var close = matchBrace(k);
        var expr = transpileRange(k + 1, close);
        /* the value keeps its parentheses: an expression child may be a
           sequence or a conditional, and bare insertion would change
           what it means inside an object literal */
        props.push(jsKey(an.name) + ': (' + expr + ')');
        k = close + 1;
      } else {
        fail(k, 'attribute ' + an.name + ' needs a "string" or an {expression}');
      }
    }

    var selfClosing = src.charAt(k) === '/';
    k = selfClosing ? k + 2 : k + 1;

    var kids = [];
    if (!selfClosing) {
      var r = parseChildren(k, tag);
      kids = r.kids;
      k = r.end;
    }

    var tagCode = /^[a-z]/.test(tag) && tag.indexOf('.') === -1
      ? jsString(tag)          /* intrinsic: 'box', 'row', ... */
      : tag;                   /* component: Button, UI.Thing */
    var propCode = props.length ? '{ ' + props.join(', ') + ' }' : '{}';
    var code = pragma + '(' + tagCode + ', ' + propCode;
    if (kids.length === 1) code += ', ' + kids[0];
    else if (kids.length > 1) code += ', [' + kids.join(', ') + ']';
    code += ')';
    return { code: code, end: k };
  }

  function parseChildren(k, tag) {
    var kids = [];
    var text = '';

    /* JSX drops whitespace-only runs that contain a newline, and trims
       the newline-adjacent edges of a text run. Without this every
       indented tree would gain stray " " children. */
    function flushText() {
      if (!text) return;
      var hasNl = text.indexOf('\n') !== -1;
      var t = text;
      if (hasNl) {
        var lines = t.split('\n');
        var kept = [];
        for (var li = 0; li < lines.length; li++) {
          var ln = lines[li].replace(/^[ \t\r]+|[ \t\r]+$/g, '');
          if (ln) kept.push(ln);
        }
        t = kept.join(' ');
      }
      if (t) kids.push(jsString(t));
      text = '';
    }

    while (k < n) {
      var c = src.charAt(k);
      if (c === '<' && src.charAt(k + 1) === '/') {
        flushText();
        k += 2;
        var cn = parseName(k);
        if (cn.name !== tag) fail(k, 'closing </' + cn.name + '> does not match <' + tag + '>');
        k = skipWs(cn.end);
        if (src.charAt(k) !== '>') fail(k, 'expected > to close </' + tag + '>');
        return { kids: kids, end: k + 1 };
      }
      if (c === '<') {
        flushText();
        var el = parseElement(k);
        kids.push(el.code);
        k = el.end;
        continue;
      }
      if (c === '{') {
        flushText();
        var close = matchBrace(k);
        var inner = src.substring(k + 1, close);
        /* {/* a comment *\/} is not a child */
        if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(inner)) { k = close + 1; continue; }
        if (/^\s*$/.test(inner)) { k = close + 1; continue; }
        kids.push('(' + transpileRange(k + 1, close) + ')');
        k = close + 1;
        continue;
      }
      text += c;
      k++;
    }
    fail(k, '<' + tag + '> is never closed');
  }

  /* Transpile the slice [from, to) and return it as a string. Used for
     expression children and attribute values, which may hold more JSX. */
  function transpileRange(from, to) {
    var sub = src.substring(from, to);
    return jsxTranspile(sub, { pragma: pragma });
  }

  /* ---- the top-level scan ---- */
  while (i < n) {
    var c = src.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      var e = skipString(i);
      out += src.substring(i, e);
      i = e;
      continue;
    }
    if (c === '/' && src.charAt(i + 1) === '/') {
      var e2 = skipLineComment(i);
      out += src.substring(i, e2);
      i = e2;
      continue;
    }
    if (c === '/' && src.charAt(i + 1) === '*') {
      var e3 = skipBlockComment(i);
      out += src.substring(i, e3);
      i = e3;
      continue;
    }
    /* a fragment reaches here as `<` followed by `>`, which the element
       path would never accept; saying so beats emitting broken JS */
    if (c === '<' && src.charAt(i + 1) === '>' && opensJsx(i)) {
      fail(i, 'fragments (<>) are not supported');
    }
    if (c === '<' && (isIdentStart(src.charAt(i + 1))) && opensJsx(i)) {
      var el2 = parseElement(i);
      out += el2.code;
      i = el2.end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { transpile: jsxTranspile };
}
