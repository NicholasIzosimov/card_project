/* Weightless Deck — the simulation.
   ------------------------------------------------------------------
   Loaded as a plain classic script so the game still runs by
   double-clicking the HTML (no server, no build). It adds exactly one
   name to the page: createSim().

   createSim() returns one independent table — its own cards, its own
   RNG stream, its own clock. Nothing is shared between instances,
   which is what lets test/physics.mjs run a fresh isolated sim per
   scenario, and what the TypeScript pass turns into a class more or
   less mechanically.

   The returned object is the whole interface. Nothing outside this
   file reaches into sim state: reads go through the getters, writes
   go through the intents at the bottom. The view renders from it and
   never mutates it; the rules layer asks it for things and is told
   what happened.

   This file is DOM-free on purpose — no document, no window, no
   canvas, no Math.random. test/physics.mjs runs it headless in node
   and will fail loudly if that stops being true. */

"use strict";

/* ============================================================
   Weightless Deck — 2D rigid-body sandbox
   Units: millimetres, grams, seconds.
   A poker card is 63 × 88 mm and weighs about 1.8 g, so every
   number the telemetry panel prints is a real-world quantity.
   ============================================================ */

/* @sim-start ----------------------------------------------------
   Everything from here to @sim-end is DOM-free and runs headless in
   node (test/physics.mjs extracts exactly this region). Keep it that
   way: no document, no window, no canvas, no Math.random. */

function createSim(){

  var CARD_W = 63, CARD_H = 88, CARD_M = 1.8;
  var DT = 1/120, MAX_STEPS = 4, ITER = 8;
  var SLOP = 0.12, CORRECT = 0.45;
  var MU_CARD = 0.22, MU_WALL = 0.30, WALL_E = 0.42;
  var SEL_MASS = 26, SEL_GROW = 0.19;
  var SPRING_K = 900, SPRING_C = 62;

  var BW = 500, BH = 400;   /* table extents, mm */
  var reduced = false;      /* set from prefers-reduced-motion at boot */

  /* ---------- deterministic RNG ----------
     Every stochastic value in the sim comes from here, so a given seed
     replays a table exactly. That is what lets test/physics.mjs assert
     the feel has not drifted. Never call rnd() below this line. */

  var SEED = 1, _rs = 1;
  function setSeed(s){ SEED = (s >>> 0) || 1; _rs = SEED; }
  function rnd(){                                    /* mulberry32 */
    _rs = (_rs + 0x6D2B79F5) | 0;
    var t = Math.imul(_rs ^ (_rs >>> 15), 1 | _rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  setSeed(1);


  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

  /* ---------- geometry ---------- */

  function verts(b){
    var c = Math.cos(b.a), s = Math.sin(b.a);
    var ax = c*b.hw, ay = s*b.hw, bx = -s*b.hh, by = c*b.hh;
    return [
      {x:b.x+ax+bx, y:b.y+ay+by},
      {x:b.x-ax+bx, y:b.y-ay+by},
      {x:b.x-ax-bx, y:b.y-ay-by},
      {x:b.x+ax-bx, y:b.y+ay-by}
    ];
  }
  function projRadius(b,n){
    var c = Math.cos(b.a), s = Math.sin(b.a);
    return Math.abs(b.hw*(n.x*c + n.y*s)) + Math.abs(b.hh*(n.x*-s + n.y*c));
  }
  function faceNormal(vs, i, cx, cy){
    var p = vs[i], q = vs[(i+1)&3];
    var ex = q.x-p.x, ey = q.y-p.y;
    var L = Math.hypot(ex,ey) || 1;
    var nx = ey/L, ny = -ex/L;
    var mx = (p.x+q.x)*0.5 - cx, my = (p.y+q.y)*0.5 - cy;
    if(nx*mx + ny*my < 0){ nx = -nx; ny = -ny; }
    return {x:nx, y:ny};
  }
  function clipSeg(v1, v2, nx, ny, o){
    var d1 = v1.x*nx + v1.y*ny - o;
    var d2 = v2.x*nx + v2.y*ny - o;
    var out = [];
    if(d1 <= 0) out.push(v1);
    if(d2 <= 0) out.push(v2);
    if(d1*d2 < 0){
      var t = d1/(d1-d2);
      out.push({x:v1.x + t*(v2.x-v1.x), y:v1.y + t*(v2.y-v1.y)});
    }
    return out.length > 2 ? out.slice(0,2) : out;
  }

  /* Separating-axis test between two oriented boxes, followed by
     reference/incident face clipping to get a real contact manifold. */
  function collide(A,B){
    var dx = B.x-A.x, dy = B.y-A.y;
    var ca = Math.cos(A.a), sa = Math.sin(A.a);
    var cb = Math.cos(B.a), sb = Math.sin(B.a);
    var axes = [{x:ca,y:sa},{x:-sa,y:ca},{x:cb,y:sb},{x:-sb,y:cb}];
    var best = Infinity, bn = null, fromA = true;

    for(var i=0;i<4;i++){
      var n = axes[i];
      var ov = projRadius(A,n) + projRadius(B,n) - Math.abs(dx*n.x + dy*n.y);
      if(ov <= 0) return null;
      if(ov < best - 1e-6){ best = ov; bn = n; fromA = i < 2; }
    }
    var nx = bn.x, ny = bn.y;
    if(dx*nx + dy*ny < 0){ nx = -nx; ny = -ny; }   // always points A → B

    var ref = fromA ? A : B, inc = fromA ? B : A;
    var rnx = fromA ? nx : -nx, rny = fromA ? ny : -ny;

    var rv = verts(ref), iv = verts(inc);
    var ri = 0, bestDot = -Infinity, k, fn;
    for(k=0;k<4;k++){
      fn = faceNormal(rv,k,ref.x,ref.y);
      var d = fn.x*rnx + fn.y*rny;
      if(d > bestDot){ bestDot = d; ri = k; }
    }
    var ii = 0, worst = Infinity;
    for(k=0;k<4;k++){
      fn = faceNormal(iv,k,inc.x,inc.y);
      var d2 = fn.x*rnx + fn.y*rny;
      if(d2 < worst){ worst = d2; ii = k; }
    }

    var r1 = rv[ri], r2 = rv[(ri+1)&3];
    var i1 = iv[ii], i2 = iv[(ii+1)&3];
    var sx = r2.x-r1.x, sy = r2.y-r1.y;
    var sl = Math.hypot(sx,sy) || 1;
    sx /= sl; sy /= sl;

    var seg = clipSeg(i1, i2, -sx, -sy, -(r1.x*sx + r1.y*sy));
    if(seg.length < 2) return null;
    seg = clipSeg(seg[0], seg[1], sx, sy, r2.x*sx + r2.y*sy);
    if(seg.length < 2) return null;

    var rfn = faceNormal(rv, ri, ref.x, ref.y);
    var pts = [];
    for(k=0;k<seg.length;k++){
      var sep = (seg[k].x-r1.x)*rfn.x + (seg[k].y-r1.y)*rfn.y;
      if(sep <= 0.001) pts.push({x:seg[k].x, y:seg[k].y, pen:-sep});
    }
    if(!pts.length){
      pts.push({x:(A.x+B.x)*0.5, y:(A.y+B.y)*0.5, pen:best});
    }
    return {a:A, b:B, nx:nx, ny:ny, pts:pts, pen:best};
  }

  /* ---------- bodies ---------- */

  var RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  var SUITS = [
    {g:"♠", red:false}, {g:"♥", red:true},
    {g:"♦", red:true},  {g:"♣", red:false}
  ];

  var cards = [];
  var sparks = [];
  var time = 0;

  function setMass(b){
    var m = CARD_M * b.massScale;
    b.m = m;
    b.invM = 1/m;
    b.invI = 12 / (m * (4*b.hw*b.hw + 4*b.hh*b.hh));
  }

  function makeCard(rank, suit){
    var b = {
      rank:rank, suit:suit,
      x:0, y:0, a:0, vx:0, vy:0, w:0,
      hw:CARD_W/2, hh:CARD_H/2,
      massScale:1, m:CARD_M, invM:1/CARD_M, invI:1,
      fx:0, fy:0, tq:0,
      ph:rnd()*Math.PI*2, ph2:rnd()*Math.PI*2,
      sel:0, hov:0, faceUp:true, flip:0, flipping:0, glow:0
    };
    setMass(b);
    return b;
  }

  function deal(n, scatter){
    cards.length = 0;
    var pool = [];
    for(var s=0;s<4;s++) for(var r=0;r<13;r++) pool.push([r,s]);
    for(var i=pool.length-1;i>0;i--){
      var j = (rnd()*(i+1))|0, t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var inset = Math.min(BW, BH) * 0.17;
    var rw = Math.max(CARD_H*2, BW - inset*2), rh = Math.max(CARD_H*2, BH - inset*2);
    var ox = (BW - rw)/2, oy = (BH - rh)/2;
    var cols = Math.max(1, Math.round(Math.sqrt(n * (rw/rh))));
    var rows = Math.ceil(n/cols);
    for(var k=0;k<n;k++){
      var c = makeCard(RANKS[pool[k][0]], SUITS[pool[k][1]]);
      var cx = k % cols, cy = (k/cols)|0;
      c.x = ox + rw*(cx+0.5)/cols + (rnd()-0.5)*rw*0.10;
      c.y = oy + rh*(cy+0.5)/rows + (rnd()-0.5)*rh*0.10;
      c.x = clamp(c.x, CARD_H*0.6, BW-CARD_H*0.6);
      c.y = clamp(c.y, CARD_H*0.6, BH-CARD_H*0.6);
      c.a = (rnd()-0.5)*1.4;
      c.w = (rnd()-0.5)*0.6;
      if(scatter){
        c.vx = (rnd()-0.5)*900;
        c.vy = (rnd()-0.5)*900;
        c.w  = (rnd()-0.5)*7;
      }
      cards.push(c);
    }
    selected = null;
    drag.body = null;
    sparks.length = 0;
  }

  function scatter(){
    for(var i=0;i<cards.length;i++){
      var c = cards[i];
      if(c === selected) continue;
      var a = rnd()*Math.PI*2, s = 500 + rnd()*900;
      c.vx += Math.cos(a)*s; c.vy += Math.sin(a)*s;
      c.w  += (rnd()-0.5)*9;
    }
  }

  /* ---------- solver ---------- */

  var selected = null;
  var drag = {body:null, lx:0, ly:0, tx:0, ty:0, active:false};
  var opts = {grav:0, rest:0.55, drift:240, air:0.42};
  var contactCount = 0;

  function applyImpulse(b, jx, jy, rx, ry){
    b.vx += jx*b.invM; b.vy += jy*b.invM;
    b.w  += (rx*jy - ry*jx)*b.invI;
  }

  function solveWalls(b, iterScale){
    var vs = verts(b);
    var walls = [[1,0,0],[-1,0,-BW],[0,1,0],[0,-1,-BH]];
    for(var wI=0; wI<4; wI++){
      var nx = walls[wI][0], ny = walls[wI][1], off = walls[wI][2];
      var hits = [], deepest = 0;
      for(var i=0;i<4;i++){
        var pen = off - (vs[i].x*nx + vs[i].y*ny);
        if(pen > 0){ hits.push(vs[i]); if(pen > deepest) deepest = pen; }
      }
      if(!hits.length) continue;
      contactCount += hits.length;
      var cn = hits.length;
      for(var h=0; h<cn; h++){
        var rx = hits[h].x - b.x, ry = hits[h].y - b.y;
        var rvx = b.vx - b.w*ry, rvy = b.vy + b.w*rx;
        var vn = rvx*nx + rvy*ny;
        if(vn >= 0) continue;
        var rn = rx*ny - ry*nx;
        var km = b.invM + rn*rn*b.invI;
        var j = -(1 + WALL_E) * vn / (km * cn);
        applyImpulse(b, j*nx, j*ny, rx, ry);
        if(j > 24 && iterScale === 0) spark(hits[h].x, hits[h].y, j);

        var tx = -ny, ty = nx;
        rvx = b.vx - b.w*ry; rvy = b.vy + b.w*rx;
        var vt = rvx*tx + rvy*ty;
        var rt = rx*ty - ry*tx;
        var kt = b.invM + rt*rt*b.invI;
        var jt = clamp(-vt/(kt*cn), -MU_WALL*j, MU_WALL*j);
        applyImpulse(b, jt*tx, jt*ty, rx, ry);
      }
      if(deepest > SLOP){
        var push = (deepest - SLOP) * CORRECT;
        b.x += nx*push; b.y += ny*push;
        vs = verts(b);
      }
    }
  }

  function solveManifold(m, first){
    var A = m.a, B = m.b, nx = m.nx, ny = m.ny;
    var e = opts.rest, cn = m.pts.length;
    for(var i=0;i<cn;i++){
      var p = m.pts[i];
      var rax = p.x-A.x, ray = p.y-A.y;
      var rbx = p.x-B.x, rby = p.y-B.y;
      var rvx = (B.vx - B.w*rby) - (A.vx - A.w*ray);
      var rvy = (B.vy + B.w*rbx) - (A.vy + A.w*rax);
      var vn = rvx*nx + rvy*ny;
      if(vn >= 0) continue;

      var ran = rax*ny - ray*nx;
      var rbn = rbx*ny - rby*nx;
      var km = A.invM + B.invM + ran*ran*A.invI + rbn*rbn*B.invI;
      var j = -(1 + e) * vn / (km * cn);

      applyImpulse(A, -j*nx, -j*ny, rax, ray);
      applyImpulse(B,  j*nx,  j*ny, rbx, rby);

      if(first && j > 30){
        spark(p.x, p.y, j);
        A.glow = Math.min(1, A.glow + j/420);
        B.glow = Math.min(1, B.glow + j/420);
      }

      var tx = -ny, ty = nx;
      rvx = (B.vx - B.w*rby) - (A.vx - A.w*ray);
      rvy = (B.vy + B.w*rbx) - (A.vy + A.w*rax);
      var vt = rvx*tx + rvy*ty;
      var rat = rax*ty - ray*tx;
      var rbt = rbx*ty - rby*tx;
      var kt = A.invM + B.invM + rat*rat*A.invI + rbt*rbt*B.invI;
      var jt = clamp(-vt/(kt*cn), -MU_CARD*j, MU_CARD*j);
      applyImpulse(A, -jt*tx, -jt*ty, rax, ray);
      applyImpulse(B,  jt*tx,  jt*ty, rbx, rby);
    }
  }

  function positionalCorrect(m){
    var A = m.a, B = m.b;
    var pen = 0;
    for(var i=0;i<m.pts.length;i++) if(m.pts[i].pen > pen) pen = m.pts[i].pen;
    if(pen <= SLOP) return;
    var s = (pen - SLOP) / (A.invM + B.invM) * CORRECT;
    A.x -= m.nx * s * A.invM; A.y -= m.ny * s * A.invM;
    B.x += m.nx * s * B.invM; B.y += m.ny * s * B.invM;
  }

  function step(dt){
    var i, c, n = cards.length;
    var cx = BW*0.5, cy = BH*0.5;

    /* forces */
    for(i=0;i<n;i++){
      c = cards[i];
      c.fx = 0; c.fy = 0; c.tq = 0;

      var targetScale = c === selected ? 1 : 0;
      c.sel += (targetScale - c.sel) * Math.min(1, dt*11);
      c.hov += ((c.hovering ? 1 : 0) - c.hov) * Math.min(1, dt*11);

      var grow = 1 + SEL_GROW * c.sel;
      c.hw = CARD_W/2 * grow;
      c.hh = CARD_H/2 * grow;
      c.massScale = 1 + (SEL_MASS - 1) * c.sel;
      setMass(c);

      /* gravity */
      c.fy += opts.grav * c.m;

      /* ambient drift — two out-of-phase harmonics so it never
         settles into a visible loop */
      var d = opts.drift * (1 - 0.85*c.sel);
      var t = time;
      c.fx += (Math.cos(t*0.63 + c.ph) + 0.55*Math.cos(t*1.41 + c.ph2)) * d * c.m;
      c.fy += (Math.sin(t*0.77 + c.ph2) + 0.55*Math.sin(t*1.19 + c.ph)) * d * c.m;
      c.tq += Math.sin(t*0.44 + c.ph) * d * 0.010 / c.invI;

      /* a soft cushion inside each rail: zero through the middle of the
         table, rising near the edges, so drifting cards never park under
         the masthead or the panels */
      var marg = Math.min(BW, BH) * 0.15, cush = 3.2;
      if(c.x < marg)      c.fx += (marg - c.x) * cush * c.m;
      if(c.x > BW - marg) c.fx -= (c.x - (BW - marg)) * cush * c.m;
      if(c.y < marg)      c.fy += (marg - c.y) * cush * c.m;
      if(c.y > BH - marg) c.fy -= (c.y - (BH - marg)) * cush * c.m;

      /* faint cohesion so the deck reads as one table, not a border */
      c.fx += (cx - c.x) * 0.09 * c.m;
      c.fy += (cy - c.y) * 0.09 * c.m;

      /* mouse spring, written as an acceleration so the heavy
         selected card still answers the pointer immediately */
      if(drag.body === c && drag.active){
        var ca = Math.cos(c.a), sa = Math.sin(c.a);
        var rx = ca*drag.lx - sa*drag.ly;
        var ry = sa*drag.lx + ca*drag.ly;
        var px = c.x + rx, py = c.y + ry;
        var vax = c.vx - c.w*ry, vay = c.vy + c.w*rx;
        var ax = SPRING_K*(drag.tx - px) - SPRING_C*vax;
        var ay = SPRING_K*(drag.ty - py) - SPRING_C*vay;
        var Fx = ax*c.m, Fy = ay*c.m;
        c.fx += Fx; c.fy += Fy;
        c.tq += (rx*Fy - ry*Fx) * 0.55;
      }

      /* integrate velocity */
      c.vx += c.fx * c.invM * dt;
      c.vy += c.fy * c.invM * dt;
      c.w  += c.tq * c.invI * dt;

      var air = opts.air + (c === selected ? 2.2 : 0);
      var damp = 1 - Math.min(0.6, air*dt);
      c.vx *= damp; c.vy *= damp;
      c.w  *= 1 - Math.min(0.6, (air + 1.6)*dt);

      var sp = Math.hypot(c.vx, c.vy), cap = 5200;
      if(sp > cap){ c.vx = c.vx/sp*cap; c.vy = c.vy/sp*cap; }
      c.w = clamp(c.w, -13, 13);
    }

    /* broadphase + narrowphase */
    var manifolds = [];
    for(i=0;i<n;i++){
      var A = cards[i];
      var rA = Math.hypot(A.hw, A.hh);
      for(var j2=i+1;j2<n;j2++){
        var B = cards[j2];
        var rB = Math.hypot(B.hw, B.hh);
        var ddx = B.x-A.x, ddy = B.y-A.y;
        if(ddx*ddx + ddy*ddy > (rA+rB)*(rA+rB)) continue;
        var m = collide(A,B);
        if(m){ manifolds.push(m); contactCount += m.pts.length; }
      }
    }

    /* velocity constraints */
    for(var it=0; it<ITER; it++){
      for(i=0;i<manifolds.length;i++) solveManifold(manifolds[i], it === 0);
      for(i=0;i<n;i++) solveWalls(cards[i], it);
    }

    /* integrate position */
    for(i=0;i<n;i++){
      c = cards[i];
      c.x += c.vx*dt; c.y += c.vy*dt; c.a += c.w*dt;
      c.glow *= 1 - Math.min(1, dt*4.5);
      if(c.flipping){
        c.flip += dt*3.4;
        if(c.flip >= 0.5 && c.flipping === 1){ c.faceUp = !c.faceUp; c.flipping = 2; }
        if(c.flip >= 1){ c.flip = 0; c.flipping = 0; }
      }
    }
    for(i=0;i<manifolds.length;i++) positionalCorrect(manifolds[i]);

    /* hard clamp — nothing ever escapes the table */
    for(i=0;i<n;i++){
      c = cards[i];
      var r = Math.hypot(c.hw, c.hh);
      if(c.x < -r || c.x > BW+r || c.y < -r || c.y > BH+r){
        c.x = clamp(c.x, r, BW-r); c.y = clamp(c.y, r, BH-r);
        c.vx *= 0.2; c.vy *= 0.2;
      }
    }

    /* sparks */
    for(i=sparks.length-1;i>=0;i--){
      var s = sparks[i];
      s.t += dt;
      if(s.t > s.life) sparks.splice(i,1);
    }
    time += dt;
  }

  function spark(x,y,j){
    if(sparks.length > 40 || reduced) return;
    sparks.push({x:x, y:y, t:0, life:0.42, r:Math.min(26, 5 + j*0.07)});
  }

  /* ---------- intents ----------
     The only way in. Input and rules never touch bodies, `selected`
     or `drag` directly — they say what should happen and the sim
     decides what that means. The channel is thin today; the point is
     that it exists, so nothing outside this file has to know how a
     drag or a selection is represented. */

  function setBounds(w, h){
    BW = w; BH = h;
    /* the table just changed size under the cards — pull anything
       now outside the new rails back inside them */
    for(var i=0;i<cards.length;i++){
      var r = Math.hypot(cards[i].hw, cards[i].hh);
      cards[i].x = clamp(cards[i].x, r, Math.max(r, BW-r));
      cards[i].y = clamp(cards[i].y, r, Math.max(r, BH-r));
    }
  }

  function setOption(k, v){ opts[k] = v; }

  /* prefers-reduced-motion is read from the page and handed down; the
     sim has no window to ask */
  function setReducedMotion(v){ reduced = !!v; }

  function select(b, snap){
    selected = b || null;
    /* snap skips the ease — boot opens on a table that is already
       holding a card, not one easing into it */
    if(snap && selected) selected.sel = 1;
  }

  function flip(b){
    if(b && !b.flipping){ b.flipping = 1; b.flip = 0; }
  }

  function setHover(b){
    for(var i=0;i<cards.length;i++) cards[i].hovering = (cards[i] === b);
  }

  function beginDrag(b, x, y){
    if(!b) return;
    var c = Math.cos(-b.a), s = Math.sin(-b.a);
    var dx = x-b.x, dy = y-b.y;
    drag.body = b;
    drag.lx = c*dx - s*dy;      /* grab point, in the card's frame, so
                                   the card pivots around the pointer */
    drag.ly = s*dx + c*dy;
    drag.tx = x; drag.ty = y;
    drag.active = true;
  }

  function dragTo(x, y){
    if(!drag.active) return;
    drag.tx = x; drag.ty = y;
  }

  function endDrag(){
    drag.active = false;
    drag.body = null;
  }

  /* opening state: every card gets a push, so the first frame shows a
     table already in motion rather than a grid about to start */
  function stir(speed, spin){
    for(var i=0;i<cards.length;i++){
      var c = cards[i];
      c.vx = (rnd()-0.5)*speed;
      c.vy = (rnd()-0.5)*speed;
      c.w  = (rnd()-0.5)*spin;
    }
  }

  /* contactCount accumulates across the substeps of one frame; the
     frame loop clears it, not step() */
  function resetContacts(){ contactCount = 0; }

  /* ---------- queries ---------- */

  function inside(b, x, y){
    var dx = x-b.x, dy = y-b.y;
    var c = Math.cos(-b.a), s = Math.sin(-b.a);
    var lx = c*dx - s*dy, ly = s*dx + c*dy;
    return Math.abs(lx) <= b.hw && Math.abs(ly) <= b.hh;
  }

  /* topmost wins, except that a held card always wins — letting go of
     the card you are dragging should not be a game of pixel golf */
  function pick(x, y){
    if(selected && inside(selected, x, y)) return selected;
    for(var i=cards.length-1;i>=0;i--) if(inside(cards[i], x, y)) return cards[i];
    return null;
  }

  /* ---------- the interface ----------
     Everything above is private. This is the whole surface the rest
     of the game sees. */

  return {
    /* constants the frame loop and the renderer need */
    DT: DT, MAX_STEPS: MAX_STEPS,
    CARD_W: CARD_W, CARD_H: CARD_H, SEL_GROW: SEL_GROW,

    /* state — read-only by contract. getters, not fields, so a reader
       cannot assign to them by accident. */
    cards: cards,
    sparks: sparks,
    get time(){ return time; },
    get contactCount(){ return contactCount; },
    get selected(){ return selected; },
    get dragging(){ return drag.active; },
    get width(){ return BW; },
    get height(){ return BH; },

    /* setup */
    setSeed: setSeed,
    rnd: rnd,
    setBounds: setBounds,
    setOption: setOption,
    setReducedMotion: setReducedMotion,

    /* intents */
    deal: deal,
    scatter: scatter,
    select: select,
    flip: flip,
    setHover: setHover,
    beginDrag: beginDrag,
    dragTo: dragTo,
    endDrag: endDrag,
    stir: stir,

    /* queries */
    pick: pick,

    /* the clock */
    step: step,
    resetContacts: resetContacts
  };
}

/* @sim-end ------------------------------------------------------ */
