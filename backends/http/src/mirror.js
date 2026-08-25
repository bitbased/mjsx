/*
 * A browser mirror for a host that already owns the app -- the sim runs
 * the core and renders ONCE; this serves the same running instance to
 * any browser as a second display and input source.
 *
 * What travels is not pixels but the DRAW OPS: a recording wrapper sits
 * over the host's real gfx (the 10-call contract plus poly), forwards
 * every call, and keeps the frame's op list. The browser replays that
 * list on a canvas at whatever resolution it likes -- so HD is purely a
 * client-side choice (the HD button re-renders the LAST frame sharper
 * without the host doing anything), a frame costs kilobytes instead of
 * megabytes, and the host never renders twice. Pointers, touch, wheel
 * and keys flow back through the callbacks, so the window and every
 * connected page stay in sync.
 *
 * createMirror({ pointer, key, wheel, connect, port }) then per frame:
 * mirror.frame(recorder.take(), w, h, fontMeta).
 * createRecorder(realGfx) builds the wrapper; swap it in as the global
 * gfx (recreate it whenever the real backend is recreated).
 */

function createRecorder(real) {
  var ops = [];
  return {
    take: function () { var o = ops; ops = []; return o; },
    gfx: {
      clear: function (c) { ops.push(['C', c]); real.clear(c); },
      rect: function (x, y, w, h, c, r) { ops.push(['r', x, y, w, h, c, r || 0]); real.rect(x, y, w, h, c, r); },
      frect: function (x, y, w, h, c, r) { ops.push(['f', x, y, w, h, c, r || 0]); real.frect(x, y, w, h, c, r); },
      circle: function (x, y, rr, c, fill) { ops.push(['c', x, y, rr, c, fill ? 1 : 0]); real.circle(x, y, rr, c, fill); },
      line: function (x0, y0, x1, y1, c) { ops.push(['l', x0, y0, x1, y1, c]); real.line(x0, y0, x1, y1, c); },
      text: function (x, y, s, c, str) { ops.push(['t', x, y, s, c, String(str)]); real.text(x, y, s, c, str); },
      clip: function (x, y, w, h) { ops.push(['x', x, y, w, h]); real.clip(x, y, w, h); },
      unclip: function () { ops.push(['X']); real.unclip(); },
      poly: real.poly ? function (polys, c, rule) {
        ops.push(['p', polys, c, rule]);
        real.poly(polys, c, rule);
      } : undefined,
      width: function () { return real.width(); },
      height: function () { return real.height(); }
    }
  };
}

function createMirror(opts) {
  var port = opts.port || 8080;
  var sockets = [];
  var lastMsg = null;  /* last frame message, replayed to new clients */

  var PAGE = '<!doctype html><meta charset=utf-8><title>mjsx sim</title>' +
    '<meta name=viewport content="width=device-width,initial-scale=1">' +
    '<style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}' +
    'canvas{border:1px solid #333;touch-action:none}' +
    '#hd{position:fixed;top:8px;right:8px;font:12px monospace;color:#ddd;background:#2226;' +
    'border:1px solid #555;border-radius:4px;padding:4px 8px;cursor:pointer;user-select:none}</style>' +
    '<canvas id=c></canvas><div id=hd></div>' +
    '<script src=/mjsx-backend.js></script>' +
    '<input id=osk autocomplete=off autocapitalize=off spellcheck=false ' +
    'style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0">' +
    '<script>' +
    'var W=0,H=0,OPS=[],FONTS={};' +
    '// HD is OURS: replay the same ops sharper. Remembered per browser.\n' +
    'var hd=true;try{hd=localStorage.mjsxHd!=="0";}catch(e){}' +
    'var cv=document.getElementById("c"),ctx=cv.getContext("2d");' +
    'var osk=document.getElementById("osk");' +
    'var hdBtn=document.getElementById("hd");' +
    'function hdLabel(){hdBtn.textContent="HD:"+(hd?"ON":"OFF");}' +
    'hdBtn.addEventListener("click",function(){hd=!hd;try{localStorage.mjsxHd=hd?"1":"0";}catch(e){}hdLabel();paint();});' +
    'hdLabel();' +
    'function fitScale(){return Math.max(1,Math.floor(Math.min((innerWidth-16)/W,(innerHeight-16)/H)));}' +
    'var fitCache={};' +
    'function fontPx(adv,cellH){var k=adv+"x"+cellH;if(fitCache[k])return fitCache[k];' +
    '  ctx.font="100px ui-monospace,Menlo,Consolas,monospace";var m=ctx.measureText("M");' +
    '  var px=Math.min(adv/(m.width/100),cellH/((m.actualBoundingBoxAscent||72)/100));' +
    '  return fitCache[k]=Math.floor(px);}' +
    'function css(c){return "#"+("00000"+(c>>>0).toString(16)).slice(-6);}' +
    'function rr(x,y,w,h,r){ctx.beginPath();' +
    '  if(r>0){ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);' +
    '    ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}' +
    '  else ctx.rect(x,y,w,h);}' +
    '// HD:ON draws the ops as device-resolution canvas vectors -- smooth.\n' +
    '// HD:OFF replays them through the bundled REAL mjsx rasterizer at the\n' +
    '// panel\'s logical resolution -- Bresenham lines, scanline fills and\n' +
    '// the actual bitmap fonts, pixelated-upscaled: exactly what the panel\n' +
    '// itself would show.\n' +
    'var pb=null,pbW=0,pbH=0,pbS=0;' +
    '// Both modes replay the ops through the REAL mjsx rasterizer -- the\n' +
    '// bundle carries the whole font system, so HD text is the same\n' +
    '// refined, bitmap-derived HD faces the sim window shows, never a\n' +
    '// substituted browser font. HD:OFF renders at dpr 1 (authentic\n' +
    '// chunky pixels, real bitmap glyphs, pixelated upscale); HD:ON at\n' +
    '// dpr = the fit scale, precise mode, like the window\'s own HD.\n' +
    'function paintPB(fs,S){' +
    '  if(!pb||pbW!==W||pbH!==H||pbS!==S){pb=createPureJsBackend(W,H,{dpr:S});pbW=W;pbH=H;pbS=S;}' +
    '  var g=pb.gfx;' +
    '  for(var i=0;i<OPS.length;i++){var o=OPS[i];' +
    '    switch(o[0]){' +
    '    case "C":g.clear(o[1]);break;' +
    '    case "r":g.rect(o[1],o[2],o[3],o[4],o[5],o[6]);break;' +
    '    case "f":g.frect(o[1],o[2],o[3],o[4],o[5],o[6]);break;' +
    '    case "c":g.circle(o[1],o[2],o[3],o[4],!!o[5]);break;' +
    '    case "l":g.line(o[1],o[2],o[3],o[4],o[5]);break;' +
    '    case "t":g.text(o[1],o[2],o[3],o[4],o[5]);break;' +
    '    case "x":g.clip(o[1],o[2],o[3],o[4]);break;' +
    '    case "X":g.unclip();break;' +
    '    case "p":if(g.poly)g.poly(o[1],o[2],o[3]);break;' +
    '    }}' +
    '  g.unclip();' +
    '  cv.width=W*S;cv.height=H*S;' +
    '  cv.style.width=(W*fs)+"px";cv.style.height=(H*fs)+"px";' +
    '  cv.style.imageRendering=S<fs?"pixelated":"auto";' +
    '  ctx.setTransform(1,0,0,1,0,0);' +
    '  var img=ctx.createImageData(W*S,H*S);var raw=pb.raw;' +
    '  for(var q=0,d=0;q<raw.length;q+=3,d+=4){' +
    '    img.data[d]=raw[q];img.data[d+1]=raw[q+1];img.data[d+2]=raw[q+2];img.data[d+3]=255;}' +
    '  ctx.putImageData(img,0,0);' +
    '}' +
    'function paint(){if(!W)return;' +
    '  var fs=fitScale();' +
    '  if(window.createPureJsBackend){paintPB(fs,hd?Math.min(4,fs):1);return;}' +
    '  // fallback only (bundle failed to load): canvas vectors and fitted\n' +
    '  // monospace standing in for text\n' +
    '  var S=fs*(devicePixelRatio||1);' +
    '  cv.width=W*S;cv.height=H*S;' +
    '  cv.style.width=(W*fs)+"px";cv.style.height=(H*fs)+"px";' +
    '  cv.style.imageRendering="auto";' +
    '  ctx.setTransform(S,0,0,S,0,0);' +
    '  ctx.imageSmoothingEnabled=false;fitCache={};' +
    '  var clipped=false;' +
    '  for(var i=0;i<OPS.length;i++){var o=OPS[i];' +
    '    switch(o[0]){' +
    '    case "C":ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=css(o[1]);' +
    '      ctx.fillRect(0,0,cv.width,cv.height);ctx.restore();break;' +
    '    case "f":ctx.fillStyle=css(o[5]);rr(o[1],o[2],o[3],o[4],o[6]);ctx.fill();break;' +
    '    case "r":ctx.strokeStyle=css(o[5]);ctx.lineWidth=1;' +
    '      rr(o[1]+0.5,o[2]+0.5,o[3]-1,o[4]-1,o[6]);ctx.stroke();break;' +
    '    case "c":ctx.fillStyle=ctx.strokeStyle=css(o[4]);ctx.beginPath();' +
    '      ctx.arc(o[1],o[2],o[3],0,6.2832);' +
    '      if(o[5])ctx.fill();else{ctx.lineWidth=1;ctx.stroke();}break;' +
    '    case "l":ctx.strokeStyle=css(o[5]);' +
    '      ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(o[1]+0.5,o[2]+0.5);ctx.lineTo(o[3]+0.5,o[4]+0.5);ctx.stroke();break;' +
    '    case "t":var fm=FONTS[o[3]]||{adv:6*o[3],lh:10*o[3]};' +
    '      ctx.fillStyle=css(o[4]);ctx.font=fontPx(fm.adv-1,fm.lh-2)+"px ui-monospace,Menlo,Consolas,monospace";' +
    '      ctx.textAlign="center";ctx.textBaseline="alphabetic";' +
    '      var str=o[5];for(var j=0;j<str.length;j++){' +
    '        ctx.fillText(str[j],o[1]+j*fm.adv+(fm.adv-1)/2,o[2]+fm.lh-2);}break;' +
    '    case "x":if(clipped)ctx.restore();ctx.save();clipped=true;' +
    '      ctx.beginPath();ctx.rect(o[1],o[2],o[3],o[4]);ctx.clip();break;' +
    '    case "X":if(clipped){ctx.restore();clipped=false;}break;' +
    '    case "p":ctx.fillStyle=css(o[2]);var P=new Path2D();' +
    '      for(var pi=0;pi<o[1].length;pi++){var ring=o[1][pi];' +
    '        if(!ring.length)continue;P.moveTo(ring[0].x,ring[0].y);' +
    '        for(var vi=1;vi<ring.length;vi++)P.lineTo(ring[vi].x,ring[vi].y);P.closePath();}' +
    '      ctx.fill(P,o[3]==="nonzero"?"nonzero":"evenodd");break;' +
    '    }}' +
    '  if(clipped)ctx.restore();' +
    '}' +
    'window.addEventListener("resize",paint);' +
    'var ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws");' +
    'ws.onmessage=function(e){var m;try{m=JSON.parse(e.data);}catch(x){return;}' +
    '  if(m.t==="frame"){W=m.w;H=m.h;OPS=m.ops;if(m.fonts)FONTS=m.fonts;paint();}' +
    '  else if(m.t==="focus"){if(m.on)osk.focus();else osk.blur();}' +
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

  /* The REAL rasterizer, bundled for the page on first request: HD:OFF
     replays ops through it so the browser shows exactly the panel's
     pixels (bitmap fonts included), not a canvas approximation. */
  var bundle = null;
  function backendJs() {
    if (!bundle) {
      bundle = Bun.build({
        entrypoints: [require.resolve('./client-backend.js')],
        target: 'browser', format: 'iife', minify: true
      }).then(function (out) { return out.outputs[0].text(); });
    }
    return bundle;
  }

  Bun.serve({
    port: port,
    fetch: function (req, srv) {
      var path = new URL(req.url).pathname;
      if (path === '/ws') {
        if (srv.upgrade(req)) return;
        return new Response('upgrade failed', { status: 400 });
      }
      if (path === '/mjsx-backend.js') {
        return backendJs().then(function (js) {
          return new Response(js, { headers: { 'Content-Type': 'application/javascript' } });
        });
      }
      return new Response(PAGE, { headers: { 'Content-Type': 'text/html' } });
    },
    websocket: {
      open: function (ws) {
        sockets.push(ws);
        if (lastMsg) ws.send(lastMsg);
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
    /* One frame's op list, the logical size it was laid out for, and the
       host's text metrics per size ({1:{adv,lh},...}) so the client's
       own glyphs land on the same grid. Remembered for late joiners. */
    frame: function (ops, w, h, fonts) {
      lastMsg = JSON.stringify({ t: 'frame', w: w, h: h, ops: ops, fonts: fonts || null });
      for (var i = 0; i < sockets.length; i++) {
        if (sockets[i].readyState === 1) sockets[i].send(lastMsg);
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
  module.exports = { createMirror: createMirror, createRecorder: createRecorder };
}
