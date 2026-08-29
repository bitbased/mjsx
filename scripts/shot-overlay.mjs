#!/usr/bin/env bun
/*
 * The debug overlay for a figure, on demand.
 *
 * WHAT A FIGURE CARRIES, AND WHY.
 * Two things, and deliberately not a third:
 *
 *   mjsx-ops       the frame as DRAW CALLS — colour, text, shape and all,
 *                  not merely rectangles. Everything a debug overlay can
 *                  show today, plus whatever it learns to show later.
 *   mjsx-overlay   the overlay already RENDERED, as a PNG. Costs about
 *                  25% of the file and needs no interpretation at all.
 *
 * The third thing — a chunk of derived rectangles — was tried and dropped.
 * It is smaller (244 bytes against the ops' 1267 on kb-qwerty-lcd35.png)
 * but it is a LOSSY summary: it throws away which colour drew a box, what
 * the text said, and whether the shape was really a rect at all. The ops
 * hold all of that already, so the boxes were both redundant and worse.
 *
 * Embedding a rendered image inside a PNG is a real technique — Fireworks
 * kept a whole second document that way, and PNG's private ancillary
 * chunks make it perfectly legal. It earns its 25% as ARCHIVE SAFETY: if
 * the op format ever changes shape, old figures stop being interpretable,
 * and the picture is what still works. Hence the chain below: ops first,
 * because they are the rich source, then the embedded image as the last
 * resort.
 *
 * (If a second image were genuinely needed as a first-class thing, APNG
 * is the standard answer — acTL/fcTL/fdAT, supported by every major
 * browser. It is the wrong tool here because it ANIMATES: a documentation
 * figure would flash between the screenshot and its overlay.)
 *
 *   bun scripts/shot-overlay.mjs <shot.png> [--svg out.svg] [--png out.png]
 *                                           [--scale N] [--kinds fill,stroke,clip,circle]
 */
import { readFileSync, writeFileSync } from 'fs';
import { inflateSync, deflateSync } from 'zlib';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const OPREC = req('../packages/core/src/oprec.js');
const BACKEND = '../backends/pure-js/src/backend.js';

const COLOURS = {
  fill:   '#5aaaff',
  stroke: '#7fd8a8',
  clip:   '#ff5050',
  circle: '#78dca0'
};

function readChunks(buf) {
  const out = {};
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'zTXt') {
      const nul = data.indexOf(0);
      out[data.toString('latin1', 0, nul)] = inflateSync(data.subarray(nul + 2)).toString('utf8');
    } else if (type === 'tEXt') {
      const nul = data.indexOf(0);
      out[data.toString('latin1', 0, nul)] = data.toString('utf8', nul + 1);
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

/* ---- args ---- */
const args = process.argv.slice(2);
const file = args[0];
if (!file || file === '-h' || file === '--help') {
  console.log('usage: bun scripts/shot-overlay.mjs <shot.png> [--svg out.svg] [--png out.png]');
  console.log('                                    [--scale N] [--kinds fill,stroke,clip,circle]');
  process.exit(file ? 0 : 1);
}
function opt(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
const scale = Number(opt('--scale', 1));
const kinds = opt('--kinds', 'fill,stroke,clip,circle').split(',');
const svgOut = opt('--svg', null);
const pngOut = opt('--png', null);

const meta = readChunks(readFileSync(file));

/* A fallback chain, in order of how much interpretation each needs.
   The point of the later links is that a figure keeps working when the
   earlier one stops being readable. The ops are the rich source — colour,
   text and shape, not just rectangles — and an embedded overlay image is
   the last resort that needs no interpretation at all. */
let rec = null, boxes = null, via = null;
if (meta['mjsx-ops']) {
  const parsed = JSON.parse(meta['mjsx-ops']);
  rec = { w: parsed.w, h: parsed.h, ops: parsed.ops };
  if (!boxes) { boxes = OPREC.boxes(parsed.ops); via = 'ops'; }
}
if (!boxes && meta['mjsx-overlay']) {
  /* nothing interpretable left: hand back the embedded picture itself */
  const raw = Buffer.from(meta['mjsx-overlay'], 'base64');
  const dest = pngOut || 'overlay.png';
  writeFileSync(dest, raw);
  console.log('wrote ' + dest + '  (embedded overlay image, ' + raw.length + ' bytes)');
  process.exit(0);
}
if (!boxes) {
  console.error(file + ': no ops, boxes or overlay — was it made by scripts/shoot.mjs?');
  process.exit(1);
}
boxes = boxes.filter(b => kinds.indexOf(b.kind) >= 0);

/* ---- SVG: the form anything can open, and the smallest ---- */
if (svgOut || (!svgOut && !pngOut)) {
  const W = rec.w * scale, H = rec.h * scale;
  const rects = boxes.map(b =>
    '  <rect x="' + (b.x * scale + 0.5) + '" y="' + (b.y * scale + 0.5) +
    '" width="' + Math.max(1, b.w * scale - 1) + '" height="' + Math.max(1, b.h * scale - 1) +
    '" stroke="' + COLOURS[b.kind] + '" class="' + b.kind + '"/>').join('\n');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + ' ' + H + '">\n' +
    '<title>draw-op overlay for ' + file.replace(/[<&]/g, '') + '</title>\n' +
    '<g fill="none" stroke-width="1">\n' + rects + '\n</g>\n</svg>\n';
  if (svgOut) {
    writeFileSync(svgOut, svg);
    console.log('wrote ' + svgOut + '  ' + boxes.length + ' rects, ' + svg.length + ' bytes (via ' + via + ')');
  } else {
    process.stdout.write(svg);
  }
}

/* ---- PNG: the render with the boxes drawn over it ---- */
if (pngOut) {
  const be = req(BACKEND).createPureJsBackend(rec.w, rec.h, { dpr: scale });
  /* with ops, the boxes land over the real frame; without them (a figure
     read through the boxes fallback) they land on black, which is still
     the overlay someone asked for */
  if (rec.ops) OPREC.replay(rec.ops, be.gfx); else be.gfx.clear(0x000000);
  const g = be.gfx;
  /* drawn through the same gfx contract, so the overlay lands on exactly
     the geometry the frame produced */
  for (const b of boxes) {
    const c = parseInt(COLOURS[b.kind].slice(1), 16);
    g.rect(b.x, b.y, b.w, b.h, c, 0);
  }
  const w = rec.w * scale, h = rec.h * scale;
  writeFileSync(pngOut, rgbToPng(be.raw, w, h));
  console.log('wrote ' + pngOut + '  ' + w + 'x' + h + ', ' + boxes.length + ' rects');
}

/* minimal PNG writer, same as the other scripts */
function crc32(buf) {
  let c, t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
