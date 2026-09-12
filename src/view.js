/* Weightless Deck — the view.
   ------------------------------------------------------------------
   Canvas rendering, DOM chrome, pointer and keyboard input. Loaded as
   a plain classic script and adds one name to the page: createView().

   The view reads the table through the interface createSim() returns
   and never writes to it. Input does not move a card — it works out
   what the player is pointing at and hands the sim an intent. That is
   the whole discipline of this file.

   CSS is the design system: readTheme() pulls the palette out of the
   CSS custom properties on :root and hands it to the canvas, so one
   variable re-skins the DOM and the table together. Keep that bridge.

   Rule of thumb for what goes where: DOM for anything that outlives a
   frame and doesn't follow a card, canvas for anything attached to
   one. */

"use strict";

function createView(sim, rules, bus){

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

  /* ---------- canvas + theme ---------- */

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var cv = document.getElementById("table");
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, DPR = 1, PPM = 1.4;

  var theme = {};
  function readTheme(){
    var cs = getComputedStyle(document.documentElement);
    function g(k){ return cs.getPropertyValue(k).trim(); }
    theme = {
      face:g("--face"), faceLine:g("--face-line"), cardInk:g("--card-ink"),
      carmine:g("--carmine"), amber:g("--amber"), amberBright:g("--amber-bright"),
      back1:g("--back-1"), back2:g("--back-2"), shadow:g("--shadow"),
      aura:g("--aura") || "232,163,61"
    };
  }
  readTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);
  new MutationObserver(readTheme).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

  /* ---------- effects ----------
     A spark is a ring that blooms where two things hit each other.
     No card has ever felt one, which is exactly why it lives here and
     not in the sim: it subscribes to the same "contact" event that
     score and, later, sound will.

     The sim reports every contact it resolves. These are the impulses
     above which a knock reads as a knock — a wall bounce shows a
     little sooner than a card-on-card one, because the card is
     rebounding off something that cannot move. */

  var SPARK_CARD = 30, SPARK_WALL = 24, SPARK_MAX = 40;
  var sparks = [];

  bus.on("contact", function(x, y, j, kind){
    if(j <= (kind === sim.CONTACT_WALL ? SPARK_WALL : SPARK_CARD)) return;
    if(sparks.length > SPARK_MAX || reduced) return;
    sparks.push({x:x, y:y, t:0, life:0.42, r:Math.min(26, 5 + j*0.07)});
  });

  /* a fresh table has nothing still ringing on it */
  bus.on("deal", function(){ sparks.length = 0; });

  /* effects age on the sim's clock, not the display's — one call per
     tick, so a slow frame does not eat a spark */
  function advance(dt){
    for(var i=sparks.length-1;i>=0;i--){
      var s = sparks[i];
      s.t += dt;
      if(s.t > s.life) sparks.splice(i,1);
    }
  }

  /* ---------- rendering ---------- */

  function roundRect(c,x,y,w,h,r){
    c.beginPath();
    c.moveTo(x+r,y);
    c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
    c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
    c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y);
    c.closePath();
  }

  function drawFace(c, b, w, h){
    var red = b.suit.red;
    c.fillStyle = red ? theme.carmine : theme.cardInk;

    /* index corners, in the same didone as the wordmark */
    var fs = w*0.175;
    c.font = "600 " + fs.toFixed(1) + 'px "Bodoni Moda", Georgia, serif';
    c.textAlign = "center"; c.textBaseline = "alphabetic";
    var ix = -w*0.5 + w*0.155, iy = -h*0.5 + fs*1.18;
    c.fillText(b.rank, ix, iy);
    c.font = (fs*0.82).toFixed(1) + 'px Georgia, "Segoe UI Symbol", serif';
    c.fillText(b.suit.g, ix, iy + fs*0.92);

    c.save();
    c.rotate(Math.PI);
    c.font = "600 " + fs.toFixed(1) + 'px "Bodoni Moda", Georgia, serif';
    c.fillText(b.rank, ix, iy);
    c.font = (fs*0.82).toFixed(1) + 'px Georgia, "Segoe UI Symbol", serif';
    c.fillText(b.suit.g, ix, iy + fs*0.92);
    c.restore();

    /* centre pip */
    c.globalAlpha = 0.92;
    c.font = (w*0.56).toFixed(1) + 'px Georgia, "Segoe UI Symbol", serif';
    c.textBaseline = "middle";
    c.fillText(b.suit.g, 0, h*0.035);
    c.globalAlpha = 1;
  }

  function drawBack(c, w, h){
    c.fillStyle = theme.back1;
    c.fillRect(-w/2, -h/2, w, h);
    c.save();
    c.beginPath(); c.rect(-w/2, -h/2, w, h); c.clip();
    c.strokeStyle = theme.back2;
    c.lineWidth = Math.max(0.6, w*0.016);
    var gap = w*0.155;
    c.beginPath();
    for(var d = -h; d < w + h; d += gap){
      c.moveTo(-w/2 + d, -h/2);      c.lineTo(-w/2 + d - h, h/2);
      c.moveTo(-w/2 + d - h, -h/2);  c.lineTo(-w/2 + d, h/2);
    }
    c.stroke();
    c.restore();
    c.strokeStyle = theme.face;
    c.lineWidth = Math.max(1, w*0.035);
    roundRect(c, -w/2 + w*0.07, -h/2 + w*0.07, w - w*0.14, h - w*0.14, w*0.04);
    c.stroke();
  }

  function drawCard(b){
    var lift = b.sel + b.hov*0.28;
    var breathe = reduced ? 0 : 0.011*Math.sin(sim.time*1.35 + b.ph);
    var vs = (1 + sim.SEL_GROW*b.sel) * (1 + breathe);
    var flipS = Math.abs(Math.cos(b.flip*Math.PI));
    var w = sim.CARD_W*PPM, h = sim.CARD_H*PPM, r = w*0.082;

    ctx.save();
    ctx.translate(b.x*PPM, b.y*PPM);
    ctx.rotate(b.a);
    ctx.scale(vs*Math.max(0.03, flipS), vs);

    /* selection aura — the one place the accent is spent */
    if(b.sel > 0.02){
      ctx.save();
      ctx.globalAlpha = b.sel*0.9;
      ctx.strokeStyle = "rgba(" + theme.aura + ",0.85)";
      ctx.lineWidth = Math.max(1.2, PPM*1.5);
      ctx.shadowColor = "rgba(" + theme.aura + ",0.55)";
      ctx.shadowBlur = 22*DPR*b.sel;
      roundRect(ctx, -w/2 - PPM*2.4, -h/2 - PPM*2.4, w + PPM*4.8, h + PPM*4.8, r + PPM*2.4);
      ctx.stroke();
      ctx.restore();
    }

    /* drop shadow: offsets live in device space, so the shadow keeps
       one light direction no matter how the card is spinning */
    ctx.shadowColor = theme.shadow;
    ctx.shadowBlur = (4 + lift*22) * PPM * DPR * 0.75;
    ctx.shadowOffsetX = (1.2 + lift*5) * PPM * DPR;
    ctx.shadowOffsetY = (2.6 + lift*11) * PPM * DPR;

    roundRect(ctx, -w/2, -h/2, w, h, r);
    ctx.fillStyle = theme.face;
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    ctx.save();
    roundRect(ctx, -w/2, -h/2, w, h, r);
    ctx.clip();

    if(b.faceUp) drawFace(ctx, b, w, h);
    else drawBack(ctx, w, h);

    /* specular: light stays fixed in world space, so the highlight
       sweeps across the card as it rotates */
    var la = -b.a;
    var lx = Math.cos(la)*(-0.55) - Math.sin(la)*(-0.83);
    var ly = Math.sin(la)*(-0.55) + Math.cos(la)*(-0.83);
    var gr = ctx.createLinearGradient(lx*w*0.8, ly*h*0.55, -lx*w*0.8, -ly*h*0.55);
    gr.addColorStop(0, "rgba(255,255,255," + (0.30 + lift*0.28).toFixed(3) + ")");
    gr.addColorStop(0.48, "rgba(255,255,255,0)");
    gr.addColorStop(1, "rgba(20,22,32,0.075)");
    ctx.fillStyle = gr;
    ctx.fillRect(-w/2, -h/2, w, h);

    if(b.glow > 0.01){
      ctx.fillStyle = "rgba(" + theme.aura + "," + (b.glow*0.22).toFixed(3) + ")";
      ctx.fillRect(-w/2, -h/2, w, h);
    }
    ctx.restore();

    ctx.strokeStyle = theme.faceLine;
    ctx.lineWidth = 1;
    roundRect(ctx, -w/2 + 0.5, -h/2 + 0.5, w - 1, h - 1, r);
    ctx.stroke();

    ctx.restore();
  }

  function render(){
    ctx.clearRect(0,0,W,H);

    for(var i=0;i<sparks.length;i++){
      var s = sparks[i];
      var k = s.t/s.life;
      ctx.beginPath();
      ctx.arc(s.x*PPM, s.y*PPM, (s.r*k + 1.5)*PPM, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(" + theme.aura + "," + ((1-k)*0.5).toFixed(3) + ")";
      ctx.lineWidth = Math.max(0.8, (1-k)*2.2*PPM);
      ctx.stroke();
    }

    var order = sim.cards.slice().sort(function(a,b){
      return (a.sel + a.hov*0.3) - (b.sel + b.hov*0.3);
    });
    for(var j=0;j<order.length;j++) drawCard(order[j]);
  }

  /* ---------- input ----------
     Input never touches a body. It turns a pointer position into mm,
     asks the sim what is there, then asks the sim to do something. */

  function toMM(ev){
    var r = cv.getBoundingClientRect();
    return {x:(ev.clientX - r.left)/PPM, y:(ev.clientY - r.top)/PPM};
  }

  cv.addEventListener("pointerdown", function(ev){
    var p = toMM(ev);
    var hit = sim.pick(p.x, p.y);
    if(!hit){ sim.select(null); sim.endDrag(); cv.className = ""; return; }
    sim.select(hit);
    sim.beginDrag(hit, p.x, p.y);
    cv.className = "grabbing";
    cv.setPointerCapture(ev.pointerId);
  });

  cv.addEventListener("pointermove", function(ev){
    var p = toMM(ev);
    if(sim.dragging){ sim.dragTo(p.x, p.y); return; }
    var hit = sim.pick(p.x, p.y);
    sim.setHover(hit);
    cv.className = hit ? "grabbable" : "";
  });

  function endDrag(ev){
    if(!sim.dragging) return;
    sim.endDrag();
    cv.className = "grabbable";
    if(ev && cv.hasPointerCapture && cv.hasPointerCapture(ev.pointerId)) cv.releasePointerCapture(ev.pointerId);
  }
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("pointerleave", function(){
    if(!sim.dragging) sim.setHover(null);
  });

  cv.addEventListener("dblclick", function(ev){
    var p = toMM(ev);
    sim.flip(sim.pick(p.x, p.y));
  });

  cv.addEventListener("contextmenu", function(ev){ ev.preventDefault(); });

  window.addEventListener("keydown", function(ev){
    if(ev.target !== document.body) return;
    var k = ev.key.toLowerCase();
    if(k === "s"){ sim.scatter(); }
    else if(k === "r"){ sim.deal(sim.cards.length, false); }
    else if(k === "escape"){ sim.select(null); sim.endDrag(); }
    else return;
    ev.preventDefault();
  });

  /* ---------- controls ---------- */

  function bind(id, valId, fmt, apply){
    var el = document.getElementById(id), out = document.getElementById(valId);
    function upd(){ var v = +el.value/100; out.textContent = fmt(v, +el.value); apply(v, +el.value); }
    el.addEventListener("input", upd);
    upd();
  }
  bind("gGrav","vGrav",
    function(v){ return (v*9.81).toFixed(2) + " m/s²"; },
    function(v){ sim.setOption("grav", v*9810); });
  bind("gBounce","vBounce",
    function(v){ return v.toFixed(2); },
    function(v){ sim.setOption("rest", v); });
  bind("gDrift","vDrift",
    function(v){ return Math.round(v*520) + " mm/s²"; },
    function(v){ sim.setOption("drift", v*520); });
  bind("gDrag","vDrag",
    function(v){ return (v*1.5).toFixed(2) + " /s"; },
    function(v){ sim.setOption("air", v*1.5); });

  var countEl = document.getElementById("gCount"), countOut = document.getElementById("vCount");
  countEl.addEventListener("input", function(){
    countOut.textContent = countEl.value;
    sim.deal(+countEl.value, false);
    document.getElementById("tBodies").textContent = countEl.value;
  });

  document.getElementById("bScatter").addEventListener("click", function(){ sim.scatter(); });
  document.getElementById("bDeal").addEventListener("click", function(){ sim.deal(+countEl.value, false); });

  if(window.innerWidth < 720) document.getElementById("ctlPanel").open = false;

  /* the deal did not come from the slider, so put the slider where the
     table actually is */
  function showCount(n){
    countEl.value = n;
    countOut.textContent = n;
  }

  /* ---------- telemetry ---------- */

  var tBodies = document.getElementById("tBodies"), tContacts = document.getElementById("tContacts"),
      tMass = document.getElementById("tMass"), tSpeed = document.getElementById("tSpeed"),
      tEnergy = document.getElementById("tEnergy"), tImpact = document.getElementById("tImpact");
  var tAcc = 0;

  /* energies arrive in g·mm²/s². Kinetic energy on this table sits in
     the µJ range and the accumulated impact score climbs past it
     within a minute, so the unit moves rather than the column. */
  function energy(v){
    var uj = v/1000;
    if(uj < 1000) return uj.toFixed(1) + " µJ";
    if(uj < 1e6)  return (uj/1000).toFixed(2) + " mJ";
    return (uj/1e6).toFixed(2) + " J";
  }

  function telemetry(dt){
    tAcc += dt;
    if(tAcc < 0.11) return;
    tAcc = 0;
    var peak = 0, ke = 0;
    var cards = sim.cards, selected = sim.selected;
    for(var i=0;i<cards.length;i++){
      var c = cards[i];
      var sp = Math.hypot(c.vx, c.vy);
      if(sp > peak) peak = sp;
      ke += 0.5*c.m*sp*sp + 0.5*(1/c.invI)*c.w*c.w;
    }
    tBodies.textContent = cards.length;
    tContacts.textContent = sim.contactCount;
    tMass.textContent = selected ? selected.m.toFixed(1) + " g" : "—";
    tMass.className = selected ? "hot" : "";
    tSpeed.textContent = Math.round(peak) + " mm/s";
    tEnergy.textContent = energy(ke);
    /* straight off the rules layer — the view does not keep score */
    tImpact.textContent = energy(rules.impact);
  }

  /* ---------- the canvas ---------- */

  function resize(){
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W*DPR);
    cv.height = Math.round(H*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    PPM = clamp(Math.min(W,H)/640, 0.72, 2.2);
    /* the table is the window: millimetres of table per pixel of
       screen is fixed, so a bigger window is a bigger table */
    sim.setBounds(W/PPM, H/PPM);
  }
  window.addEventListener("resize", resize);

  return {
    resize: resize,
    render: render,
    advance: advance,
    telemetry: telemetry,
    showCount: showCount
  };
}
