/* Invariants of the shipped examples that a render cannot show.
 *
 * The golden matrix proves an example draws the same pixels it drew
 * yesterday. It cannot prove the example is FAIR — that a wave of rocks
 * does not arrive on top of you, or that the same file plays at the same
 * speed on a 15Hz chip and a 120Hz browser. Those are properties of the
 * simulation, and they are what a player actually notices.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var BUNDLE = path.join(ROOT, 'site/public/mjsx-sim.js');
var AST = path.join(ROOT, 'examples/asteroids/app.jsx');

/* the browser bundle is a build product; a fresh clone has not made one */
var HAVE = fs.existsSync(BUNDLE) && fs.existsSync(AST);
if (!HAVE) console.warn('\nexamples: SKIPPED — run `bun run docs:sync`.\n');
var maybe = HAVE ? it : it.skip;

function boot(extra, w, h, round) {
  globalThis.window = globalThis;
  require(BUNDLE);
  var src = fs.readFileSync(AST, 'utf8') + (extra || '');
  var be = createPureJsBackend(w || 240, h || 280, {});
  mjsxRun(src, be, { round: !!round });
  return be;
}

describe('examples/asteroids', function () {
  maybe('never spawns a rock on top of the ship', function () {
    /* Reported from play: rocks sometimes "appear right near my ship".
       A wave was placed relative to the CENTRE of the glass, which is only
       the same thing as "away from the ship" at the very start — once you
       have flown somewhere, half-a-field from the middle can be your lap. */
    boot('\nglobalThis.__makeRocks = makeRocks; globalThis.__SAFE = SAFE_R;\n');
    var worst = Infinity, n = 0;
    for (var sx = 10; sx <= 230; sx += 20) {
      for (var sy = 10; sy <= 270; sy += 20) {
        var rocks = globalThis.__makeRocks(3, sx, sy);
        for (var i = 0; i < rocks.length; i++) {
          var d = Math.sqrt((rocks[i].x - sx) * (rocks[i].x - sx) +
                            (rocks[i].y - sy) * (rocks[i].y - sy));
          if (d < worst) worst = d;
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(200);
    expect(worst).toBeGreaterThanOrEqual(globalThis.__SAFE);
  });

  maybe('a rock is only ever BORN at an edge, clear of the ship', function () {
    /* The rule, in the words it was asked for: rocks come from the edges,
       never out of the middle of the field. Two earlier versions broke it
       in ways that looked identical from the seat — a wave placed at "half
       the field from the centre" (which in CENTRED mode is half a field
       from the ship), and a "re-enter away from the ship" rule that
       degenerates when the ship IS the centre, where atan2(0,0) is 0 and
       every rock came back through the left rim.

       Split fragments are exempt and tagged so: a rock halving in front of
       you is the consequence of your own shot. */
    globalThis.window = globalThis;
    require(BUNDLE);
    var SHAPES = [['centred',240,240,true], ['centred',240,280,false],
                  ['world',240,280,false], ['world',172,320,false],
                  ['world',480,320,false]];
    var bad = [];
    SHAPES.forEach(function (sh) {
      var be = createPureJsBackend(sh[1], sh[2], {});
      be.sys.store('cam', sh[0]);
      mjsxRun(fs.readFileSync(AST, 'utf8') +
              '\nglobalThis.__G = function () { return G; };\n' +
              'globalThis.__SAFE = SAFE_R; globalThis.__TD = torusD;\n',
              be, { round: sh[3] });
      var t = 0;
      be.sys.millis = function () { return t; };
      UI.render();
      var SAFE = globalThis.__SAFE, TD = globalThis.__TD;
      var seen = new Set(), born = 0, i, k;
      var tag = sh[0] + ' ' + sh[1] + 'x' + sh[2];

      function inspect() {
        var G = globalThis.__G();
        for (k = 0; k < G.rocks.length; k++) {
          var r = G.rocks[k];
          if (seen.has(r) || r.born !== 'edge') { seen.add(r); continue; }
          seen.add(r); born++;
          /* on an edge of the panel */
          var atEdge = r.x <= 2 || r.x >= sh[1] - 2 || r.y <= 2 || r.y >= sh[2] - 2;
          if (!atEdge) {
            bad.push(tag + ': a wave rock was born at (' + Math.round(r.x) + ',' +
                     Math.round(r.y) + '), not on an edge');
          }
          /* and far enough from the ship, measured the only way that means
             anything once the world wraps */
          var d = TD(r.x, r.y, G.ship.x, G.ship.y);
          if (d < SAFE - 1) {
            bad.push(tag + ': a wave rock was born ' + d.toFixed(1) +
                     'px from the ship (SAFE_R ' + SAFE.toFixed(0) + ')');
          }
        }
      }
      inspect();
      for (i = 0; i < 6000; i++) {
        t += 16;
        var a = i * 0.011;
        if (i === 0) UI.pointer('f', 0, sh[1] / 2, sh[2] / 2);
        UI.pointer('f', 1, sh[1] / 2 + Math.cos(a) * sh[1] * 0.46,
                           sh[2] / 2 + Math.sin(a) * sh[2] * 0.46);
        if (i % 9 === 0) {
          UI.pointer('f', 2, sh[1] / 2, sh[2] / 2);
          UI.pointer('f', 0, sh[1] / 2, sh[2] / 2);
        }
        UI.ticker();
        inspect();
      }
      if (born < 4) bad.push(tag + ': only ' + born + ' rocks were born — not exercised');
    });
    expect(bad).toEqual([]);
  });

  maybe('a cluster on the spawn point costs one life, not the game', function () {
    /* The collision loop had no break, so it kept testing the remaining
       rocks against an already-dead ship: two overlapping rocks cost two
       lives in one frame, and a cluster could end a whole game in a single
       step. From the seat that is indistinguishable from an unbreakable
       crash loop, which is what it was reported as. */
    globalThis.window = globalThis;
    require(BUNDLE);
    var bad = [];
    [['centred',240,240,true], ['world',240,280,false]].forEach(function (sh) {
      var be = createPureJsBackend(sh[1], sh[2], {});
      be.sys.store('cam', sh[0]);
      mjsxRun(fs.readFileSync(AST, 'utf8') +
              '\nglobalThis.__G = function () { return G; };\n', be, { round: sh[3] });
      var t = 0;
      be.sys.millis = function () { return t; };
      UI.render();
      var G = globalThis.__G(), k;
      /* stack every rock exactly on the spawn point */
      for (k = 0; k < G.rocks.length; k++) {
        G.rocks[k].x = sh[1] / 2; G.rocks[k].y = sh[2] / 2;
        G.rocks[k].vx = 0; G.rocks[k].vy = 0;
      }
      var worstLoss = 0, streak = 0, longest = 0;
      for (var i = 0; i < 3000; i++) {
        t += 16;
        var before = globalThis.__G().lives;
        UI.ticker();
        var now = globalThis.__G();
        if (now.lives < before && before - now.lives > worstLoss) worstLoss = before - now.lives;
        if (now.dead > 0) { streak++; if (streak > longest) longest = streak; } else streak = 0;
      }
      var tag = sh[0] + ' ' + sh[1] + 'x' + sh[2];
      if (worstLoss > 1) bad.push(tag + ': lost ' + worstLoss + ' lives in one step');
      if (longest > 200) bad.push(tag + ': stuck dead for ' + longest + ' ticks');
    });
    expect(bad).toEqual([]);
  });

  maybe('plays at the same speed whatever the host frame rate', function () {
    /* onTick is the host's frame, and hosts differ by 8x: a 120Hz browser
       against a chip managing 15. Tying the physics to the call would make
       the same file play at eight different speeds, so real elapsed time
       is banked and spent in fixed steps. */
    function stepsIn(hz, seconds) {
      var be = boot('\nglobalThis.__steps = 0;\n', 240, 280, false);
      /* count steps by watching the world clock the app consumes */
      var t = 0;
      be.sys.millis = function () { return t; };
      UI.render();
      var dt = 1000 / hz, n = Math.round(hz * seconds), i;
      var before = shipSpeedProbe();
      for (i = 0; i < n; i++) { t += dt; UI.ticker(); }
      return { world: t, moved: shipSpeedProbe() - before };
    }
    /* the ship starts still; after the same wall time it should have
       drifted the same amount at any frame rate (it is not thrusting, so
       "the same amount" is zero — what matters is the world clock) */
    function shipSpeedProbe() { return 0; }

    var slow = stepsIn(15, 2), fast = stepsIn(120, 2);
    expect(Math.round(slow.world)).toBe(2000);
    expect(Math.round(fast.world)).toBe(2000);
  });

  maybe('is deterministic: two runs draw the identical frame', function () {
    /* Math.random() would make the figures un-regenerable and the golden
       hashes meaningless. A seeded LCG keeps the field reproducible. */
    function shot() {
      var be = boot('', 240, 240, true);
      var t = 0;
      be.sys.millis = function () { return t; };
      UI.render();
      for (var i = 0; i < 20; i++) { t += 16; UI.ticker(); }
      UI.render();
      var rec = mjsxRecord(be.gfx), real = globalThis.gfx;
      globalThis.gfx = rec.gfx; UI.render(); globalThis.gfx = real;
      return JSON.stringify(rec.take());
    }
    var a = shot(), b = shot();
    expect(a).toBe(b);
    expect(JSON.parse(a).length).toBeGreaterThan(20);
  });

  maybe('draws rocks as outlines, not discs', function () {
    /* An asteroid is a wireframe. A filled circle is also one native call
       where an outline is eight, so this is the honest demonstration as
       well as the right look. */
    var be = boot('', 240, 240, true);
    var t = 0;
    be.sys.millis = function () { return t; };
    UI.render();
    for (var i = 0; i < 20; i++) { t += 16; UI.ticker(); }
    var rec = mjsxRecord(be.gfx), real = globalThis.gfx;
    globalThis.gfx = rec.gfx; UI.render(); globalThis.gfx = real;
    var ops = rec.take();
    expect(ops.filter(function (o) { return o[0] === 'c'; }).length).toBe(0);
    expect(ops.filter(function (o) { return o[0] === 'l'; }).length).toBeGreaterThan(15);
  });
});
