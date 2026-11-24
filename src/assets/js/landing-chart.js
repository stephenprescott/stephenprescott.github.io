/* The landing page's star chart, proof panel and work accordion. Ported from the approved mockup
   (round-11/full-page.html). Reads #lp-data ({ areas, figures, projects }) and enhances the
   server-rendered lists in #expertise and #work. Everything that can fail runs on detached nodes before the
   page changes, so on any error (logged) the no-JavaScript lists stay. Exposes window.LandingChart = { select, open }. */
(function () {
  'use strict';
  var dataEl = document.getElementById('lp-data');
  var expertise = document.getElementById('expertise');
  var work = document.getElementById('work');
  if (!dataEl) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var two = function (n) { return (n < 10 ? '0' : '') + n; };
  var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
  var ARROW = '<span class="arr" aria-hidden="true">→</span>';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LIMIT = 6;
  var phoneMQ = window.matchMedia('(max-width: 760px)');
  var reduced = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var bring = function (el, block) { el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: block || 'start' }); };

  /* ============ data ============ */
  var AREAS, ITEMS, BYID = {};
  try {
    var D = JSON.parse(dataEl.textContent);
    AREAS = D.areas.map(function (a) { return { id: String(a.id), t: a.title, b: a.body }; });
    var AIDX = {};
    AREAS.forEach(function (a, i) { AIDX[a.id] = i; });
    var idx = function (ids) { return (ids || []).map(function (id) { return AIDX[id]; }).filter(function (i) { return i !== undefined; }); };
    ITEMS = D.projects.map(function (p) {
      return { id: String(p.slug), kind: 'case', t: p.shortTitle || p.title, sub: p.subtitle || '', eyebrow: p.eyebrow || '', status: p.status || '',
        sum: p.summary || '', problem: p.problem || '', approach: p.approach || '', result: p.result || '', href: p.href || '', areas: idx(p.proves) };
    }).concat(D.figures.map(function (f) {
      return { id: String(f.id), kind: 'fig', t: f.value + f.suffix + ' ' + f.label, n: f.value, suf: f.suffix, label: f.label, body: f.body, href: '/resume/', areas: idx(f.proves) };
    }));
    ITEMS.forEach(function (it) { BYID[it.id] = it; });
  } catch (e) { console.error(e); return; }
  var PROJECTS = ITEMS.filter(function (it) { return it.kind === 'case'; });

  function itemsFor(a) { return ITEMS.filter(function (it) { return it.areas.indexOf(a) > -1; }); }
  function kindLabel(it) { return it.kind === 'fig' ? 'Figure' : 'Case study'; }
  function kindCls(it) { return it.kind === 'fig' ? 'k-fig' : it.status ? 'k-wip' : 'k-case'; }
  function proves(it) { return it.areas.length ? 'Proves ' + plural(it.areas.length, 'area') : ''; }

  /* ============ chart geometry, in a 780 × 400 space ============ */
  var W = 780, H = 400;
  var NODE = AREAS.map(function (_, i) {
    var x = AREAS.length > 1 ? 75 + i * 630 / (AREAS.length - 1) : 390;
    return { x: x, y: 300 + 30 * Math.pow((x - 390) / 315, 2) };
  });
  /* deterministic random: the same positions on every load */
  function rng(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /* every star gets a fixed place near the areas it proves; earlier stars never move when later ones are added */
  var POS = {};
  (function place() {
    var MIN = 36, X0 = 30, X1 = 750, Y0 = 30, Y1 = 236, placed = [];
    function free(x, y) {
      if (x < X0 || x > X1 || y < Y0 || y > Y1) return false;
      for (var i = 0; i < placed.length; i++) { var dx = placed[i].x - x, dy = placed[i].y - y; if (dx * dx + dy * dy < MIN * MIN) return false; }
      return true;
    }
    ITEMS.forEach(function (it, n) {
      var r = rng(97 + n * 131), k = it.areas.length, tx, ty;
      if (!k) { tx = 742; ty = 40; }
      else {
        tx = it.areas.reduce(function (s, a) { return s + NODE[a].x; }, 0) / k + (r() - 0.5) * 84;
        ty = (k === 1 ? 186 : k === 2 ? 122 : 70) + (r() - 0.5) * 84;
      }
      tx = Math.max(X0, Math.min(X1, tx)); ty = Math.max(Y0, Math.min(Y1, ty));
      var off = r() * 6.283;
      for (var rad = 0; rad < 420; rad += 7) {
        var steps = rad ? 14 : 1;
        for (var s = 0; s < steps; s++) {
          var an = off + s / steps * 6.283, x = tx + Math.cos(an) * rad, y = ty + Math.sin(an) * rad * 0.8;
          if (free(x, y)) { var p = { x: Math.round(x), y: Math.round(y) }; placed.push(p); POS[it.id] = p; return; }
        }
      }
      POS[it.id] = { x: tx, y: ty };
    });
  })();

  /* ============ state and the current view's elements ============ */
  var curArea = 0, curItem = null, panelAll = false, xAll = {};
  var V = {};

  function setState() {
    if (!live) return;
    expertise.setAttribute('data-selected', AREAS[curArea].id);
    if (curItem) expertise.setAttribute('data-open', curItem); else expertise.removeAttribute('data-open');
  }

  /* ============ desktop: the chart, panel and caption ============ */
  function buildDesktop() {
    var wip = PROJECTS.some(function (p) { return p.status; });
    var nodeW = Math.min(15.6, 100 / (AREAS.length + 0.4));
    var order = ITEMS.slice().sort(function (a, b) { return POS[a.id].x - POS[b.id].x; });
    var main = document.createElement('div');
    main.innerHTML =
      '<div class="lp-starchart">' +
        '<svg class="lp-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
          '<path class="lp-arc" d="M20 341.4 Q390 258.6 760 341.4"/><g class="lp-lines"></g><g class="lp-lines-hover"></g></svg>' +
        '<div class="lp-dots" role="group" aria-label="' + two(ITEMS.length) + ' stars">' + order.map(function (it, i) {
          var p = POS[it.id];
          return '<button class="lp-dot ' + kindCls(it) + '" type="button" data-id="' + esc(it.id) + '" tabindex="' + (i ? -1 : 0) + '" style="left:' + (p.x / W * 100) + '%;top:' + (p.y / H * 100) + '%" aria-label="' +
            esc([it.t, kindLabel(it), it.status, proves(it)].filter(Boolean).join(', ')) + '"><i aria-hidden="true"></i></button>';
        }).join('') + '</div>' +
        '<div class="lp-nodes" role="group" aria-label="' + plural(AREAS.length, 'area') + '">' + AREAS.map(function (a, i) {
          var n = itemsFor(i).length;
          return '<button class="lp-node" type="button" data-area="' + esc(a.id) + '" aria-pressed="false" style="left:' + (NODE[i].x / W * 100) + '%;top:' + (NODE[i].y / H * 100) + '%;width:' + nodeW + '%">' +
            '<span class="nd" aria-hidden="true"></span><span class="nl">' + esc(a.t) + '</span>' + (n ? '<span class="nc">' + plural(n, 'star') + '</span>' : '') + '</button>';
        }).join('') + '</div>' +
        '<div class="lp-tip" aria-hidden="true"></div>' +
      '</div>' +
      '<p class="lp-legend" aria-hidden="true"><span class="keys"><span><i class="mk"></i>Case study</span><span><i class="mk k-fig"></i>Figure</span>' +
        (wip ? '<span><i class="mk k-wip"></i>In progress</span>' : '') + '</span>' +
        '<span class="lp-count"><b>' + two(ITEMS.length) + '</b> stars · ' + plural(AREAS.length, 'area') + '</span></p>' +
      '<div class="lp-cap"></div>';
    var panel = document.createElement('div');
    panel.className = 'lp-panel';
    panel.setAttribute('aria-live', 'polite');
    return { main: main, panel: panel, chart: $('.lp-starchart', main), lines: $('.lp-lines', main), linesHover: $('.lp-lines-hover', main),
      dots: $('.lp-dots', main), nodes: $('.lp-nodes', main), tip: $('.lp-tip', main), cap: $('.lp-cap', main) };
  }

  function line(group, a, id, cls) {
    var n = NODE[a], p = POS[id], path = document.createElementNS(SVGNS, 'path');
    var cx = n.x + (p.x - n.x) * 0.18, cy = p.y + (n.y - p.y) * 0.42;
    path.setAttribute('d', 'M' + n.x + ' ' + (n.y - 7) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + p.x + ' ' + (p.y + 6));
    path.setAttribute('pathLength', '1');
    path.setAttribute('class', 'lp-line' + (cls ? ' ' + cls : ''));
    group.appendChild(path);
  }
  function dotOf(id) { return $$('.lp-dot', V.dots).filter(function (d) { return d.dataset.id === id; })[0]; }
  function swap(el) { if (reduced()) return; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }

  function paintDesktop() {
    var it = curItem ? BYID[curItem] : null;
    V.lines.textContent = ''; V.linesHover.textContent = '';
    V.chart.classList.add('tracing');
    V.chart.classList.toggle('item', !!it);
    $$('.lp-node', V.nodes).forEach(function (b, i) {
      b.setAttribute('aria-pressed', String(!it && i === curArea));
      b.classList.toggle('lit', !!it && it.areas.indexOf(i) > -1);
    });
    $$('.lp-dot', V.dots).forEach(function (d) {
      var x = BYID[d.dataset.id];
      d.classList.toggle('on', !!it && x === it);
      d.classList.toggle('lit', !it && x.areas.indexOf(curArea) > -1);
    });
    if (it) it.areas.forEach(function (a) { line(V.lines, a, it.id, 'rev'); });
    else itemsFor(curArea).forEach(function (x) { line(V.lines, curArea, x.id); });
    renderPanel(); renderCap();
  }

  function row(it) {
    return '<li><button class="lp-pr ' + kindCls(it) + '" type="button" data-id="' + esc(it.id) + '"><i class="mk ' + kindCls(it) + '" aria-hidden="true"></i><span>' + esc(it.t) + '</span><small>' +
      esc(it.status || kindLabel(it)) + '</small>' + ARROW + '</button></li>';
  }
  function areaRows(it) {
    if (!it.areas.length) return '';
    return '<p class="lp-pp-h">' + proves(it) + '</p><ol class="lp-pp-list">' + it.areas.map(function (a) {
      return '<li><button class="lp-pr" type="button" data-to-area="' + a + '"><i class="mk k-area" aria-hidden="true"></i><span>' + esc(AREAS[a].t) + '</span><small>' + two(a + 1) + '</small>' + ARROW + '</button></li>';
    }).join('') + '</ol>';
  }
  function renderPanel() {
    var it = curItem ? BYID[curItem] : null, h = '';
    if (!it) {
      var its = itemsFor(curArea), shown = panelAll ? its : its.slice(0, LIMIT);
      V.panel.hidden = !its.length;
      if (its.length) {
        h += '<p class="lp-pp-k">Proof · <b>' + two(its.length) + '</b></p><h3 class="lp-pp-t">' + esc(AREAS[curArea].t) + '</h3>' +
          '<ol class="lp-pp-list">' + shown.map(row).join('') + '</ol>';
        if (shown.length < its.length) h += '<button class="lp-more" type="button" data-more>Show all <b>' + its.length + '</b></button>';
      }
    } else {
      V.panel.hidden = false;
      h += '<button class="lp-back" type="button" data-back><span aria-hidden="true">←</span> ' + esc(AREAS[curArea].t) + '</button>';
      if (it.kind === 'case') {
        h += '<p class="lp-pp-k"><span>' + esc(['Case study', it.eyebrow].filter(Boolean).join(' · ')) + '</span>' + (it.status ? '<span class="lp-status"><i aria-hidden="true"></i>' + esc(it.status) + '</span>' : '') + '</p>' +
          '<h3 class="lp-pp-t">' + esc(it.t) + (it.sub ? '<span class="sub">: ' + esc(it.sub) + '</span>' : '') + '</h3>' + (it.sum ? '<p class="lp-pp-s">' + esc(it.sum) + '</p>' : '') +
          areaRows(it) + (it.href ? '<a class="lp-tlink" href="' + esc(it.href) + '">Read the case study<span class="sr">: ' + esc(it.t) + '</span> ' + ARROW + '</a>' : '');
      } else {
        h += '<p class="lp-pp-k"><span>Figure</span></p><h3 class="lp-pp-t"><span class="lp-pp-fig">' + esc(it.n) + '<small>' + esc(it.suf) + '</small></span>' + esc(it.label) + '</h3><p class="lp-pp-s">' + esc(it.body) + '</p>' +
          areaRows(it) + '<a class="lp-tlink" href="/resume/">See the résumé ' + ARROW + '</a>';
      }
    }
    V.panel.innerHTML = h ? '<div class="lp-pp-in">' + h + '</div>' : '';
    swap(V.panel);
  }
  function renderCap() {
    var key = AREAS[curArea].id;
    if (V.cap.dataset.area === key) return;
    V.cap.dataset.area = key;
    V.cap.innerHTML = '<p class="lp-cap-k"><b>' + two(curArea + 1) + '</b>' + esc(AREAS[curArea].t) + '</p><p class="lp-cap-b">' + esc(AREAS[curArea].b) + '</p>' +
      '<a class="lp-tlink" href="/resume/">See the résumé ' + ARROW + '</a>';
    swap(V.cap);
  }

  /* stars: hover or focus names the star and shows which areas it proves */
  function peek(d) {
    var it = BYID[d.dataset.id], p = POS[it.id];
    V.tip.innerHTML = esc(it.t) + '<small>' + esc([kindLabel(it), it.status].filter(Boolean).join(' · ')) + '</small>';
    V.tip.style.left = (p.x / W * 100) + '%'; V.tip.style.top = (p.y / H * 100) + '%';
    V.tip.className = 'lp-tip show' + (p.x < 130 ? ' l' : p.x > W - 130 ? ' r' : '') + (p.y < 70 ? ' below' : '');
    V.linesHover.textContent = '';
    if (it.id !== curItem) it.areas.forEach(function (a) { if (curItem || a !== curArea) line(V.linesHover, a, it.id, 'soft'); });
    if (!curItem) $$('.lp-node', V.nodes).forEach(function (b, i) { b.classList.toggle('lit', it.areas.indexOf(i) > -1 && i !== curArea); });
  }
  function unpeek() {
    if (!V.tip) return;
    V.tip.classList.remove('show'); V.linesHover.textContent = '';
    if (!curItem) $$('.lp-node.lit', V.nodes).forEach(function (b) { b.classList.remove('lit'); });
  }

  /* ============ accordion rows (the work list, and the areas on phones) ============ */
  function accItem(rawId, head, body, attrs) {
    var id = esc(rawId);
    return '<li class="lp-item" id="' + id + '"' + (attrs || '') + '><h3 class="lp-item-h"><button class="lp-trig" type="button" id="' + id + '-b" aria-expanded="false" aria-controls="' + id + '-p">' + head +
      '<span class="lp-ico" aria-hidden="true"></span></button></h3><div class="lp-acc-body" id="' + id + '-p" role="region" aria-labelledby="' + id + '-b"><div class="lp-acc-in"><div class="lp-acc-c">' + body + '</div></div></div></li>';
  }
  function setOpen(li, open) {
    li.classList.toggle('open', open);
    var b = $('.lp-trig', li); if (b) b.setAttribute('aria-expanded', String(open));
  }
  function toggle(li, force) {
    var open = force === undefined ? !li.classList.contains('open') : force;
    $$('.lp-item.open', li.parentNode).forEach(function (o) { if (o !== li) setOpen(o, false); });
    setOpen(li, open);
  }
  function accKeys(list, e) {
    var t = e.target.closest('.lp-trig'); if (!t) return;
    var all = $$('.lp-trig', list).filter(function (b) { return !b.closest('[hidden]'); }), i = all.indexOf(t), j = -1;
    if (e.key === 'ArrowDown') j = Math.min(all.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = all.length - 1;
    if (j > -1) { e.preventDefault(); all[j].focus(); }
  }
  function moreButton(n) { return '<button class="lp-more" type="button">Show all <b>' + n + '</b></button>'; }
  function showAll(list, more) {
    var hidden = $$(':scope > li[hidden]', list), first = hidden[0];
    hidden.forEach(function (li) { li.hidden = false; });
    more.remove();
    var f = first && $('.lp-trig, .lp-pr', first); if (f) f.focus();
  }

  /* ============ phones: each area lists its own proof in place ============ */
  function xRows(a) {
    var its = itemsFor(a);
    if (!its.length) return '';
    return '<ol class="lp-pp-list">' + its.map(function (it, i) {
      var inner = '<i class="mk ' + kindCls(it) + '" aria-hidden="true"></i><span>' + esc(it.t) + '</span><small>' + esc(it.status || kindLabel(it)) + '</small>';
      return '<li' + (!xAll[a] && i >= LIMIT ? ' hidden' : '') + '>' + (it.href ? '<a class="lp-pr" href="' + esc(it.href) + '">' + inner + ARROW + '</a>' : '<span class="lp-pr">' + inner + '<span></span></span>') + '</li>';
    }).join('') + '</ol>' + (!xAll[a] && its.length > LIMIT ? moreButton(its.length) : '');
  }
  function buildPhone() {
    var list = document.createElement('ul');
    list.className = 'lp-acc lp-xacc';
    list.innerHTML = AREAS.map(function (a, i) {
      var n = itemsFor(i).length;
      return accItem('lp-x-' + a.id, '<span class="no">' + two(i + 1) + '</span><span class="hd"><span class="ttl">' + esc(a.t) + '</span>' + (n ? '<span class="lp-meta"><span>Proof · ' + two(n) + '</span></span>' : '') + '</span>',
        '<p class="lp-body">' + esc(a.b) + '</p><div data-xrows="' + i + '">' + xRows(i) + '</div>', ' data-area="' + esc(a.id) + '"');
    }).join('');
    return { xacc: list };
  }
  function paintPhone() {
    var li = V.xacc.children[curArea];
    if (li && !li.classList.contains('open')) toggle(li, true);
  }

  /* ============ the work list: six rows, then "Show all N" ============ */
  function buildWork() {
    var list = document.createElement('ol');
    list.className = 'lp-work lp-acc';
    list.innerHTML = PROJECTS.map(function (it, i) {
      var head = '<span class="no">' + two(i + 1) + '</span><span class="hd"><span class="ttl">' + esc(it.t) + (it.sub ? '<span class="sub">: ' + esc(it.sub) + '</span>' : '') + '</span>' +
        '<span class="lp-meta">' + (it.eyebrow ? '<span>' + esc(it.eyebrow) + '</span>' : '') + (it.status ? '<span class="lp-status"><i aria-hidden="true"></i>' + esc(it.status) + '</span>' : '') +
        (it.areas.length ? '<span class="lp-proves"><i class="mk k-area" aria-hidden="true"></i>' + proves(it) + '</span>' : '') + '</span></span>';
      var psr = [['Problem', it.problem], ['Approach', it.approach], ['Result', it.result]].filter(function (x) { return x[1]; });
      var body = (it.sum ? '<p class="lp-sum">' + esc(it.sum) + '</p>' : '') +
        (psr.length ? '<dl class="lp-psr">' + psr.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' : '') +
        (it.areas.length ? '<p class="lp-proves-row"><span class="pv-k">' + proves(it) + '</span>' + it.areas.map(function (a) {
          return '<button class="lp-chip" type="button" data-to-area="' + a + '"><i class="mk k-area" aria-hidden="true"></i>' + esc(AREAS[a].t) + '</button>'; }).join('') + '</p>' : '') +
        (it.href ? '<a class="lp-tlink" href="' + esc(it.href) + '">Read the case study<span class="sr">: ' + esc(it.t) + '</span> ' + ARROW + '</a>' : '');
      return accItem('lp-w-' + it.id, head, body, ' data-slug="' + esc(it.id) + '"');
    }).join('');
    $$(':scope > li', list).forEach(function (li, i) { li.hidden = i >= LIMIT; });
    var frag = document.createDocumentFragment();
    frag.appendChild(list);
    if (PROJECTS.length > LIMIT) { var m = document.createElement('div'); m.innerHTML = moreButton(PROJECTS.length); frag.appendChild(m.firstChild); }
    return frag;
  }

  /* ============ selection ============ */
  function paint() { setState(); if (V.xacc) paintPhone(); else if (V.panel) paintDesktop(); }
  function selectArea(i) {
    if (i === undefined || i < 0 || i >= AREAS.length) return;
    if (!curItem && i === curArea) return;
    curArea = i; curItem = null; panelAll = false; paint();
  }
  function openItem(id) {
    var it = BYID[id]; if (!it) return;
    if (it.areas.length && it.areas.indexOf(curArea) < 0) curArea = it.areas[0];
    curItem = id; paint();
  }
  /* a "Proves" chip or the hero jumps to an area: the chart on desktop, its accordion on phones */
  function goArea(a) {
    selectArea(a);
    if (V.xacc) { var li = V.xacc.children[a]; if (li) { toggle(li, true); bring(li); } }
    else bring(expertise);
  }

  /* a figure (or the hero) finds its star: opened in the chart, or its first area's accordion on phones */
  function findItem(id) {
    var it = BYID[id]; if (!it) return;
    if (!V.xacc) { openItem(id); bring(V.chart, 'center'); }
    else if (it.areas.length) goArea(it.areas[0]);
    else bring(expertise);
  }

  /* ============ build the current view detached and paint it; mount() then swaps it in ============ */
  function build() {
    var view = phoneMQ.matches ? buildPhone() : buildDesktop(), prev = V;
    V = view;
    try { paint(); } catch (e) { V = prev; throw e; }
    return view;
  }
  function mount(view) {
    var head = $('.lp-mod-h', expertise), body = $('.lp-mod-b', expertise), mod = $('.lp-mod', expertise);
    $$('.lp-panel', expertise).forEach(function (p) { p.remove(); });
    body.textContent = '';
    if (view.xacc) { mod.classList.remove('lp-sc'); body.appendChild(view.xacc); }
    else {
      mod.classList.add('lp-sc');
      head.after(view.panel);
      while (view.main.firstChild) body.appendChild(view.main.firstChild);
    }
    setState();
  }

  /* every handler stays inert until the page has been enhanced (live), so a failed init leaves the
     server-rendered lists and the figures' plain links working */
  var live = false;
  function on(target, type, fn, capture) { target.addEventListener(type, function (e) { if (live) fn(e); }, !!capture); }

  function wire() {
    var hoverT, hoverNode = null, prevPt = null, curPt = null;
    /* hover selects an area only after a real mouse movement over it: scrolling a node under a resting
       pointer fires boundary events (and may fire a pointermove at the same spot), never a change here */
    on(document, 'pointermove', function (e) { prevPt = curPt; curPt = { x: e.clientX, y: e.clientY }; }, true);
    on(expertise, 'pointermove', function (e) {
      if (e.pointerType !== 'mouse' || !V.nodes) return;
      if (prevPt && prevPt.x === e.clientX && prevPt.y === e.clientY) return;
      var b = e.target.closest('.lp-node');
      if (b === hoverNode) return;
      hoverNode = b; clearTimeout(hoverT);
      if (b) hoverT = setTimeout(function () { selectArea(AREAS.findIndex(function (a) { return a.id === b.dataset.area; })); }, 110);
    });
    /* a panel row marks its star while hovered or focused */
    function rowMark(e, on) { var r = e.target.closest('.lp-panel .lp-pr[data-id]'), d = r && dotOf(r.dataset.id); if (d) d.classList.toggle('hov', on); }
    on(expertise, 'pointerout', function (e) {
      var b = e.target.closest('.lp-node'); if (b && !b.contains(e.relatedTarget)) { hoverNode = null; clearTimeout(hoverT); }
      if (e.target.closest('.lp-dot')) unpeek();
      rowMark(e, false);
    });
    on(expertise, 'pointerover', function (e) {
      var d = e.target.closest('.lp-dot'); if (d && e.pointerType !== 'touch') peek(d);
      rowMark(e, true);
    });
    on(expertise, 'focusin', function (e) {
      var b = e.target.closest('.lp-node');
      if (b && b.matches(':focus-visible')) selectArea(AREAS.findIndex(function (a) { return a.id === b.dataset.area; }));
      var d = e.target.closest('.lp-dot');
      if (d) { $$('.lp-dot', V.dots).forEach(function (x) { x.tabIndex = x === d ? 0 : -1; }); peek(d); }
      rowMark(e, true);
    });
    on(expertise, 'focusout', function (e) {
      if (e.target.closest('.lp-dot')) unpeek();
      rowMark(e, false);
    });
    on(expertise, 'click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('.lp-node'))) { clearTimeout(hoverT); selectArea(AREAS.findIndex(function (a) { return a.id === b.dataset.area; })); return; }
      if ((b = t.closest('.lp-dot'))) { openItem(b.dataset.id); unpeek(); return; }
      if ((b = t.closest('.lp-xacc .lp-trig'))) { var li = b.closest('.lp-item'); toggle(li); if (li.classList.contains('open')) { curArea = Array.prototype.indexOf.call(V.xacc.children, li); curItem = null; setState(); } return; }
      if ((b = t.closest('.lp-xacc .lp-more'))) { var a = +b.previousElementSibling.closest('[data-xrows]').dataset.xrows; xAll[a] = true; showAll(b.previousElementSibling, b); return; }
      if (!(b = t.closest('.lp-panel button'))) return;
      if (b.hasAttribute('data-more')) { panelAll = true; var n = $$('.lp-pp-list li', V.panel).length; renderPanel(); var f = $$('.lp-pp-list .lp-pr', V.panel)[n]; if (f) f.focus(); return; }
      if (b.hasAttribute('data-back')) { var was = curItem; curItem = null; paint(); var r = $$('.lp-pr[data-id]', V.panel).filter(function (x) { return x.dataset.id === was; })[0] || $('.lp-pr', V.panel); if (r) r.focus(); return; }
      if (b.dataset.toArea) { selectArea(+b.dataset.toArea); var p = $('.lp-pr', V.panel); if (p) p.focus(); return; }
      if (b.dataset.id) { openItem(b.dataset.id); var bk = $('[data-back]', V.panel); if (bk) bk.focus(); }
    });
    on(expertise, 'keydown', function (e) {
      var t = e.target, b;
      if ((b = t.closest('.lp-node'))) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
        e.preventDefault();
        var all = $$('.lp-node', V.nodes), j = (all.indexOf(b) + d + all.length) % all.length;
        selectArea(j); all[j].focus();
      } else if ((b = t.closest('.lp-dot'))) {
        var dots = $$('.lp-dot', V.dots), i = dots.indexOf(b), k = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') k = (i + 1) % dots.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') k = (i - 1 + dots.length) % dots.length;
        else if (e.key === 'Home') k = 0;
        else if (e.key === 'End') k = dots.length - 1;
        else if (e.key === 'Escape' && curItem) { curItem = null; paint(); return; }
        if (k > -1) { e.preventDefault(); dots[k].focus(); }
      } else if (t.closest('.lp-panel') && e.key === 'Escape' && curItem) {
        var was = curItem; curItem = null; paint();
        var r = $$('.lp-pr[data-id]', V.panel).filter(function (x) { return x.dataset.id === was; })[0]; if (r) r.focus();
      } else if (V.xacc) accKeys(V.xacc, e);
    });

    on(work, 'click', function (e) {
      var b;
      if ((b = e.target.closest('.lp-trig'))) { toggle(b.closest('.lp-item')); return; }
      if ((b = e.target.closest('.lp-chip'))) { goArea(+b.dataset.toArea); return; }
      if ((b = e.target.closest('.lp-more'))) showAll($('ol.lp-work', work), b);
    });
    on(work, 'keydown', function (e) { var l = $('ol.lp-work', work); if (l) accKeys(l, e); });

    /* a figure finds its star */
    $$('#results [data-fig]').forEach(function (s) {
      on(s, 'click', function (e) { if (BYID[s.dataset.fig]) { e.preventDefault(); findItem(s.dataset.fig); } });
    });

    /* crossing the phone breakpoint rebuilds the other view (addListener: Safari before 14) */
    var onMQ = function () { if (!live) return; try { mount(build()); } catch (e) { console.error(e); } };
    if (phoneMQ.addEventListener) phoneMQ.addEventListener('change', onMQ); else phoneMQ.addListener(onMQ);
  }

  /* Everything that can fail runs first, on detached nodes; the page itself changes only at the end */
  try {
    if (!expertise || !work || !AREAS.length) return;
    var list = buildWork(), view = build();
    wire();
    mount(view);
    $('ol.lp-work', work).replaceWith(list);
    $$('#results [data-fig]').forEach(function (s) {
      var go = document.createElement('span');
      go.className = 'lp-go'; go.setAttribute('aria-hidden', 'true'); go.innerHTML = ARROW;
      s.appendChild(go);
    });
    live = true;
    setState();
  } catch (e) { console.error(e); return; }

  window.LandingChart = {
    select: function (areaId) { var i = AREAS.findIndex(function (a) { return a.id === areaId; }); if (i > -1) goArea(i); },
    open: findItem
  };
})();
