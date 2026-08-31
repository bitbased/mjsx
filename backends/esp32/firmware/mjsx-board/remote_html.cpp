// The /remote viewer: the op-stream method, not the JPG poll.
//
// All the machinery lives in /remote.js (remote_client.cpp) — the push
// stream, the binary decode, replay through the REAL mjsx rasterizer at
// /mjsx-backend.js, pointer and keyboard forwarding. This page is just
// the full-window face on it: a canvas, the HD/SRC/DBG buttons with
// their choices remembered, and the status line.
//
// Same .cpp-not-header reasoning as display_html.cpp: this JavaScript's
// braces derail the Arduino prototype generator.
#include <Arduino.h>

extern const char REMOTE_HTML[] PROGMEM = R"HTML(<!doctype html>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">
<title>mjsx remote</title>
<style>
 html,body{margin:0;height:100%;background:#111;color:#ddd;font:12px monospace}
 body{display:flex;align-items:center;justify-content:center;height:100vh}
 canvas{border:1px solid #333;touch-action:none}
 .btn{position:fixed;top:8px;background:#2226;border:1px solid #555;
   border-radius:4px;padding:4px 8px;cursor:pointer;user-select:none}
 #st{position:fixed;bottom:8px;left:8px;color:#666}
 /* a drawer, not a split: the glass keeps the whole window when the
    console is shut, which is the state it is in nearly always */
 #con{position:fixed;left:0;right:0;bottom:0;height:34vh;background:#0b0b0b;
   border-top:1px solid #333;display:none;flex-direction:column}
 #con.on{display:flex}
 /* the glass gives up the room rather than being drawn under the drawer;
    the client is told about it too, or it would size to the whole window */
 body.conon{padding-bottom:34vh;box-sizing:border-box}
 body.conon #st{bottom:calc(34vh + 8px)}
 #conh{flex:0 0 auto;display:flex;gap:8px;align-items:center;
   padding:4px 8px;border-bottom:1px solid #222;color:#777}
 #conh .sp{flex:1 1 auto}
 #conh span{cursor:pointer;user-select:none}
 #cono{flex:1 1 auto;overflow:auto;padding:4px 8px;white-space:pre-wrap;
   word-break:break-word;line-height:1.45}
 #cono div{border-bottom:1px solid #1a1a1a;padding:1px 0}
 .l-debug{color:#7a7a7a}.l-log{color:#ccc}.l-info{color:#6cf}
 .l-warn{color:#fc6}.l-error{color:#f77}
 .l-in{color:#8fa}.l-out{color:#9bd0ff}
 /* backfilled from the ring: same text, visibly older */
 #cono div.hist{opacity:.62;border-left:2px solid #333;padding-left:6px}
 /* the prompt: same eval the tooling uses, in the app's own globals */
 #conp{flex:0 0 auto;display:flex;align-items:center;gap:6px;
   border-top:1px solid #222;padding:4px 8px}
 #conp b{color:#6a6}
 #coni{flex:1 1 auto;background:#000;color:#ddd;border:1px solid #333;
   border-radius:3px;padding:3px 6px;font:12px monospace;outline:none}
 #coni:focus{border-color:#585}
</style>
<canvas id=c></canvas>
<div id=hd class=btn style="right:8px"></div>
<div id=src class=btn style="right:74px"></div>
<div id=dbg class=btn style="right:148px"></div>
<div id=cvq class=btn style="right:222px"></div>
<div id=con1 class=btn style="right:296px"></div>
<div id=st></div>
<div id=con><div id=conh><b>console</b><span id=concnt>0</span>
  <span class=sp></span><span id=conclr>clear</span><span id=conx>close</span></div>
  <div id=cono></div>
  <div id=conp><b>&gt;</b><input id=coni spellcheck=false autocomplete=off
    placeholder="UI.state.count &nbsp;/&nbsp; sys.millis() &nbsp;/&nbsp; console.log(1+1)"></div></div>
<script src=/mjsx-backend.js></script>
<script src=/remote.js></script>
<script>
var cv=document.getElementById("c"),st=document.getElementById("st");
var hdBtn=document.getElementById("hd"),srcBtn=document.getElementById("src"),dbgBtn=document.getElementById("dbg");
var cvqBtn=document.getElementById("cvq");
var hd="pix",dbg=0,src="bin";
try{
  var hv=localStorage.mjsxRemoteHd;
  if(hv==="off"||hv==="full"||hv==="pix")hd=hv;   /* legacy 0/1 fall to the pix default */
  dbg=parseInt(localStorage.mjsxRemoteDbg)||0;
  if(localStorage.mjsxRemoteSrc)src=localStorage.mjsxRemoteSrc;
}catch(e){}
var conEl=document.getElementById("con"),conOut=document.getElementById("cono");
var conCnt=document.getElementById("concnt"),conBtn=document.getElementById("con1");
var conOn=false,conN=0;
try{conOn=localStorage.mjsxRemoteCon==="1";}catch(e){}
/* Appended one node at a time and capped: this pane can be left open on a
   board that logs every tick, and an unbounded list would eat the tab. */
function conAdd(level,text,history){
  var atEnd=conOut.scrollTop+conOut.clientHeight>=conOut.scrollHeight-24;
  var d=document.createElement("div");
  d.className="l-"+level+(history?" hist":"");
  /* "in" and "out" are the REPL's own pseudo-levels and carry their own
     marker; only the real console levels get named. */
  d.textContent=(level==="log"||level==="in"||level==="out"?"":level+": ")+text;
  /* backfilled lines happened BEFORE anything already shown, so they go
     above it, in order, rather than at the bottom out of sequence */
  if(history&&conOut.firstChild)conOut.insertBefore(d,conHistAt?conHistAt.nextSibling:conOut.firstChild);
  else conOut.appendChild(d);
  if(history)conHistAt=d;
  while(conOut.childNodes.length>300)conOut.removeChild(conOut.firstChild);
  conCnt.textContent=(++conN)+" lines";
  if(atEnd&&!history)conOut.scrollTop=conOut.scrollHeight;
}
var conHistAt=null;
var R=mjsxRemote(cv,{hd:hd,dbg:dbg,src:src,log:conOn,
  fitBox:function(){return [innerWidth,innerHeight-(conOn?Math.round(innerHeight*0.34):0)];},
  onStatus:function(t){st.textContent=t;},
  onLog:conAdd,
  onSrc:function(){srcLabel();}});
function conLabel(){conBtn.textContent="CON:"+(conOn?"ON":"OFF");}
/* Opening the console BACKFILLS from the board's ring before live lines
   start arriving, so you see what it has been saying -- its boot included
   -- instead of only what happens after you thought to look. The ring is
   the same bounded buffer `mjsx logs` reads; this just asks for the tail
   of it once, through the REPL endpoint that already exists.

   conBackAt tracks the highest sequence number backfilled, so reopening
   the pane does not repeat what is already on screen. */
var conBackAt = 0, conBackDone = false;
function conBackfill(){
  if(conBackDone)return;
  conBackDone=true;
  fetch("/eval?js="+encodeURIComponent(
      'JSON.stringify(mjsxLog.since('+conBackAt+'))'))
    .then(function(r){return r.json();})
    .then(function(j){
      if(!j||!j.ok||!j.value)return;
      var rows;
      try{rows=JSON.parse(JSON.parse(j.value));}catch(e){
        try{rows=JSON.parse(j.value);}catch(e2){return;}
      }
      if(!rows||!rows.length)return;
      /* oldest first, above whatever has already streamed in */
      for(var i=0;i<rows.length;i++){
        conAdd(rows[i].level,rows[i].text,true);
        if(rows[i].n>conBackAt)conBackAt=rows[i].n;
      }
    })
    .catch(function(){});
}

function conApply(){
  conEl.className=conOn?"on":"";
  document.body.className=conOn?"conon":"";
  R.setLog(conOn);
  R.paint();                       /* the glass just changed size */
  try{localStorage.mjsxRemoteCon=conOn?"1":"0";}catch(e){}
  conLabel();
}
conBtn.addEventListener("click",function(){conOn=!conOn;conApply();if(conOn)conBackfill();});

/* ---- the REPL ------------------------------------------------------
   /eval runs the text in the SAME globals the app is running in, so
   UI.state and the app's own variables are simply in scope. Anything the
   expression logs arrives through the ordinary log-op path and lands in
   the pane above on its own; this only has to show what it RETURNED.
   History on ArrowUp/Down, because a REPL without it is a chore. */
var conIn=document.getElementById("coni");
var hist=[],histAt=0;
function conEval(src){
  conAdd("in","> "+src);
  fetch("/eval?js="+encodeURIComponent(src))
    .then(function(r){return r.json().then(function(j){return {s:r.status,j:j};});})
    .then(function(x){
      if(x.j&&x.j.error){conAdd("error",x.j.error);return;}
      /* the engine hands back a string either way; ok:false is a throw */
      conAdd(x.j&&x.j.ok?"out":"error",String(x.j&&x.j.value!==undefined?x.j.value:""));
    })
    .catch(function(e){conAdd("error","eval failed: "+e);});
}
/* Click anywhere in the drawer and the prompt takes the keyboard, so you
   can read a line and just start typing.

   The test is whether the mouse MOVED, not whether a selection exists.
   Reading the selection at mouseup looks right and is not: clicking
   inside an existing selection keeps that selection alive through
   mouseup (browsers hold it in case you meant to drag the text), so the
   click after a drag saw "something is selected", declined to focus, and
   you had to click twice. Distance is unambiguous -- a drag is a
   selection, a click is a click.

   e.detail > 1 catches double- and triple-click, which select a word or
   a line without moving the mouse at all; taking focus there would
   collapse the selection the user just asked for. */
var conDownX=0,conDownY=0;
conEl.addEventListener("mousedown",function(e){conDownX=e.clientX;conDownY=e.clientY;});
conEl.addEventListener("mouseup",function(e){
  var t=e.target;
  if(t===conIn||t.id==="conclr"||t.id==="conx")return;
  if(e.detail>1)return;                                   /* word/line select */
  var dx=e.clientX-conDownX,dy=e.clientY-conDownY;
  if(dx*dx+dy*dy>16)return;                               /* dragged: a selection */
  conIn.focus();
});

conIn.addEventListener("keydown",function(e){
  if(e.key==="Enter"){
    var v=conIn.value;
    if(!v.trim())return;
    hist.push(v);histAt=hist.length;conIn.value="";
    conEval(v);
  }else if(e.key==="ArrowUp"){
    if(histAt>0){histAt--;conIn.value=hist[histAt];e.preventDefault();}
  }else if(e.key==="ArrowDown"){
    if(histAt<hist.length-1){histAt++;conIn.value=hist[histAt];}
    else{histAt=hist.length;conIn.value="";}
    e.preventDefault();
  }
  /* keystrokes here are for the prompt, not the board */
  e.stopPropagation();
});
document.getElementById("conx").addEventListener("click",function(){conOn=false;conApply();});
document.getElementById("conclr").addEventListener("click",function(){
  conOut.innerHTML="";conN=0;conHistAt=null;conCnt.textContent="0";});
conApply();
function hdLabel(){var m=R.hd();hdBtn.textContent="HD:"+(m==="off"?"OFF":(m==="pix"?"PIX":"FULL"));}
function srcLabel(){srcBtn.textContent="SRC:"+(R.src()==="bin"?"BIN":"JS");}
function dbgLabel(){dbgBtn.textContent="DBG:"+(R.dbg()===0?"OFF":(R.dbg()===1?"BOX":"CLIP"));}
hdBtn.addEventListener("click",function(){
  var m=R.hd();R.setHd(m==="off"?"pix":(m==="pix"?"full":"off"));
  try{localStorage.mjsxRemoteHd=R.hd();}catch(e){}hdLabel();});
srcBtn.addEventListener("click",function(){R.setSrc(R.src()==="bin"?"js":"bin");
  try{localStorage.mjsxRemoteSrc=R.src();}catch(e){}srcLabel();});
dbgBtn.addEventListener("click",function(){R.setDbg((R.dbg()+1)%3);
  try{localStorage.mjsxRemoteDbg=R.dbg();}catch(e){}dbgLabel();});
hdLabel();srcLabel();dbgLabel();
/* canvas stream quality, MJPEG-style: quality x full/half resolution.
   AUTO is the firmware default (80, half over 100k px). */
var CVQS=[["AUTO",0,0],["90",90,2],["H90",90,1],["45",45,2],["H45",45,1],["25",25,2],["H25",25,1]];
var cvqi=0;
try{cvqi=parseInt(localStorage.mjsxRemoteCvq)||0;}catch(e){}
function cvqLabel(){cvqBtn.textContent="CV:"+CVQS[cvqi][0];}
function cvqApply(){
  var c=CVQS[cvqi];
  fetch("/canvasq?"+(c[1]?("q="+c[1]+"&half="+c[2]):"q=80&half=0")).catch(function(){});
}
cvqBtn.addEventListener("click",function(){
  cvqi=(cvqi+1)%CVQS.length;
  try{localStorage.mjsxRemoteCvq=cvqi;}catch(e){}
  cvqLabel();cvqApply();});
cvqLabel();
if(cvqi>0)cvqApply();
</script>)HTML";
