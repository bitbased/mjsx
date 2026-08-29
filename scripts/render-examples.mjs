/*
 * Render every example headlessly and build the gallery images.
 *
 *   bun scripts/render-examples.mjs
 *
 * For each directory under examples/ this runs the pure-js backend's
 * runner (backends/pure-js/src/run.js) on its app.jsx at 240x280 in a
 * separate bun process, then converts the PPM it writes into
 * out/gallery/<name>.png. The PNG encoder here is plain JS on top of
 * node's zlib — no image library, matching the backend's own
 * no-native-deps stance.
 *
 * Examples that gate on device natives (camera, wifi, screen, ...)
 * render their no-hardware fallback, which is itself informative. A
 * broken example never kills the run: each one gets its own process, a
 * timeout, and a recorded failure.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = join(ROOT, 'examples');
const OUT = join(ROOT, 'out', 'gallery');
const RUNNER = join(ROOT, 'backends', 'pure-js', 'src', 'run.js');
const W = 240, H = 280;
const TIMEOUT_MS = 15000;

/* ---- minimal PPM (P6) -> PNG, pure JS ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function ppmToPng(ppm) {
  /* header: "P6" <w> <h> <maxval>, tokens separated by whitespace,
     # starts a comment to end of line; one whitespace byte then raw RGB */
  let pos = 0;
  function token() {
    for (;;) {
      while (pos < ppm.length && /\s/.test(String.fromCharCode(ppm[pos]))) pos++;
      if (ppm[pos] === 0x23) { while (pos < ppm.length && ppm[pos] !== 0x0a) pos++; }
      else break;
    }
    const start = pos;
    while (pos < ppm.length && !/\s/.test(String.fromCharCode(ppm[pos]))) pos++;
    return ppm.toString('ascii', start, pos);
  }
  if (token() !== 'P6') throw new Error('not a P6 PPM');
  const w = parseInt(token(), 10), h = parseInt(token(), 10), max = parseInt(token(), 10);
  pos++; // the single whitespace byte after maxval
  if (!(w > 0 && h > 0) || max !== 255) throw new Error('unsupported PPM: ' + w + 'x' + h + ' max ' + max);
  const stride = w * 3;
  if (ppm.length - pos < stride * h) throw new Error('truncated PPM pixel data');

  /* scanlines with filter byte 0 (None), deflated into one IDAT */
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    ppm.copy(raw, y * (stride + 1) + 1, pos + y * stride, pos + (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- run one example in its own process ---- */

async function renderOne(name) {
  const app = join(EXAMPLES, name, 'app.jsx');
  const ppmPath = join(OUT, name + '.ppm');
  const pngPath = join(OUT, name + '.png');
  const proc = Bun.spawn(['bun', RUNNER, app, ppmPath, String(W), String(H)], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, TIMEOUT_MS);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  const stderr = await new Response(proc.stderr).text();

  /* An example that schedules timers (sensors, wifi) keeps bun's event
     loop alive after the frame is written; the kill is expected then and
     the PPM on disk is the frame we want. */
  if (!existsSync(ppmPath)) {
    return { name, ok: false, why: (timedOut ? 'timed out; ' : 'exit ' + exitCode + '; ') + firstLine(stderr) };
  }
  try {
    writeFileSync(pngPath, ppmToPng(readFileSync(ppmPath)));
  } catch (e) {
    return { name, ok: false, why: 'PPM->PNG failed: ' + e.message };
  } finally {
    cleanup(ppmPath);
    cleanup(ppmPath.replace(/\.ppm$/, '.after.ppm')); // demo second frame, not gallery material
  }
  return { name, ok: true, note: timedOut ? 'killed after frame (live timers)' : '' };
}

function firstLine(s) { return (s || '').trim().split('\n')[0] || 'no stderr'; }
function cleanup(p) { try { unlinkSync(p); } catch (e) { /* wasn't written */ } }

/* ---- main ---- */

mkdirSync(OUT, { recursive: true });
const names = readdirSync(EXAMPLES)
  .filter((n) => statSync(join(EXAMPLES, n)).isDirectory() && existsSync(join(EXAMPLES, n, 'app.jsx')))
  .sort();

const results = [];
for (const name of names) {
  const r = await renderOne(name);
  results.push(r);
  console.log((r.ok ? 'ok   ' : 'FAIL ') + name + (r.note ? '  (' + r.note + ')' : '') + (r.why ? '  ' + r.why : ''));
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' examples rendered to ' + OUT);
if (failed.length) process.exit(1);
