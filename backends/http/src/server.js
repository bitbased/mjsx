/*
 * mjsx over HTTP/WebSocket — a live pixel framebuffer in a browser tab,
 * with real input marshalled back. This is the low-risk half of the
 * "stream a UI instead of a compressed framebuffer" idea from the README:
 * for now it *does* send raw pixels (the pure-js backend's own buffer),
 * not a structured op-list — that's the natural next step once this
 * proves the input direction works, not a redesign of it.
 *
 * Unlike the terminal backend, this one can be honest about keydown/keyup/
 * keypress: a real browser gives genuine separate press/release timing
 * (the terminal backend's interactive.js has to fake all three from one
 * tty byte, and says so). And because mjsx-core's pointer() now takes an
 * id, a browser's real per-finger touch.identifier passes straight
 * through — this is the first backend that can genuinely test multitouch,
 * not just accept the parameter.
 *
 *   bun server.js <example.jsx> [port] [width] [height]
 */
var path = require('path');
var exampleFile = process.argv[2];
var port = parseInt(process.argv[3] || '8737', 10);
var W = parseInt(process.argv[4] || '240', 10);
var H = parseInt(process.argv[5] || '280', 10);

if (!exampleFile) {
  console.error('usage: bun server.js <example.jsx> [port] [width] [height]');
  process.exit(1);
}

var backend = require('../../pure-js/src/backend.js').createPureJsBackend(W, H);
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;

require(path.resolve(exampleFile));
UI.render();

/* RGBA, not the RGB the PPM writer produces — canvas ImageData needs the
   alpha channel, and building it here (once, reused) is cheaper than
   asking every connected client to pad it themselves. */
function rgbaFrame() {
  var w = backend.width, h = backend.height;
  // backend.js keeps its pixel buffer private; toPPM() is its only public
  // export today, so the RGB bytes are pulled out of that rather than
  // reaching into the module's internals — the seam to widen later is
  // backend.js itself, not this file working around it.
  var ppm = backend.toPPM();
  var headerEnd = 0, newlines = 0;
  for (var i = 0; i < ppm.length && newlines < 3; i++) if (ppm[i] === 10) newlines++, headerEnd = i + 1;
  var rgb = ppm.subarray(headerEnd);
  var rgba = new Uint8Array(w * h * 4);
  for (var p = 0, q = 0; p < w * h; p++, q += 3) {
    rgba[p * 4] = rgb[q]; rgba[p * 4 + 1] = rgb[q + 1]; rgba[p * 4 + 2] = rgb[q + 2]; rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

var PAGE = '<!doctype html><meta charset=utf-8><title>mjsx</title>' +
  '<style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}' +
  'canvas{image-rendering:pixelated;border:1px solid #333;touch-action:none}</style>' +
  '<canvas id=c width=' + W + ' height=' + H + '></canvas><script>' +
  'var cv=document.getElementById("c"),ctx=cv.getContext("2d");' +
  'var ws=new WebSocket("ws://"+location.host+"/ws");' +
  'ws.binaryType="arraybuffer";' +
  'ws.onmessage=function(e){' +
  '  var u8=new Uint8Array(e.data);' +
  '  var img=ctx.createImageData(' + W + ',' + H + ');' +
  '  img.data.set(u8); ctx.putImageData(img,0,0);' +
  '};' +
  'function send(o){ if(ws.readyState===1) ws.send(JSON.stringify(o)); }' +
  '// Mouse: pointer id "mouse", one contact.\n' +
  'cv.addEventListener("mousedown",function(e){send({t:"ptr",id:"mouse",phase:0,x:e.offsetX,y:e.offsetY});});' +
  'cv.addEventListener("mousemove",function(e){if(e.buttons)send({t:"ptr",id:"mouse",phase:1,x:e.offsetX,y:e.offsetY});});' +
  'window.addEventListener("mouseup",function(e){send({t:"ptr",id:"mouse",phase:2,x:e.offsetX||0,y:e.offsetY||0});});' +
  '// Touch: each finger\'s own identifier passes straight through as the\n' +
  '// pointer id — real multitouch, not simulated.\n' +
  'function touchXY(t){var r=cv.getBoundingClientRect();return {x:t.clientX-r.left,y:t.clientY-r.top};}' +
  'function onTouch(phase){return function(e){e.preventDefault();' +
  '  var list=e.changedTouches;' +
  '  for(var i=0;i<list.length;i++){var p=touchXY(list[i]);send({t:"ptr",id:"t"+list[i].identifier,phase:phase,x:p.x,y:p.y});}' +
  '};}' +
  'cv.addEventListener("touchstart",onTouch(0),{passive:false});' +
  'cv.addEventListener("touchmove",onTouch(1),{passive:false});' +
  'cv.addEventListener("touchend",onTouch(2),{passive:false});' +
  'cv.addEventListener("touchcancel",onTouch(2),{passive:false});' +
  '// Keyboard: a real browser gives genuine separate down/up, and keypress\n' +
  '// where the browser still fires it — unlike a bare tty, nothing here is\n' +
  '// an approximation.\n' +
  'window.addEventListener("keydown",function(e){send({t:"key",type:"down",key:e.key});});' +
  'window.addEventListener("keyup",function(e){send({t:"key",type:"up",key:e.key});});' +
  'window.addEventListener("keypress",function(e){send({t:"key",type:"press",key:e.key});});' +
  '</script>';

var sockets = [];

function broadcastFrame() {
  var buf = rgbaFrame();
  for (var i = 0; i < sockets.length; i++) {
    if (sockets[i].readyState === 1) sockets[i].send(buf);
  }
}

var server = Bun.serve({
  port: port,
  fetch: function (req, srv) {
    var url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (srv.upgrade(req)) return;
      return new Response('upgrade failed', { status: 400 });
    }
    return new Response(PAGE, { headers: { 'Content-Type': 'text/html' } });
  },
  websocket: {
    open: function (ws) {
      sockets.push(ws);
      ws.send(rgbaFrame()); // the frame already on screen, immediately
    },
    close: function (ws) {
      var i = sockets.indexOf(ws);
      if (i >= 0) sockets.splice(i, 1);
    },
    message: function (ws, data) {
      var msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg.t === 'ptr') {
        UI.pointer(msg.id, msg.phase, Math.round(msg.x), Math.round(msg.y));
      } else if (msg.t === 'key') {
        UI.key(msg.type, msg.key);
      }
      if (UI.dirty()) { UI.render(); broadcastFrame(); }
    }
  }
});

// A tick loop for the same reason every other backend has one: momentum
// and long-press repeat happen between input events, not because of them.
setInterval(function () {
  if (UI.ticker()) { UI.render(); broadcastFrame(); }
}, 33); // ~30fps — a live view, not a benchmark

console.log('mjsx serving ' + exampleFile + ' at http://localhost:' + port + '/  (' + W + 'x' + H + ')');
