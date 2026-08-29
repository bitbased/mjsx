#!/usr/bin/env bun
/*
 * Read back what a figure carries.
 *
 * scripts/shoot.mjs writes two text chunks into every PNG it makes:
 *   mjsx-shot   how the picture was made — profile, source, the taps and
 *               keys, and any --note — so it can be reproduced later
 *   mjsx-ops    the frame as DRAW CALLS rather than pixels
 *
 * The ops are the interesting half: they are resolution-independent, so
 * `--replay out.png --scale 4` redraws the figure with a 4x font instead
 * of magnifying a small one. The picture and its source travel as one
 * file, and every image viewer ignores the chunks it does not know.
 *
 *   bun scripts/shot-info.mjs <shot.png>                    # the recipe
 *   bun scripts/shot-info.mjs <shot.png> --ops              # the ops
 *   bun scripts/shot-info.mjs <shot.png> --replay out.png [--scale 4]
 */
import { readFileSync, writeFileSync } from 'fs';
import { inflateSync, deflateSync } from 'zlib';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const OPREC = req('../packages/core/src/oprec.js');
const BACKEND = '../backends/pure-js/src/backend.js';

/* ---- PNG text chunks -------------------------------------------------
 * Walk the chunk list; tEXt is plain, zTXt is deflated after a
 * keyword\0 and a one-byte compression method. Nothing else is decoded:
 * this reads metadata, it does not decode images.
 */
function readTextChunks(buf) {
  const out = {};
  let p = 8;                                   /* past the signature */
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'tEXt' || type === 'zTXt') {
      const nul = data.indexOf(0);
      const key = data.toString('latin1', 0, nul);
      out[key] = type === 'tEXt'
        ? data.toString('utf8', nul + 1)
        : inflateSync(data.subarray(nul + 2)).toString('utf8');
    }
    if (type === 'IEND') break;
    p += 12 + len;                             /* len + type + data + crc */
  }
  return out;
}

/* ---- PNG writing, for --replay ---- */
function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function rgbToPng(px, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- main ---- */
const args = process.argv.slice(2);
const file = args[0];
if (!file || file === '--help' || file === '-h') {
  console.log('usage: bun scripts/shot-info.mjs <shot.png> [--ops] [--replay out.png [--scale N]]');
  process.exit(file ? 0 : 1);
}
const buf = readFileSync(file);
const meta = readTextChunks(buf);

if (!meta['mjsx-shot'] && !meta['mjsx-ops']) {
  console.error(file + ': no mjsx metadata — was it made by scripts/shoot.mjs?');
  process.exit(1);
}

const wantOps = args.includes('--ops');
const replayAt = args.indexOf('--replay');
const scaleAt = args.indexOf('--scale');
const scale = scaleAt >= 0 ? Number(args[scaleAt + 1]) : 1;

if (replayAt >= 0) {
  const out = args[replayAt + 1];
  if (!out) { console.error('--replay needs an output path'); process.exit(1); }
  const rec = JSON.parse(meta['mjsx-ops']);
  const w = Math.round(rec.w * scale), h = Math.round(rec.h * scale);
  const backend = req(BACKEND).createPureJsBackend(w, h, {});
  OPREC.replay(rec.ops, backend.gfx, scale);
  writeFileSync(out, rgbToPng(backend.raw, w, h));
  console.log('replayed ' + rec.ops.length + ' ops at ' + scale + 'x -> ' + out + '  ' + w + 'x' + h);
  process.exit(0);
}

if (wantOps) {
  console.log(meta['mjsx-ops'] || '(no ops)');
  process.exit(0);
}

if (meta['mjsx-shot']) {
  const shot = JSON.parse(meta['mjsx-shot']);
  console.log(file);
  if (shot.note) console.log('  note      ' + shot.note);
  console.log('  profile   ' + shot.profile + '  ' + shot.size.w + 'x' + shot.size.h +
              (shot.size.round ? ' round' : '') +
              (shot.size.scale > 1 ? '  scale ' + shot.size.scale : ''));
  if (shot.source) console.log('  source    ' + shot.source);
  if (shot.actions) console.log('  actions   ' + JSON.stringify(shot.actions));
  if (shot.frames > 1) console.log('  frames    ' + shot.frames);
  if (shot.command) console.log('  reproduce ' + shot.command);
}
if (meta['mjsx-ops']) {
  const rec = JSON.parse(meta['mjsx-ops']);
  console.log('  ops       ' + rec.ops.length + ' draw calls (replay with --replay out.png --scale N)');
}
