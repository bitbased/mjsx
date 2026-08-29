/* What every documentation figure promises about itself.
 *
 * A figure carries two things in its PNG: the frame as DRAW OPS, and the
 * recipe that made it. Both are claims, and both can rot silently:
 *
 *  - a recipe is worthless if it does not rebuild the picture. It once
 *    did not: the command builder had no case for `tapLabel`, so the
 *    register-peek figure recorded a command that quietly dropped the tap
 *    and rebuilt the plain scan view instead. Nothing failed; the recipe
 *    just described a different image.
 *  - the ops are what the site's viewer replays and what the debug
 *    overlay is derived from, so a figure without them is a dead end.
 *
 * These tests re-run recipes rather than trusting them.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var child = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var IMG = path.join(ROOT, 'docs', 'img');

function chunks(buf) {
  var out = {}, p = 8;
  while (p + 8 <= buf.length) {
    var len = buf.readUInt32BE(p);
    var type = buf.toString('ascii', p + 4, p + 8);
    var data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'zTXt') {
      var nul = data.indexOf(0);
      out[data.toString('latin1', 0, nul)] =
        zlib.inflateSync(data.subarray(nul + 2)).toString('utf8');
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

var figures = fs.existsSync(IMG)
  ? fs.readdirSync(IMG).filter(function (f) { return f.slice(-4) === '.png'; }).sort()
  : [];

describe('documentation figures', function () {
  it('there are figures to check', function () {
    expect(figures.length).toBeGreaterThan(0);
  });

  it('every figure carries its ops and its recipe', function () {
    var missing = [];
    figures.forEach(function (f) {
      var c = chunks(fs.readFileSync(path.join(IMG, f)));
      if (!c['mjsx-ops']) missing.push(f + ': no ops');
      else if (!JSON.parse(c['mjsx-ops']).ops.length) missing.push(f + ': empty ops');
      if (!c['mjsx-shot']) missing.push(f + ': no recipe');
    });
    expect(missing).toEqual([]);
  });

  it('every figure carries the embedded overlay image', function () {
    /* the archive copy: the one form that still works if the op format
       ever moves on and old ops stop being interpretable */
    var missing = figures.filter(function (f) {
      return !chunks(fs.readFileSync(path.join(IMG, f)))['mjsx-overlay'];
    });
    expect(missing).toEqual([]);
  });

  it('no figure carries the retired derived-boxes chunk', function () {
    /* dropped deliberately: rectangles are a LOSSY summary of the ops —
       no colour, no text, no shape kind — so they were both redundant
       and worse than the thing they summarised */
    var stale = figures.filter(function (f) {
      return chunks(fs.readFileSync(path.join(IMG, f)))['mjsx-boxes'];
    });
    expect(stale).toEqual([]);
  });

  /* The expensive one, and the only one that proves anything: take the
     recorded command, run it, and require the SAME ops back. Sampled
     across the kinds of action a recipe has to express — taps by
     coordinate and by label, focus, typing, time and a simulated native —
     because re-running all of them is `bun run figures` twice over. */
  var SAMPLE = [
    'ex-i2c-peek-lcd35.png',        /* tapLabel + advance + --sim */
    'shape-input-round128-round128.png', /* tap by coordinate, round glass */
    'kb-qwerty-lcd35.png',          /* focus, and an -e inline source */
    'ex-wifi-join-lcd35.png'        /* a settle sequence */
  ].filter(function (f) { return figures.indexOf(f) >= 0; });

  SAMPLE.forEach(function (f) {
    it('the recorded command rebuilds ' + f, function () {
      var c = chunks(fs.readFileSync(path.join(IMG, f)));
      var shot = JSON.parse(c['mjsx-shot']);
      expect(shot.command).toBeTruthy();

      /* rename the output so the rebuild cannot overwrite the figure it
         is being compared against */
      var argv = shot.command.replace(/^bun scripts\/shoot\.mjs /, '');
      var tmp = 'figtest' + process.pid;
      argv = argv.replace(/^(\S+)/, tmp);
      var out = path.join(IMG, tmp + '-' + shot.profile + '.png');
      try {
        child.execSync('bun scripts/shoot.mjs ' + argv,
                       { cwd: ROOT, stdio: 'pipe' });
        var rebuilt = chunks(fs.readFileSync(out));
        expect(JSON.parse(rebuilt['mjsx-ops']).ops)
          .toEqual(JSON.parse(c['mjsx-ops']).ops);
      } finally {
        if (fs.existsSync(out)) fs.unlinkSync(out);
      }
    });
  });
});
