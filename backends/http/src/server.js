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
var flagArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) === '--'; });
var numArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) !== '--'; });
var exampleFile = numArgs[0];
var port = parseInt(numArgs[1] || '8737', 10);
var W = parseInt(numArgs[2] || '240', 10);
var H = parseInt(numArgs[3] || '280', 10);
/* --hostfont: text is NOT rasterized into the pixel frame; the browser
   draws it with a real monospace font, fitted to the mjsx grid (advance =
   op.adv, line box within op.lineH, baseline on the cell bottom so
   descenders use the leading rows). Layout is identical either way. */
var hostFont = flagArgs.indexOf('--hostfont') !== -1;

if (!exampleFile) {
  console.error('usage: bun server.js <example.jsx> [port] [width] [height]');
  process.exit(1);
}

var backend = require('../../pure-js/src/backend.js').createPureJsBackend(W, H, hostFont ? { textMode: 'capture' } : {});
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;
globalThis.Modal = core.Modal;
globalThis.Keyboard = core.Keyboard;
globalThis.ArcFooter = core.ArcFooter;

require(path.resolve(exampleFile));

/* Declared BEFORE the first render: an app that focuses a field from
   inside its render (or from a mount-time effect) calls onFocusChange
   during the UI.render() below, and a `var sockets` further down the
   file would still be undefined there — the server died on startup with
   "undefined is not an object (evaluating 'sockets.length')". */
var sockets = [];

/* The host half of native-keyboard support: when a field gains or loses
   focus, tell the page, which focuses or blurs its hidden real input --
   on a phone that is what shows and hides the system keyboard. */
UI.onFocusChange = function (id) {
  var fmsg = JSON.stringify({ t: 'focus', on: !!id });
  for (var fi = 0; fi < sockets.length; fi++) {
    if (sockets[fi].readyState === 1) sockets[fi].send(fmsg);
  }
};
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

var S = hostFont ? 2 : 1; /* host-font pages upscale so real glyphs are crisp */
var PAGE = '<!doctype html><meta charset=utf-8><title>mjsx</title>' +
  '<style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}' +
  'canvas{image-rendering:pixelated;border:1px solid #333;touch-action:none;width:' + (W * S) + 'px;height:' + (H * S) + 'px}</style>' +
  '<canvas id=c width=' + (W * S) + ' height=' + (H * S) + '></canvas>' +
  /* An invisible REAL input: focusing it is the only way to summon a
     phone's native keyboard. The server says when an mjsx field has
     focus; what gets typed here is relayed as keys and never kept. */
  '<input id=osk autocomplete=off autocapitalize=off spellcheck=false style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0">' +
  '<script>' +
  'var S=' + S + ',W=' + W + ',H=' + H + ';' +
  'var cv=document.getElementById("c"),ctx=cv.getContext("2d");' +
  'var off=document.createElement("canvas");off.width=W;off.height=H;var octx=off.getContext("2d");' +
  'var textOps=[];' +
  '// Fit a real monospace font to the mjsx grid: one glyph advance = adv,\n' +
  '// and CAP HEIGHT within the glyph cell (h) - fitting the nominal line\n' +
  '// box would shrink the glyphs, since monospace faces carry boxes far\n' +
  '// taller than their caps. Baseline sits on the cell bottom; descenders\n' +
  '// drop into the leading rows exactly like the bitmap fonts.\n' +
  'var MONO="ui-monospace,Menlo,Consolas,monospace";var fitCache={};' +
  'function fitFont(adv,cellH){var k=adv+"x"+cellH;if(fitCache[k])return fitCache[k];' +
  '  ctx.font="100px "+MONO;var m=ctx.measureText("M");' +
  '  var rw=m.width/100;var rc=(m.actualBoundingBoxAscent||72)/100;' +
  '  var px=Math.min(adv*S/rw,cellH*S/rc);' +
  '  return fitCache[k]=Math.floor(px);}' +
  'function redraw(){' +
  '  ctx.imageSmoothingEnabled=false;' +
  '  ctx.drawImage(off,0,0,W*S,H*S);' +
  '  for(var i=0;i<textOps.length;i++){var o=textOps[i];' +
  '    ctx.save();' +
  '    if(o.clip){ctx.beginPath();ctx.rect(o.clip.x*S,o.clip.y*S,o.clip.w*S,o.clip.h*S);ctx.clip();}' +
  '    ctx.font=fitFont(o.adv,o.h)+"px "+MONO;' +
  '    ctx.fillStyle="#"+("00000"+o.color.toString(16)).slice(-6);' +
  '    ctx.textAlign="center";ctx.textBaseline="alphabetic";' +
  '    var inkW=o.adv-(o.sp||0);var baseY=(o.y+(o.base||o.h))*S;' +
  '    for(var j=0;j<o.str.length;j++){' +
  '      ctx.fillText(o.str[j],(o.x+j*o.adv+inkW/2)*S,baseY);' +
  '    }' +
  '    ctx.restore();' +
  '  }' +
  '}' +
  'var ws=new WebSocket("ws://"+location.host+"/ws");' +
  'ws.binaryType="arraybuffer";' +
  'ws.onmessage=function(e){' +
  '  if(typeof e.data==="string"){try{var m=JSON.parse(e.data);if(m.t==="text"){textOps=m.ops;redraw();}else if(m.t==="focus"){if(m.on)osk.focus();else osk.blur();}}catch(x){}return;}' +
  '  var u8=new Uint8Array(e.data);' +
  '  var img=octx.createImageData(W,H);' +
  '  img.data.set(u8); octx.putImageData(img,0,0);' +
  '  redraw();' +
  '};' +
  'function send(o){ if(ws.readyState===1) ws.send(JSON.stringify(o)); }' +
  '// Mouse: pointer id "mouse", one contact.\n' +
  'cv.addEventListener("mousedown",function(e){send({t:"ptr",id:"mouse",phase:0,x:e.offsetX/S,y:e.offsetY/S});});' +
  'cv.addEventListener("mousemove",function(e){if(e.buttons)send({t:"ptr",id:"mouse",phase:1,x:e.offsetX/S,y:e.offsetY/S});});' +
  'window.addEventListener("mouseup",function(e){send({t:"ptr",id:"mouse",phase:2,x:(e.offsetX||0)/S,y:(e.offsetY||0)/S});});' +
  '// Touch: each finger\'s own identifier passes straight through as the\n' +
  '// pointer id — real multitouch, not simulated.\n' +
  'function touchXY(t){var r=cv.getBoundingClientRect();return {x:(t.clientX-r.left)/S,y:(t.clientY-r.top)/S};}' +
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
  'var osk=document.getElementById("osk");' +
  'window.addEventListener("keydown",function(e){' +
  '  var k=e.key==="Tab"&&e.shiftKey?"ShiftTab":e.key;' +
  '  send({t:"key",type:"down",key:k});' +
  '  if(e.key.length>1)send({t:"key",type:"press",key:k});' +
  '  if(e.key==="Tab"||e.key==="Backspace")e.preventDefault();' +
  '});' +
  'window.addEventListener("keyup",function(e){send({t:"key",type:"up",key:e.key});});' +
  'window.addEventListener("keypress",function(e){if(document.activeElement!==osk)send({t:"key",type:"press",key:e.key});});' +
  '// The phone keyboard types into the hidden input; beforeinput hands\n' +
  '// over the composed text and the input itself stays empty.\n' +
  'osk.addEventListener("beforeinput",function(e){' +
  '  if(e.inputType==="deleteContentBackward"){send({t:"key",type:"press",key:"Backspace"});}' +
  '  else if(e.data){for(var i=0;i<e.data.length;i++)send({t:"key",type:"press",key:e.data.charAt(i)});}' +
  '  e.preventDefault();' +
  '});' +
  '</script>';

/* A finite integer or 0 — never NaN, whatever the socket sent. */
function num(v) {
  v = Number(v);
  if (v !== v || v === Infinity || v === -Infinity) return 0;
  return Math.round(v);
}

function broadcastFrame() {
  var buf = rgbaFrame();
  var ops = hostFont ? JSON.stringify({ t: 'text', ops: backend.textOps }) : null;
  for (var i = 0; i < sockets.length; i++) {
    if (sockets[i].readyState === 1) {
      sockets[i].send(buf);
      if (ops) sockets[i].send(ops); /* after the frame: TCP keeps the order */
    }
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
      if (hostFont) ws.send(JSON.stringify({ t: 'text', ops: backend.textOps }));
    },
    close: function (ws) {
      var i = sockets.indexOf(ws);
      if (i >= 0) sockets.splice(i, 1);
    },
    message: function (ws, data) {
      var msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      /* Anything a socket can send has to be survivable: JSON.parse
         succeeds on `null`, `5` and `"hi"` too, and reading .t off those
         used to throw straight out of the handler and take the whole
         server down. Coordinates get the same treatment — a message with
         no x/y must not feed NaN into the core's hit testing. */
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ptr') {
        UI.pointer(msg.id, num(msg.phase), num(msg.x), num(msg.y));
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

/* server.port, not the requested one: `0` means "any free port" and the
   printed URL is the only way anything — a test harness, a person — finds
   out which one it got. */
console.log('mjsx serving ' + exampleFile + ' at http://localhost:' + server.port + '/  (' + W + 'x' + H + ')');
