/*
 * The subset checker.
 *
 * mjsx-core and every app run on MicroQuickJS, whose parser is ES5. The
 * rule "stay in the subset" was enforced by nothing but attention, and
 * the failure it guards against is nasty: modern syntax parses fine in
 * every desktop backend and in the tests, then the bundle reaches a board
 * and the engine rejects the whole file. A device that will not boot is a
 * long way to travel to learn about an arrow function.
 *
 * THREE LEVELS, because not all of this repo has the same constraint:
 *   mquickjs  the strict ES5 subset — packages/core and examples/, the
 *             code that actually ships to a chip
 *   quickjs   full QuickJS: ES2020 syntax is fine, modules are not
 *   modern    anything — the CLI, the backends, the build scripts, which
 *             only ever run under bun or node
 *
 * HOW IT WORKS. A scanner, not a parser: it walks the source tracking
 * strings, template literals, comments and regular expressions, and
 * reports the constructs it can identify unambiguously from tokens. That
 * is a deliberate trade — a real parser would catch shorthand properties
 * and destructured parameters too, but it would not be 300 lines and it
 * could not run on the device. What it does catch, it catches without
 * false positives, which is the property that makes a linter usable.
 *
 * NOT DETECTED, stated so nobody trusts a clean run too far: object
 * shorthand ({ a, b } and { foo() {} }), destructured function
 * parameters, and computed keys ({ [k]: v }). Those need real parsing.
 * The MicroQuickJS harness in the push path remains the final word.
 */

function es5lint(src, opts) {
  opts = opts || {};
  var level = opts.level || 'mquickjs';

  /* Methods every desktop engine has and MicroQuickJS does not.
     Measured on a board, not assumed:
       "abc".substr / padStart / padEnd / includes / startsWith / endsWith / at
       [].find / findIndex / includes / fill / flat
     These are the worst kind of portability bug, because nothing catches
     them: the syntax is ES5, every desktop runner works, and the board
     throws "TypeError: not a function" at the call site. examples/clock hit
     exactly this -- `substr` in the network-time parser took UI.onTick down
     with it, which read as a crash on the SYNC button. */
  var MISSING_ON_DEVICE = {
    substr: 'use substring or slice',
    padStart: 'pad by hand',
    padEnd: 'pad by hand',
    startsWith: 'use indexOf(x) === 0',
    endsWith: 'compare with slice',
    includes: 'use indexOf(x) !== -1',
    find: 'use a for(;;) loop',
    findIndex: 'use a for(;;) loop',
    fill: 'assign in a for(;;) loop',
    flat: 'concat the parts yourself',
    at: 'index with [] (negative indices need length + i)'
  };
  if (level === 'modern') return [];

  var findings = [];
  var n = src.length;
  var line = 1;

  /* what the previous significant token was, which is how a regex is told
     from a division and a keyword from a property name */
  var prevWord = '';
  var prevChar = '';
  var prevWasOperand = false;

  function add(where, rule, msg) {
    findings.push({ line: where, rule: rule, message: msg });
  }

  function isIdentStart(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
  }
  function isIdentPart(c) {
    return isIdentStart(c) || (c >= '0' && c <= '9');
  }
  function isSpace(c) { return c === ' ' || c === '\t' || c === '\r' || c === '\n'; }

  /* the keywords that may legally follow a `.` or precede a `:` as a
     property name, where they are identifiers rather than syntax */
  function afterDot() { return prevChar === '.'; }

  var i = 0;
  while (i < n) {
    var c = src.charAt(i);

    if (c === '\n') { line++; i++; continue; }
    if (isSpace(c)) { i++; continue; }

    /* comments */
    if (c === '/' && src.charAt(i + 1) === '/') {
      while (i < n && src.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && src.charAt(i + 1) === '*') {
      i += 2;
      while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    /* strings */
    if (c === '"' || c === "'") {
      var q = c;
      i++;
      while (i < n) {
        var s = src.charAt(i);
        if (s === '\\') { i += 2; continue; }
        if (s === '\n') line++;
        if (s === q) { i++; break; }
        i++;
      }
      prevWasOperand = true; prevChar = q; prevWord = '';
      continue;
    }

    /* template literal */
    if (c === '`') {
      if (level === 'mquickjs') {
        add(line, 'template-literal', 'template literals are ES6; build the string with +');
      }
      i++;
      var depth = 0;
      while (i < n) {
        var t = src.charAt(i);
        if (t === '\\') { i += 2; continue; }
        if (t === '\n') line++;
        if (t === '$' && src.charAt(i + 1) === '{') { depth++; i += 2; continue; }
        if (t === '}' && depth > 0) { depth--; i++; continue; }
        if (t === '`' && depth === 0) { i++; break; }
        i++;
      }
      prevWasOperand = true; prevChar = '`'; prevWord = '';
      continue;
    }

    /* regular expression, told from division by what came before */
    if (c === '/' && !prevWasOperand) {
      i++;
      var inClass = false;
      while (i < n) {
        var r = src.charAt(i);
        if (r === '\\') { i += 2; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) { i++; break; }
        else if (r === '\n') { line++; break; }
        i++;
      }
      while (i < n && isIdentPart(src.charAt(i))) i++;   /* flags */
      prevWasOperand = true; prevChar = '/'; prevWord = '';
      continue;
    }

    /* identifiers and keywords */
    if (isIdentStart(c)) {
      var start = i;
      while (i < n && isIdentPart(src.charAt(i))) i++;
      var word = src.substring(start, i);
      /* A keyword is an ordinary name in two positions: after a dot
         (o.class) and before a colon as an object key ({ class: 1 }).
         Both are legal ES5 and flagging them is noise. */
      var peek = i;
      while (peek < n && isSpace(src.charAt(peek))) peek++;
      var isKey = src.charAt(peek) === ':' && src.charAt(peek + 1) !== ':';
      var isProp = afterDot() || isKey;

      /* A method call the device does not have. Only after a dot: an object
         KEY of the same name ({ find: ... }) is the caller's own and fine. */
      /* hasOwnProperty, not a plain lookup: `MISSING_ON_DEVICE['toString']`
         finds Object.prototype.toString and flags every .toString() call. */
      if (level === 'mquickjs' && afterDot() &&
          Object.prototype.hasOwnProperty.call(MISSING_ON_DEVICE, word)) {
        var callAt = i;
        while (callAt < n && isSpace(src.charAt(callAt))) callAt++;
        if (src.charAt(callAt) === '(') {
          add(line, 'no-' + word,
              '.' + word + '() does not exist in MicroQuickJS; ' + MISSING_ON_DEVICE[word]);
        }
      }

      if (!isProp && level === 'mquickjs') {
        if (word === 'let' || word === 'const') {
          /* `let` is a valid identifier in ES5, so only flag it where a
             declaration can start: followed by a name */
          var k = i;
          while (k < n && isSpace(src.charAt(k))) k++;
          if (isIdentStart(src.charAt(k)) || src.charAt(k) === '[' || src.charAt(k) === '{') {
            add(line, word, word + ' is ES6; use var');
          }
        } else if (word === 'class') {
          add(line, 'class', 'class is ES6; use a constructor function');
        } else if (word === 'of') {
          /* for (x of y) */
          if (prevWasOperand && /\bfor\s*\(/.test(src.substring(Math.max(0, start - 60), start))) {
            add(line, 'for-of', 'for...of is ES6; index the array with a for(;;) loop');
          }
        } else if (word === 'async' || word === 'await') {
          var k2 = i;
          while (k2 < n && isSpace(src.charAt(k2))) k2++;
          if (word === 'await' || isIdentStart(src.charAt(k2)) || src.charAt(k2) === '(') {
            add(line, word, word + ' is ES2017; MicroQuickJS has no promises');
          }
        } else if (word === 'import' || word === 'export') {
          add(line, 'modules', word + ' is an ES module keyword; the device loads a flat script');
        } else if (word === 'yield') {
          add(line, 'generator', 'generators are ES6');
        }
      }
      if (!isProp && (level === 'mquickjs' || level === 'quickjs')) {
        if (word === 'import' || word === 'export') {
          if (level === 'quickjs') add(line, 'modules', word + ' is an ES module keyword; this target loads a flat script');
        }
      }

      prevWord = word;
      prevChar = '';
      /* a keyword that can precede a regex is not an operand */
      prevWasOperand = !(word === 'return' || word === 'typeof' || word === 'instanceof' ||
                         word === 'in' || word === 'of' || word === 'new' || word === 'delete' ||
                         word === 'void' || word === 'case' || word === 'do' || word === 'else');
      continue;
    }

    /* numbers */
    if (c >= '0' && c <= '9') {
      while (i < n && (isIdentPart(src.charAt(i)) || src.charAt(i) === '.')) i++;
      prevWasOperand = true; prevChar = ''; prevWord = '';
      continue;
    }

    /* operators and punctuation */
    if (level === 'mquickjs') {
      if (c === '=' && src.charAt(i + 1) === '>') {
        add(line, 'arrow', 'arrow functions are ES6; use function () {}');
        i += 2; prevWasOperand = false; prevChar = '>'; continue;
      }
      if (c === '.' && src.charAt(i + 1) === '.' && src.charAt(i + 2) === '.') {
        add(line, 'spread', 'spread and rest are ES6');
        i += 3; prevWasOperand = false; prevChar = '.'; continue;
      }
      if (c === '?' && src.charAt(i + 1) === '.') {
        add(line, 'optional-chaining', 'optional chaining is ES2020');
        i += 2; prevWasOperand = false; prevChar = '.'; continue;
      }
      if (c === '?' && src.charAt(i + 1) === '?') {
        add(line, 'nullish', 'the nullish operator is ES2020; use ||');
        i += 2; prevWasOperand = false; prevChar = '?'; continue;
      }
      if (c === '*' && src.charAt(i + 1) === '*') {
        add(line, 'exponent', '** is ES2016; use Math.pow');
        i += 2; prevWasOperand = false; prevChar = '*'; continue;
      }
      if (c === '*' && prevWord === 'function') {
        add(line, 'generator', 'generators are ES6');
        i++; prevWasOperand = false; prevChar = '*'; continue;
      }
    }

    prevWasOperand = (c === ')' || c === ']' || c === '}');
    prevChar = c;
    prevWord = '';
    i++;
  }

  return findings;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lint: es5lint };
}
