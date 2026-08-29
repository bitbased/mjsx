/*
 * http-backend tests. Two servers live in backends/http/:
 *
 *   server.js  — owns the app itself and streams RAW RGBA FRAMES over a
 *                websocket, with pointer/key input coming back.
 *   mirror.js  — attaches to a host that already owns the app (the SDL
 *                sim) and streams the DRAW OP LIST instead, so the page
 *                replays it at whatever resolution it likes.
 *
 * Both are exercised for real: server.js is spawned as a child process on
 * an ephemeral port and driven over a live websocket; mirror.js is created
 * in-process (it has no SDL dependency of its own) and driven the same way.
 * Nothing here needs a display.
 */
import { test, expect, describe, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'backends', 'http', 'src', 'server.js');
const MIRROR = path.join(ROOT, 'backends', 'http', 'src', 'mirror.js');
const SIM = path.join(ROOT, 'backends', 'sdl', 'src', 'sim.js');
const W = 240, H = 280;

/* Every child we spawn, so a failing assertion can never leak a listening
   server past the end of the run. */
const spawned = [];
afterAll(() => { for (const p of spawned) { try { p.kill(); } catch (e) {} } });

function fail(ms, what) {
  return Bun.sleep(ms).then(() => { throw new Error('timed out waiting for ' + what); });
}

/* Read a child's stdout until the port line shows up. Both servers print
   the port they actually BOUND (not the one asked for), which is what
   makes `0` — any free port — usable from a test. */
async function portFrom(proc, ms) {
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let acc = '';
  const scan = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('server exited before printing a port; output: ' + acc +
        '\nstderr: ' + await new Response(proc.stderr).text());
      acc += dec.decode(value, { stream: true });
      const m = acc.match(/http:\/\/localhost:(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
  })();
  return Promise.race([scan, fail(ms, 'the server to print its port')]);
}

/* server.js on an ephemeral port, running one example. */
async function startServer(exampleFile, extra) {
  const proc = Bun.spawn(['bun', SERVER, exampleFile, '0', String(W), String(H)].concat(extra || []),
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  spawned.push(proc);
  const port = await portFrom(proc, 15000);
  return { proc, port, kill() { try { proc.kill(); } catch (e) {} } };
}

/* An open websocket that collects everything the server pushes. */
async function connect(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  ws.binaryType = 'arraybuffer';
  const msgs = [];
  ws.onmessage = (e) => msgs.push(e.data);
  await Promise.race([
    new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); }),
    fail(5000, 'the websocket to open')
  ]);
  return { ws, msgs, close() { try { ws.close(); } catch (e) {} } };
}

/* Wait for at least n collected messages. */
async function until(msgs, n, ms) {
  const deadline = Date.now() + (ms || 4000);
  while (msgs.length < n && Date.now() < deadline) await Bun.sleep(20);
  return msgs.length >= n;
}

/* ---------------------------------------------------------------- */
/* server.js: the raw-frame server, one child process per example.   */
/* ---------------------------------------------------------------- */

/* Deliberately spread across the framework's surfaces: plain state
   (counter), text fields + virtual keyboards (input), onDraw pointer
   capture (draw), sys.* natives with a desktop fallback (screen), and
   scroll/clip/abs/modal layering (layers). */
const EXAMPLES = ['counter', 'input', 'draw', 'screen', 'layers'];

describe('http backend: example sweep', () => {
  for (const name of EXAMPLES) {
    test('serves examples/' + name + ' — page, live frame, still alive', async () => {
      const srv = await startServer('examples/' + name + '/app.jsx');
      try {
        const res = await fetch('http://127.0.0.1:' + srv.port + '/');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const html = await res.text();
        expect(html).toContain('<canvas id=c');
        expect(html).toContain('new WebSocket');
        /* the page is sized for the panel it was told to serve */
        expect(html).toContain('width=' + W + ' height=' + H);

        const c = await connect(srv.port);
        try {
          expect(await until(c.msgs, 1)).toBe(true);
          const frame = c.msgs[0];
          /* the very first push is the frame already on screen */
          expect(frame).toBeInstanceOf(ArrayBuffer);
          expect(frame.byteLength).toBe(W * H * 4);
          const px = new Uint8Array(frame);
          /* RGBA: canvas ImageData wants a real alpha channel */
          for (let i = 3; i < px.length; i += 4000) expect(px[i]).toBe(255);
          /* and it is a rendered UI, not an empty buffer */
          let distinct = new Set();
          for (let i = 0; i < px.length; i += 4) {
            distinct.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
            if (distinct.size > 2) break;
          }
          expect(distinct.size).toBeGreaterThan(2);
        } finally { c.close(); }

        /* rendering one frame and taking a socket must not have killed it */
        expect(srv.proc.exitCode).toBe(null);
        expect((await fetch('http://127.0.0.1:' + srv.port + '/')).status).toBe(200);
      } finally { srv.kill(); }
    }, 30000);
  }
});

describe('http backend: input round-trip', () => {
  /* Where the +1 button lands is not hardcoded: the same example is
     rendered in-process at the same size and asked which rect it
     registered, exactly like test/behavior.test.js does. */
  function counterButtonCentre() {
    const { renderExample } = require('./load.js');
    const t = renderExample('examples/counter/app.jsx', W, H);
    const hit = t.UI._hits[0];
    expect(hit).toBeTruthy();
    return { x: hit.x + (hit.w >> 1), y: hit.y + (hit.h >> 1) };
  }

  test('a websocket tap on the +1 button pushes a changed frame', async () => {
    const at = counterButtonCentre();
    const srv = await startServer('examples/counter/app.jsx');
    const c = await connect(srv.port);
    try {
      expect(await until(c.msgs, 1)).toBe(true);
      const before = new Uint8Array(c.msgs[0]);

      c.ws.send(JSON.stringify({ t: 'ptr', id: 'mouse', phase: 0, x: at.x, y: at.y }));
      c.ws.send(JSON.stringify({ t: 'ptr', id: 'mouse', phase: 2, x: at.x, y: at.y }));

      expect(await until(c.msgs, 2)).toBe(true);
      const after = new Uint8Array(c.msgs[c.msgs.length - 1]);
      expect(after.byteLength).toBe(before.byteLength);
      /* COUNT: 0 -> COUNT: 1, so the pixels must differ */
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
    } finally { c.close(); srv.kill(); }
  }, 30000);

  test('a tap far from any control changes nothing and pushes no frame', async () => {
    const srv = await startServer('examples/counter/app.jsx');
    const c = await connect(srv.port);
    try {
      expect(await until(c.msgs, 1)).toBe(true);
      c.ws.send(JSON.stringify({ t: 'ptr', id: 'mouse', phase: 0, x: 2, y: H - 2 }));
      c.ws.send(JSON.stringify({ t: 'ptr', id: 'mouse', phase: 2, x: 2, y: H - 2 }));
      await Bun.sleep(500);
      expect(c.msgs.length).toBe(1);
      expect(srv.proc.exitCode).toBe(null);
    } finally { c.close(); srv.kill(); }
  }, 30000);

  test('tapping a field announces focus, and typing then redraws', async () => {
    /* The first text field's rect, again read off a real in-process
       render — an input registers a whole-stroke capture, not a tap fn. */
    const { renderExample } = require('./load.js');
    const t = renderExample('examples/input/app.jsx', W, H);
    const field = t.UI._hits.find((hh) => !hh.fn && hh.draw);
    expect(field).toBeTruthy();
    const fx = field.x + (field.w >> 1), fy = field.y + (field.h >> 1);

    const srv = await startServer('examples/input/app.jsx');
    const c = await connect(srv.port);
    try {
      expect(await until(c.msgs, 1)).toBe(true);
      /* A press and a stationary release is a tap: it focuses the field,
         and the focus is announced on the socket so a phone can raise its
         own native keyboard. */
      c.ws.send(JSON.stringify({ t: 'ptr', id: 'mouse', phase: 0, x: fx, y: fy }));
      c.ws.send(JSON.stringify({ t: 'ptr', id: 'mouse', phase: 2, x: fx, y: fy }));
      expect(await until(c.msgs, 3)).toBe(true);
      const json = () => c.msgs.filter((m) => typeof m === 'string').map((m) => JSON.parse(m));
      expect(json().some((m) => m.t === 'focus' && m.on === true)).toBe(true);
      /* and the keyboard that appeared is a new frame, not just a message */
      expect(c.msgs.filter((m) => m instanceof ArrayBuffer).length).toBeGreaterThan(1);

      const n = c.msgs.length;
      c.ws.send(JSON.stringify({ t: 'key', type: 'press', key: 'Z' }));
      expect(await until(c.msgs, n + 1)).toBe(true);

      /* Escape blurs, which tells the page to drop the native keyboard */
      c.ws.send(JSON.stringify({ t: 'key', type: 'press', key: 'Escape' }));
      await Bun.sleep(300);
      expect(json().some((m) => m.t === 'focus' && m.on === false)).toBe(true);
      expect(srv.proc.exitCode).toBe(null);
    } finally { c.close(); srv.kill(); }
  }, 30000);
});

describe('http backend: hostile input', () => {
  /* Regression: JSON.parse succeeds on `null`, `5` and `"hi"`, and reading
     .t off those threw out of the websocket handler and took the whole
     server process down — one stray frame from any page killed it. */
  test('junk websocket payloads never kill the server', async () => {
    const srv = await startServer('examples/counter/app.jsx');
    const c = await connect(srv.port);
    try {
      expect(await until(c.msgs, 1)).toBe(true);
      const junk = [
        'null', '5', '"hi"', '[]', 'true', 'not json at all', '',
        '{"t":"ptr"}',
        '{"t":"ptr","id":null,"phase":null,"x":"nope","y":{}}',
        '{"t":"ptr","id":"mouse","phase":0,"x":1e400,"y":-1e400}',
        '{"t":"key"}',
        '{"t":"key","type":9,"key":null}',
        '{"t":"wheel"}',
        '{"t":"unknown-kind"}'
      ];
      for (const j of junk) { c.ws.send(j); await Bun.sleep(20); }
      await Bun.sleep(300);
      expect(srv.proc.exitCode).toBe(null);
      expect((await fetch('http://127.0.0.1:' + srv.port + '/')).status).toBe(200);
    } finally { c.close(); srv.kill(); }
  }, 30000);

  test('GET /ws without upgrade headers is a 400, not a crash', async () => {
    const srv = await startServer('examples/counter/app.jsx');
    try {
      const res = await fetch('http://127.0.0.1:' + srv.port + '/ws');
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('upgrade failed');
      expect(srv.proc.exitCode).toBe(null);
    } finally { srv.kill(); }
  }, 30000);

  /* Regression: `var sockets` was declared BELOW the first UI.render(), so
     an app that focused a field from inside its render called
     onFocusChange while sockets was still undefined and the server died
     on startup. */
  test('an app that focuses during its first render still boots', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjsx-http-'));
    const app = path.join(dir, 'focus-on-render.jsx');
    fs.writeFileSync(app,
      'var once = false;\n' +
      'function App() {\n' +
      '  if (!once) { once = true; UI.focus("f"); }\n' +
      '  return h("box", { pad: 8 }, h("input", { id: "f" }));\n' +
      '}\n' +
      'UI.mount(App);\n');
    const srv = await startServer(app);
    try {
      expect((await fetch('http://127.0.0.1:' + srv.port + '/')).status).toBe(200);
      expect(srv.proc.exitCode).toBe(null);
    } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
});

describe('http backend: --hostfont text ops', () => {
  /* With --hostfont the frame carries no glyphs: text arrives as a JSON op
     list and the browser draws it with a real font on the mjsx grid. */
  test('text is sent as ops beside the frame, not rasterized into it', async () => {
    const srv = await startServer('examples/counter/app.jsx', ['--hostfont']);
    const c = await connect(srv.port);
    try {
      expect(await until(c.msgs, 2)).toBe(true);
      const bin = c.msgs.filter((m) => m instanceof ArrayBuffer);
      const txt = c.msgs.filter((m) => typeof m === 'string').map((m) => JSON.parse(m));
      expect(bin.length).toBeGreaterThan(0);
      expect(bin[0].byteLength).toBe(W * H * 4);

      const ops = txt.find((m) => m.t === 'text');
      expect(ops).toBeTruthy();
      expect(Array.isArray(ops.ops)).toBe(true);
      expect(ops.ops.length).toBeGreaterThan(0);
      /* the contract the page draws against: a string, where it starts,
         one advance per glyph and the line box it must fit */
      const op = ops.ops[0];
      for (const k of ['x', 'y', 'str', 'color', 'adv']) expect(op).toHaveProperty(k);
      expect(typeof op.str).toBe('string');
      expect(op.adv).toBeGreaterThan(0);
      expect(ops.ops.some((o) => /COUNT/i.test(o.str))).toBe(true);

      /* the page upscales x2 for real glyphs */
      const html = await (await fetch('http://127.0.0.1:' + srv.port + '/')).text();
      expect(html).toContain('width=' + (W * 2) + ' height=' + (H * 2));
    } finally { c.close(); srv.kill(); }
  }, 30000);
});

/* ---------------------------------------------------------------- */
/* mirror.js: the op-list mirror, in-process — no SDL, no display.   */
/* ---------------------------------------------------------------- */

describe('http backend: mirror (op-list)', () => {
  const { createMirror, createRecorder } = require(MIRROR);
  const { createPureJsBackend } = require(path.join(ROOT, 'backends', 'pure-js', 'src', 'backend.js'));

  test('the recorder forwards every call and hands back the op list', () => {
    const be = createPureJsBackend(40, 20);
    const rec = createRecorder(be.gfx);
    rec.gfx.clear(0x000000);
    rec.gfx.frect(2, 2, 10, 6, 0xff0000, 2);
    rec.gfx.rect(1, 1, 12, 8, 0x00ff00);
    rec.gfx.circle(20, 10, 4, 0x0000ff, true);
    rec.gfx.line(0, 0, 39, 19, 0xffffff);
    rec.gfx.clip(0, 0, 20, 20);
    rec.gfx.text(1, 1, 1, 0xffffff, 'HI');
    rec.gfx.unclip();
    /* poly is the eleventh call, optional by contract — the recorder only
       exposes it when the real backend has it, and pure-js does */
    expect(typeof rec.gfx.poly).toBe('function');
    rec.gfx.poly([[{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 4, y: 8 }]], 0xff00ff, 'nonzero');

    const ops = rec.take();
    expect(ops.map((o) => o[0])).toEqual(['C', 'f', 'r', 'c', 'l', 'x', 't', 'X', 'p']);
    /* the op payload is what the page replays, so it has to survive JSON */
    expect(JSON.parse(JSON.stringify(ops))).toEqual(ops);
    expect(ops[1]).toEqual(['f', 2, 2, 10, 6, 0xff0000, 2]);
    expect(ops[3]).toEqual(['c', 20, 10, 4, 0x0000ff, 1]);   // fill -> 1, not true
    expect(ops[2][6]).toBe(0);                               // absent radius -> 0
    expect(rec.take()).toEqual([]);          // take() drains
    expect(rec.gfx.width()).toBe(40);        // metrics pass through
    expect(rec.gfx.height()).toBe(20);
    /* forwarded, not just recorded: the real buffer actually changed */
    let ink = 0;
    for (let i = 0; i < be.raw.length; i++) if (be.raw[i]) ink++;
    expect(ink).toBeGreaterThan(0);
    /* text is recorded as a string even when handed a number */
    rec.gfx.text(0, 0, 1, 0xffffff, 7);
    expect(rec.take()[0][5]).toBe('7');
  });

  test('serves its page, bundles the real rasterizer, and streams a frame', async () => {
    const got = { ptr: null, key: null, wheel: null, connects: 0 };
    const m = createMirror({
      port: 0,
      pointer: (id, phase, x, y) => { got.ptr = [id, phase, x, y]; },
      key: (type, key) => { got.key = [type, key]; },
      wheel: (x, y, dy) => { got.wheel = [x, y, dy]; },
      connect: () => { got.connects++; }
    });
    try {
      expect(m.port).toBeGreaterThan(0);      // port 0 resolved to a real one

      const page = await fetch('http://127.0.0.1:' + m.port + '/');
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('<canvas id=c');
      expect(html).toContain('/mjsx-backend.js');

      /* HD:OFF replays ops through the REAL rasterizer, so the page has to
         be able to fetch a working bundle of it */
      const js = await fetch('http://127.0.0.1:' + m.port + '/mjsx-backend.js');
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('javascript');
      const src = await js.text();
      expect(src.length).toBeGreaterThan(1000);
      expect(src).toContain('createPureJsBackend');

      const c = await connect(m.port);
      try {
        /* no frame recorded yet: the mirror asks the host for one rather
           than opening the page onto black */
        await Bun.sleep(200);
        expect(got.connects).toBe(1);
        expect(m.clients()).toBe(1);

        const ops = [['C', 0x101014], ['t', 4, 4, 2, 0xffffff, 'HELLO']];
        const fonts = { 1: { adv: 5, lh: 8 }, 2: { adv: 7, lh: 10 } };
        m.frame(ops, 240, 240, fonts);
        expect(await until(c.msgs, 1)).toBe(true);
        const msg = JSON.parse(c.msgs[0]);
        expect(msg.t).toBe('frame');
        expect(msg.w).toBe(240);
        expect(msg.h).toBe(240);
        expect(msg.ops).toEqual(ops);
        expect(msg.fonts).toEqual(fonts);

        m.focus(true);
        expect(await until(c.msgs, 2)).toBe(true);
        expect(JSON.parse(c.msgs[1])).toEqual({ t: 'focus', on: true });

        /* input flows the other way through the callbacks */
        c.ws.send(JSON.stringify({ t: 'ptr', id: 't3', phase: 1, x: 10.6, y: 20.4 }));
        c.ws.send(JSON.stringify({ t: 'key', type: 'down', key: 'A' }));
        c.ws.send(JSON.stringify({ t: 'wheel', x: 5, y: 6, dy: -0.5 }));
        await Bun.sleep(200);
        expect(got.ptr).toEqual(['t3', 1, 11, 20]);
        expect(got.key).toEqual(['down', 'A']);
        /* dy stays a float — a trackpad's sub-pixel delta carries the
           direction, and rounding it to 0 would lose it */
        expect(got.wheel).toEqual([5, 6, -0.5]);

        /* Regression: the same null-payload crash server.js had. Here it
           would have taken down the whole sim process. Nothing that is not
           a JSON OBJECT may reach a callback at all. */
        const before = JSON.stringify(got);
        for (const j of ['null', '7', '"x"', '[]', 'nonsense', '', '{']) {
          c.ws.send(j);
          await Bun.sleep(20);
        }
        await Bun.sleep(200);
        expect(JSON.stringify(got)).toBe(before);

        /* A well-formed message with nothing in it IS routed — but every
           number it carries has to come out finite. */
        c.ws.send(JSON.stringify({ t: 'ptr' }));
        await Bun.sleep(150);
        expect(got.ptr[0]).toBe(undefined);
        expect(got.ptr.slice(1)).toEqual([0, 0, 0]);
        c.ws.send(JSON.stringify({ t: 'wheel', x: 'nope', y: null, dy: 1e400 }));
        await Bun.sleep(150);
        expect(got.wheel).toEqual([0, 0, 0]);
        expect(got.key).toEqual(['down', 'A']);   // never touched by any of it
        expect((await fetch('http://127.0.0.1:' + m.port + '/')).status).toBe(200);

        /* a late joiner gets the remembered frame instead of nothing */
        const late = await connect(m.port);
        try {
          expect(await until(late.msgs, 1)).toBe(true);
          expect(JSON.parse(late.msgs[0]).t).toBe('frame');
          expect(got.connects).toBe(1);       // not asked again: one was cached
        } finally { late.close(); }
      } finally { c.close(); }
    } finally { m.stop(); }
  }, 40000);
});

/* ---------------------------------------------------------------- */
/* sdl sim --http: the headless HALF of the sdl backend.             */
/* ---------------------------------------------------------------- */

/* The sim opens a real SDL2 window, so only its mirror can be checked
   here — and only when SDL2 is installed. SDL_VIDEODRIVER=dummy keeps it
   off any display. Everything else about the sdl backend (the window, the
   toolbar, SDL_ttf host fonts) stays manual. */
const SDL_LIBS = ['/opt/homebrew/lib/libSDL2.dylib', '/usr/local/lib/libSDL2.dylib',
                  '/usr/lib/x86_64-linux-gnu/libSDL2-2.0.so.0', '/usr/lib/aarch64-linux-gnu/libSDL2-2.0.so.0'];
const HAVE_SDL = SDL_LIBS.some((p) => fs.existsSync(p));

describe('sdl backend: headless surface', () => {
  test('window.js and ttf.js import without touching a display', () => {
    /* Loading the modules must not dlopen or SDL_Init — that only happens
       inside createSdlWindow/createTtfText. */
    const win = require(path.join(ROOT, 'backends', 'sdl', 'src', 'window.js'));
    expect(typeof win.createSdlWindow).toBe('function');
    const ttf = require(path.join(ROOT, 'backends', 'sdl', 'src', 'ttf.js'));
    expect(typeof ttf.createTtfText).toBe('function');
    expect(typeof ttf.availableFaces).toBe('function');
    /* face discovery is pure filesystem work, no SDL */
    expect(Array.isArray(ttf.availableFaces(false))).toBe(true);
  });

  (HAVE_SDL ? test : test.skip)('sim --http=0 serves its mirror and streams an op-list frame', async () => {
    const proc = Bun.spawn(['bun', SIM, 'counter', '--http=0'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { SDL_VIDEODRIVER: 'dummy' }),
      stdout: 'pipe', stderr: 'pipe'
    });
    spawned.push(proc);
    try {
      const port = await portFrom(proc, 20000);
      expect(port).toBeGreaterThan(0);
      expect((await fetch('http://127.0.0.1:' + port + '/')).status).toBe(200);

      const c = await connect(port);
      try {
        expect(await until(c.msgs, 1, 8000)).toBe(true);
        const msg = JSON.parse(c.msgs[0]);
        expect(msg.t).toBe('frame');
        expect(msg.w).toBe(240);
        expect(msg.h).toBe(240);
        /* the counter draws a clear, a heading and a button */
        expect(msg.ops.length).toBeGreaterThan(2);
        expect(msg.ops[0][0]).toBe('C');
        expect(msg.ops.some((o) => o[0] === 't' && /COUNT/i.test(o[5]))).toBe(true);
        /* fontMeta rides along so the page's glyphs land on the host grid */
        expect(msg.fonts['1'].adv).toBeGreaterThan(0);
        expect(msg.fonts['1'].lh).toBeGreaterThan(0);
      } finally { c.close(); }
      expect(proc.exitCode).toBe(null);
    } finally { try { proc.kill(); } catch (e) {} }
  }, 40000);
});
