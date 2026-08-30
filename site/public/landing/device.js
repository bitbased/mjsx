/* device.js — the shared runtime behind every landing page.
 *
 * Each landing page is a different presentation of the SAME three programs:
 * asteroids, input and drawing, taken from examples/ and run here, unmodified,
 * on the same core file that runs on the hardware.
 *
 * It lives in one place because the interesting parts are subtle and were
 * previously copy-pasted per page, which is how a page ends up with a held
 * arrow key that never releases or a panel that overflows a phone. Fix it
 * once, every presentation gets it.
 *
 * Usage:
 *   MJSX.ready(function (ex) {                 // ex.asteroids / .input / .canvas
 *     var d = MJSX.panel(hostEl, { src: ex.asteroids, w: 240, h: 240, round: 1 });
 *   });
 */
(function (root) {
  'use strict';

  /* mjsxRun points the globals (gfx, sys, UI, h, …) at whatever it just built,
     so several devices on one page have to take turns: each keeps its own core
     and re-points the globals before it touches anything. */
  var KEYS = ['h', 'UI', 'Button', 'Swatch', 'em', 'Modal', 'Keyboard',
              'ArcFooter', 'configStorage'];

  function Device(cv, src, w, h, opts) {
    opts = opts || {};
    this.cv = cv;
    this.ctx = cv.getContext('2d', { alpha: false });
    this.src = src;
    this.opts = opts;
    this._build(w, h, !!opts.round);
    this.wire();
  }

  Device.prototype._build = function (w, h, round) {
    var cv = this.cv, opts = this.opts;
    this.w = w; this.h = h; this.round = round;
    /* Render at 2x for the small panels so text is crisp, 1x for the big
       ones where 2x is a lot of pixels to push per frame in software. */
    this.dpr = opts.dpr || (Math.max(w, h) <= 320 ? 2 : 1);
    cv.width = w * this.dpr; cv.height = h * this.dpr;
    /* The canvas fills its container and keeps the panel's aspect ratio. The
       container decides how big that is, so a 240x240 panel cannot push a
       420px-wide phone sideways — which is exactly what a hard-coded pixel
       width on the canvas used to do. */
    cv.style.display = 'block';
    cv.style.width = '100%';
    cv.style.height = 'auto';
    this.be = createPureJsBackend(w, h, { dpr: this.dpr });
    if (opts.seed) {
      /* seeded before the app runs, the way a firmware seeds its board */
      for (var k in opts.seed) this.be.sys.store(k, opts.seed[k]);
    }
    this.core = mjsxRun(this.src, this.be, { round: round });
    this.saved = {};
    for (var i = 0; i < KEYS.length; i++) this.saved[KEYS[i]] = this.core[KEYS[i]];
    this.img = null; this.ms = 0;
    this.render();
  };

  /* Rebuild at a new size or shape, in place. The app restarts — which is the
     honest thing to show, because a device does not change shape at runtime;
     what the switcher demonstrates is the SAME SOURCE meeting a different
     panel, not a reflow. */
  Device.prototype.reshape = function (w, h, round) {
    this._build(w, h, !!round);
    return this;
  };

  /* Rebuild from NEW source, keeping this Device object identity — the frame
     loop holds a reference to it, so replacing the object would leave a stale
     one ticking a dead engine. */
  Device.prototype.reload = function (src, w, h, round) {
    this.src = src;
    this._build(w === undefined ? this.w : w,
                h === undefined ? this.h : h,
                round === undefined ? this.round : !!round);
    return this;
  };

  Device.prototype.enter = function () {
    globalThis.gfx = this.be.gfx;
    globalThis.sys = this.be.sys;
    for (var i = 0; i < KEYS.length; i++) globalThis[KEYS[i]] = this.saved[KEYS[i]];
  };

  Device.prototype.blit = function () {
    var cw = this.cv.width, ch = this.cv.height, src = this.be.raw;
    if (!this.img || this.img.width !== cw || this.img.height !== ch) {
      this.img = this.ctx.createImageData(cw, ch);
    }
    var d = this.img.data, n = cw * ch, s = 0, o = 0;
    for (var i = 0; i < n; i++) {
      d[o] = src[s]; d[o + 1] = src[s + 1]; d[o + 2] = src[s + 2]; d[o + 3] = 255;
      s += 3; o += 4;
    }
    this.ctx.putImageData(this.img, 0, 0);
  };

  Device.prototype.render = function () {
    this.enter();
    var t0 = performance.now();
    if (this._mirrors && this._mirrors.length) {
      /* The recorder forwards every call to the real backend as it captures
         it, so this is still ONE render: the panel gets its pixels and the
         mirrors get the exact call list that produced them. Nothing is
         simulated twice, which is the whole point of showing it. */
      var rec = mjsxRecord(this.be.gfx), real = globalThis.gfx;
      globalThis.gfx = rec.gfx;
      this.core.UI.render();
      globalThis.gfx = real;
      var ops = rec.take();
      this.ms = performance.now() - t0;
      this.blit();
      for (var i = 0; i < this._mirrors.length; i++) {
        try { this._mirrors[i](ops, this); } catch (e) { if (root.__MIRROR_DEBUG) console.error('mirror:', e && e.message, e && e.stack); }
      }
      return;
    }
    this.core.UI.render();
    this.ms = performance.now() - t0;
    this.blit();
  };

  /* fn(ops, device) after every frame this device draws */
  Device.prototype.addMirror = function (fn) {
    (this._mirrors || (this._mirrors = [])).push(fn);
    this.render();
    return this;
  };

  Device.prototype.tick = function () {
    this.enter();
    var moved = this.core.UI.ticker();
    if (moved || this.core.UI.dirty()) this.render();
    return moved;
  };

  /* The op list for the frame currently on screen, as compact arrays. */
  Device.prototype.ops = function () {
    this.enter();
    var rec = mjsxRecord(this.be.gfx), real = globalThis.gfx;
    globalThis.gfx = rec.gfx;
    this.core.UI.render();
    globalThis.gfx = real;
    var list = rec.take();
    this.core.UI.render();
    this.blit();
    return list;
  };

  Device.prototype.at = function (e) {
    var r = this.cv.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / r.width * this.w),
             y: Math.round((e.clientY - r.top) / r.height * this.h) };
  };

  Device.prototype.point = function (phase, e) {
    this.enter();
    var p = this.at(e);
    this.core.UI.pointer('p', phase, p.x, p.y);
    if (this.core.UI.dirty()) this.render();
  };

  Device.prototype.wire = function () {
    if (this._wired) return;
    this._wired = true;
    var self = this, cv = this.cv;
    cv.tabIndex = 0;

    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      /* preventScroll matters: focusing a canvas the browser thinks is
         off-centre scrolls the page under the finger, and the tap lands
         hundreds of pixels from where it was aimed. */
      cv.focus({ preventScroll: true });
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      self.point(0, e);
    });
    cv.addEventListener('pointermove', function (e) {
      if (e.buttons || e.pointerType === 'touch') self.point(1, e);
    });
    cv.addEventListener('pointerup', function (e) { self.point(2, e); });
    cv.addEventListener('pointercancel', function (e) { self.point(2, e); });

    /* A HELD KEY MUST STAY HELD. Sending down+press+up in one burst on
       keydown is fine for typing — a character arrives once — but it makes an
       arrow key impossible: the app sets turn on down and clears it on up,
       both in the same instant, so the ship never turns. down goes on keydown,
       up goes on keyup, and press rides with the down for the one-shot keys. */
    cv.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') return;          /* leave the page keyboard-navigable */
      e.preventDefault();
      self.enter();
      var k = e.key;
      if (k.length === 1 && k !== ' ') { self.core.UI.type(k); }
      else if (!e.repeat) {
        self.core.UI.key('down', k);
        self.core.UI.key('press', k);
      }
      if (self.core.UI.dirty()) self.render();
    });
    cv.addEventListener('keyup', function (e) {
      var k = e.key;
      if (k.length === 1 && k !== ' ') return;
      self.enter();
      self.core.UI.key('up', k);
      if (self.core.UI.dirty()) self.render();
    });
  };

  /* ---- the shared frame loop ------------------------------------------
     One rAF for the whole page, and only the panels actually on screen are
     ticked: a page of running devices should cost nothing while you are
     reading past it. */
  var watched = [], seen = new WeakMap(), io = null, running = false;

  function startLoop() {
    if (running) return;
    running = true;
    (function loop() {
      requestAnimationFrame(loop);
      for (var i = 0; i < watched.length; i++) {
        /* on screen AND not explicitly paused: the observer decides the
           first, the page's own play control decides the second, and they
           must not overwrite each other */
        if (seen.get(watched[i].cv) && !watched[i]._paused) {
          try { watched[i].tick(); } catch (e) { /* one bad frame is not fatal */ }
        }
      }
    })();
  }

  function watch(d) {
    if (!io) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (en) { seen.set(en.target, en.isIntersecting); });
      }, { rootMargin: '150px' });
    }
    watched.push(d);
    seen.set(d.cv, false);
    io.observe(d.cv);
    startLoop();
    return d;
  }

  /* ---- convenience: build the glass + canvas markup ---------------------
     Every page styles .glass itself; what is shared is the part that has to
     be right — the aspect box, the max width, and the round clip. */
  function panel(host, o) {
    var glass = document.createElement('div');
    glass.className = o.className || 'glass';
    if (o.round) glass.classList.add('round');
    /* The panel never asks for more width than it has logical pixels at the
       page's chosen zoom, never more than its container — and never more than
       maxW, whatever the panel's logical size.
       That last cap is not cosmetic. A page that puts the glass beside a
       column of prose gives the glass an `auto` grid track; without a ceiling,
       picking the 480-wide panel makes that track 816px, and the prose column
       collapses to a ladder of three-word lines. */
    /* The panel FILLS its column and is capped, rather than being pinned to a
       fixed pixel width — so a wide browser gets a big panel and a narrow one
       gets a small panel, without either overflowing.
       The cap is on both axes: capping width alone turns a 172x320 portrait
       panel into an 800px-tall tower the moment the column is wide. */
    var zoom = o.zoom || (Math.max(o.w, o.h) <= 320 ? 2 : 1.4);
    var maxW = o.maxW || 440, maxH = o.maxH || 560;
    var cap = Math.round(Math.min(o.w * zoom, maxW, maxH * o.w / o.h));
    if (o.definite) {
      /* A DEFINITE width. Inside the pipeline grid the panel sits in an
         auto-sized column, and `width:100%` there is circular: the column
         measures the glass, the glass measures the column, and the panel came
         out stretched off its own aspect ratio. */
      glass.style.width = cap + 'px';
      glass.style.maxWidth = '100%';
    } else {
      glass.style.width = '100%';
      glass.style.maxWidth = cap + 'px';
    }
    glass.style.aspectRatio = o.w + ' / ' + o.h;
    var cv = document.createElement('canvas');
    if (o.label) cv.setAttribute('aria-label', o.label);
    glass.appendChild(cv);
    host.appendChild(glass);
    var d = new Device(cv, o.src, o.w, o.h, o);
    d.glass = glass;
    d.zoom = zoom;
    d.maxW = maxW;
    d.maxH = maxH;
    if (o.watch !== false) watch(d);
    return d;
  }

  /* ---- boot -----------------------------------------------------------
     The programs come from the repository, not from the page: examples.json
     is written by the build from examples/*.jsx. */
  var pending = [], loaded = null, failed = null;

  function ready(cb) {
    if (loaded) return cb(loaded);
    if (failed) return;
    pending.push(cb);
    if (pending.length > 1) return;
    fetch('/examples.json').then(function (r) { return r.json(); }).then(function (list) {
      var by = {};
      list.forEach(function (e) { if (!e.synthetic) by[e.name] = e.source; });
      by._list = list;
      loaded = by;
      pending.forEach(function (f) { f(by); });
      pending.length = 0;
    }).catch(function (e) {
      failed = e;
      var n = document.createElement('p');
      n.textContent = 'Could not load examples.json — run `bun run docs:sync`.';
      n.style.cssText = 'color:#f87171;font:13px ui-monospace,monospace;padding:1rem';
      document.body.insertBefore(n, document.body.firstChild);
    });
  }

  /* A shape switcher, since every page wants one and they should all behave
     the same: buttons that ARE the panel they select, drawn to scale. */
  var SHAPES = [
    { key: '240x280', w: 240, h: 280, label: '240×280' },
    { key: '172x320', w: 172, h: 320, label: '172×320' },
    { key: '320x172', w: 320, h: 172, label: '320×172' },
    { key: '240x240r', w: 240, h: 240, round: 1, label: '240×240 round' },
    { key: '480x320', w: 480, h: 320, label: '480×320' }
  ];

  function shapeButtons(host, dev, opts) {
    opts = opts || {};
    var list = opts.shapes || SHAPES;
    var cur = opts.current || (dev.round ? '240x240r' : dev.w + 'x' + dev.h);
    list.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = opts.className || 'shapebtn';
      b.setAttribute('aria-pressed', String(s.key === cur));
      b.title = s.label;
      var g = document.createElement('span');
      g.className = 'g' + (s.round ? ' round' : '');
      var k = (opts.chip || 20) / Math.max(s.w, s.h);
      g.style.width = Math.round(s.w * k) + 'px';
      g.style.height = Math.round(s.h * k) + 'px';
      var t = document.createElement('span');
      t.textContent = s.label;
      b.appendChild(g); b.appendChild(t);
      b.addEventListener('click', function () {
        dev.reshape(s.w, s.h, s.round);
        dev.glass.classList.toggle('round', !!s.round);
        var ncap = Math.round(Math.min(s.w * (dev.zoom || 2), dev.maxW || 440,
                                       (dev.maxH || 560) * s.w / s.h));
        if (dev.opts && dev.opts.definite) dev.glass.style.width = ncap + 'px';
        else dev.glass.style.maxWidth = ncap + 'px';
        dev.glass.style.aspectRatio = s.w + ' / ' + s.h;
        Array.prototype.forEach.call(host.children, function (c) {
          c.setAttribute('aria-pressed', String(c === b));
        });
        if (opts.onChange) opts.onChange(s);
      });
      host.appendChild(b);
    });
  }

  /* ---- the pipeline widget --------------------------------------------
   *
   * Source in, pixels out, with as much of the middle exposed as the page
   * wants: `stages` is any subset of source / js / ops / panel, in any order.
   * A page that only wants "type JSX, watch it run" asks for two stages and
   * gets no cruft; a page making a point about the transform asks for four.
   *
   * The widget owns only the machinery. Layout is entirely the page's — it
   * emits stable class names and arranges nothing, so the same working
   * pipeline can be a row of panels, a shell pipe, or a diptych.
   */
  var OPNAME = { C:'clear', r:'rect', f:'frect', c:'circle', l:'line',
                 t:'text', x:'clip', X:'unclip', p:'poly', b:'blit' };

  function fmtOps(list, esc) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var args = o.slice(1).map(function (v) {
        if (typeof v === 'string') return '<span class="s">' + esc(JSON.stringify(v)) + '</span>';
        /* poly carries point arrays; the count is the interesting part */
        if (v && typeof v === 'object') {
          var n = v.length === undefined ? Object.keys(v).length : v.length;
          return '<span class="c">&lt;' + n + ' pts&gt;</span>';
        }
        if (typeof v === 'number' && v > 4096) return '<span class="num">0x' + v.toString(16) + '</span>';
        if (typeof v === 'number' && v % 1 !== 0) return '<span class="num">' + v.toFixed(1) + '</span>';
        return '<span class="num">' + v + '</span>';
      }).join(', ');
      out.push(('   ' + (i + 1)).slice(-4) + '  <span class="op">' +
               (OPNAME[o[0]] || o[0]) + '</span>(' + args + ')');
    }
    return out.join('\n');
  }

  var upid = 0;

  function pipeline(host, o) {
    o = o || {};
    var stages = o.stages || ['source', 'panel'];
    var labels = o.labels || {};
    var esc = root.hlEsc || function (t) { return String(t); };
    var hl = root.hl || function (t) { return esc(t); };
    var uid = 'mp' + (++upid);

    var wrapEl = document.createElement('div');
    wrapEl.className = 'mp';
    wrapEl.setAttribute('data-stages', stages.join(' '));

    var el = {};
    function stage(kind, title, meta, bodyNode) {
      var s = document.createElement('section');
      s.className = 'mp-stage mp-' + kind;
      s.setAttribute('data-stage', kind);
      if (o.heads !== false) {
        var hd = document.createElement('header');
        hd.className = 'mp-head';
        var n = document.createElement('span');
        n.className = 'mp-n';
        n.textContent = stages.indexOf(kind) + 1;
        var t = document.createElement('span');
        t.className = 'mp-t'; t.textContent = title;
        var m = document.createElement('span');
        m.className = 'mp-f'; m.textContent = meta || '';
        hd.appendChild(n); hd.appendChild(t); hd.appendChild(m);
        s.appendChild(hd);
        el[kind + 'Meta'] = m;
      }
      var b = document.createElement('div');
      b.className = 'mp-body';
      b.appendChild(bodyNode);
      s.appendChild(b);
      wrapEl.appendChild(s);
      return s;
    }

    /* --- source: a real editor, highlighted underneath --- */
    if (stages.indexOf('source') >= 0) {
      var ed = document.createElement('div');
      ed.className = 'mp-ed';
      var pre = document.createElement('pre');
      pre.className = 'mp-hl'; pre.setAttribute('aria-hidden', 'true');
      var ta = document.createElement('textarea');
      ta.className = 'mp-src'; ta.spellcheck = false;
      ta.id = uid + '-src';
      ta.setAttribute('aria-label', labels.source || 'mjsx source, editable');
      ed.appendChild(pre); ed.appendChild(ta);
      stage('source', labels.source || 'SOURCE', labels.sourceMeta || '.jsx', ed);
      el.src = ta; el.hl = pre;
    }
    if (stages.indexOf('js') >= 0) {
      var pj = document.createElement('pre'); pj.className = 'mp-js';
      stage('js', labels.js || 'TRANSPILED', labels.jsMeta || 'core/src/jsx.js', pj);
      el.js = pj;
    }
    if (stages.indexOf('ops') >= 0) {
      var po = document.createElement('pre'); po.className = 'mp-ops';
      stage('ops', labels.ops || 'DRAW CALLS', labels.opsMeta || 'this frame', po);
      el.ops = po;
    }
    if (stages.indexOf('panel') >= 0) {
      var sc = document.createElement('div'); sc.className = 'mp-screen';
      stage('panel', labels.panel || 'GLASS', labels.panelMeta || '', sc);
      el.screen = sc;
    }

    /* --- controls --- */
    var ctl = document.createElement('div');
    ctl.className = 'mp-ctl';
    var sel = null;
    if (o.examples && o.examples.length) {
      var lb = document.createElement('label');
      lb.className = 'mp-sr'; lb.setAttribute('for', uid + '-ex');
      lb.textContent = 'Example';
      sel = document.createElement('select');
      sel.className = 'mp-ex'; sel.id = uid + '-ex';
      o.examples.forEach(function (e) {
        var op = document.createElement('option');
        op.value = e.name; op.textContent = e.label || e.name;
        sel.appendChild(op);
      });
      ctl.appendChild(lb); ctl.appendChild(sel);
    }
    var shapesHost = document.createElement('span');
    shapesHost.className = 'mp-shapes';
    if (o.shapes !== false) ctl.appendChild(shapesHost);
    var playBtn = null;
    if (o.play !== false) {
      playBtn = document.createElement('button');
      playBtn.type = 'button'; playBtn.className = 'mp-play';
      playBtn.setAttribute('aria-pressed', 'true');
      playBtn.textContent = o.playLabel || '❙❙ pause';
      ctl.appendChild(playBtn);
    }
    var errEl = document.createElement('span');
    errEl.className = 'mp-err'; errEl.setAttribute('role', 'status');
    ctl.appendChild(errEl);

    if (o.controlsFirst === false) wrapEl.appendChild(ctl);
    else host.appendChild(ctl);
    host.appendChild(wrapEl);

    /* --- machinery --- */
    /* The glass grows with the window like the code panes do: a 27" display
       should show a bigger device than a laptop, within sane bounds. */
    function panelCap() {
      var vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
      return { w: Math.max(220, Math.min(520, Math.round(vw * 0.24))),
               h: Math.max(260, Math.min(620, Math.round(vh * 0.62))) };
    }

    var dev = null, playing = o.autoplay !== false, repaint = null;
    var curW = o.w || 240, curH = o.h || 280, curRound = !!o.round;
    var opsAt = 0;

    function currentSource() {
      return el.src ? el.src.value : (o.src || '');
    }

    function showJs(js) {
      if (!el.js) return;
      el.js.innerHTML = hl(js);
      if (el.jsMeta) el.jsMeta.textContent = js.split('\n').length + ' lines';
    }

    function refreshOps(force) {
      if (!el.ops || !dev) return;
      var now = performance.now();
      if (!force && now - opsAt < 250) return;   /* 4 Hz is plenty to read */
      opsAt = now;
      var list;
      try { list = dev.ops(); } catch (e) { return; }
      el.ops.innerHTML = fmtOps(list, esc);
      if (el.opsMeta) el.opsMeta.textContent = list.length + ' calls';
    }

    function build() {
      var source = currentSource();
      errEl.textContent = '';

      if (el.js) {
        try { showJs(mjsxTranspile(source)); }
        catch (e) { errEl.textContent = 'JSX: ' + e.message; el.js.textContent = ''; return; }
      }
      try {
        if (!dev) {
          dev = panel(el.screen || document.createElement('div'), {
            src: source, w: curW, h: curH, round: curRound,
            zoom: o.zoom || 1.45, definite: true,
            label: o.panelLabel || 'live panel', watch: false,
            maxW: o.maxW || panelCap().w, maxH: o.maxH || panelCap().h
          });
          watch(dev);
          if (o.shapes !== false) {
            shapeButtons(shapesHost, dev, {
              current: curRound ? '240x240r' : curW + 'x' + curH,
              chip: o.chip,
              onChange: function (s) {
                curW = s.w; curH = s.h; curRound = !!s.round;
                if (el.panelMeta) el.panelMeta.textContent = s.label;
                refreshOps(true);
                if (o.onChange) o.onChange(s);
              }
            });
          }
        } else {
          dev.reload(source, curW, curH, curRound);
        }
      } catch (e) {
        errEl.textContent = (e.mjsxPhase === 'jsx' ? 'JSX: ' : 'run: ') + e.message;
        return;
      }
      if (el.panelMeta && !el.panelMeta.textContent) {
        el.panelMeta.textContent = curW + '×' + curH + (curRound ? ' round' : '');
      }
      refreshOps(true);
      if (o.onBuild) o.onBuild(dev);
    }

    function setSource(text) {
      if (el.src) { el.src.value = text; if (repaint) repaint(); autoHeight(); }
      else { o.src = text; }
      build();
    }

    /* The editor is as tall as the program in it, up to the pane's cap. */
    function autoHeight() {
      var ta = el.src;
      if (!ta) return;
      /* Only when the panes are STACKED. Side by side, CSS stretches the
         editor to the glass's height, and an inline pixel height set here
         would beat that and reintroduce the short box. */
      if (!window.matchMedia('(max-width: 860px)').matches) {
        ta.style.height = '';
        return;
      }
      ta.style.height = 'auto';
      var cap = parseFloat(getComputedStyle(ta).maxHeight);
      var want = ta.scrollHeight + 2;
      ta.style.height = (cap && want > cap ? cap : want) + 'px';
    }

    if (el.src) {
      el.src.value = o.src || '';
      repaint = root.hlAttach ? root.hlAttach(el.src, el.hl) : null;
      autoHeight();
      el.src.addEventListener('input', autoHeight);
      window.addEventListener('resize', autoHeight);
      var deb = 0;
      el.src.addEventListener('input', function () {
        clearTimeout(deb);
        deb = setTimeout(build, 400);
      });
    }
    if (sel) {
      sel.addEventListener('change', function () {
        for (var i = 0; i < o.examples.length; i++) {
          if (o.examples[i].name === this.value) {
            curW = o.examples[i].w || curW;
            curH = o.examples[i].h || curH;
            if (o.examples[i].round !== undefined) curRound = !!o.examples[i].round;
            setSource(o.examples[i].source);
            return;
          }
        }
      });
    }
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        playing = !playing;
        this.setAttribute('aria-pressed', String(playing));
        this.textContent = playing ? (o.playLabel || '❙❙ pause') : (o.pauseLabel || '▶ play');
        if (dev) { dev._paused = !playing; if (playing) dev.render(); }
      });
    }

    build();

    /* re-cap the glass when the window changes size */
    var rz = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        if (!dev || o.maxW) return;
        var cap = panelCap();
        dev.maxW = cap.w; dev.maxH = cap.h;
        dev.glass.style.width = Math.round(Math.min(
          dev.w * (dev.zoom || 2), cap.w, cap.h * dev.w / dev.h)) + 'px';
      }, 120);
    });

    /* keep the op list current while the thing animates */
    if (el.ops) {
      (function poll() {
        requestAnimationFrame(poll);
        if (playing) refreshOps(false);
      })();
    }

    return { el: el, wrap: wrapEl, ctl: ctl, build: build, setSource: setSource,
             device: function () { return dev; } };
  }

  /* Attach a second RENDERER to a running device: same op stream, different
     treatment. Throttled, because a wobbling pen is a lot more work per frame
     than a rectangle fill and the mirror is a demonstration, not the app. */
  function sketchMirror(dev, canvas, o) {
    o = o || {};
    var r = null, last = 0, pending = null, queued = 0;
    var every = 1000 / (o.fps || 20);

    function fit() {
      if (r && r.w === dev.w && r.h === dev.h) return r;
      r = root.MJSXSketch.make(canvas, dev.w, dev.h, {
        theme: o.theme, dpr: o.dpr,
        /* the panel's own character advance, so the pen's text lands at the
           same width as the panel's bitmap font instead of a guessed size */
        advance: (dev.be.font && dev.be.font.advance) || 6,
        metrics: dev.be.textMetrics ? function (size) { return dev.be.textMetrics(size); } : null,
        /* real pixels for a blit, straight out of the canvas source */
        source: function (id) {
          return dev.be.sys.canvasRaw ? dev.be.sys.canvasRaw(id) : null;
        }
      });
      return r;
    }
    function paint(ops) {
      var rr = fit();
      rr.gfx.clear(0);
      mjsxReplay(ops, rr.gfx);
      last = performance.now();
      pending = null;
    }
    dev.addMirror(function (ops) {
      var now = performance.now();
      if (now - last >= every) { paint(ops); return; }
      /* THROTTLED, NOT DROPPED. Renders only happen when something changes,
         so a skipped frame is never re-offered — dropping it left the mirror
         showing a stale picture until the app happened to change again. The
         latest ops are held and flushed when the interval is up. */
      pending = ops;
      if (!queued) {
        queued = setTimeout(function () {
          queued = 0;
          if (pending) paint(pending);
        }, Math.max(0, every - (now - last)));
      }
    });

    /* ---- the mirror takes input too ----
       It is a real rendering of a real device, so pointing at it should work
       exactly like pointing at the panel. Coordinates are the panel's logical
       space in both, so the same mapping serves. */
    if (o.input !== false) {
      canvas.style.touchAction = 'none';
      canvas.tabIndex = 0;
      var at = function (e) {
        var b = canvas.getBoundingClientRect();
        return { x: Math.round((e.clientX - b.left) / b.width * dev.w),
                 y: Math.round((e.clientY - b.top) / b.height * dev.h) };
      };
      var send = function (phase, e) {
        dev.enter();
        var p = at(e);
        dev.core.UI.pointer('p', phase, p.x, p.y);
        if (dev.core.UI.dirty()) dev.render();
      };
      canvas.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        canvas.focus({ preventScroll: true });
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        send(0, e);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (e.buttons || e.pointerType === 'touch') send(1, e);
      });
      canvas.addEventListener('pointerup', function (e) { send(2, e); });
      canvas.addEventListener('pointercancel', function (e) { send(2, e); });
      canvas.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') return;
        e.preventDefault();
        dev.enter();
        var k = e.key;
        if (k.length === 1 && k !== ' ') dev.core.UI.type(k);
        else if (!e.repeat) { dev.core.UI.key('down', k); dev.core.UI.key('press', k); }
        if (dev.core.UI.dirty()) dev.render();
      });
      canvas.addEventListener('keyup', function (e) {
        var k = e.key;
        if (k.length === 1 && k !== ' ') return;
        dev.enter(); dev.core.UI.key('up', k);
        if (dev.core.UI.dirty()) dev.render();
      });
    }

    return { redraw: function () { last = 0; dev.render(); } };
  }

  root.MJSX = {
    Device: Device, ready: ready, panel: panel, watch: watch,
    shapeButtons: shapeButtons, pipeline: pipeline, fmtOps: fmtOps,
    sketchMirror: sketchMirror,
    SHAPES: SHAPES, KEYS: KEYS
  };
})(window);
