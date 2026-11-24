/* The landing page's hero scene: the "Einstein Ring" black hole, sparkle streams from every project into it, the comet,
   the constellations on the arc and the page's starfield. Ported from the approved mockup (round-11/full-page.html,
   script 1); the maths, constants and drawing order are the mockup's. Changes from the mockup: projects come from
   #lp-data and the existing server-rendered links (ul.lp-projects) are placed on the arc; the nebula is locked
   (Haze, Cyan, cloud scale 1, area 1, strength .6); the arc shows as many projects as fit, then "+N more below";
   one animation loop for the scene and the starfield, paused off-screen and in hidden tabs; reduced motion draws one
   still frame; on any error the scene removes itself (logged once) and the no-JavaScript hero stays.
   html.lp-scene-on is set only while the scene is laid out and drawn. Exposes window.HeroScene (test hooks). */
(function () {
  'use strict';
  var root = document.documentElement;
  var hero = document.getElementById('top'), scene = document.getElementById('lp-scene'), dataEl = document.getElementById('lp-data');
  var reduceMQ = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var paused = !!(reduceMQ && reduceMQ.matches);
  var NS = 'http://www.w3.org/2000/svg', TAU = Math.PI * 2, D2R = Math.PI / 180;
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, x) { var k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); }
  function rgba(r, g, b, a) { return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'; }
  /* a 2D context or an error (the scene cannot run without one) */
  function ctx2d(c) { var x = c.getContext('2d'); if (!x) throw new Error('hero scene: no 2D canvas context'); return x; }

  /* ============ zenith geometry: arc, lanes and fan, all computed from the project list (unchanged from Zenith) ============ */
  function rectHit(A, B, pad) { return Math.min(A.r, B.r) - Math.max(A.l, B.l) + pad > 0 && Math.min(A.b, B.b) - Math.max(A.t, B.t) + pad > 0; }
  function ptRect(px, py, R) { var dx = Math.max(R.l - px, 0, px - R.r), dy = Math.max(R.t - py, 0, py - R.b); return Math.hypot(dx, dy); }
  function cubic(a, b, c, d, n, out) {
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, E = t * t * t;
      out.push([A * a[0] + B * b[0] + C * c[0] + E * d[0], A * a[1] + B * b[1] + C * c[1] + E * d[1]]);
    }
    return out;
  }
  function resample(raw, M) {
    var cum = [0], i, N = raw.length - 1;
    for (i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    var len = cum[N] || 1, X = new Float32Array(M), Y = new Float32Array(M), NX = new Float32Array(M), NY = new Float32Array(M), k = 0;
    for (i = 0; i < M; i++) {
      var dd = len * i / (M - 1);
      while (k < N - 1 && cum[k + 1] < dd) k++;
      var f = (dd - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
      X[i] = raw[k][0] + (raw[k + 1][0] - raw[k][0]) * f;
      Y[i] = raw[k][1] + (raw[k + 1][1] - raw[k][1]) * f;
    }
    for (i = 0; i < M; i++) {
      var a = Math.max(0, i - 2), b = Math.min(M - 1, i + 2), tx = X[b] - X[a], ty = Y[b] - Y[a], tl = Math.hypot(tx, ty) || 1;
      NX[i] = -ty / tl; NY[i] = tx / tl;
    }
    return { X: X, Y: Y, NX: NX, NY: NY, M: M, len: len };
  }
  function lanePts(U, j, phi) {
    var o = U.clr + j * U.g, pts = [], x0 = U.hw - U.rc, yb = U.yb;
    for (var x = 0; x < x0; x += 4) pts.push([x, yb + o]);
    var R = U.rc + o;
    for (var a = 90; a > 0; a -= 4) pts.push([x0 + R * Math.cos(a * D2R), yb - U.rc + R * Math.sin(a * D2R)]);
    var xs = U.hw + o, yA = U.yA - j * U.g * U.rise;
    for (var y = yb - U.rc; y > yA; y -= 4) pts.push([xs, y]);
    var d = [Math.sin(phi), Math.cos(phi)], fanStart = pts.length;
    cubic([xs, yA], [xs, yA - xs * U.c1], [d[0] * xs * U.c2, d[1] * xs * U.c2], [0, 0], 70, pts);
    return { pts: pts, fanStart: fanStart };
  }
  function layoutZenith(W, star, items, text, opt) {
    opt = opt || {};
    var N = items.length, cx = star.x, cy = star.y, k = star.k;
    var box = N <= 6 ? clamp(W * .082, 84, 112) : clamp(W * .066, 72, 92);
    var pad = clamp(W * .016, 14, 22), m = 16, clr = 30;
    var fp = items.map(function (it) { return { w: Math.max(it.lw, box), up: box / 2, dn: box / 2 + 4 + it.lh }; });
    var maxW = 0; fp.forEach(function (f) { maxW = Math.max(maxW, f.w); });
    var hw = 0, yt = 1e9, yb = -1e9;
    text.forEach(function (R) { hw = Math.max(hw, cx - R.l, R.r - cx); yt = Math.min(yt, R.t - cy); yb = Math.max(yb, R.b - cy); });
    var nSide = Math.ceil(N / 2);
    var U = { hw: hw, yb: yb, rc: 26, clr: clr, g: clamp(W * .022, 24, 30), yA: yt + 18, rise: 1.1, c1: .5, c2: .42 };
    var phiMin = 62 * D2R;
    text.forEach(function (R) {
      var c = [Math.max(Math.abs(R.l - cx), Math.abs(R.r - cx)) + 22, R.t - cy - 22];
      phiMin = Math.max(phiMin, Math.atan2(c[0], c[1]) + 1.5 * D2R);
    });
    var phiMax = Math.max(phiMin + 36 * D2R, 108 * D2R);
    var phis = [];
    for (var q = 0; q < nSide; q++) phis.push(nSide === 1 ? 90 * D2R : phiMin + (phiMax - phiMin) * q / (nSide - 1));
    var lanes = phis.map(function (ph, j) { return lanePts(U, j, ph); });
    var rx = W / 2 - m - maxW / 2;
    var ry0 = yb + clr + (nSide - 1) * U.g + 26 + box / 2;
    var MERGE = opt.merge == null ? .35 : opt.merge, ADV = opt.adv || .5;
    /* the black hole's disk is wider than the old pulsar's rings: keep drawings clear of it */
    var starZone = { l: cx - 196 * k, r: cx + 196 * k, t: cy - 150 * k, b: cy + 96 * k };
    var P, S, ok = false, best = null;
    function fpr(i) { var p = P[i], f = fp[i]; return { l: p.x - f.w / 2, r: p.x + f.w / 2, t: p.y - f.up, b: p.y + f.dn }; }
    function height() { var h = 0; P.forEach(function (p, i) { h = Math.max(h, p.y + fp[i].dn); }); return h; }
    function place(SE, yEnd, ry) {
      var A = Math.PI / 2, oy = cy + yEnd;
      var raw = [], cum = [0], NSM = 300, i, j;
      for (i = 0; i <= NSM; i++) {
        var t = -A + 2 * A * i / NSM, st = Math.sin(t), ct = Math.cos(t);
        raw.push([cx + rx * (st < 0 ? -1 : 1) * Math.pow(Math.abs(st), SE), oy + (ry - yEnd) * Math.pow(Math.abs(ct), SE)]);
        if (i) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
      }
      P = [];
      for (j = 0; j < N; j++) {
        var target = N === 1 ? cum[NSM] / 2 : cum[NSM] * j / (N - 1), qq = 0;
        while (qq < NSM - 1 && cum[qq + 1] < target) qq++;
        P.push({ x: raw[qq][0], y: raw[qq][1] });
      }
      for (j = 0; j < Math.floor(N / 2); j++) { var o = N - 1 - j; P[o].x = 2 * cx - P[j].x; P[o].y = P[j].y; }
      if (N % 2) {
        var mid = (N - 1) / 2, ny = N > 1 ? P[mid - 1].y : 0;
        P[mid].x = cx;
        P[mid].y = Math.min(P[mid].y, Math.max(cy + ry0, ny + box * .7));
      }
    }
    function collide() {
      for (var i = 0; i < N; i++) {
        var Ri = fpr(i);
        for (var j = i + 1; j < N; j++) if (rectHit(Ri, fpr(j), pad)) return 1;
        for (var t = 0; t < text.length; t++) if (rectHit(Ri, text[t], clr)) return 2;
        if (rectHit(Ri, starZone, pad)) return 3;
        if (Ri.t < 70) return 4;
      }
      return 0;
    }
    (opt.combos || [[.8, -60], [.62, -50], [.8, -10], [1, -70], [.5, -30]]).forEach(function (cb) {
      var ry = ry0;
      for (var attempt = 0; attempt < 36; attempt++) {
        place(cb[0], cb[1], ry);
        if (best && height() >= best.H) break;
        var bad = collide();
        if (!bad) { S = buildStreams(); bad = checkStreams(S); }
        if (!bad) { best = { H: height(), P: P, S: S }; break; }
        ry *= 1.045;
      }
    });
    if (best) { P = best.P; S = best.S; ok = true; }
    else { place(.8, -60, ry0 * 1.3); S = buildStreams(); }
    function buildStreams() {
      var right = [], left = [], out = [];
      P.forEach(function (p, i) {
        if (Math.abs(p.x - cx) < 1) { right.push(i); left.push(i); }
        else if (p.x > cx) right.push(i); else left.push(i);
      });
      function lowFirst(a, b) { return P[b].y - P[a].y || Math.abs(P[a].x - cx) - Math.abs(P[b].x - cx); }
      right.sort(lowFirst); left.sort(lowFirst);
      [[right, 1], [left, -1]].forEach(function (pair) {
        var arr = pair[0], side = pair[1];
        arr.forEach(function (idx, j) {
          var L = lanes[j], lp = L.pts, c = P[idx], b = box;
          var C = [(c.x - cx) * side, c.y - cy];
          var pts = [], J, Ji, T;
          if (Math.abs(c.x - cx) < 1) {
            var pad0 = [0, C[1] - b / 2 - 2], ty = lp[0][1], R = Math.max(18, Math.min(70, pad0[1] - ty));
            for (Ji = 0; Ji < lp.length - 1 && lp[Ji][0] < R; Ji++);
            J = lp[Ji];
            cubic(pad0, [0, pad0[1] - R * .56], [J[0] - R * .56, J[1]], J, 24, pts);
          } else {
            var bst = 1e18; Ji = 0;
            for (var i = 2; i < L.fanStart + 40; i++) {
              var ddx = lp[i][0] - C[0], ddy = lp[i][1] - C[1], dd = ddx * ddx + ddy * ddy, dl0 = Math.sqrt(dd) || 1;
              var tx0 = lp[i + 2][0] - lp[i - 2][0], ty0 = lp[i + 2][1] - lp[i - 2][1], tl0 = Math.hypot(tx0, ty0) || 1;
              if ((ddx * tx0 + ddy * ty0) / (dl0 * tl0) < MERGE) continue;
              if (dd < bst) { bst = dd; Ji = i; }
            }
            var dist0 = Math.sqrt(bst), adv = clamp(dist0 * ADV, 20, 90), acc = 0;
            while (Ji < lp.length - 75 && acc < adv) { acc += Math.hypot(lp[Ji + 1][0] - lp[Ji][0], lp[Ji + 1][1] - lp[Ji][1]); Ji++; }
            var ux, uy;
            J = lp[Ji];
            var nx = lp[Math.min(lp.length - 1, Ji + 2)], pv = lp[Math.max(0, Ji - 2)];
            T = [nx[0] - pv[0], nx[1] - pv[1]]; var tl = Math.hypot(T[0], T[1]) || 1; T = [T[0] / tl, T[1] / tl];
            ux = lp[Math.max(0, Ji)][0] - C[0]; uy = lp[Math.max(0, Ji)][1] - C[1];
            var ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
            var e = .5 / Math.max(Math.abs(ux), Math.abs(uy));
            var pad1 = [C[0] + ux * b * Math.min(e, .6), C[1] + uy * b * Math.min(e, .6)];
            var Ln = Math.hypot(J[0] - pad1[0], J[1] - pad1[1]);
            cubic(pad1, [pad1[0] + ux * Ln * .45, pad1[1] + uy * Ln * .45], [J[0] - T[0] * Ln * .45, J[1] - T[1] * Ln * .45], J, 30, pts);
          }
          for (var w = Ji + 1; w < lp.length; w++) pts.push(lp[w]);
          var abs = pts.map(function (p) { return [cx + side * p[0], cy + p[1]]; });
          out.push({ owner: idx, side: side, lane: j, phi: phis[j], pts: abs });
        });
      });
      return out;
    }
    function checkStreams(S) {
      if (opt.nocheck) return 0;
      for (var a = 0; a < S.length; a++) {
        var pts = S[a].pts;
        for (var i = 0; i < pts.length; i += 2) {
          var x = pts[i][0], y = pts[i][1];
          for (var t = 0; t < text.length; t++) if (ptRect(x, y, text[t]) < 20) return 10;
          for (var j = 0; j < P.length; j++) {
            if (j === S[a].owner) continue;
            if (ptRect(x, y, fpr(j)) < 14) return 11;
          }
          if (y < 64) return 12;
        }
        for (var b2 = a + 1; b2 < S.length; b2++) {
          if (S[b2].side !== S[a].side || Math.abs(S[b2].lane - S[a].lane) > 1) continue;
          var B = S[b2].pts;
          for (i = 0; i < pts.length; i += 3) {
            if (Math.hypot(pts[i][0] - cx, pts[i][1] - cy) < 120 * k) continue;
            for (var q2 = 0; q2 < B.length; q2 += 3) if (Math.hypot(pts[i][0] - B[q2][0], pts[i][1] - B[q2][1]) < U.g * .62) return 13;
          }
        }
      }
      return 0;
    }
    return { H: Math.ceil(height() + 24), box: box, P: P, fp: fp, streams: S, ok: ok };
  }

  /* ============ the drawings, as star charts (unchanged; keyed by slug in SLUG_SHAPE, generic for any other slug) ============ */
  function poly(cx, cy, r, n, rot, m) {
    var out = [];
    for (var i = 0; i < n; i++) { var a = (rot + i * 360 / n) * Math.PI / 180; out.push([+(cx + r * Math.cos(a)).toFixed(2), +(cy + r * Math.sin(a)).toFixed(2), m]); }
    return out;
  }
  function card(x, y, c) { return { p: [[x, y, c ? 1.2 : .6], [x + 18, y, 0], [x + 18, y + 10, 0], [x, y + 10, 0]], close: 1, c: c ? 1 : 0 }; }
  function candle(x, wt, bt, bb, wb) {
    return [{ p: [[x, wt, .55], [x, bt, 0]] }, { p: [[x - 4, bt, .45], [x + 4, bt, 0], [x + 4, bb, 0], [x - 4, bb, 0]], close: 1 }, { p: [[x, bb, 0], [x, wb, .35]] }];
  }
  var sweepA = -50 * Math.PI / 180;
  var SHAPES = {
    monitor: { paths: [
      { p: [[8, 14, 1.4], [92, 14, 1.1], [92, 68, 1.2], [8, 68, 1]], close: 1 },
      { p: [[14, 20], [86, 20], [86, 62], [14, 62]], close: 1, d: 1, s: 0 },
      { p: [[50, 68, 0], [50, 80, .7]] },
      { p: [[32, 84, 1], [68, 84, 1]] },
      { p: [[18, 44, .7], [34, 44, 0], [38, 36, .45], [42, 50, .45], [47, 26, 1.7], [52, 54, .55], [56, 44, 0], [62, 44, 0], [65, 39, .45], [68, 44, 0], [82, 44, .9]], c: 1 }
    ] },
    board: { paths: [
      { p: [[8, 12, 1.3], [92, 12, 1], [92, 86, 1.2], [8, 86, 1]], close: 1 },
      { p: [[8, 24, 0], [92, 24, 0]] },
      { p: [[36, 24], [36, 86]], d: 1, s: 0 }, { p: [[64, 24], [64, 86]], d: 1, s: 0 },
      { p: [[13, 18, .55], [24, 18, 0]] }, { p: [[41, 18, .55], [52, 18, 0]] }, { p: [[69, 18, .55], [80, 18, 0]] },
      card(13, 30), card(13, 46), card(13, 62), card(41, 30), card(41, 46, 1), card(69, 30)
    ] },
    calendar: { paths: [
      { p: [[10, 18, 1.3], [90, 18, 1.1], [90, 88, 1.2], [10, 88, 1]], close: 1 },
      { p: [[30, 10, .9], [30, 24, 0]] }, { p: [[70, 10, .9], [70, 24, 0]] },
      { p: [[10, 32, 0], [90, 32, 0]] },
      { p: [[30, 32], [30, 88]], d: 1, s: 0 }, { p: [[50, 32], [50, 88]], d: 1, s: 0 }, { p: [[70, 32], [70, 88]], d: 1, s: 0 },
      { p: [[10, 50], [90, 50]], d: 1, s: 0 }, { p: [[10, 69], [90, 69]], d: 1, s: 0 },
      { p: [[52, 52, 1.4], [68, 52, .5], [68, 67, .5], [52, 67, .5]], close: 1, c: 1 },
      { p: [[12, 71, .5], [28, 71, 0], [28, 86, 0], [12, 86, 0]], close: 1 }
    ], stars: [[30, 50, .35], [50, 50, .35], [70, 50, .35], [30, 69, .35], [50, 69, .35], [70, 69, .35]] },
    radar: { paths: [
      { p: poly(50, 50, 40, 8, 22.5, .9), close: 1 },
      { p: poly(50, 50, 22, 8, 22.5, 0), close: 1, d: 1, s: 0 },
      { p: [[13, 50], [87, 50]], d: 1, s: 0 }, { p: [[50, 13], [50, 87]], d: 1, s: 0 },
      { p: [[50, 50, 1.1], [+(50 + 37 * Math.cos(sweepA)).toFixed(2), +(50 + 37 * Math.sin(sweepA)).toFixed(2), .5]], c: 1 }
    ], stars: [[64, 33, 1.9, 1], [33, 40, 1.1], [61, 66, .8], [29, 63, .5]] },
    candles: { paths: [
      { p: [[10, 10, .7], [10, 88, 1], [92, 88, .7]] }
    ].concat(candle(24, 52, 60, 72, 80), candle(38, 44, 52, 66, 74), candle(52, 48, 54, 62, 70), candle(66, 30, 36, 50, 58), candle(80, 18, 24, 38, 46), [
      { p: [[24, 66, 0], [38, 59, 0], [52, 58, 0], [66, 43, 0], [80, 31, .9]], c: 1 },
      { p: [[80, 4, 0], [84, 9, 0], [80, 14, 0], [76, 9, 0]], close: 1, c: 1 }
    ]), stars: [[80, 9, 1.8, 1]] },
    /* any project without its own drawing: the mockup's placeholder figure with a solid outline (as projectGlyph's generic glyph) */
    generic: { paths: [
      { p: poly(50, 50, 38, 9, -90, .6), close: 1 },
      { p: [[50, 36], [50, 64]], d: 1, s: 0 }, { p: [[36, 50], [64, 50]], d: 1, s: 0 }
    ], stars: [[50, 12, 1.1], [50, 50, 1.2, 1]] }
  };
  var SLUG_SHAPE = { 'data-central': 'monitor', 'kyber-praxis': 'board', 'praxis-fasti': 'calendar', 'jobscan-board': 'radar', 'steppenwolf': 'candles' };
  function constellation(parent, shape, ox, oy, s, o) {
    o = o || {};
    var k = o.k || 1, base = o.base || 0, total = 0;
    shape.paths.forEach(function (p) { total += p.close ? p.p.length : p.p.length - 1; });
    var step = (o.dur || 1100) / total;
    var g = el('g', { 'class': 'lp-cst' + (o.cls ? ' ' + o.cls : '') }, parent), L = el('g', {}, g), S = el('g', {}, g);
    function X(v) { return +(ox + v * s).toFixed(2); }
    function Y(v) { return +(oy + v * s).toFixed(2); }
    var stars = {}, order = [], idx = 0;
    function star(x, y, m, cy, d) {
      if (!m) return;
      var key = x + ',' + y, prev = stars[key];
      if (prev) { if (m > prev.m) prev.m = m; prev.cy = prev.cy || cy; prev.d = Math.min(prev.d, d); return; }
      stars[key] = { x: x, y: y, m: m, cy: cy, d: d }; order.push(key);
    }
    shape.paths.forEach(function (p) {
      var pts = p.p, n = pts.length, segs = p.close ? n : n - 1, start = idx;
      for (var i = 0; i < segs; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        var at = { x1: X(a[0]), y1: Y(a[1]), x2: X(b[0]), y2: Y(b[1]), 'class': 'lp-seg' + (p.c ? ' cy' : '') + (p.d ? ' dt' : '') };
        if (!p.d) at.pathLength = 1;
        el('line', at, L).style.setProperty('--d', Math.round(base + idx * step) + 'ms');
        idx++;
      }
      pts.forEach(function (v, j) {
        var m = v.length > 2 ? v[2] : (p.s === 0 ? 0 : 1);
        star(v[0], v[1], m, !!p.c, Math.round(base + (start + Math.max(0, j - 1)) * step + step * .8));
      });
    });
    var endT = Math.round(base + idx * step);
    (shape.stars || []).forEach(function (v) { star(v[0], v[1], v[2], !!v[3], endT); });
    order.forEach(function (key) {
      var st = stars[key];
      var sg = el('g', { 'class': 'lp-star' + (st.m >= 1.2 && o.twinkle !== false ? ' tw' : '') }, S);
      sg.style.setProperty('--d', st.d + 'ms');
      sg.style.setProperty('--t', (-Math.random() * 5).toFixed(2) + 's');
      el('circle', { cx: X(st.x), cy: Y(st.y), r: ((3 + st.m * 4.2) * k).toFixed(2), fill: st.cy ? 'url(#lp-gCy)' : 'url(#lp-gInk)', 'class': 'lp-halo' }, sg);
      el('circle', { cx: X(st.x), cy: Y(st.y), r: ((.5 + st.m * .75) * k).toFixed(2), fill: st.cy ? '#e6fcff' : '#ffffff' }, sg);
    });
    return g;
  }

  /* ============ value noise (for the turbulence, the plasma wisps) ============ */
  function hash3(i, j, k) {
    var h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    var a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
    var e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
    var x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
    var y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  }
  function fbm(x, y, z) { return vnoise(x, y, z) * .62 + vnoise(x * 2.07 + 5.2, y * 2.07 + 1.3, z * 1.6 + 3.1) * .38; }

  /* ============ the canvas: streams of data and the black hole ============
     Geometry. The hole lives in its own local frame (x right, y down) turned by TILT. The disk is a flat ring seen
     nearly edge-on: a disk point (rho, ph) on the near half (sin ph >= 0) is drawn where it is, squashed by INC.
     A point on the far half is lensed: its light is bent up over the shadow, so it is drawn at a radius that blends from
     its true radius (at the sides) to a tight band hugging the photon ring (straight behind), with no squash there. The
     same far-half light also makes a thin secondary image under the shadow. Every grain, streak, sparkle and comet uses
     this one map, so the halo is the disk, not a decoration. */
  var flowCv = null, cx2 = null;   /* the scene's canvas and its context (made in init) */
  var TILT = -7 * D2R, CTL = Math.cos(TILT), STL = Math.sin(TILT);
  var INC = .16;    /* how far the disk is tipped towards us: nearly edge-on */
  var WOUT = -.2;   /* angular speed of the outer disk (rad/s); negative: the left side moves towards us (Doppler-bright) */
  var F = { W: 0, H: 0, core: null, k: 1, ks: 1, compact: false, streams: [], t: 0, run: false, raf: 0, last: 0, inView: true, dpr: 1,
    rs: 31, rin: 40, D: 177, G: 240, RL: 310, RW: 310, thE: 54, disk: null, wsp: [], glowB: null, glowF: null, bound: null,
    heat: new Float32Array(96), e: .3, flare: 0, pr: 0, hov: 0, hovT: 0, rips: [], lands: [], comet: null, nextC: 4.5, lastC: -1,
    cTrail: null, cTrailA: 0, warm: false, anyHot: false, geoKey: '', drift: 0, fc: 0, diskBot: 0, comets: 0 };
  /* gravity along a stream: slow at the project, faster and faster towards the hole (sparkles and the comet share it) */
  function accel(u) { return .3 + 3.7 * Math.pow(u, 2.2); }
  /* start positions drawn from the steady state (density ~ 1 / speed), so the first frame already shows the stretch */
  function sampleU() { for (var i = 0; i < 40; i++) { var u = Math.random(); if (Math.random() < .3 / accel(u)) return u; } return Math.random() * .2; }

  function sprite(r, g, b, w) {
    var c = document.createElement('canvas'); c.width = c.height = 48;
    var x = c.getContext('2d'), gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, w || 'rgba(255,255,255,1)');
    gr.addColorStop(.12, 'rgba(' + r + ',' + g + ',' + b + ',.95)');
    gr.addColorStop(.34, 'rgba(' + r + ',' + g + ',' + b + ',.26)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 48, 48); return c;
  }
  var SPW, SPC, SPO, SPH;
  function makeSprites() {
    SPW = sprite(206, 218, 234); SPC = sprite(79, 216, 235); SPO = sprite(255, 146, 100, 'rgba(255,214,190,1)');
    SPH = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.16, 'rgba(255,240,220,.7)'); gr.addColorStop(.45, 'rgba(255,196,150,.2)'); gr.addColorStop(1, 'rgba(255,170,120,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c;
    })();
  }

  /* temperature palette, hottest first: blue-white (approaching, inner) to the accent orange (receding, outer) */
  var PAL = [[200, 236, 255], [255, 255, 255], [255, 241, 222], [255, 212, 168], [255, 172, 124], [255, 138, 92]];
  var TCOL = PAL.map(function (p) { return 'rgb(' + p.join(',') + ')'; });
  function tempU(cs, f) { return clamp((.95 + f + .95 * cs) / 2.9, 0, 1); }
  function palRGB(u) { var x = u * 5, i = Math.min(4, x | 0), f = x - i, a = PAL[i], b = PAL[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  /* relativistic beaming: the side coming towards us is far brighter than the side going away */
  function dop(cs) { var q = 1 - .42 * cs; return q * q * q * .714; }
  /* emissivity: the inner disk is hotter */
  function emis(f) { return .3 + (1 - f) * (1 - f); }

  var LP = [0, 0, 0];
  function lensXY(rho, ph) {
    var cs = Math.cos(ph), sn = Math.sin(ph);
    if (sn >= 0) { LP[0] = rho * cs; LP[1] = rho * sn * INC; LP[2] = 0; return LP; }
    var w = Math.pow(-sn, .7), bl = F.rs * 1.05 + (rho - F.rin) * .21, b = rho + (bl - rho) * w;
    LP[0] = b * cs; LP[1] = b * sn * (INC + (1 - INC) * w); LP[2] = w; return LP;
  }
  function secXY(rho, ph) { var b2 = F.rs * 1.02 + (rho - F.rin) * .045; LP[0] = b2 * Math.cos(ph) * .985; LP[1] = -b2 * Math.sin(ph); return LP; }
  function toLocal(x, y) { var dx = x - F.core.x, dy = y - F.core.y; return [dx * CTL + dy * STL, -dx * STL + dy * CTL]; }
  function toScreen(lx, ly) { return [F.core.x + lx * CTL - ly * STL, F.core.y + lx * STL + ly * CTL]; }

  /* the outline of the disk-plus-halo as seen on screen: radius and disk angle for every screen direction, so a stream
     joins the disk exactly where its edge is drawn (even when it arrives over the lensed far side) */
  function buildBound() {
    var NB = 720, R = new Float32Array(NB), P = new Float32Array(NB), ok = new Uint8Array(NB), i, j;
    for (i = 0; i < 6000; i++) {
      var ph = -Math.PI + TAU * i / 6000, q = lensXY(F.D, ph), r = Math.hypot(q[0], q[1]);
      var b = Math.floor((Math.atan2(q[1], q[0]) + Math.PI) / TAU * NB) % NB;
      if (!ok[b] || r > R[b]) { R[b] = r; P[b] = ph; ok[b] = 1; }
    }
    for (i = 0; i < NB; i++) if (!ok[i]) {
      for (j = 1; j < NB / 2; j++) {
        var a = (i + j) % NB, c = (i - j + NB) % NB;
        if (ok[a]) { R[i] = R[a]; P[i] = P[a]; break; }
        if (ok[c]) { R[i] = R[c]; P[i] = P[c]; break; }
      }
    }
    F.bound = { R: R, P: P, NB: NB };
  }
  function boundBin(lx, ly) { var B = F.bound; return Math.floor((Math.atan2(ly, lx) + Math.PI) / TAU * B.NB) % B.NB; }
  function inHole(x, y) { var L = toLocal(x, y); return Math.hypot(L[0], L[1]) <= F.bound.R[boundBin(L[0], L[1])]; }

  /* ---- the disk: fine ringlets with gaps, every grain on its own Keplerian orbit (inner grains run faster) ---- */
  var RINGS = [[0, .06, .6], [.08, .19, 1], [.21, .25, .55], [.27, .41, .9], [.44, .46, .4], [.49, .63, .78], [.66, .69, .38], [.72, .85, .6], [.88, .9, .32], [.93, 1, .38]];
  var PX, PY, PA, DS, S2X, S2Y, S2A, KEY, ORD, BC = new Int32Array(12), BO = new Int32Array(12), BP = new Int32Array(12);
  function makeDisk() {
    var total = F.compact ? 700 : 1500, wsum = 0, tmp = [], k = F.k;
    RINGS.forEach(function (r) { wsum += (r[1] - r[0]) * r[2]; });
    RINGS.forEach(function (r) {
      var n = Math.round(total * (r[1] - r[0]) * r[2] / wsum);
      for (var i = 0; i < n; i++) {
        var f = r[0] + (r[1] - r[0]) * Math.random(), rho = F.rin + (F.D - F.rin) * f;
        tmp.push({ f: f, rho: rho, phi: Math.random() * TAU, om: WOUT * Math.pow(F.D / rho, 1.5) * (.96 + Math.random() * .08),
          sz: (.5 + Math.pow(Math.random(), 3) * 1.25) * Math.max(.8, k), al: (.22 + Math.random() * .55) * (.6 + .4 * r[2]),
          sp: .6 + Math.random() * 2.4, p2: Math.random() * TAU });
      }
    });
    var n = tmp.length, d = { n: n, f: new Float32Array(n), rho: new Float32Array(n), phi: new Float32Array(n), om: new Float32Array(n),
      sz: new Float32Array(n), al: new Float32Array(n), em: new Float32Array(n), sp: new Float32Array(n), p2: new Float32Array(n) };
    tmp.forEach(function (g, i) { d.f[i] = g.f; d.rho[i] = g.rho; d.phi[i] = g.phi; d.om[i] = g.om; d.sz[i] = g.sz; d.al[i] = g.al; d.em[i] = emis(g.f); d.sp[i] = g.sp; d.p2[i] = g.p2; });
    F.disk = d;
    PX = new Float32Array(n); PY = new Float32Array(n); PA = new Float32Array(n); DS = new Float32Array(n);
    S2X = new Float32Array(n); S2Y = new Float32Array(n); S2A = new Float32Array(n); KEY = new Uint8Array(n); ORD = new Int32Array(n);
  }
  /* the plasma corona: faint wisps in a flattened haze round the hole */
  function makeWisps() {
    F.wsp = [];
    for (var i = 0, n = F.compact ? 50 : 96; i < n; i++) F.wsp.push({ a: Math.random() * TAU, r0: 1.12 + Math.random() * 1.2, len: .4 + Math.random() * .8, sd: Math.random() * 50 });
  }

  /* ============ the disk's gas: a turbulent texture in the disk's own polar frame ============
     One row per radius, one column per angle. Each row slides at its own Keplerian speed, so clumps and filaments shear into
     streaks as they orbit. A pattern lives for TP seconds, then a fresh one fades in over it (two phases, crossfaded), so the
     shear never winds the disk up into plain rings. */
  var TNR = 96, TNA = 1024, TMASK = TNA - 1, TEX = null, TP = 26;
  var ROWOM = new Float32Array(TNR), SA = new Float32Array(TNR), SB2 = new Float32Array(TNR), TW = [1, 0];
  function ringDen(f) {
    var d = 0;
    for (var i = 0; i < RINGS.length; i++) { var r = RINGS[i]; d = Math.max(d, r[2] * smooth(r[0] - .014, r[0] + .014, f) * (1 - smooth(r[1] - .014, r[1] + .014, f))); }
    return Math.max(.16, d) * (1 - .6 * smooth(.86, 1, f));
  }
  function makeTex() {
    TEX = new Float32Array(TNR * TNA);
    var ca = new Float32Array(TNA), sa = new Float32Array(TNA), q0 = 1.28 / 5.7, r, c, s, spots = [];
    for (c = 0; c < TNA; c++) { ca[c] = Math.cos(c / TNA * TAU); sa[c] = Math.sin(c / TNA * TAU); }
    for (r = 0; r < TNR; r++) {
      var f = r / (TNR - 1), rr = q0 + (1 - q0) * f, Rn = 2.6 + 6 * rr, den = ringDen(f);
      ROWOM[r] = WOUT * Math.pow(1 / rr, 1.5);
      for (c = 0; c < TNA; c++) {
        var x = ca[c], y = sa[c];
        var n1 = fbm(x * Rn + 7.3, y * Rn - 2.1, f * 26);
        var n2 = vnoise(x * Rn * 2.6 + 1.7, y * Rn * 2.6 + 9.1, f * 64 + 4.4);
        var rd = 1 - Math.abs(2 * n2 - 1); rd *= rd; rd *= rd; rd *= rd;
        var n3 = vnoise(x * Rn * .45 + 4.2, y * Rn * .45 - 6.1, f * 7 + 2.2);
        var base = smooth(.28, .8, n1);
        TEX[r * TNA + c] = den * (.08 + .95 * base + .5 * rd * (.3 + base)) * (.45 + 1.1 * n3);
      }
    }
    /* hot spots: compact bright knots, stretched along the orbit */
    for (s = 0; s < 26; s++) spots.push({ f: Math.pow(Math.random(), 1.4), a: Math.random() * TNA, sf: .01 + Math.random() * .025, sa: .05 + Math.random() * .3, A: .5 + Math.random() * 1.5 });
    spots.forEach(function (sp) {
      var r0 = Math.max(0, Math.floor((sp.f - 3 * sp.sf) * (TNR - 1))), r1 = Math.min(TNR - 1, Math.ceil((sp.f + 3 * sp.sf) * (TNR - 1)));
      var cw = Math.ceil(3 * sp.sa / TAU * TNA), c0 = Math.round(sp.a);
      for (var rw = r0; rw <= r1; rw++) {
        var df = (rw / (TNR - 1) - sp.f) / sp.sf, dn = .5 + .5 * ringDen(rw / (TNR - 1));
        for (var dc = -cw; dc <= cw; dc++) {
          var da = dc / TNA * TAU / sp.sa, cc = ((c0 + dc) % TNA + TNA) % TNA;
          TEX[rw * TNA + cc] += sp.A * Math.exp(-(df * df + da * da)) * dn;
        }
      }
    });
  }
  /* where each row's pattern has slid to at time t (both crossfade phases) */
  function prepTex(t) {
    var pa = t / TP, ea = Math.floor(pa), fa = pa - ea, pb = pa + .5, eb = Math.floor(pb), fb = pb - eb, K = TNA / TAU;
    TW[0] = 1 - Math.abs(2 * fa - 1); TW[1] = 1 - TW[0];
    var oa = hash3(ea, 3, 7) * TNA, ob = hash3(eb, 11, 5) * TNA;
    for (var r = 0; r < TNR; r++) {
      var s1 = (oa - ROWOM[r] * fa * TP * K) % TNA, s2 = (ob - ROWOM[r] * fb * TP * K) % TNA;
      SA[r] = s1 < 0 ? s1 + TNA : s1; SB2[r] = s2 < 0 ? s2 + TNA : s2;
    }
  }
  function texAt(r, c) {
    var c1 = c + SA[r], c2 = c + SB2[r], b = r * TNA;
    return TEX[b + ((c1 | 0) & TMASK)] * TW[0] + TEX[b + ((c2 | 0) & TMASK)] * TW[1];
  }

  /* the disk's pixels: every screen pixel of the disk (near side, lensed far side, thin secondary image) is traced back once
     to the disk radius and angle it shows, with its Doppler colour and brightness. Each frame only looks the gas up. */
  var DM = null;
  function buildDiskMap() {
    var bs = Math.min(F.dpr, 1.5), rs = F.rs, rin = F.rin, D = F.D, DK = .95;
    var XB = D * 1.02 + 3, YT = rs * 1.05 + (D - rin) * .21 + 5, YB = Math.max(D * INC, rs * 1.02 + (D - rin) * .045) + 5;
    var W = Math.ceil(2 * XB * bs), H = Math.ceil((YT + YB) * bs), N = W * H;
    var lay = [0, 1].map(function () { var o = { row: new Int16Array(N), col: new Float32Array(N), cnt: new Uint16Array(N), w: new Float32Array(N * 3) }; o.row.fill(-1); return o; });
    var NRf = Math.ceil((D - rin) * bs * 1.6), NAf = Math.ceil(TAU * D * bs * 1.6), ia, ir;
    function put(L, x, y, f, col, cs, I) {
      var px = Math.floor((x + XB) * bs), py = Math.floor((y + YT) * bs);
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      var i = py * W + px, u = tempU(cs, f) * 5, k0 = Math.min(4, u | 0), fr = u - k0, A = PAL[k0], B = PAL[k0 + 1], e = emis(f) * I;
      L.cnt[i]++;
      L.w[3 * i] += (A[0] + (B[0] - A[0]) * fr) * e; L.w[3 * i + 1] += (A[1] + (B[1] - A[1]) * fr) * e; L.w[3 * i + 2] += (A[2] + (B[2] - A[2]) * fr) * e;
      if (L.row[i] < 0 || Math.random() * L.cnt[i] < 1) { L.row[i] = Math.round(f * (TNR - 1)); L.col[i] = col; }
    }
    for (ia = 0; ia < NAf; ia++) {
      var ph = TAU * (ia + .5) / NAf, cs = Math.cos(ph), sn = Math.sin(ph), col = ph / TAU * TNA, dp = dop(cs);
      if (sn >= 0) {
        for (ir = 0; ir < NRf; ir++) { var f = (ir + .5) / NRf, rho = rin + (D - rin) * f; put(lay[1], rho * cs, rho * sn * INC, f, col, cs, dp); }
      } else {
        var s = -sn, w = Math.pow(s, .7), sq = INC + (1 - INC) * w, I = dp * (1 + .2 * w), I2 = I * .6 * Math.sqrt(s);
        for (ir = 0; ir < NRf; ir++) {
          var f2 = (ir + .5) / NRf, rho2 = rin + (D - rin) * f2, bl = rs * 1.05 + (rho2 - rin) * .21, b = rho2 + (bl - rho2) * w;
          put(lay[0], b * cs, b * sn * sq, f2, col, cs, I);
          if (!(ir & 1)) { var b2 = rs * 1.02 + (rho2 - rin) * .045; put(lay[0], b2 * cs * .985, b2 * s, f2, col, cs, I2); }
        }
      }
    }
    DM = { bs: bs, XB: XB, YT: YT, W: W, H: H, L: [] };
    lay.forEach(function (L) {
      var m = 0, i, j = 0;
      for (i = 0; i < N; i++) if (L.cnt[i]) m++;
      var o = { n: m, pix: new Int32Array(m), row: new Int16Array(m), col: new Float32Array(m), hb: new Float32Array(m), hot: new Uint8Array(m),
        wr: new Float32Array(m), wg: new Float32Array(m), wb: new Float32Array(m) };
      for (i = 0; i < N; i++) if (L.cnt[i]) {
        var cn = L.cnt[i] / DK;
        o.pix[j] = i; o.row[j] = L.row[i]; o.col[j] = L.col[i]; o.hb[j] = L.col[i] / TNA * 96; o.hot[j] = L.row[i] > .42 * (TNR - 1) ? 1 : 0;
        o.wr[j] = L.w[3 * i] / cn; o.wg[j] = L.w[3 * i + 1] / cn; o.wb[j] = L.w[3 * i + 2] / cn;
        j++;
      }
      o.cv = document.createElement('canvas'); o.cv.width = W; o.cv.height = H;
      o.ctx = o.cv.getContext('2d'); o.img = o.ctx.createImageData(W, H); o.o32 = new Uint32Array(o.img.data.buffer);
      DM.L.push(o);
    });
  }
  /* light (any brightness) to a colour + alpha pixel that adds onto the sky; over-bright light runs to white */
  function px32(R, G, B) {
    var m = R > G ? (R > B ? R : B) : (G > B ? G : B);
    if (m < 1) return 0;
    /* a soft shoulder instead of a hard clip, so the hottest gas keeps its texture */
    var tm = 255 * (1 - Math.exp(-m / 210)), s0 = tm / m, ex = m > 420 ? smooth(420, 1400, m) * .3 : 0;
    R *= s0; G *= s0; B *= s0; m = tm;
    if (ex) { R += (m - R) * ex; G += (m - G) * ex; B += (m - B) * ex; }
    var s = 255 / m;
    return ((m | 0) << 24) | (((B * s) | 0) << 16) | (((G * s) | 0) << 8) | ((R * s) | 0);
  }
  function renderDisk(t, bright) {
    var heat = F.heat, hoff = ((-WOUT * t / TAU * 96) % 96 + 96) % 96;
    for (var l = 0; l < 2; l++) {
      var o = DM.L[l], n = o.n, o32 = o.o32, row = o.row, col = o.col;
      for (var j = 0; j < n; j++) {
        var r = row[j], c = col[j], c1 = c + SA[r], c2 = c + SB2[r];
        if (c1 >= TNA) c1 -= TNA; if (c2 >= TNA) c2 -= TNA;
        var i1 = c1 | 0, i2 = c2 | 0, b = r * TNA, t1 = TEX[b + i1], t2 = TEX[b + i2];
        var v = ((t1 + (TEX[b + ((i1 + 1) & TMASK)] - t1) * (c1 - i1)) * TW[0] + (t2 + (TEX[b + ((i2 + 1) & TMASK)] - t2) * (c2 - i2)) * TW[1]) * bright;
        if (o.hot[j]) { var hb = o.hb[j] + hoff; if (hb >= 96) hb -= 96; v *= 1 + 2.4 * heat[hb | 0]; }
        o32[o.pix[j]] = px32(v * o.wr[j], v * o.wg[j], v * o.wb[j]);
      }
      o.ctx.putImageData(o.img, 0, 0);
    }
  }

  /* the photon ring, drawn per pixel at device resolution: a thin bright ring whose radius and width wander a little, two finer
     sub-rings just inside it, light falling off into the shadow; clumps of brightness run round it with the flow, and the
     approaching side is brighter and bluer */
  var RG = null;
  function buildRing() {
    var rs = F.rs, dpr = F.dpr, RR = rs * 1.3, S = Math.ceil(RR * 2 * dpr), L = [], a;
    var s2 = Math.max(rs * .006, .42 / dpr), s3 = Math.max(rs * .004, .34 / dpr);
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var lx = (x + .5) / dpr - RR, ly = (y + .5) / dpr - RR, r = Math.sqrt(lx * lx + ly * ly);
      if (r < rs * .6 || r > RR) continue;
      var th = Math.atan2(ly, lx), ux = Math.cos(th), uy = Math.sin(th);
      var n1 = vnoise(ux * 3.5 + 3, uy * 3.5, 1.3), n2 = vnoise(ux * 8 + 1, uy * 8 + 5, 2.7);
      var R1 = rs * (1.018 + .014 * (n1 - .5)), s1 = Math.max(rs * (.01 + .012 * n2), .55 / dpr);
      var d1 = (r - R1) / s1, d2 = (r - rs * .984) / s2, d3 = (r - rs * .968) / s3;
      var p = Math.exp(-d1 * d1) + .45 * Math.exp(-d2 * d2) * (.5 + n2) + .24 * Math.exp(-d3 * d3);
      p += r < rs ? .15 * Math.exp(-(rs - r) / (rs * .08)) : (r > R1 ? .3 * Math.exp(-(r - R1) / (rs * .055)) : .3);
      if (p < .004) continue;
      L.push(y * S + x, p, Math.floor((th + Math.PI) / TAU * 512) & 511);
    }
    var n = L.length / 3, cv = document.createElement('canvas'); cv.width = cv.height = S;
    RG = { RR: RR, S: S, n: n, pix: new Int32Array(n), p: new Float32Array(n), ai: new Uint16Array(n), dp: new Float32Array(512), cr: new Float32Array(512),
      cg: new Float32Array(512), cb: new Float32Array(512), cl: new Float32Array(512), cv: cv, ctx: cv.getContext('2d') };
    for (var i = 0; i < n; i++) { RG.pix[i] = L[3 * i]; RG.p[i] = L[3 * i + 1]; RG.ai[i] = L[3 * i + 2]; }
    for (a = 0; a < 512; a++) {
      var cs = Math.cos(a / 512 * TAU - Math.PI), q = 1 - .36 * cs, m = (1 + cs) / 2;
      RG.dp[a] = q * q;
      RG.cr[a] = 228 + 27 * m; RG.cg[a] = 246 - 40 * m; RG.cb[a] = 255 - 89 * m;
    }
    RG.img = RG.ctx.createImageData(S, S); RG.o32 = new Uint32Array(RG.img.data.buffer);
  }
  function renderRing(t, gain) {
    var R = RG, a, cl = R.cl;
    for (a = 0; a < 512; a++) {
      var th = a / 512 * TAU - Math.PI + .8 * t;
      cl[a] = (.35 + 1.3 * fbm(Math.cos(th) * 3 + 5, Math.sin(th) * 3, t * .2)) * R.dp[a] * gain * 235;
    }
    for (var i = 0; i < R.n; i++) {
      a = R.ai[i]; var v = R.p[i] * cl[a];
      R.o32[R.pix[i]] = px32(v * R.cr[a] / 255, v * R.cg[a] / 255, v * R.cb[a] / 255);
    }
    R.ctx.putImageData(R.img, 0, 0);
  }

  /* ============ Einstein ring: the sky behind the hole, warped through a point-mass lens ============
     The local deep field (stars + a faint nebular haze) lives in a source plane that wraps left to right and drifts slowly.
     Every pixel in a circle round the hole looks up where its light came from: beta = theta (1 - thetaE^2 / theta^2). Outside
     the Einstein ring that is the bent primary image, inside it the flipped secondary image, and a faint galaxy sitting almost
     behind the hole is spread into a ring. The lookup map is cached (rebuilt only while a ripple runs or the ring flashes). */
  var WP = null;
  /* the nebula, locked (approved 2026-11-24): type Haze, colour Cyan, cloud scale 1, area 1, strength .6 */
  var NEB = .6;   /* nebula strength */
  var AREA = 1;   /* radius of the lensed-sky region relative to F.RL */
  var CS = 1;     /* nebula cloud scale (noise frequency) */
  function buildWarp() {
    var RW = F.RW, sc = clamp(Math.min(F.dpr, Math.sqrt(230000 / (Math.PI * RW * RW))), .8, 2);
    var S = Math.ceil(2 * RW * sc), T = Math.ceil(2.3 * RW * sc), HS = S + 4, n = T * HS, i, x, y;
    var SR = new Float32Array(n), SG = new Float32Array(n), SB = new Float32Array(n);
    /* nebular haze: computed coarse, smoothly upsampled, tileable across x (noise sampled on a cylinder) */
    var q = 4, cw = Math.ceil(T / q), ch = Math.ceil(HS / q) + 2, NB = new Float32Array(cw * ch), NC = new Float32Array(cw * ch), U = 13.8 / T;
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
      var a = x / cw * TAU, zz = y * q * U;
      var nn = fbm(Math.cos(a) * 2.2 * CS + 4.1, Math.sin(a) * 2.2 * CS - 1.7, zz * CS);
      var lane = vnoise(Math.cos(a) * 5 * CS + 9, Math.sin(a) * 5 * CS + 2, zz * 2.3 * CS + 7);
      var haze = Math.pow(smooth(.36, .9, nn), 1.5) * (.45 + .55 * smooth(.25, .7, lane));
      NB[y * cw + x] = haze;
      NC[y * cw + x] = vnoise(Math.cos(a) * 1.4 + 2, Math.sin(a) * 1.4 + 6, zz * .7 + 3);
    }
    for (y = 0; y < HS; y++) {
      var gy = y / q, y0 = Math.min(ch - 2, gy | 0), fy = gy - y0;
      for (x = 0; x < T; x++) {
        var gx = x / T * cw, x0 = gx | 0, fx = gx - x0, x1 = (x0 + 1) % cw; x0 %= cw;
        var i00 = y0 * cw + x0, i10 = y0 * cw + x1, i01 = i00 + cw, i11 = i10 + cw;
        var nb = (NB[i00] * (1 - fx) + NB[i10] * fx) * (1 - fy) + (NB[i01] * (1 - fx) + NB[i11] * fx) * fy;
        var nc = (NC[i00] * (1 - fx) + NC[i10] * fx) * (1 - fy) + (NC[i01] * (1 - fx) + NC[i11] * fx) * fy;
        var L = nb * 30 * NEB, j = y * T + x;
        SR[j] = L * (.34 - .12 * nc); SG[j] = L * (.48 + .3 * nc); SB[j] = L * (.86 - .08 * nc);
      }
    }
    /* stars: small gaussians of light, a few with a soft halo; mostly blue-white, a few warm */
    function splat(sx, sy, sg, lum, tc) {
      var Rr = Math.ceil(sg * 3), xa = Math.floor(sx) - Rr, ya = Math.floor(sy) - Rr, i2 = 1 / (2 * sg * sg);
      for (var yy = ya; yy <= ya + 2 * Rr; yy++) {
        if (yy < 0 || yy >= HS) continue;
        for (var xx = xa; xx <= xa + 2 * Rr; xx++) {
          var ddx = xx + .5 - sx, ddy = yy + .5 - sy, g = Math.exp(-(ddx * ddx + ddy * ddy) * i2) * lum;
          if (g < .4) continue;
          var jj = yy * T + ((xx % T) + T) % T;
          SR[jj] += g * tc[0]; SG[jj] += g * tc[1]; SB[jj] += g * tc[2];
        }
      }
    }
    var nS = Math.round(T * HS / (sc * sc) / 600);
    for (i = 0; i < nS; i++) {
      var px = Math.random() * T, py = 2 + Math.random() * (HS - 4), cr = Math.random();
      var lum = 34 + 210 * Math.pow(Math.random(), 3.4), sg = (.45 + .45 * Math.pow(Math.random(), 4)) * sc;
      var tc = cr < .12 ? [1, .86, .72] : cr < .55 ? [.82, .91, 1] : [1, 1, 1];
      splat(px, py, sg, lum, tc);
      if (lum > 140) splat(px, py, sg * 3.4, lum * .05, tc);
    }
    /* the output pixels: a disc round the hole, minus the shadow (that light fell in) */
    var rs = F.rs, P = [];
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var tx = (x + .5) / sc - RW, ty = (y + .5) / sc - RW, r = Math.sqrt(tx * tx + ty * ty);
      if (r < rs || r > RW) continue;
      var gn = (1 - smooth(.6 * RW, RW, r)) * (1 - .6 * smooth(55 * F.k, 150 * F.k, ty));
      if (gn < .01) continue;
      P.push(y * S + x, tx, ty, gn);
    }
    var m = P.length / 4, cv = document.createElement('canvas'); cv.width = cv.height = S;
    WP = { S: S, T: T, HS: HS, sc: sc, SR: SR, SG: SG, SB: SB, n: m, pix: new Int32Array(m), tx: new Float32Array(m), ty: new Float32Array(m), gn: new Float32Array(m),
      tp: new Float32Array(m), mx: new Float32Array(m), my: new Int32Array(m), bx: new Float32Array(m), by: new Float32Array(m), cv: cv, ctx: cv.getContext('2d'), clean: false };
    for (i = 0; i < m; i++) {
      WP.pix[i] = P[4 * i]; WP.tx[i] = P[4 * i + 1]; WP.ty[i] = P[4 * i + 2]; WP.gn[i] = P[4 * i + 3];
      WP.tp[i] = 1 - smooth(.5 * RW, RW, Math.hypot(WP.tx[i], WP.ty[i]));   /* the deflection is eased out towards the rim of the region */
    }
    WP.img = WP.ctx.createImageData(S, S); WP.o32 = new Uint32Array(WP.img.data.buffer);
    mapWarp();
  }
  function mapWarp() {
    var W = WP, th = F.thE * (1 + .12 * F.pr), th2 = th * th, RW = F.RW, sc = W.sc, off = (W.T - W.S) / 2, rip = F.rips.length > 0, rs = F.rs, T = W.T, HS = W.HS;
    for (var i = 0; i < W.n; i++) {
      var tx = W.tx[i], ty = W.ty[i], r = Math.sqrt(tx * tx + ty * ty), re = rip ? Math.max(rs, r - ripOff(r)) : r;
      var fac = re / r * (1 - th2 / (re * re) * W.tp[i]), bx = tx * fac, by = ty * fac;
      W.bx[i] = bx; W.by[i] = by;
      W.mx[i] = clamp((bx + RW) * sc + off, 0, T - 1);
      W.my[i] = clamp(((by + RW) * sc + 2) | 0, 0, HS - 1) * T;
    }
  }
  function renderWarp(t) {
    var W = WP;
    if (F.rips.length || F.pr > .004) { mapWarp(); W.clean = false; }
    else if (!W.clean) { mapWarp(); W.clean = true; }
    var k = F.k, gx = (3 + 8 * Math.sin(t * .045)) * k, gy = (-2 + 4 * Math.sin(t * .031 + 1)) * k, gs2 = 49 * k * k, GL = 46;
    var T = W.T, ox = (F.drift * W.sc) % T, SR = W.SR, SG = W.SG, SB = W.SB, o = W.o32, n = W.n, mx = W.mx, my = W.my, bx = W.bx, by = W.by, gn = W.gn, pix = W.pix;
    for (var i = 0; i < n; i++) {
      var x = mx[i] + ox, xi = x | 0, f = x - xi;
      if (xi >= T) xi -= T;
      var x1 = xi + 1 >= T ? 0 : xi + 1, a = my[i] + xi, b = my[i] + x1;
      var R = SR[a] + (SR[b] - SR[a]) * f, G = SG[a] + (SG[b] - SG[a]) * f, B = SB[a] + (SB[b] - SB[a]) * f;
      var dx = bx[i] - gx, dy = by[i] - gy, d2 = dx * dx + dy * dy;
      if (d2 < gs2) { var qq = 1 - d2 / gs2; qq *= qq * GL; R += qq; G += qq * .94; B += qq * .88; }
      var g = gn[i];
      o[pix[i]] = px32(R * g, G * g, B * g);
    }
    W.ctx.putImageData(W.img, 0, 0);
  }

  /* ---- the disk's own light, painted once per size: emissive quads through the lens map, blurred into a glow ---- */
  function blurInto(x, src, r, a) {
    if ('filter' in x) { x.filter = 'blur(' + r.toFixed(1) + 'px)'; x.globalAlpha = a; x.drawImage(src, 0, 0); x.filter = 'none'; x.globalAlpha = 1; return; }
    for (var i = 0; i < 12; i++) { var an = i / 12 * TAU; x.globalAlpha = a / 12; x.drawImage(src, Math.cos(an) * r * .6, Math.sin(an) * r * .6); }
    x.globalAlpha = 1;
  }
  /* the glow is painted as light on black, then turned into colour + alpha so it can be added over the sky */
  function toAlpha(cv) {
    var x = cv.getContext('2d'), im = x.getImageData(0, 0, cv.width, cv.height), d = im.data;
    for (var i = 0; i < d.length; i += 4) {
      var m = Math.max(d[i], d[i + 1], d[i + 2]);
      if (!m) { d[i + 3] = 0; continue; }
      var s = 255 / m; d[i] = d[i] * s; d[i + 1] = d[i + 1] * s; d[i + 2] = d[i + 2] * s; d[i + 3] = m;
    }
    x.putImageData(im, 0, 0);
  }
  function buildGlow() {
    var dpr = F.dpr, k = F.k, G = Math.ceil(F.D * 1.2 + 26 * k), S = Math.ceil(G * 2 * dpr);
    F.G = G;
    function mk() {
      var cv = document.createElement('canvas'); cv.width = cv.height = S;
      var x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, S, S); x.setTransform(dpr, 0, 0, dpr, G * dpr, G * dpr);
      return cv;
    }
    function quad(x, r0, r1, a0, a1, I, col, sec) {
      var c = 'rgb(' + Math.round(col[0] * I) + ',' + Math.round(col[1] * I) + ',' + Math.round(col[2] * I) + ')';
      x.fillStyle = c; x.strokeStyle = c;
      var C = [[r0, a0], [r1, a0], [r1, a1], [r0, a1]];
      x.beginPath();
      for (var q = 0; q < 4; q++) { var P = sec ? secXY(C[q][0], C[q][1]) : lensXY(C[q][0], C[q][1]); if (q) x.lineTo(P[0], P[1]); else x.moveTo(P[0], P[1]); }
      x.closePath(); x.fill(); x.stroke();
    }
    function paint(cv, front) {
      var x = cv.getContext('2d'), NR = 24, NA = 96, rin = F.rin, D = F.D, pass, j, i;
      x.lineWidth = .7; x.lineJoin = 'round';
      for (pass = front ? 1 : 0; pass < 2; pass++) {
        for (j = 0; j < NR; j++) {
          var f0 = j / NR, f1 = (j + 1) / NR, fm = (f0 + f1) / 2, r0 = rin + (D - rin) * f0, r1 = rin + (D - rin) * f1, em = emis(fm);
          for (i = 0; i < NA; i++) {
            var a0 = (front ? 0 : -Math.PI) + Math.PI * i / NA, a1 = a0 + Math.PI / NA, am = (a0 + a1) / 2, cs = Math.cos(am), s = Math.abs(Math.sin(am));
            var w = front ? 0 : Math.pow(s, .7), I = Math.min(1, em * dop(cs) * .24 * (1 - .4 * w));
            /* pass 0: the thin secondary image under the shadow; pass 1: the disk itself (or its lensed halo) */
            if (pass === 0) quad(x, r0, r1, a0, a1, I * .34 * Math.sqrt(s), palRGB(tempU(cs, fm)), true);
            else quad(x, r0, r1, a0, a1, I, palRGB(tempU(cs, fm)), false);
          }
        }
      }
    }
    function finish(src) {
      var out = mk(), x = out.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'lighter';
      blurInto(x, src, 18 * k * dpr, .5);
      blurInto(x, src, 4.5 * k * dpr, .7);
      x.globalAlpha = .16; x.drawImage(src, 0, 0); x.globalAlpha = 1;
      toAlpha(out);
      return out;
    }
    var b = mk(), f = mk();
    paint(b, false); paint(f, true);
    F.glowB = finish(b); F.glowF = finish(f);
  }

  /* ---- stream particles ---- */
  function spawn(p, u) {
    p.m = 0; p.u = u; p.v = 52 + Math.random() * 52; p.l = gauss(); p.ph = Math.random() * TAU;
    p.w = .6 + Math.random() * 1.4; p.sz = .45 + Math.pow(Math.random(), 2.4) * 1.25; p.a = .32 + Math.random() * .58;
    p.rho = 0; p.phi = 0; p.age = 0;
    return p;
  }
  function setFlow(W, H, core, k, defs, compact) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    flowCv.width = Math.round(W * dpr); flowCv.height = Math.round(H * dpr);
    flowCv.style.width = W + 'px'; flowCv.style.height = H + 'px';
    cx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    F.W = W; F.H = H; F.core = core; F.k = k; F.ks = Math.max(.75, k); F.dpr = dpr; F.compact = compact;
    F.rs = 31 * k; F.rin = 1.28 * F.rs; F.D = 5.7 * F.rs; F.thE = 2.2 * F.rs; F.RL = 3.2 * F.thE; F.RW = F.RL * AREA;
    var key = k + '|' + dpr + '|' + compact;
    if (!TEX) makeTex();
    if (key !== F.geoKey) { F.geoKey = key; buildBound(); makeDisk(); makeWisps(); buildDiskMap(); buildRing(); buildWarp(); buildGlow(); }
    F.streams = defs.map(function (d) {
      /* a stream ends where it meets the drawn edge of the disk (or of the lensed halo) */
      var raw = d.pts, cut = raw.length - 1, i;
      for (i = 1; i < raw.length; i++) if (inHole(raw[i][0], raw[i][1])) { cut = i; break; }
      raw = raw.slice(0, Math.max(2, cut + 1));
      var L0 = 0;
      for (i = 1; i < raw.length; i++) L0 += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
      var s = resample(raw, Math.max(60, Math.ceil(L0 / 2.5)));
      s.owner = d.owner; s.hot = 0; s.h = 0; s.pad = !d.noPad; s.side = d.side;
      var e = toLocal(s.X[s.M - 1], s.Y[s.M - 1]);
      s.jp = F.bound.P[boundBin(e[0], e[1])];
      s.parts = [];
      var n = clamp(Math.round(s.len / 4.4 * (d.share || 1)), 40, 180);
      for (i = 0; i < n; i++) s.parts.push(spawn({}, sampleU()));
      return s;
    });
    F.heat.fill(0); F.lands = []; F.rips = []; F.comet = null; F.cTrail = null; F.flare = 0; F.pr = 0;
    /* run the simulation forward so the first frame (and the reduced-motion still) is already full of data */
    F.warm = true;
    for (var w = 0; w < 150; w++) updateFlow(1 / 30);
    F.warm = false;
    drawFlow();
  }

  function heatAdd(ph, v) {
    var b = Math.floor(((((ph - WOUT * F.t) % TAU) + TAU) % TAU) / TAU * 96) % 96, H = F.heat;
    H[b] = Math.min(1.5, H[b] + v);
    H[(b + 1) % 96] = Math.min(1.5, H[(b + 1) % 96] + v * .6); H[(b + 95) % 96] = Math.min(1.5, H[(b + 95) % 96] + v * .6);
    H[(b + 2) % 96] = Math.min(1.5, H[(b + 2) % 96] + v * .25); H[(b + 94) % 96] = Math.min(1.5, H[(b + 94) % 96] + v * .25);
  }

  /* ---- the comet: one brighter sparkle every 8 to 12 s, down a different stream each time ---- */
  function spawnComet() {
    var cand = [];
    F.streams.forEach(function (s, i) { if (s.parts.length && i !== F.lastC) cand.push(i); });
    if (!cand.length) F.streams.forEach(function (s, i) { if (s.parts.length) cand.push(i); });
    if (!cand.length) return;
    var i = cand[Math.floor(Math.random() * cand.length)];
    F.lastC = i;
    F.comet = { s: F.streams[i], u: 0, m: 0, rho: 0, phi: 0, age: 0, trail: [] };
  }
  function cometXY(C) {
    if (!C.m) {
      var s = C.s, fi = clamp(C.u, 0, 1) * (s.M - 1), i0 = fi | 0, i1 = Math.min(s.M - 1, i0 + 1), f = fi - i0;
      return [s.X[i0] + (s.X[i1] - s.X[i0]) * f, s.Y[i0] + (s.Y[i1] - s.Y[i0]) * f];
    }
    var q = lensXY(C.rho, C.phi);
    return toScreen(q[0], q[1]);
  }
  /* it touches the disk: the disk flares there, and the flare is carried round with the orbit */
  function land(ph) {
    heatAdd(ph, 1.1);
    F.lands.push({ ph: ph, rho: F.D * .95, t0: F.t, k: 0 });
    F.flare = Math.max(F.flare, .55);
  }
  /* it crosses the horizon: the photon ring brightens and a lensing ripple runs out through the starfield */
  function strike() {
    F.pr = 1; F.flare = Math.max(F.flare, 1); F.rips.push({ k: 0 }); F.e = Math.min(1.4, F.e + .35); F.comets++;
    F.cTrail = F.comet.trail; F.cTrailA = 1; F.comet = null;
  }

  function updateFlow(dt) {
    F.t += dt;
    var D = F.D, rin = F.rin, i;
    F.hov += (F.hovT - F.hov) * Math.min(1, dt * 5);
    F.streams.forEach(function (s) {
      s.h += (s.hot - s.h) * Math.min(1, dt * 6);
      for (var n = 0; n < s.parts.length; n++) {
        var p = s.parts[n];
        if (!p.m) {
          /* gravity: slow at the project, speeding up all the way in (spacing stretches as they go) */
          p.u += p.v * accel(p.u) * dt / s.len;
          if (p.u >= 1) { p.m = 1; p.rho = D; p.phi = s.jp; p.age = 0; heatAdd(s.jp, .02); }
        } else {
          /* inside the disk: carried on at full speed into orbit, faster and faster while falling inward, gone at the horizon */
          p.age += dt;
          p.phi -= Math.min(9, 1.5 * Math.pow(D / p.rho, 1.5)) * dt;
          p.rho -= p.rho * (.75 + p.age * .5) * dt;
          if (p.rho < rin * .9) { F.e = Math.min(1.4, F.e + .004); spawn(p, Math.random() * .01); }
        }
      }
    });
    if (!F.warm && !paused) {
      F.nextC -= dt;
      if (F.nextC <= 0 && !F.comet) { spawnComet(); F.nextC = 8 + Math.random() * 4; }
    }
    var C = F.comet;
    if (C) {
      if (!C.m) {
        C.u += 300 * F.ks * accel(C.u) * dt / C.s.len;
        if (C.u >= 1) { C.m = 1; C.rho = D; C.phi = C.s.jp; C.age = 0; land(C.phi); }
      } else {
        C.age += dt;
        C.phi -= Math.min(11, 1.7 * Math.pow(D / C.rho, 1.5)) * dt;
        C.rho -= C.rho * (.9 + C.age * 1.4) * dt;
        if (C.rho < rin * .93) strike();
      }
      if (F.comet) { var q = cometXY(C); C.trail.push(q[0], q[1]); trimTrail(C.trail, 24, 150 * F.ks); }
    }
    if (F.cTrail) { F.cTrailA -= dt * 3; if (F.cTrailA <= 0) F.cTrail = null; }
    var hd = Math.exp(-dt * .7);
    for (i = 0; i < 96; i++) F.heat[i] *= hd;
    F.e *= Math.exp(-dt * 1.1);
    F.flare *= Math.exp(-dt * 1.5);
    F.pr *= Math.exp(-dt * 1.7);
    for (i = F.lands.length - 1; i >= 0; i--) { F.lands[i].k += dt / 1.7; if (F.lands[i].k >= 1) F.lands.splice(i, 1); }
    for (i = F.rips.length - 1; i >= 0; i--) { F.rips[i].k += dt / 1.6; if (F.rips[i].k >= 1) F.rips.splice(i, 1); }
    /* the deep field drifts slowly past the hole */
    F.drift += 3.6 * F.k * dt;
  }
  /* the comet's trail: a fixed number of points, but never longer than maxL, so it stretches as the comet speeds up and stays tidy */
  function trimTrail(tr, maxN, maxL) {
    if (tr.length > maxN * 2) tr.splice(0, tr.length - maxN * 2);
    var L = 0;
    for (var j = tr.length - 2; j >= 2; j -= 2) {
      L += Math.hypot(tr[j] - tr[j - 2], tr[j + 1] - tr[j - 1]);
      if (L > maxL) { tr.splice(0, j - 2); break; }
    }
  }

  /* ---- lensing of background light (used by the deep field here and the page's starfield) ---- */
  function ripOff(d1) {
    var o = 0, R = F.rips;
    for (var i = 0; i < R.length; i++) {
      var q = R[i].k, Rw = F.rs * 1.4 + (1 - Math.pow(1 - q, 2)) * F.RL * 1.1, sg = 26 * F.k, x = (d1 - Rw) / sg;
      if (x > -3 && x < 3) o += 10 * F.k * Math.pow(1 - q, 1.4) * Math.sin(x * 2.4) * Math.exp(-x * x);
    }
    return o;
  }
  /* ---- the black hole, layer by layer ---- */
  function computeGrains(t, bright) {
    var d = F.disk, n = d.n, heat = F.heat, rs = F.rs, rin = F.rin, rsb = rs * 1.05, wt = WOUT * t, i, key;
    BC.fill(0);
    for (i = 0; i < n; i++) {
      var ph = d.phi[i] + d.om[i] * t, cs = Math.cos(ph), sn = Math.sin(ph), rho = d.rho[i], f = d.f[i];
      var q = 1 - .42 * cs, a = d.al[i] * q * q * q * .714 * d.em[i] * (.8 + .2 * Math.sin(t * d.sp[i] + d.p2[i])) * bright;
      /* grains are bright only where the gas is: they glint along the filaments and hot spots, not as an even cloud */
      a *= .1 + .9 * texAt((f * (TNR - 1) + .5) | 0, (((ph % TAU) + TAU) % TAU) * TNA / TAU);
      if (f > .42) { var hb = Math.floor(((((ph - wt) % TAU) + TAU) % TAU) / TAU * 96) % 96; a *= 1 + 2.4 * heat[hb]; }
      var ci = (tempU(cs, f) * 5 + .5) | 0; if (ci > 5) ci = 5;
      if (sn >= 0) {
        PX[i] = rho * cs; PY[i] = rho * sn * INC; key = 6 + ci; DS[i] = d.sz[i]; S2A[i] = 0;
      } else {
        var s = -sn, w = Math.pow(s, .7), bl = rsb + (rho - rin) * .21, b = rho + (bl - rho) * w;
        PX[i] = b * cs; PY[i] = b * sn * (INC + (1 - INC) * w); key = ci;
        a *= 1 - .4 * w; DS[i] = d.sz[i] * (1 - .3 * w);
        if (!(i & 1)) { var b2 = rs * 1.02 + (rho - rin) * .045; S2X[i] = b2 * cs * .985; S2Y[i] = b2 * s; S2A[i] = a * .3 * Math.sqrt(s); }
        else S2A[i] = 0;
      }
      PA[i] = a > 1 ? 1 : a; KEY[i] = key; BC[key]++;
    }
    BO[0] = 0;
    for (key = 1; key < 12; key++) BO[key] = BO[key - 1] + BC[key - 1];
    for (key = 0; key < 12; key++) BP[key] = BO[key];
    for (i = 0; i < n; i++) ORD[BP[KEY[i]]++] = i;
  }
  function drawGrains(c, layer) {
    var k0 = layer * 6;
    for (var key = k0; key < k0 + 6; key++) {
      var a0 = BO[key], a1 = a0 + BC[key];
      if (a1 === a0) continue;
      c.fillStyle = TCOL[key - k0];
      for (var j = a0; j < a1; j++) {
        var i = ORD[j], s = DS[i];
        c.globalAlpha = PA[i]; c.fillRect(PX[i] - s / 2, PY[i] - s / 2, s, s);
        if (!layer && S2A[i] > .008) { c.globalAlpha = S2A[i]; c.fillRect(S2X[i] - s * .4, S2Y[i] - s * .4, s * .8, s * .8); }
      }
    }
    c.globalAlpha = 1;
  }
  function drawWisps(c, t, bright) {
    var rs = F.rs, P = [new Path2D(), new Path2D(), new Path2D()], i, j;
    for (i = 0; i < F.wsp.length; i++) {
      var wp = F.wsp[i], a = wp.a - t * .035, n = fbm(Math.cos(a) * 1.6 + wp.sd, Math.sin(a) * 1.6, t * .12), L = rs * (.25 + 1.4 * n * n * wp.len);
      var b = n > .62 ? 2 : n > .44 ? 1 : 0;
      for (j = 0; j <= 4; j++) {
        var r = rs * wp.r0 + L * j / 4, bend = (vnoise(wp.sd + j * .4, t * .18, 1.7) - .5) * .6 * j / 4, an = a + bend;
        var x = Math.cos(an) * r, y = Math.sin(an) * r * .58;
        if (j) P[b].lineTo(x, y); else P[b].moveTo(x, y);
      }
    }
    var AL = [.01, .018, .032];
    c.lineWidth = .6;
    for (b = 0; b < 3; b++) { c.strokeStyle = rgba(255, 228, 202, AL[b] * bright); c.stroke(P[b]); }
  }
  function drawInfall(c, layer, t) {
    var rin = F.rin, D = F.D, ks = F.ks, anyHot = F.anyHot;
    F.streams.forEach(function (s) {
      var dim = anyHot && !s.hot ? .3 : 1;
      for (var n = 0; n < s.parts.length; n++) {
        var p = s.parts[n];
        if (!p.m || (Math.sin(p.phi) >= 0 ? 1 : 0) !== layer) continue;
        var q = lensXY(p.rho, p.phi), x = q[0], y = q[1], w = q[2], f = p.rho / D;
        /* near the horizon the sparkle dims and reddens (gravitational redshift) before it is gone */
        var fr = smooth(rin * .9, rin * 2.4, p.rho);
        var al = p.a * (.55 + .7 * (1 - f)) * Math.pow(fr, .7) * (1 - .4 * w) * dim * (1 + s.h * .5) * smooth(0, .12, p.age + .05);
        var size = p.sz * 9 * ks * (1 - .3 * w) * (.75 + .5 * (1 - f));
        if (fr > .02) { c.globalAlpha = Math.min(1, al * fr); c.drawImage(SPC, x - size / 2, y - size / 2, size, size); }
        if (fr < .98) { c.globalAlpha = Math.min(1, al * (1 - fr) * 1.4); c.drawImage(SPO, x - size / 2, y - size / 2, size, size); }
      }
    });
    c.globalAlpha = 1;
  }
  function drawBH(c, t) {
    var core = F.core, ks = F.ks, rs = F.rs, D = F.D, G = F.G, R, g;
    var fl = F.flare, pr = F.pr, hov = F.hov, e = Math.min(1, F.e);
    var bright = 1 + .5 * fl + .14 * hov + .1 * e;
    prepTex(t);
    renderDisk(t, bright);
    renderRing(t, Math.min(2, .85 + .8 * pr + .18 * hov + .12 * fl));
    var DL = DM.L, dw = DM.W / DM.bs, dh = DM.H / DM.bs;
    c.save(); c.translate(core.x, core.y); c.rotate(TILT);
    c.globalCompositeOperation = 'lighter';
    /* 1 · warm light thrown on the surrounding sky, a whisper of cyan at its edge */
    R = D * 2.3; g = c.createRadialGradient(0, 0, rs, 0, 0, R);
    g.addColorStop(0, rgba(255, 214, 172, .07 + .05 * fl + .02 * hov)); g.addColorStop(.22, rgba(255, 190, 146, .026 + .02 * fl));
    g.addColorStop(.55, 'rgba(79,216,235,.012)'); g.addColorStop(1, 'rgba(79,216,235,0)');
    c.fillStyle = g; c.fillRect(-R, -R, R * 2, R * 2);
    /* 2 · the plasma haze: a flattened glow hugging the inner disk, with slow churning wisps */
    c.save(); c.scale(1, .62);
    R = rs * 3.4; g = c.createRadialGradient(0, 0, rs * .8, 0, 0, R);
    g.addColorStop(0, rgba(255, 226, 196, .12 + .1 * fl + .03 * Math.sin(t * .7))); g.addColorStop(.35, rgba(255, 205, 165, .045 + .04 * fl)); g.addColorStop(1, 'rgba(255,200,160,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    c.restore();
    drawWisps(c, t, bright);
    /* 3 · the far side, lensed up over the top (and its thin secondary image under the bottom): bloom, gas, glints, data */
    c.globalAlpha = .5; c.drawImage(F.glowB, -G, -G, G * 2, G * 2);
    if (fl > .02) { c.globalAlpha = Math.min(1, fl * .5); c.drawImage(F.glowB, -G, -G, G * 2, G * 2); }
    c.globalAlpha = 1;
    c.drawImage(DL[0].cv, -DM.XB, -DM.YT, dw, dh);
    computeGrains(t, bright);
    drawGrains(c, 0);
    drawInfall(c, 0, t);
    /* 4 · the shadow: black, but with a soft edge (no outline); it hides everything behind it */
    c.globalCompositeOperation = 'source-over';
    R = rs * 1.07; g = c.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.88, 'rgba(0,0,0,1)'); g.addColorStop(.935, 'rgba(0,0,0,.9)'); g.addColorStop(.975, 'rgba(0,0,0,.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    c.globalCompositeOperation = 'lighter';
    /* 5 · the photon ring (per pixel: uneven, with sub-rings, brighter and bluer on the approaching side) */
    c.drawImage(RG.cv, -RG.RR, -RG.RR, RG.RR * 2, RG.RR * 2);
    if (pr > .02) {
      R = rs * 1.9; g = c.createRadialGradient(0, 0, rs * .98, 0, 0, R);
      g.addColorStop(0, 'rgba(255,236,214,0)'); g.addColorStop(.06, rgba(255, 236, 214, .26 * pr)); g.addColorStop(.3, rgba(255, 210, 170, .07 * pr)); g.addColorStop(1, 'rgba(255,200,160,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.arc(0, 0, rs * .98, 0, TAU, true); c.fill();
    }
    /* 6 · the near side of the disk: a bright band of gas crossing in front of the shadow */
    c.globalAlpha = .5; c.drawImage(F.glowF, -G, -G, G * 2, G * 2);
    if (fl > .02) { c.globalAlpha = Math.min(1, fl * .5); c.drawImage(F.glowF, -G, -G, G * 2, G * 2); }
    c.globalAlpha = 1;
    c.drawImage(DL[1].cv, -DM.XB, -DM.YT, dw, dh);
    drawGrains(c, 1);
    drawInfall(c, 1, t);
    /* 7 · where a comet landed, a flare smeared along the orbit and carried round with it */
    for (var i = 0; i < F.lands.length; i++) {
      var Ld = F.lands[i], ph = Ld.ph + WOUT * Math.pow(D / Ld.rho, 1.5) * (t - Ld.t0), q = lensXY(Ld.rho, ph), e2 = 1 - Math.pow(1 - Ld.k, 3);
      var sz = (16 + 40 * e2) * ks * (1 - .35 * q[2]), al = Math.pow(1 - Ld.k, 1.6) * .95;
      c.globalAlpha = al; c.drawImage(SPH, q[0] - sz * .9, q[1] - sz * .32, sz * 1.8, sz * .64);
      c.globalAlpha = al * .8; c.drawImage(SPH, q[0] - sz * .25, q[1] - sz * .25, sz * .5, sz * .5);
    }
    c.globalAlpha = 1;
    c.restore();
  }
  function drawTrail(c, tr, a0) {
    var n = tr.length / 2, ks = F.ks, j, f;
    if (n < 2) return;
    c.lineCap = 'round';
    for (j = 1; j < n; j++) {
      f = j / (n - 1);
      c.strokeStyle = rgba(196, 246, 252, a0 * f * f * .6); c.lineWidth = (.5 + 2.2 * f) * ks;
      c.beginPath(); c.moveTo(tr[2 * j - 2], tr[2 * j - 1]); c.lineTo(tr[2 * j], tr[2 * j + 1]); c.stroke();
    }
    for (j = 0; j < n; j++) {
      f = j / (n - 1);
      var sz = (6 + 18 * f) * ks;
      c.globalAlpha = a0 * f * f * .32; c.drawImage(SPC, tr[2 * j] - sz / 2, tr[2 * j + 1] - sz / 2, sz, sz);
    }
    c.globalAlpha = 1;
  }
  function drawComet(c) {
    if (F.cTrail) drawTrail(c, F.cTrail, Math.max(0, F.cTrailA));
    var C = F.comet;
    if (!C || C.trail.length < 2) return;
    drawTrail(c, C.trail, 1);
    var x = C.trail[C.trail.length - 2], y = C.trail[C.trail.length - 1], ks = F.ks, sz = 32 * ks;
    c.globalAlpha = .85; c.drawImage(SPC, x - sz / 2, y - sz / 2, sz, sz);
    sz = 13 * ks; c.globalAlpha = 1; c.drawImage(SPW, x - sz / 2, y - sz / 2, sz, sz);
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, 1.5 * ks, 0, TAU); c.fill();
  }

  function strokeChunks(s, w, a0, a1, c0, c1) {
    var C = 12, step = Math.max(2, Math.floor((s.M - 1) / C));
    cx2.lineWidth = w;
    for (var q = 0; q * step < s.M - 1; q++) {
      var i0 = q * step, i1 = Math.min(s.M - 1, (q + 1) * step), f = (i0 + i1) / 2 / (s.M - 1);
      var r = Math.round(c0[0] + (c1[0] - c0[0]) * f), g = Math.round(c0[1] + (c1[1] - c0[1]) * f), b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      cx2.strokeStyle = rgba(r, g, b, a0 + (a1 - a0) * f);
      cx2.beginPath(); cx2.moveTo(s.X[i0], s.Y[i0]);
      for (var i = i0 + 2; i < i1; i += 2) cx2.lineTo(s.X[i], s.Y[i]);
      cx2.lineTo(s.X[i1], s.Y[i1]); cx2.stroke();
    }
  }
  var SLATE = [154, 167, 187], CYAN = [79, 216, 235];
  function drawFlow() {
    var W = F.W, H = F.H, core = F.core, k = F.k, t = F.t, c = cx2;
    if (!core || !F.disk) return;
    c.clearRect(0, 0, W, H);
    /* the lensed deep field, behind everything: the warped sky (updated every other frame; it moves slowly) */
    c.globalCompositeOperation = 'lighter';
    if (WP) {
      if (!F.run || !(F.fc & 1)) renderWarp(t);
      c.drawImage(WP.cv, core.x - F.RW, core.y - F.RW, F.RW * 2, F.RW * 2);
    }
    c.globalCompositeOperation = 'source-over';
    var anyHot = F.anyHot = F.streams.some(function (s) { return s.hot; });
    c.lineCap = 'butt'; c.lineJoin = 'round';
    /* each stream: only a thin link line (no tube), barely there; the sparkles carry the stream */
    F.streams.forEach(function (s) {
      var dim = anyHot && !s.hot ? .35 : 1;
      strokeChunks(s, .85 + .5 * s.h, (.025 + .08 * s.h) * dim, (.095 + .24 * s.h) * dim, SLATE, CYAN);
    });
    c.globalCompositeOperation = 'lighter';
    /* glowing pads where each stream leaves its constellation */
    F.streams.forEach(function (s) {
      if (!s.pad) return;
      var a = Math.atan2(s.Y[4] - s.Y[0], s.X[4] - s.X[0]), al = (.13 + .05 * Math.sin(t * 1.6 + s.owner) + .2 * s.h) * (anyHot && !s.hot ? .4 : 1);
      c.save(); c.translate(s.X[0], s.Y[0]); c.rotate(a); c.scale(1, .45);
      var pg = c.createRadialGradient(0, 0, 0, 0, 0, 30 * Math.max(.7, k));
      pg.addColorStop(0, rgba(79, 216, 235, al)); pg.addColorStop(1, 'rgba(79,216,235,0)');
      c.fillStyle = pg; c.fillRect(-32, -32, 64, 64); c.restore();
    });
    /* the sparkles: dense, drifting, brightening and turning cyan as they near the disk */
    var spread = 6 * Math.max(.7, k);
    F.streams.forEach(function (s) {
      var dim = anyHot && !s.hot ? .3 : 1;
      for (var n = 0; n < s.parts.length; n++) {
        var p = s.parts[n];
        if (p.m) continue;
        var fi = p.u * (s.M - 1), i0 = fi | 0, i1 = Math.min(s.M - 1, i0 + 1), f = fi - i0;
        var x = s.X[i0] + (s.X[i1] - s.X[i0]) * f, y = s.Y[i0] + (s.Y[i1] - s.Y[i0]) * f;
        var q2 = p.u * s.len / 26, squeeze = .55 + .45 * (1 - Math.exp(-q2 * q2));
        var conv = 1 - smooth(.8, 1, p.u) * .8;
        var lat = (p.l * spread * squeeze + Math.sin(t * p.w + p.ph) * 1.3) * conv;
        x += s.NX[i0] * lat; y += s.NY[i0] * lat;
        var boost = smooth(.7, 1, p.u), fade = smooth(0, .025, p.u);
        var al = p.a * (.78 + .22 * Math.sin(t * 2 * p.w + p.ph)) * (1 + boost * .7) * fade * dim * (1 + s.h * .5);
        var size = p.sz * (1 + boost * .5) * 9.5 * Math.max(.75, k);
        var tint = .1 + .9 * smooth(.45, 1, p.u);
        if (tint < .98) { c.globalAlpha = Math.min(1, al * (1 - tint)); c.drawImage(SPW, x - size / 2, y - size / 2, size, size); }
        c.globalAlpha = Math.min(1, al * tint); c.drawImage(SPC, x - size / 2, y - size / 2, size, size);
      }
    });
    c.globalAlpha = 1;
    drawBH(c, t);
    drawComet(c);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  /* the lowest drawn edge of the disk below the core (near side, and the thin secondary image under the shadow), in px */
  function diskBottom() {
    var m = 0;
    for (var i = 0; i < 720; i++) {
      var ph = TAU * i / 720, q = Math.sin(ph) >= 0 ? lensXY(F.D, ph) : secXY(F.D, ph);
      m = Math.max(m, q[0] * STL + q[1] * CTL);
    }
    return m;
  }

  /* ============ the page's starfield: faint stars and drifting dust; the stars near the hole are lensed round it ============ */
  var bgCv = null, bgCtx = null, BW, BH, stars = [], dust = [], bgRaf = 0;
  var LENS = { on: false, px: 0, py: 0 };
  function sizeBg() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    BW = window.innerWidth; BH = window.innerHeight;
    bgCv.width = BW * dpr; bgCv.height = BH * dpr;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(BW * BH / 5200);
    stars = [];
    for (var i = 0; i < n; i++) {
      var big = Math.random() < .07;
      stars.push({ x: Math.random() * BW, y: Math.random() * BH * 1.4, r: big ? .9 + Math.random() * .5 : .25 + Math.random() * .55, a: .1 + Math.random() * .45, p: Math.random() * 6.28, s: .2 + Math.random() * .6, z: .02 + Math.random() * .06 });
    }
    dust = [];
    for (var j = 0; j < Math.round(BW / 30); j++) {
      dust.push({ x: Math.random() * BW, y: Math.random() * BH, r: .6 + Math.random() * 1.4, a: .03 + Math.random() * .07, vx: (Math.random() - .5) * .07, vy: -(.02 + Math.random() * .08) });
    }
  }
  function paintBg(t, still) {
    var ctx = bgCtx;
    ctx.clearRect(0, 0, BW, BH);
    var sy = window.scrollY, span = BH * 1.4;
    var lens = LENS.on && F.core, hx = 0, hy = 0, RLb = 0, th4 = 0, rsL = 0;
    if (lens) { hx = LENS.px - window.scrollX; hy = LENS.py - sy; RLb = F.RL * 1.15; var th = F.thE * (1 + .12 * F.pr); th4 = 4 * th * th; rsL = F.rs; }
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i], y = ((s.y - sy * s.z) % span + span) % span, x = s.x;
      if (y > BH) continue;
      var al = still ? s.a : s.a * (.72 + .28 * Math.sin(t * .001 * s.s + s.p));
      if (lens) {
        var dx = x - hx, dy = y - hy, dd = dx * dx + dy * dy;
        if (dd < RLb * RLb) {
          var d = Math.sqrt(dd) || .01, sq = Math.sqrt(dd + th4), d1 = (d + sq) / 2;
          if (d1 < rsL * 1.05) continue;
          var tap = 1 - smooth(RLb * .6, RLb, d), dr = d + (d1 - d + ripOff(d1)) * tap;
          x = hx + dx / d * dr; y = hy + dy / d * dr;
          al *= 1 + (Math.min(1.8, d1 / d * .5 * (1 + d / sq)) - 1) * tap;
        }
      }
      ctx.fillStyle = 'rgba(216,222,233,' + Math.min(1, al).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.283); ctx.fill();
    }
    for (var j = 0; j < dust.length; j++) {
      var dt = dust[j];
      if (!still) { dt.x += dt.vx; dt.y += dt.vy; if (dt.y < -4) dt.y = BH + 4; if (dt.x < -4) dt.x = BW + 4; if (dt.x > BW + 4) dt.x = -4; }
      ctx.fillStyle = 'rgba(154,167,187,' + dt.a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(dt.x, dt.y, dt.r, 0, 6.283); ctx.fill();
    }
  }

  /* ============ one animation loop for the scene and the starfield ============
     It runs only while motion is allowed, the hero is in view and the tab is visible. While it is stopped, scrolling
     repaints the starfield once per frame (still), so its parallax follows the page. */
  var loops = 0;
  function frame(now) {
    F.raf = 0;
    try {
      var dt = Math.min(.05, (now - F.last) / 1000 || .016); F.last = now;
      F.fc++; updateFlow(dt); drawFlow(); paintBg(now, false);
    } catch (e) { fail(e); return; }
    if (F.run) F.raf = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (F.run || dead || paused || !F.inView || document.hidden || !F.core) return;
    F.run = true; loops++; F.last = performance.now(); F.raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (!F.run) return;
    F.run = false; loops--;
    if (F.raf) cancelAnimationFrame(F.raf);
    F.raf = 0;
  }
  function bgStill() {
    if (bgRaf || F.run || dead) return;
    bgRaf = requestAnimationFrame(guard(function () { bgRaf = 0; if (!F.run) paintBg(0, true); }));
  }
  /* motion follows prefers-reduced-motion only: a still, complete frame when reduced (sparkles in place, no comet) */
  function setPaused(v) {
    paused = v;
    if (v) { stopLoop(); F.comet = null; F.cTrail = null; drawFlow(); paintBg(0, true); }
    else startLoop();
  }

  /* ============ the stage: the core, the headline block, the arc and the lanes, all computed from the project list ============
     The page's own links (ul.lp-projects > li[data-slug]) are placed on the arc over their drawn constellations. The stage
     (#lp-scene) starts at the top of the page, under the sticky nav, as in the mockup. */
  var zt = hero && hero.querySelector('.lp-text'), label = hero && hero.querySelector('.lp-core-label'), ul = hero && hero.querySelector('ul.lp-projects');
  var phoneMQ = window.matchMedia && window.matchMedia('(max-width: 760px)');
  var HERO_MAX = 12;   /* the arc never holds more than this (in practice about 10 fit at 1440); phones show up to 12 cards */
  var TT = 400;        /* top of the headline block on the stage */
  var PROJ = [], total = 0, shown = 0, svg = null, moreNote = null, moreN = null;
  var t0Sky = 0, baseMap = {}, lastW = 0, fitMemo = {};

  function textRects(W, top) {
    zt.style.top = (scene.offsetTop + top) + 'px';
    var left = (W - zt.offsetWidth) / 2, out = [];
    Array.prototype.forEach.call(zt.children, function (ch) {
      out.push({ l: left + ch.offsetLeft, r: left + ch.offsetLeft + ch.offsetWidth, t: top + ch.offsetTop, b: top + ch.offsetTop + ch.offsetHeight });
    });
    return out;
  }
  function arcOrder(items) {
    var N = items.length, h = Math.floor(N / 2), slots = [], out = new Array(N);
    for (var i = 0; i < h; i++) slots.push(i, N - 1 - i);
    if (N % 2) slots.push(h);
    items.forEach(function (it, j) { out[slots[j]] = it; });
    return out;
  }
  function setMode(compact) { hero.classList.toggle('lp-arc', !compact); hero.classList.toggle('lp-compact', compact); }
  /* only these projects take part (on the arc, or as cards); the rest are in the work list below */
  function showOnly(list) { PROJ.forEach(function (p) { p.li.classList.toggle('lp-off', list.indexOf(p) < 0); }); }
  function buildSky() {
    var W = Math.round(scene.clientWidth);
    if (!W) return;
    lastW = W;
    var cap = Math.min(PROJ.length, HERO_MAX), items, now = performance.now(), el0 = t0Sky ? now - t0Sky : 0;
    svg.classList.remove('has-lit');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    PROJ.forEach(function (p) { p.li.removeAttribute('style'); p.idx = -1; p.g = null; });
    var compact = (phoneMQ && phoneMQ.matches) || W < 700, L = null, core, k, H, defs = [], text;
    setMode(compact);
    if (!compact) {
      /* the headline block sits at top 400; the hole, 10% larger, sits just above it with a small gap */
      k = 1.1; core = { x: W / 2, y: TT - 96 };
      text = textRects(W, TT);
      /* try every project (up to HERO_MAX); while the arc cannot open without crowding, drop one from the end */
      for (var nFit = fitMemo[W + '|' + cap] || cap; ; nFit--) {
        items = arcOrder(PROJ.slice(0, nFit));
        showOnly(items);
        var dims = items.map(function (p) { return { lw: p.tag.offsetWidth + 12, lh: p.tag.offsetHeight + 2 }; });
        L = layoutZenith(W, { x: core.x, y: core.y, k: k }, dims, text);
        if (L.ok) { fitMemo[W + '|' + cap] = nFit; break; }
        if (nFit <= 1) { compact = true; setMode(true); break; }
      }
    }
    if (compact) { items = arcOrder(PROJ.slice(0, cap)); showOnly(items); }
    var keep = {}, fresh = 0;
    items.forEach(function (p) { keep[p.key] = 1; });
    Object.keys(baseMap).forEach(function (kk) { if (!keep[kk]) delete baseMap[kk]; });
    items.forEach(function (p, i) { if (!(p.key in baseMap)) baseMap[p.key] = t0Sky ? el0 + 150 + (fresh++) * 220 : 500 + i * 300; });

    var sx = scene.offsetLeft, sy = scene.offsetTop;
    if (!compact) {
      var tb = 0; text.forEach(function (R) { tb = Math.max(tb, R.b); });
      H = Math.max(L.H, tb + 60);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
      var b = L.box;
      items.forEach(function (p, i) {
        var x = L.P[i].x, y = L.P[i].y;
        var g = constellation(svg, SHAPES[p.shape], x - b / 2, y - b / 2, b / 100, { k: b / 125, base: baseMap[p.key] - el0, dur: 1150 });
        g.setAttribute('data-slug', p.key); g.setAttribute('data-shape', p.shape);
        var st = p.li.style;
        st.left = (sx + x - b / 2) + 'px'; st.top = (sy + y - b / 2) + 'px';
        st.width = b + 'px'; st.height = b + 'px';
        p.idx = i; p.g = g;
      });
      var seen = {};
      L.streams.forEach(function (s) {
        var fork = L.streams.filter(function (o) { return o.owner === s.owner; }).length > 1;
        defs.push({ pts: s.pts, owner: s.owner, side: s.side, share: fork ? .7 : 1, noPad: !!seen[s.owner] });
        seen[s.owner] = 1;
      });
    } else {
      /* small screens: the black hole fed by a symmetric fan of short lanes from both edges; the projects sit in a grid below */
      var k0 = W < 520 ? .62 : .74, TTc = (W < 520 ? 168 : 190) + 118 * k0 + 18;
      k = k0 * 1.1; core = { x: W / 2, y: Math.round(TTc - 46 * k - 30) };
      var textC = textRects(W, TTc), tbC = 0;
      textC.forEach(function (R) { tbC = Math.max(tbC, R.b); });
      H = Math.ceil(tbC + 24);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
      var n = Math.ceil(items.length / 2), y0 = 34 * k + 4, y1 = -58 * k;
      for (var j = 0; j < n; j++) {
        var f = n === 1 ? .5 : j / (n - 1), phi = (64 + 46 * f) * D2R, fy = core.y + y0 + (y1 - y0) * f;
        [1, -1].forEach(function (side) {
          var idx = side === 1 ? j : items.length - 1 - j;
          var fx = core.x + side * (W / 2 + 4), dx = core.x - fx, pts = [];
          cubic([fx, fy], [fx + dx * .45, fy], [core.x + side * Math.sin(phi) * Math.abs(dx) * .42, core.y + Math.cos(phi) * Math.abs(dx) * .42], [core.x, core.y], 60, pts);
          defs.push({ pts: pts, owner: idx, side: side, share: .8, noPad: true });
        });
      }
    }
    scene.style.height = H + 'px';
    /* the core label sits above the hole (the mockup's core button label: bottom edge 134k above the core) */
    var cr = Math.round(64 * k), lab = Math.round(134 * k - cr);
    if (label) label.style.top = (sy + core.y - cr - lab) + 'px';
    setFlow(W, H, core, k, defs, compact);
    F.diskBot = diskBottom();
    /* where the hole sits on the page, so the page's own starfield bends round it too */
    var rc = scene.getBoundingClientRect();
    LENS.px = rc.left + window.scrollX + core.x; LENS.py = rc.top + window.scrollY + core.y; LENS.on = true;
    /* say how many projects the hero left out */
    shown = items.length;
    var extra = total - shown;
    moreNote.hidden = extra <= 0;
    if (extra > 0) moreN.textContent = '+' + extra + ' more below';
  }

  /* pointing at (or focusing) a project lights its constellation and its stream */
  function setLit(p, v) {
    if (!p.g) return;
    p.g.classList.toggle('lit', !!v); svg.classList.toggle('has-lit', !!v);
    F.streams.forEach(function (s) { if (s.owner === p.idx) { s.hot = v; if (!F.run) s.h = v; } });
    if (!F.run) drawFlow();
  }

  /* ============ start, stop, fail ============ */
  var dead = false, logged = false, io = null, rsT = 0;
  /* run a handler only while the scene is alive; any error removes the scene */
  function guard(fn) { return function () { if (dead) return; try { fn.apply(this, arguments); } catch (e) { fail(e); } }; }
  function fail(e) {
    if (!logged) { logged = true; console.error(e); }
    teardown();
  }
  /* back to the server-rendered hero: no canvases, no lp-scene-on, no inline layout */
  function teardown() {
    dead = true;
    stopLoop();
    if (bgRaf) cancelAnimationFrame(bgRaf);
    bgRaf = 0; clearTimeout(rsT);
    if (io) io.disconnect();
    root.classList.remove('lp-scene-on');
    hero.classList.remove('lp-arc', 'lp-compact');
    scene.textContent = ''; scene.removeAttribute('style'); scene.classList.remove('drawn');
    [bgCv, moreNote].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    if (zt) zt.removeAttribute('style');
    if (label) label.removeAttribute('style');
    if (ul) ul.classList.remove('drawn');
    PROJ.forEach(function (p) {
      p.li.removeAttribute('style'); p.li.classList.remove('lp-off');
      if (p.card.parentNode) p.card.parentNode.removeChild(p.card);
    });
  }
  /* the projects from #lp-data that have a link in the hero, in data order. Each link's eyebrow and title go into one
     .lp-tag (display: contents until the scene is on) so they can sit under the drawing as one label. */
  function readProjects() {
    var data = JSON.parse(dataEl.textContent), list = data.projects || [], lis = {};
    if (ul) Array.prototype.forEach.call(ul.children, function (li) { if (li.dataset.slug) lis[li.dataset.slug] = li; });
    total = list.length;
    return list.filter(function (p) { return lis[p.slug] && lis[p.slug].querySelector('.lp-proj'); }).map(function (p, j) {
      var li = lis[p.slug], a = li.querySelector('.lp-proj'), tag = a.querySelector('.lp-tag'), shape = SLUG_SHAPE[p.slug] || 'generic';
      if (!tag) {
        tag = document.createElement('span'); tag.className = 'lp-tag';
        ['.lp-proj-e', '.lp-proj-t'].forEach(function (s) { var n = a.querySelector(s); if (n) tag.appendChild(n); });
        a.appendChild(tag);
      }
      /* the phone card's drawing (the mockup's card constellation); the server's static glyph is hidden while the scene is on */
      var card = el('svg', { viewBox: '-8 -8 116 116', 'class': 'lp-cst-card', 'aria-hidden': 'true', focusable: 'false' });
      constellation(card, SHAPES[shape], 0, 0, 1, { k: .8, base: 300 + j * 140, dur: 900 });
      a.insertBefore(card, tag);
      return { key: p.slug, shape: shape, li: li, a: a, tag: tag, card: card, idx: -1, g: null };
    });
  }
  function markDrawn(t) {
    if (t === scene) { if (!t0Sky) { t0Sky = performance.now(); scene.classList.add('drawn'); } }
    else t.classList.add('drawn');
  }
  function init() {
    try {
      PROJ = readProjects();
      makeSprites();
      flowCv = document.createElement('canvas'); flowCv.className = 'lp-flow'; flowCv.setAttribute('aria-hidden', 'true');
      cx2 = ctx2d(flowCv);
      bgCv = document.createElement('canvas'); bgCv.className = 'lp-bg'; bgCv.setAttribute('aria-hidden', 'true');
      bgCtx = ctx2d(bgCv);
      svg = el('svg', { 'class': 'lp-sky', 'aria-hidden': 'true', focusable: 'false' });
      moreNote = document.createElement('p'); moreNote.className = 'lp-more-note'; moreNote.hidden = true;
      moreN = document.createElement('a'); moreN.className = 'lp-more-below'; moreN.href = '#work';
      moreNote.appendChild(moreN);
      /* everything below runs in this one task, so nothing is painted until the scene is laid out and drawn */
      scene.appendChild(flowCv); scene.appendChild(svg);
      document.body.insertBefore(bgCv, document.getElementById('main') || document.body.firstChild);
      (ul || zt).parentNode.insertBefore(moreNote, (ul || zt).nextSibling);
      root.classList.add('lp-scene-on');
      buildSky();
      sizeBg();
      setPaused(paused);
      if (!paused) paintBg(0, true);
    } catch (e) { fail(e); return; }

    PROJ.forEach(function (p) {
      var on = guard(function () { setLit(p, 1); }), off = guard(function () { setLit(p, 0); });
      p.a.addEventListener('mouseenter', on); p.a.addEventListener('mouseleave', off);
      p.a.addEventListener('focus', on); p.a.addEventListener('blur', off);
    });
    /* draw the constellations in when they come into view; run the loop only while the hero is in view */
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(guard(function (entries) {
        entries.forEach(function (en) {
          if (en.target === hero) { F.inView = en.isIntersecting; if (F.inView) startLoop(); else { stopLoop(); bgStill(); } }
          else if (en.isIntersecting && en.intersectionRatio >= .1) { markDrawn(en.target); io.unobserve(en.target); }
        });
      }), { threshold: [0, .1] });
      io.observe(hero);
    }
    [scene, ul].forEach(function (t) { if (t) { if (io && !paused) io.observe(t); else markDrawn(t); } });
    document.addEventListener('visibilitychange', guard(function () { if (document.hidden) stopLoop(); else startLoop(); }));
    window.addEventListener('scroll', function () { bgStill(); }, { passive: true });
    /* re-layout on resize (debounced), with the loop stopped while the stage is rebuilt */
    window.addEventListener('resize', function () {
      if (dead) return;
      clearTimeout(rsT);
      rsT = setTimeout(guard(function () {
        stopLoop();
        sizeBg();
        if (Math.round(scene.clientWidth) !== lastW) buildSky();
        if (paused) drawFlow();
        paintBg(0, true);
        startLoop();
      }), 150);
    });
    var onMotion = guard(function (e) { setPaused(e.matches); });
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotion); else reduceMQ.addListener(onMotion);
  }

  /* ============ test hooks ============ */
  window.HeroScene = {
    state: function () {
      var top = scene ? scene.getBoundingClientRect().top + window.scrollY : 0;
      return { running: F.run, loops: loops, shown: dead ? 0 : shown, total: total, comets: F.comets,
        diskBottom: F.core ? top + F.core.y + F.diskBot : 0, failed: dead, layoutWidth: lastW };
    },
    cometNow: function () { if (!dead && !paused && F.streams.length) { spawnComet(); F.nextC = 8 + Math.random() * 4; } },
    speedAt: accel
  };

  /* ============ start after the page has loaded and painted, never blocking the text ============ */
  if (!hero || !scene || !dataEl || !zt || !reduceMQ) return;
  function boot() {
    requestAnimationFrame(function () {
      setTimeout(function () {
        var once = false, go = function () { if (!once) { once = true; init(); } };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go); else go();
      }, 0);
    });
  }
  if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
})();
