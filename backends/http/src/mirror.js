/*
 * A browser mirror for a host that already owns the app -- the sim runs
 * the core and renders locally; this serves the SAME running instance to
 * any browser as a second display and input source. Frames flow out as
 * raw RGBA over a websocket, pointers and keys flow back in through the
 * callbacks, so the window and every connected page stay in sync -- tap
 * in one, watch it happen in the others.
 *
 * Unlike server.js (which boots its own core around an example), this
 * owns nothing: createMirror({ pointer, key, port }) and then push
 * frames with mirror.frame(raw, pw, ph, w, h). Sizes may change between
 * frames (the sim resizes and rotates live) -- the client is told and
 * follows.
 */

function createMirror(opts) {
  var port = opts.port || 8080;
  var sockets = [];
  var lastMeta = null;   /* {w,h,pw,ph} last announced geometry */
  var lastFrame = null;  /* last RGBA buffer, replayed to new clients */

  var PAGE = '<!doctype html><meta charset=utf-8><title>mjsx sim</title>' +
    '<meta name=viewport content="width=device-width,initial-scale=1">' +
    '<style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}' +
    'canvas{image-rendering:pixelated;border:1px solid #333;touch-action:none}</style>' +
    '<canvas id=c></canvas>' +
    '<input id=osk autocomplete=off autocapitalize=off spellcheck=false ' +
    'style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0">' +
    '<script>' +
    'var W=0,H=0,PW=0,PH=0;' +
    'var cv=document.getElementById("c"),ctx=cv.getContext("2d");' +
    'var osk=document.getElementById("osk");' +
    'function fit(){if(!W)return;' +
    '  var s=Math.max(1,Math.floor(Math.min((innerWidth-16)/W,(innerHeight-16)/H)));' +
    '  cv.style.width=(W*s)+"px";cv.style.height=(H*s)+"px";}' +
    'window.addEventListener("resize",fit);' +
    'var ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws");' +
    'ws.binaryType="arraybuffer";' +
    'ws.onmessage=function(e){' +
    '  if(typeof e.data==="string"){var m;try{m=JSON.parse(e.data);}catch(x){return;}' +
    '    if(m.t==="size"){W=m.w;H=m.h;PW=m.pw;PH=m.ph;cv.width=PW;cv.height=PH;fit();}' +
    '    else if(m.t==="focus"){if(m.on)osk.focus();else osk.blur();}' +
    '    return;}' +
    '  if(!PW)return;' +
    '  var img=new ImageData(new Uint8ClampedArray(e.data),PW,PH);' +
    '  ctx.putImageData(img,0,0);' +
    '};' +
    'function send(o){if(ws.readyState===1)ws.send(JSON.stringify(o));}' +
    'function pos(e){var r=cv.getBoundingClientRect();' +
    '  return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}' +
    'cv.addEventListener("mousedown",function(e){var p=pos(e);send({t:"ptr",id:"mouse",phase:0,x:p.x,y:p.y});});' +
    'cv.addEventListener("mousemove",function(e){if(e.buttons){var p=pos(e);send({t:"ptr",id:"mouse",phase:1,x:p.x,y:p.y});}});' +
    'window.addEventListener("mouseup",function(e){var p=pos(e);send({t:"ptr",id:"mouse",phase:2,x:p.x,y:p.y});});' +
    'function onTouch(ph){return function(e){e.preventDefault();' +
    '  for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];var p=pos(t);' +
    '    send({t:"ptr",id:"t"+t.identifier,phase:ph,x:p.x,y:p.y});}};}' +
    'cv.addEventListener("touchstart",onTouch(0),{passive:false});' +
    'cv.addEventListener("touchmove",onTouch(1),{passive:false});' +
    'cv.addEventListener("touchend",onTouch(2),{passive:false});' +
    'cv.addEventListener("touchcancel",onTouch(2),{passive:false});' +
    'cv.addEventListener("wheel",function(e){e.preventDefault();var p=pos(e);' +
    '  send({t:"wheel",x:p.x,y:p.y,dy:e.deltaY});},{passive:false});' +
    'window.addEventListener("keydown",function(e){' +
    '  var k=e.key==="Tab"&&e.shiftKey?"ShiftTab":e.key;' +
    '  send({t:"key",type:"down",key:k});' +
    '  if(e.key.length>1)send({t:"key",type:"press",key:k});' +
    '  if(e.key==="Tab"||e.key==="Backspace")e.preventDefault();' +
    '});' +
    'window.addEventListener("keyup",function(e){send({t:"key",type:"up",key:e.key});});' +
    'window.addEventListener("keypress",function(e){if(document.activeElement!==osk)send({t:"key",type:"press",key:e.key});});' +
    'osk.addEventListener("beforeinput",function(e){' +
    '  if(e.inputType==="deleteContentBackward"){send({t:"key",type:"press",key:"Backspace"});}' +
    '  else if(e.data){for(var i=0;i<e.data.length;i++)send({t:"key",type:"press",key:e.data.charAt(i)});}' +
    '  e.preventDefault();' +
    '});' +
    '</script>';

  function sendMeta(ws) {
    if (lastMeta) ws.send(JSON.stringify({ t: 'size', w: lastMeta.w, h: lastMeta.h, pw: lastMeta.pw, ph: lastMeta.ph }));
  }

  Bun.serve({
    port: port,
    fetch: function (req, srv) {
      if (new URL(req.url).pathname === '/ws') {
        if (srv.upgrade(req)) return;
        return new Response('upgrade failed', { status: 400 });
      }
      return new Response(PAGE, { headers: { 'Content-Type': 'text/html' } });
    },
    websocket: {
      open: function (ws) {
        sockets.push(ws);
        sendMeta(ws);
        if (lastFrame) ws.send(lastFrame);
        /* the screen may have been idle for minutes -- ask the host to
           push the current frame so the page never opens onto black */
        else if (opts.connect) opts.connect();
      },
      close: function (ws) {
        var i = sockets.indexOf(ws);
        if (i >= 0) sockets.splice(i, 1);
      },
      message: function (ws, data) {
        var msg;
        try { msg = JSON.parse(data); } catch (e) { return; }
        if (msg.t === 'ptr' && opts.pointer) {
          opts.pointer(msg.id, msg.phase, Math.round(msg.x), Math.round(msg.y));
        } else if (msg.t === 'key' && opts.key) {
          opts.key(msg.type, msg.key);
        } else if (msg.t === 'wheel' && opts.wheel) {
          opts.wheel(Math.round(msg.x), Math.round(msg.y), msg.dy);
        }
      }
    }
  });

  return {
    port: port,
    clients: function () { return sockets.length; },
    /* Push one frame: raw RGB (pw x ph x 3) plus the logical size it
       represents. Converts to RGBA once and fans out; remembers the
       frame so a client connecting mid-run gets the current screen. */
    frame: function (raw, pw, ph, w, h) {
      if (!sockets.length) { lastFrame = null; lastMeta = { w: w, h: h, pw: pw, ph: ph }; return; }
      var metaChanged = !lastMeta || lastMeta.pw !== pw || lastMeta.ph !== ph ||
                        lastMeta.w !== w || lastMeta.h !== h;
      lastMeta = { w: w, h: h, pw: pw, ph: ph };
      var n = pw * ph;
      var rgba = new Uint8Array(n * 4);
      for (var i = 0, q = 0; i < n; i++, q += 3) {
        rgba[i * 4] = raw[q]; rgba[i * 4 + 1] = raw[q + 1];
        rgba[i * 4 + 2] = raw[q + 2]; rgba[i * 4 + 3] = 255;
      }
      lastFrame = rgba;
      for (var si = 0; si < sockets.length; si++) {
        if (sockets[si].readyState === 1) {
          if (metaChanged) sendMeta(sockets[si]);
          sockets[si].send(rgba);
        }
      }
    },
    focus: function (on) {
      var m = JSON.stringify({ t: 'focus', on: !!on });
      for (var i = 0; i < sockets.length; i++) {
        if (sockets[i].readyState === 1) sockets[i].send(m);
      }
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createMirror: createMirror };
}
