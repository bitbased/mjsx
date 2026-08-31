// /remote.js — the op-stream viewer as an attachable client.
//
// mjsxRemote(canvas, opts) owns everything between the board and the
// pixels: the push stream on :81 (polling fallback for firmware without
// it), the binary frame decode, replay through the REAL mjsx rasterizer
// from /mjsx-backend.js, the debug overlays, and pointer + keyboard
// forwarding to /touch and /key. Shared by /remote (the full page) and
// the dashboard's Display tab: one copy of the protocol in flash, two
// faces on it.
//
//   opts.hd        sharp fonts (default true)
//   opts.dbg       0 off, 1 draw-call boxes, 2 + clip rects
//   opts.src       "bin" (default) or "js" (the JSON dev stream)
//   opts.autostart false to attach idle and .start() later
//   opts.cssSized  true when the page's CSS sizes the canvas (the
//                  dashboard card); otherwise it fits the window
//   opts.keys      () => bool, gate key forwarding (default always)
//   opts.onStatus  (text) => void, the "480x320 · 41 ops" line
//   opts.onSrc     () => void, fired when /ops.bin 404s and the client
//                  falls back to the JSON stream (relabel the button)
//
// Same .cpp-not-header reasoning as the other pages: this JavaScript's
// braces derail the Arduino prototype generator.
#include <Arduino.h>

extern const char REMOTE_CLIENT_JS[] PROGMEM = R"JS(
window.mjsxRemote=function(cv,opts){
opts=opts||{};
var ctx=cv.getContext("2d");
var W=0,H=0,OPS=null,FRQ=4,FRM=2;
/* hd: "off" (1:1, the panel's pixels), "pix" (3x, stamped glyphs with
   the same AdvMAME smoothing the device runs -- the pixel-HD look), or
   "full" (3x, vectorized stroke faces). Legacy booleans map to
   full/off. Default pix: it is what the glass itself shows. */
var hd=opts.hd===true?"full":(opts.hd===false?"off":(opts.hd||"pix"));
var dbg=opts.dbg|0,src=opts.src||"bin";
var status=opts.onStatus||function(){};
var onLog=opts.onLog||null;   /* console lines, if the host wants them */
/* How much room the glass actually has. The window, unless the host says
   otherwise -- a page with a console drawer open has less, and a canvas
   sized to the whole window would be drawn underneath it. */
var fitBox=opts.fitBox||function(){return [innerWidth,innerHeight];};
var wantLog=!!opts.log;
var onSrc=opts.onSrc||function(){};
var keysOn=opts.keys||function(){return true;};
var cssSized=!!opts.cssSized;
var running=false,streamCtl=null,pollTimer=null,streamedOnce=false;
var lastT="",lastBinSig="";
var LVN=["debug","log","info","warn","error"];
function decodeBin(buf){
  var v=new DataView(buf);
  if(buf.byteLength<8||v.getUint8(0)!==77||v.getUint8(1)!==79)return null;
  /* header 1.1 adds the view scale (quarters) and font mode -- what the
     glass emulator needs; 1.0 frames still decode */
  var ver=v.getUint8(3);
  var w=v.getUint16(4,true),h=v.getUint16(6,true);
  var o=ver>=1?10:8;
  var q=ver>=1?v.getUint8(8):4,fm=ver>=1?v.getUint8(9):2;
  var ops=[];
  function i16(){var x=v.getInt16(o,true);o+=2;return x;}
  function rgb(){var c=(v.getUint8(o)<<16)|(v.getUint8(o+1)<<8)|v.getUint8(o+2);o+=3;return c;}
  while(o<buf.byteLength){
    var op=v.getUint8(o++);
    if(op===1)ops.push(["C",rgb()]);
    else if(op===2||op===3){var x=i16(),y=i16(),ww=i16(),hh=i16(),c=rgb(),r=v.getUint8(o++);ops.push([op===2?"f":"r",x,y,ww,hh,c,r]);}
    else if(op===4){var cx=i16(),cy=i16(),cr=i16(),cc=rgb(),cf=v.getUint8(o++);ops.push(["c",cx,cy,cr,cc,cf]);}
    else if(op===5){var la=i16(),lb=i16(),lc=i16(),ld=i16(),le=rgb();ops.push(["l",la,lb,lc,ld,le]);}
    else if(op===6){var tx=i16(),ty=i16(),sz=v.getUint8(o++),tc=rgb(),n=v.getUint8(o++);
      var str="";for(var i=0;i<n;i++){var cb=v.getUint8(o++);
        str+=cb===133?"…":String.fromCharCode(cb);}
      ops.push(["t",tx,ty,sz,tc,str]);}
    else if(op===7){ops.push(["x",i16(),i16(),i16(),i16()]);}
    else if(op===8)ops.push(["X"]);
    else if(op===9){var pc=rgb(),rule=v.getUint8(o++)?"nonzero":"evenodd",nr=v.getUint8(o++),rings=[];
      for(var ri=0;ri<nr;ri++){var np=v.getUint16(o,true);o+=2;var ring=[];
        for(var pi=0;pi<np;pi++){ring.push([i16()/10,i16()/10]);}rings.push(ring);}
      ops.push(["p",rings,pc,rule]);}
    else if(op===10){var bid=v.getUint8(o++),bg2=v.getUint16(o,true);o+=2;
      ops.push(["b",bid,bg2,i16(),i16(),i16(),i16()]);}
    else if(op===12){var lv=v.getUint8(o++),ln=v.getUint16(o,true);o+=2;
      var lt="";for(var li=0;li<ln;li++){var lb=v.getUint8(o++);
        lt+=lb===133?"…":String.fromCharCode(lb);}
      ops.push(["L",LVN[lv]||"log",lt]);}
    else if(op===11){var did=v.getUint8(o++),dg=v.getUint16(o,true);o+=2;
      var doff=v.getUint32(o,true);o+=4;
      var dtot=v.getUint32(o,true);o+=4;
      var dl=v.getUint16(o,true);o+=2;
      cvData(did,dg,doff,dtot,new Uint8Array(buf.slice(o,o+dl)));o+=dl;}
    else return null;
  }
  return {w:w,h:h,q:q,fm:fm,ops:ops};
}
function opBounds(o){
  if(o[0]==="f"||o[0]==="r")return [o[1],o[2],o[3],o[4]];
  if(o[0]==="c")return [o[1]-o[3],o[2]-o[3],2*o[3]+1,2*o[3]+1];
  if(o[0]==="l")return [Math.min(o[1],o[3]),Math.min(o[2],o[4]),Math.abs(o[3]-o[1])+1,Math.abs(o[4]-o[2])+1];
  if(o[0]==="t")return [o[1],o[2],o[5].length*6*o[3],8*o[3]];
  if(o[0]==="p"){var a=1e9,b=1e9,cx2=-1e9,cy2=-1e9;
    for(var ri=0;ri<o[1].length;ri++)for(var pi=0;pi<o[1][ri].length;pi++){
      var pt=o[1][ri][pi];var px=pt[0]!==undefined?pt[0]:pt.x,py=pt[1]!==undefined?pt[1]:pt.y;
      if(px<a)a=px;if(py<b)b=py;if(px>cx2)cx2=px;if(py>cy2)cy2=py;}
    return [a,b,cx2-a,cy2-b];}
  return null;
}
function drawDebug(S){
  if(!dbg||!OPS)return;
  ctx.save();
  ctx.setTransform(S,0,0,S,0,0);
  ctx.lineWidth=1;
  for(var i=0;i<OPS.length;i++){var o=OPS[i];
    if(o[0]==="x"){
      if(dbg===2){ctx.strokeStyle="#ff9f43";ctx.setLineDash([3,2]);
        ctx.strokeRect(o[1]+0.5,o[2]+0.5,o[3]-1,o[4]-1);ctx.setLineDash([]);}
      continue;}
    if(o[0]==="C"||o[0]==="X")continue;
    var bb=opBounds(o);if(!bb)continue;
    ctx.strokeStyle="#4b8bf5";
    ctx.strokeRect(bb[0]+0.5,bb[1]+0.5,Math.max(bb[2]-1,0.5),Math.max(bb[3]-1,0.5));
  }
  ctx.restore();
}
/* canvas sources: in-band op-11 JPEGs decoded into ImageBitmaps, keyed
   by generation -- op 10 says WHERE and WHICH gen to show */
var CVS={};
function cvData(id,gen,off,total,bytes){
  /* CHUNKED: accumulate per (id, gen); the sender finishes a snapshot
     before starting a newer generation, so completion means coherent.
     Decoded to raw PIXELS: the blit happens IN FRAME ORDER during the
     replay (ops after it paint on top -- the live stroke, the exit
     dot), exactly like the glass. */
  var c=CVS[id]||(CVS[id]={gen:-1,px:null,pw:0,ph:0,acc:null,accGen:-1,got:0});
  if(c.gen===gen)return;
  if(c.accGen!==gen||!c.acc||c.acc.length!==total){
    c.acc=new Uint8Array(total);c.accGen=gen;c.got=0;
  }
  c.acc.set(bytes,off);
  c.got+=bytes.length;
  if(c.got<total)return;
  var done=c.acc;c.acc=null;c.got=0;
  /* decodes are ASYNC: serialize them per source and never let an
     older generation land after a newer one, or rapid updates leave
     the view stuck one picture behind */
  function newer(a2,b2){return b2<0||((a2-b2)&65535)<32768&&a2!==b2;}
  c.chain=(c.chain||Promise.resolve()).then(function(){
    if(!newer(gen,c.gen))return;
    return createImageBitmap(new Blob([done],{type:"image/jpeg"})).then(function(im){
      if(!newer(gen,c.gen))return;
      var oc=document.createElement("canvas");
      oc.width=im.width;oc.height=im.height;
      var octx=oc.getContext("2d");
      octx.drawImage(im,0,0);
      var d=octx.getImageData(0,0,im.width,im.height);
      c.px=d.data;c.pw=im.width;c.ph=im.height;c.gen=gen;
      paint();
    });
  }).catch(function(){});
}
/* nearest-blit a decoded source into a backend's raw RGB buffer at the
   given PHYSICAL rect -- 565-quantized like the panel stores it */
function rawBlitInto(raw,PW,PH,src,x0,y0,x1,y1){
  if(!src||!src.px)return;
  var dw=x1-x0,dh=y1-y0;
  if(dw<1||dh<1)return;
  var cx0=Math.max(0,x0),cy0=Math.max(0,y0);
  var cx1=Math.min(PW,x1),cy1=Math.min(PH,y1);
  for(var py=cy0;py<cy1;py++){
    var sy=Math.floor((py-y0)*src.ph/dh);
    if(sy>=src.ph)sy=src.ph-1;
    for(var px=cx0;px<cx1;px++){
      var sx=Math.floor((px-x0)*src.pw/dw);
      if(sx>=src.pw)sx=src.pw-1;
      var so=(sy*src.pw+sx)*4,o=(py*PW+px)*3;
      raw[o]=(src.px[so]>>3)<<3;
      raw[o+1]=(src.px[so+1]>>2)<<2;
      raw[o+2]=(src.px[so+2]>>3)<<3;
    }
  }
}
var pb=null,pbW=0,pbH=0,pbS=0;
function fitScale(){
  var aw,ah;
  if(cssSized){var r=cv.getBoundingClientRect();aw=r.width||W;ah=1e9;}
  else{var fb=fitScale.b=fitBox();aw=fb[0]-16;ah=fb[1]-16;}
  return Math.max(1,Math.floor(Math.min(aw/W,ah/H)));
}
function replayInto(g){
  for(var i=0;i<OPS.length;i++){var o=OPS[i];
    switch(o[0]){
    case "L":break;   /* a console line: handled once in gotFrame, not per repaint */
    case "b":if(g.blit)g.blit(o[1],o[3],o[4],o[5],o[6]);break;
    case "C":g.clear(o[1]);break;
    case "r":g.rect(o[1],o[2],o[3],o[4],o[5],o[6]);break;
    case "f":g.frect(o[1],o[2],o[3],o[4],o[5],o[6]);break;
    case "c":g.circle(o[1],o[2],o[3],o[4],!!o[5]);break;
    case "l":g.line(o[1],o[2],o[3],o[4],o[5]);break;
    case "t":g.text(o[1],o[2],o[3],o[4],o[5]);break;
    case "x":g.clip(o[1],o[2],o[3],o[4]);break;
    case "X":g.unclip();break;
    case "p":if(g.poly){g.poly(o[1].map(function(ring){
      return ring.map(function(pt){return {x:pt[0],y:pt[1]};});}),o[2],o[3]);}break;
    }}
  g.unclip();
}
/* integer-replicated blit: each source pixel becomes an exact kxk block
   of DEVICE pixels (canvas backing sized rw*k, style sized so backing
   maps 1:1 onto the monitor) -- no browser filtering can touch it. The
   half-filtered mush of CSS-upscaling a 1:1 canvas is what it replaces. */
function blitRep(rw,rh,raw,k,dispW,dispH){
  var bw=rw*k,bh=rh*k;
  cv.width=bw;cv.height=bh;
  if(cssSized){cv.style.imageRendering="pixelated";}
  else{
    /* the EXACT same box every mode uses -- only the backing differs */
    cv.style.width=dispW+"px";cv.style.height=dispH+"px";
    cv.style.imageRendering="pixelated";
  }
  var img=ctx.createImageData(bw,bh);
  for(var y=0;y<rh;y++){
    var rowBase=y*rw*3;
    for(var yy=0;yy<k;yy++){
      var d=(y*k+yy)*bw*4;
      for(var x=0;x<rw;x++){
        var o=rowBase+x*3,r=raw[o],g=raw[o+1],b=raw[o+2];
        for(var xx=0;xx<k;xx++){
          img.data[d]=r;img.data[d+1]=g;img.data[d+2]=b;img.data[d+3]=255;d+=4;}
      }
    }
  }
  ctx.setTransform(1,0,0,1,0,0);
  ctx.putImageData(img,0,0);
}
function blitOut(rw,rh,raw,dispW,dispH,pixelated){
  cv.width=rw;cv.height=rh;
  if(cssSized){
    cv.style.imageRendering=pixelated?"pixelated":"auto";
  }else{
    cv.style.width=dispW+"px";cv.style.height=dispH+"px";
    cv.style.imageRendering=pixelated?"pixelated":"auto";
  }
  ctx.setTransform(1,0,0,1,0,0);
  var img=ctx.createImageData(rw,rh);
  for(var qq=0,d=0;qq<raw.length;qq+=3,d+=4){
    img.data[d]=raw[qq];img.data[d+1]=raw[qq+1];img.data[d+2]=raw[qq+2];img.data[d+3]=255;}
  ctx.putImageData(img,0,0);
}
/* ONE box for every mode, anchored to the DEVICE'S physical grid: the
   largest integer multiple of device pixels that fits the window. At
   1x view scale this is exactly the classic logical fit. PIX fills the
   box with device pixels 1:1 -- perfectly uniform, zero resampling,
   EXACTLY what the panel shows. FULL renders smoothly into the same
   box; OFF stretches its logical blocks into it (exact at 1x). */
function boxFit(){
  var q4=FRQ||4;
  var rw0=Math.floor((W*q4+3)/4),rh0=Math.floor((H*q4+3)/4);
  var dprB=window.devicePixelRatio||1;
  var fb=fitBox();
  var m=Math.max(1,Math.floor(Math.min((fb[0]-16)*dprB/rw0,(fb[1]-16)*dprB/rh0)));
  return {rw0:rw0,rh0:rh0,m:m,q4:q4,dpr:dprB,cssW:rw0*m/dprB,cssH:rh0*m/dprB};
}
function glassBlitHook(be,q4){
  return function(id,x,y,w2,h2){
    var v=function(v2){return Math.floor(v2*q4/4);};
    rawBlitInto(be.raw,be.w,be.h,CVS[id],v(x),v(y),v(x+w2),v(y+h2));
  };
}
function pureBlitHook(be,S2,w2,h2){
  return function(id,x,y,ww,hh){
    rawBlitInto(be.raw,w2*S2,h2*S2,CVS[id],x*S2,y*S2,(x+ww)*S2,(y+hh)*S2);
  };
}
function paint(){
  if(!W||!OPS||!window.createPureJsBackend)return;
  var bf=boxFit();
  /* SD mirrors the device AS IT CURRENTLY IS: the glass emulator at the
     frame's own font mode and view scale. PIX is the always-HD device
     view; FULL is the web-enhanced one. */
  if(hd==="off"&&window.createGlassBackend&&FRM>=1){
    var keyS="s:"+W+":"+H+":"+FRQ+":"+FRM;
    if(!pb||pbS!==keyS){
      pb=createGlassBackend(W,H,{q:FRQ,fontMode:FRM});
      pbS=keyS;pbW=W;pbH=H;}
    pb.gfx.blit=glassBlitHook(pb,FRQ);
    replayInto(pb.gfx);
    blitRep(pb.w,pb.h,pb.raw,bf.m,bf.cssW,bf.cssH);
    drawDebug(pb.w/W*bf.m);
    return;
  }
  if(hd==="pix"&&window.createGlassBackend){
    /* PIX is the HD pixel view: always the device's HD pipeline at the
       device's view scale, whatever font mode the panel is toggled to */
    var fm=2,q4=FRQ;
    var key2="g:"+W+":"+H+":"+q4+":"+fm;
    if(!pb||pbS!==key2){
      pb=createGlassBackend(W,H,{q:q4,fontMode:2});
      pbS=key2;pbW=W;pbH=H;}
    pb.gfx.blit=glassBlitHook(pb,q4);
    replayInto(pb.gfx);
    /* the EXACT device frame (0-mismatch vs the panel), each device
       pixel an identical crisp kxk block in the shared box */
    var rw=fm>=1?pb.w:W,rh=fm>=1?pb.h:H;
    blitRep(rw,rh,pb.raw,bf.m,bf.cssW,bf.cssH);
    drawDebug(rw/W*bf.m);
    return;
  }
  var dpr2=bf.dpr;
  var disp=bf.cssW/W;
  if(cssSized){var rr=cv.getBoundingClientRect();disp=(rr.width||W)/W;}
  var S=hd==="off"?1:Math.max(3,Math.min(8,Math.round(disp*dpr2)));
  var key=S+":"+hd;
  if(!pb||pbW!==W||pbH!==H||pbS!==key){
    /* SD (dpr 1) stays the raw bitmap: no glyph smoothing */
    /* compat OFF for FULL, on everywhere else.
       In compat mode the Adafruit-faithful rasterizers work in LOGICAL
       coordinates and stamp dpr-sized blocks, so a line, a rect or a
       circle comes out block-upscaled no matter how high dpr goes --
       measured: at dpr 3 an irregular outline had ZERO sub-block detail
       with compat on and 4.1% of blocks mixed with it off. poly and text
       do not go through those rasterizers, which is why they sharpened
       and everything else did not: the asteroids example is all lines and
       looked identical in HD, while shapes (polys) sharpened.
       SD and PIX still want device fidelity; FULL is the web-enhanced
       view, and this is what enhancing it means. */
    pb=createPureJsBackend(W,H,{dpr:S,font:"5x7",
      compat:hd==="full"?false:"adafruit",hdText:S===1?false:true});
    pbW=W;pbH=H;pbS=key;}
  pb.gfx.blit=pureBlitHook(pb,S,W,H);
  replayInto(pb.gfx);
  if(hd==="off"){
    var k2=Math.max(1,Math.floor(bf.m*bf.q4/4));
    blitRep(W,H,pb.raw,k2,bf.cssW,bf.cssH);
    drawDebug(k2);
    return;
  }
  blitOut(W*S,H*S,pb.raw,bf.cssW,bf.cssH,false);
  drawDebug(S);
}
/* a bundle without the HD-stamping marker is a STALE cached copy: say
   so in the status line instead of silently rendering blocky */
var VER="";
try{var sc=document.querySelector('script[src*="remote.js"]');
  if(sc&&sc.src.indexOf("v=")>=0)VER=" ·"+sc.src.split("v=")[1].slice(-6);}catch(e){}
function bundleNote(){
  if(hd!=="off"&&!(window.createPureJsBackend&&createPureJsBackend.hdStamp))
    return "  [STALE BUNDLE - hard reload!]";
  return "";
}
/* Once per FRAME, not once per replay: paint() re-runs the op list on
   every resize and every quality change, and a console that grew three
   copies of each line every time the window moved would be useless. */
function drainLog(j){
  if(!onLog||!j||!j.ops)return;
  for(var i=0;i<j.ops.length;i++)if(j.ops[i][0]==="L")onLog(j.ops[i][1],j.ops[i][2]);
}
function gotFrame(j,bytes,tag){
  drainLog(j);
  if(j&&j.ops){W=j.w;H=j.h;FRQ=j.q||4;FRM=j.fm===undefined?2:j.fm;OPS=j.ops;paint();
    status(W+"x"+H+" · "+j.ops.length+" ops · "+bytes+"B "+tag+VER+bundleNote());}
}
// The PUSH stream: one long-lived socket on the MJPEG port, each frame
// arriving as 'F','R', u32 LE length, then /ops.bin's bytes. A firmware
// without it (or a failure before the first frame) falls back to
// polling; once it has ever delivered, a drop means the board went
// away, so it reconnects instead.
function startStream(){
  streamCtl=new AbortController();
  var mine=streamCtl;
  fetch(location.protocol+"//"+location.hostname+":81/ops"+(wantLog?"?log=1":""),{signal:mine.signal})
  .then(function(r){
    if(r.status!==200||!r.body)throw 0;
    var rd=r.body.getReader(),acc=null;
    function step(res){
      if(res.done)throw 0;
      var m=res.value;
      if(acc&&acc.length){var t=new Uint8Array(acc.length+m.length);t.set(acc);t.set(m,acc.length);m=t;}
      var off=0;
      while(m.length-off>=6){
        if(m[off]!==70||m[off+1]!==82)throw 0;
        var len=m[off+2]|(m[off+3]<<8)|(m[off+4]<<16)|(m[off+5]<<24);
        if(len<0||len>4194304)throw 0;
        if(m.length-off-6<len)break;
        if(len===0){off+=6;streamedOnce=true;continue;}  /* heartbeat */
        streamedOnce=true;
        var fb=m.slice(off+6,off+6+len);
        gotFrame(decodeBin(fb.buffer),len,"live");
        off+=6+len;
      }
      acc=m.slice(off);
      return rd.read().then(step);
    }
    status("live");
    return rd.read().then(step);
  })
  .catch(function(){
    if(streamCtl===mine)streamCtl=null;
    if(mine.signal.aborted||!running)return;
    if(streamedOnce){status("reconnecting");
      setTimeout(function(){if(running&&src==="bin"&&!streamCtl)startStream();},1500);}
    else poll();
  });
}
function poll(){
  if(!running)return;
  if(src==="bin"){
    fetch("/ops.bin"+(wantLog?"?log=1":"")).then(function(r){
      if(r.status===404){src="js";onSrc();return null;}
      if(r.status!==200)return null;
      return r.arrayBuffer();
    }).then(function(buf){
      var changed=false;
      if(buf&&buf.byteLength>8){
        var u=new Uint8Array(buf);
        var sig=buf.byteLength+":"+u[9]+":"+u[u.length-1]+":"+u[u.length>>1];
        changed=sig!==lastBinSig;
        if(changed){lastBinSig=sig;gotFrame(decodeBin(buf),buf.byteLength,"bin");}
      }
      pollTimer=setTimeout(poll,changed?120:350);
    }).catch(function(){status("offline");pollTimer=setTimeout(poll,1500);});
    return;
  }
  fetch("/ops"+(wantLog?"?log=1":"")).then(function(r){return r.text();}).then(function(t){
    var changed=t!==lastT;
    if(changed){lastT=t;
      var j=null;try{j=JSON.parse(t);if(typeof j==="string")j=JSON.parse(j);}catch(e){}
      gotFrame(j,t.length,"json");}
    pollTimer=setTimeout(poll,changed?120:350);
  }).catch(function(){status("offline");pollTimer=setTimeout(poll,1500);});
}
function stopLoops(){
  if(streamCtl){streamCtl.abort();streamCtl=null;}
  if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
}
function kick(){stopLoops();if(!running)return;if(src==="bin")startStream();else poll();}
// Touch goes in where a real press does, so a drag has to arrive as a
// stream of moves (lightly throttled: the board answers these on the
// core that draws), not as a tap at the end of one.
function pos(e){var r=cv.getBoundingClientRect();
  return {x:Math.round((e.clientX-r.left)*W/r.width),y:Math.round((e.clientY-r.top)*H/r.height)};}
function ptr(phase,e){if(!W)return;var p=pos(e);
  fetch("/touch?phase="+phase+"&x="+p.x+"&y="+p.y).catch(function(){});}
var lastMv=0;
cv.addEventListener("pointerdown",function(e){e.preventDefault();cv.setPointerCapture(e.pointerId);ptr(0,e);});
cv.addEventListener("pointermove",function(e){if(!e.buttons)return;
  var n=Date.now();if(n-lastMv<30)return;lastMv=n;ptr(1,e);});
cv.addEventListener("pointerup",function(e){ptr(2,e);});
cv.addEventListener("pointercancel",function(e){ptr(2,e);});
cv.addEventListener("dragstart",function(e){e.preventDefault();});
window.addEventListener("keydown",function(e){
  if(!keysOn())return;
  var tg=e.target&&e.target.tagName;
  if(tg==="INPUT"||tg==="SELECT"||tg==="TEXTAREA")return;
  var k=e.key==="Tab"&&e.shiftKey?"ShiftTab":e.key;
  if(k.length===1||["Backspace","Enter","Escape","Tab","ShiftTab","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","Delete"].indexOf(k)>=0){
    fetch("/key?k="+encodeURIComponent(k));
    if(e.key==="Tab"||e.key==="Backspace")e.preventDefault();
  }
});
window.addEventListener("resize",function(){paint();});
if(opts.autostart!==false){running=true;kick();}
return {
  start:function(){if(!running){running=true;kick();}},
  stop:function(){running=false;stopLoops();},
  paint:paint,
  setHd:function(v){hd=v===true?"full":(v===false?"off":v);paint();},
  hd:function(){return hd;},
  setDbg:function(v){dbg=v|0;paint();},dbg:function(){return dbg;},
  setSrc:function(v){if(v!==src){src=v;kick();}},src:function(){return src;},
  /* the stream carries log ops only while a viewer asks, and the ask is
     part of the request -- so turning it on reopens the connection */
  setLog:function(v){v=!!v;if(v!==wantLog){wantLog=v;kick();}},log:function(){return wantLog;}
};
};
)JS";
