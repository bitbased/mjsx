// The /display viewer page.
//
// A .cpp rather than a header on purpose: the Arduino prototype generator runs
// over the PREPROCESSED sketch, so anything a header contains is still in its
// view — and the braces in this file's JavaScript derail its tracking of
// `extern "C"`, after which every static function it declares comes out as
// `static extern "C"`. A separate translation unit is never inlined, so it
// cannot be misread.
#include <Arduino.h>

// `extern` matters: a const at namespace scope has internal linkage in C++,
// so without it this compiles fine and fails to link.
extern const char DISPLAY_HTML[] PROGMEM = R"HTML(<!doctype html>
<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">
<title>display</title>
<style>
 html,body{margin:0;height:100%;background:#0b0c0f;color:#e6e8eb;
   font:13px/1.4 system-ui,sans-serif;overscroll-behavior:none}
 body{display:flex;flex-direction:column}
 #bar{display:flex;gap:6px;align-items:center;padding:8px 10px;background:#16181d;flex:none;
   flex-wrap:wrap}
 #bar b{font-weight:600;color:#98a1ae;font-size:12px}
 button{background:#212530;color:#e6e8eb;border:0;border-radius:6px;padding:6px 10px;font:inherit}
 button.on{background:#4b8bf5}
 #wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:10px;min-height:0;
   overflow:auto}
 #s{image-rendering:pixelated;border-radius:14px;touch-action:none;background:#000;
   box-shadow:0 0 0 1px #2a2f3a;display:block}
 #st{padding:6px 10px;color:#6b7280;font-size:12px;flex:none}
</style>
<div id=bar>
  <button id=mode class=on>stream</button>
  <b>fps</b>
  <button data-f=1>1</button><button data-f=5>5</button><button data-f=10>10</button>
  <button data-f=0>max</button>
  <button id=q>q70</button>
  <button id=scale class=on>fill</button>
  <span style=flex:1></span>
  <b id=hz></b>
</div>
<div id=wrap><img id=s alt=screen></div>
<div id=st>connecting</div>
<script>
var img=document.getElementById('s'),st=document.getElementById('st'),hz=document.getElementById('hz');
/* Three rungs, coarsest last: 12.2 kB, 6.2 kB, 2.9 kB a frame as measured on
   this panel. Q70 came out at 8 kB — between the other two without being
   usefully different from either — and half resolution only earns its place at
   the bottom, so the ladder drops quality first and only then pixels. */
var MODES=[{q:90,h:0,n:'Q90'},{q:45,h:0,n:'Q45'},{q:45,h:1,n:'H45'}];
var mode=1;   /* Q45: about 6 kB a frame, comfortable at five a second */
var stream=1,fps=5,fill=1,busy=false,frames=0,fsec=performance.now();
function quality(){return MODES[mode].q;}
function half(){return MODES[mode].h;}

/* Device pixels, not image pixels — at half resolution the picture is 120 wide
   while the screen is 240, and a tap mapped through the image lands at half the
   position it should.
   
   The board is asked rather than the picture measured, because a browser
   showing a multipart stream keeps the FIRST frame's dimensions: rotate the
   device mid-stream and naturalWidth still reports the old shape, so the
   sizing and the touch mapping would both quietly follow it. */
var devw=0,devh=0;
function devW(){return devw||(img.naturalWidth||120)*(half()?2:1);}
function devH(){return devh||(img.naturalHeight||140)*(half()?2:1);}

function checkSize(){
  fetch('/info').then(function(r){return r.json();}).then(function(j){
    if(!j.w)return;
    if(j.w===devw&&j.h===devh)return;
    devw=j.w;devh=j.h;
    /* A stream carries no way to say "the frames changed shape", so the only
       honest response to a rotation is a fresh connection. */
    if(stream)connect();
    size();
  }).catch(function(){});
}
setInterval(checkSize,2000);

function apply(){
  document.querySelectorAll('[data-f]').forEach(function(e){
    e.className=(+e.dataset.f===fps)?'on':'';});
  document.getElementById('q').textContent=MODES[mode].n;
  document.getElementById('mode').textContent=stream?'stream':'snap';
  document.getElementById('mode').className=stream?'on':'';
  document.getElementById('scale').textContent=fill?'fill':'1:1';
  document.getElementById('scale').className=fill?'on':'';
  size();
  if(stream)connect(); else img.removeAttribute('src');
}
function size(){
  /* The element is sized to the picture, not the other way round. Leaving it
     at 100% and relying on object-fit letterboxes *inside* the element, so its
     background, rounded corners and shadow draw a box the wrong shape around
     the image. Computing the fitted size keeps the frame on the picture. */
  var wrap=document.getElementById('wrap');
  var avW=wrap.clientWidth-20,avH=wrap.clientHeight-20;   /* less the padding */
  var w=devW(),h=devH();
  var sc=fill?Math.min(avW/w,avH/h):1;
  img.style.maxWidth='none';img.style.maxHeight='none';
  img.style.width=Math.max(1,Math.floor(w*sc))+'px';
  img.style.height=Math.max(1,Math.floor(h*sc))+'px';
}
addEventListener('resize',size);
addEventListener('orientationchange',function(){setTimeout(size,150);});
img.addEventListener('load',size);

function connect(){
  /* Drop the old stream before asking for a new one. Re-pointing an <img> at a
     multipart response does not reliably abort the one in flight, and the board
     serves one viewer at a time — so the new settings would sit in the accept
     queue behind the connection they were meant to replace. */
  img.removeAttribute('src');
  setTimeout(function(){
    if(!stream)return;
    img.src=location.protocol+'//'+location.hostname+':81/stream?q='+quality()+
            '&half='+half()+'&fps='+fps+'&t='+Date.now();
    st.textContent='streaming '+MODES[mode].n+(fps?' at '+fps+' fps':' at max');
  },30);
}
document.getElementById('mode').onclick=function(){stream=!stream?1:0;apply();};
document.querySelectorAll('[data-f]').forEach(function(e){
  e.onclick=function(){fps=+e.dataset.f;apply();};});
document.getElementById('q').onclick=function(){mode=(mode+1)%MODES.length;apply();};
document.getElementById('scale').onclick=function(){fill=fill?0:1;apply();};

/* Snapshot polling, for when the stream is off. */
function shot(){
  if(busy||stream)return;
  busy=true;
  var t0=performance.now();
  fetch('/screen.jpg?q='+quality()+(half()?'&half=1':'')+'&t='+Date.now()).then(function(r){
    if(!r.ok)throw new Error(r.status===503?'no script on screen':'HTTP '+r.status);
    return r.blob();
  }).then(function(b){
    var old=img.src,url=URL.createObjectURL(b);
    img.onload=function(){size();if(old&&old.slice(0,5)==='blob:')URL.revokeObjectURL(old);};
    img.src=url;
    st.textContent=(b.size/1024).toFixed(1)+' kB in '+Math.round(performance.now()-t0)+' ms';
    frames++;busy=false;
  }).catch(function(e){st.textContent=String(e.message||e);busy=false;});
}
var acc=0,prev=performance.now();
setInterval(function(){
  var now=performance.now();
  acc+=now-prev;prev=now;
  if(!stream&&acc>=1000/(fps||20)){acc=0;shot();}
  if(now-fsec>=1000){
    if(!stream)hz.textContent=frames+' fps';
    frames=0;fsec=now;
  }
},16);

/* Pointer to screen coordinates. The picture is letterboxed inside its box, so
   the offset comes from the rendered size rather than the element. */
function map(e){
  var r=img.getBoundingClientRect();
  var w=devW(),h=devH();
  var sc=Math.min(r.width/w,r.height/h);
  var ox=(r.width-w*sc)/2,oy=(r.height-h*sc)/2;
  return {x:Math.round((e.clientX-r.left-ox)/sc),y:Math.round((e.clientY-r.top-oy)/sc)};
}
var down=false,lastSend=0;
function send(phase,p){fetch('/touch?phase='+phase+'&x='+p.x+'&y='+p.y).catch(function(){});}
img.addEventListener('pointerdown',function(e){
  e.preventDefault();img.setPointerCapture(e.pointerId);down=true;send(0,map(e));});
img.addEventListener('pointermove',function(e){
  if(!down)return;
  var now=performance.now();
  if(now-lastSend<45)return;   /* one request per pointer move is a flood */
  lastSend=now;send(1,map(e));});
function up(e){if(!down)return;down=false;send(2,map(e));}
img.addEventListener('pointerup',up);
img.addEventListener('pointercancel',up);
apply();checkSize();
</script>
)HTML";
