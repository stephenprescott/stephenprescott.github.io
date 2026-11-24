// The hero scene (src/assets/js/hero-scene.js) in a real browser: the black hole, sparkle streams, comet,
// the constellations on the arc and the page's starfield. Headless Chromium has no GPU, so the scene runs
// slowly here: these tests check state, positions and pixel change over time, never frame rate.
// Fixture tests swap #lp-data and add the matching server-rendered project links before the script runs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';
import { withData } from './helpers/lp-data.mjs';

let out;
let server;
let browser;
before(async () => {
  out = await build();
  server = await serve(out);
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await server.close();
});

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// Open / in a fresh context; collects page errors and console errors. `setup(page)` runs before
// navigation; `ready` waits for the scene to switch on (false: for tests where it must not).
async function withPage(opts, fn) {
  const { setup, ready = true, ...ctxOpts } = opts;
  const ctx = await browser.newContext({ viewport: DESK, ...ctxOpts });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    if (setup) await setup(page);
    await page.goto(server.url + '/');
    if (ready) await sceneOn(page);
    await fn(page, errors);
  } finally {
    await ctx.close();
  }
}
const sceneOn = (page) => page.waitForFunction(() => document.documentElement.classList.contains('lp-scene-on') && window.HeroScene, null, { timeout: 30000 });
const state = (page) => page.evaluate(() => window.HeroScene.state());
// the part of the stage inside the viewport (no scrolling, so the fixed starfield stays put between shots)
const shot = async (page) => {
  const b = await page.locator('#lp-scene').boundingBox();
  const vp = page.viewportSize();
  const y = Math.max(0, b.y);
  return page.screenshot({ clip: { x: b.x, y, width: b.width, height: Math.min(b.y + b.height, vp.height) - y }, animations: 'disabled' });
};

// n extra projects (slugs fixture-06 …), in #lp-data and as server-rendered links in the hero.
const fixtureLi = (p) => `<li data-slug="${p.slug}"><a class="lp-proj" href="${p.href}"><svg class="lp-glyph lp-glyph-generic" viewBox="-8 -8 116 116" aria-hidden="true" focusable="false"></svg><span class="lp-proj-t">${p.shortTitle}<i aria-hidden="true"> →</i></span></a></li>`;
const withExtra = (n, title) => withData(server.url, (d) => {
  const extra = Array.from({ length: n }, (_, i) => {
    const no = String(i + 6).padStart(2, '0');
    const t = title || `Fixture project ${no}`;
    return { slug: `fixture-${no}`, title: t, shortTitle: t, subtitle: '', eyebrow: 'Personal project · 2026', summary: `Summary ${no}.`, status: '', href: `/projects/fixture-${no}/`, proves: ['ai-tools-and-platforms'], problem: '', approach: '', result: '' };
  });
  return { ...d, projects: [...d.projects, ...extra] };
}, (html, data) => html.replace(/(<ul class="lp-projects">[\s\S]*?)(<\/ul>)/, (_, list, end) => list + data.projects.slice(5).map(fixtureLi).join('') + end));

const boxes = (page) => page.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  return {
    headline: r(document.querySelector('.lp-headline')),
    links: [...document.querySelectorAll('.lp-projects a')].filter((a) => a.getClientRects().length).map((a) => ({ slug: a.parentNode.dataset.slug, ...r(a) })),
  };
});
const hit = (A, B) => Math.min(A.r, B.r) > Math.max(A.l, B.l) && Math.min(A.b, B.b) > Math.max(A.t, B.t);
async function assertArcLayout(page, n) {
  const { headline, links } = await boxes(page);
  assert.equal(links.length, n, 'visible project links');
  for (const [i, a] of links.entries()) {
    assert.ok(a.w > 40 && a.h > 40, `${a.slug} has a box`);
    assert.equal(hit(a, headline), false, `${a.slug} clear of the headline`);
    for (const b of links.slice(i + 1)) assert.equal(hit(a, b), false, `${a.slug} clear of ${b.slug}`);
  }
  for (const a of await page.locator('.lp-projects a').all()) if (await a.evaluate((e) => e.getClientRects().length)) assert.ok(await a.isVisible());
}
const noSideScroll = async (page, w) => assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w, `no horizontal scroll at ${w}`);

test('the landing page loads hero-scene.js deferred', () => {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/assets\/js\/hero-scene\.js" defer><\/script>/);
});

test('1440: the scene runs, shows all five projects on the arc, and moves', async () => {
  await withPage({}, async (page, errors) => {
    await page.waitForTimeout(3000);
    const s = await state(page);
    assert.equal(s.running, true);
    assert.equal(s.shown, 5);
    assert.equal(s.total, 5);
    assert.equal(await page.locator('#lp-scene canvas').count() > 0, true);
    const a = await shot(page);
    await page.waitForTimeout(1000);
    const b = await shot(page);
    assert.equal(a.equals(b), false, 'pixels changed in 1s');
    await assertArcLayout(page, 5);
    assert.equal(await page.locator('a.lp-more-below').isVisible(), false, 'nothing left out');
    assert.deepEqual(errors, []);
  });
});

test('1440: the gap between the disk and the eyebrow is small (30–80px)', async () => {
  await withPage({}, async (page) => {
    const s = await state(page);
    const top = await page.evaluate(() => document.querySelector('.lp-eyebrow').getBoundingClientRect().top + window.scrollY);
    const gap = top - s.diskBottom;
    assert.ok(gap >= 30 && gap <= 80, `gap ${gap}`);
  });
});

test('sparkles accelerate: speed at the core is at least 8× the speed at the project', async () => {
  await withPage({}, async (page) => {
    const [v0, v1] = await page.evaluate(() => [window.HeroScene.speedAt(0), window.HeroScene.speedAt(1)]);
    assert.ok(v1 / v0 >= 8, `${v1} / ${v0}`);
  });
});

test('a comet launched now strikes the core within 6s', async () => {
  await withPage({}, async (page, errors) => {
    const before = (await state(page)).comets;
    await page.evaluate(() => window.HeroScene.cometNow());
    // >= : the scene's own timer may send another comet once this one has struck
    await page.waitForFunction((n) => window.HeroScene.state().comets >= n + 1, before, { timeout: 6000 });
    assert.deepEqual(errors, []);
  });
});

test('reduced motion: one complete still frame, no loop', async () => {
  await withPage({ reducedMotion: 'reduce' }, async (page) => {
    await page.waitForTimeout(500);
    const s = await state(page);
    assert.equal(s.running, false);
    assert.equal(s.loops, 0);
    const a = await shot(page);
    await page.waitForTimeout(1000);
    const b = await shot(page);
    assert.equal(a.equals(b), true, 'identical 1s apart');
    // the scene's canvas holds a picture (mean light over all pixels, 0–255)
    const mean = await page.evaluate(() => {
      const c = document.querySelector('#lp-scene canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3 * d[i + 3] / 255;
      return sum / (d.length / 4);
    });
    assert.ok(mean > 0.5, `mean ${mean}`);
    await assertArcLayout(page, 5);
  });
});

for (const n of [12, 24]) {
  test(`${n} projects: the arc shows what fits and "+N more below" links to the list; phones show at most 12 cards`, async () => {
    await withPage({ setup: withExtra(n - 5) }, async (page, errors) => {
      const s = await state(page);
      assert.equal(s.total, n);
      assert.ok(s.shown >= 1 && s.shown < s.total, `shown ${s.shown}`);
      const more = page.locator('a.lp-more-below');
      assert.equal(await more.getAttribute('href'), '#work');
      assert.equal((await more.textContent()).trim(), `+${s.total - s.shown} more below`);
      await assertArcLayout(page, s.shown);
      assert.deepEqual(errors, []);
    });
    await withPage({ setup: withExtra(n - 5), viewport: PHONE }, async (page, errors) => {
      const s = await state(page);
      const cards = await page.locator('.lp-projects a').evaluateAll((as) => as.filter((a) => a.getClientRects().length).length);
      assert.ok(cards <= 12, `${cards} cards`);
      assert.equal(cards, s.shown);
      if (n > 12) {
        assert.equal((await page.locator('a.lp-more-below').textContent()).trim(), `+${n - cards} more below`);
        assert.equal(await page.locator('a.lp-more-below').isVisible(), true);
      } else assert.equal(await page.locator('a.lp-more-below').isVisible(), false, 'all 12 are cards');
      await noSideScroll(page, PHONE.width);
      assert.deepEqual(errors, []);
    });
  });
}

test('a sixth project with no drawing and a 60-character title: generic constellation, no sideways scroll', async () => {
  const title = 'An unusually long project title that runs to sixty character'.slice(0, 60);
  assert.equal(title.length, 60);
  for (const viewport of [DESK, { width: 1024, height: 800 }, PHONE]) {
    await withPage({ setup: withExtra(1, title), viewport }, async (page, errors) => {
      const s = await state(page);
      assert.equal(s.total, 6);
      const link = page.locator('.lp-projects li[data-slug="fixture-06"] a');
      assert.equal(s.shown, 6);
      if (viewport.width > 760) {
        assert.equal(await page.locator('#lp-scene svg g[data-slug="fixture-06"][data-shape="generic"]').count(), 1, 'generic constellation on the arc');
        await assertArcLayout(page, 6);
      }
      assert.equal(await link.isVisible(), true);
      assert.match(await link.innerText(), /An unusually long project title/);
      await noSideScroll(page, viewport.width);
      assert.deepEqual(errors, []);
    });
  }
});

// Headline, every project link and every figure: present, with a box, and nothing left at opacity 0.
async function assertContentShown(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {}))));
  const report = await page.evaluate(() => [...document.querySelectorAll('.lp-headline, .lp-projects a, [data-fig]')].map((e) => {
    let hidden = false;
    for (let n = e; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).opacity === '0') hidden = true;
    const b = e.getBoundingClientRect();
    return { what: e.className || e.tagName, box: b.width > 0 && b.height > 0, hidden };
  }));
  assert.equal(report.filter((r) => r.what.includes('lp-proj')).length, 5);
  assert.equal(report.filter((r) => r.what.includes('lp-stat')).length, 4);
  for (const r of report) {
    assert.ok(r.box, `${r.what} has a box`);
    assert.equal(r.hidden, false, `${r.what} not at opacity 0`);
  }
}

test('without the scene (script blocked, or canvas unavailable) all content stays visible and the scene stays off', async () => {
  await withPage({ ready: false, setup: (page) => page.route('**/hero-scene.js', (r) => r.abort()) }, async (page) => {
    await page.waitForLoadState('load');
    await assertContentShown(page);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lp-scene-on')), false);
  });
  await withPage({ ready: false, setup: (page) => page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; }) }, async (page, errors) => {
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.HeroScene && window.HeroScene.state().failed, null, { timeout: 15000 });
    await assertContentShown(page);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lp-scene-on')), false);
    assert.equal(await page.locator('#lp-scene canvas, canvas.lp-bg').count(), 0, 'canvases removed');
    assert.equal(errors.length, 1, 'logged once');
  });
});

test('resize 1440 → 900 → 390 → 1440 ends with one running loop and a valid arc; hidden tab stops it, visible resumes', async () => {
  await withPage({}, async (page, errors) => {
    for (const width of [900, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => {
      const s = window.HeroScene.state();
      return s.running && s.layoutWidth === Math.round(document.getElementById('lp-scene').clientWidth);
    }, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const s = await state(page);
    assert.equal(s.running, true);
    assert.equal(s.loops, 1);
    assert.equal(s.shown, 5);
    await assertArcLayout(page, 5);
    const setHidden = (h) => page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, h);
    await setHidden(true);
    assert.equal((await state(page)).running, false);
    assert.equal((await state(page)).loops, 0);
    await setHidden(false);
    assert.equal((await state(page)).running, true);
    assert.equal((await state(page)).loops, 1);
    assert.deepEqual(errors, []);
  });
});

test('scrolling the hero out of view stops the loop; scrolling back resumes it', async () => {
  await withPage({}, async (page) => {
    await page.evaluate(() => document.getElementById('contact').scrollIntoView());
    await page.waitForFunction(() => !window.HeroScene.state().running, null, { timeout: 5000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.HeroScene.state().running && window.HeroScene.state().loops === 1, null, { timeout: 5000 });
  });
});

test('same-origin requests only, and no console errors at 1440, 1024 and 390', async () => {
  for (const viewport of [DESK, { width: 1024, height: 800 }, PHONE]) {
    const foreign = [];
    await withPage({ viewport, setup: (page) => page.on('request', (r) => { if (!r.url().startsWith(server.url)) foreign.push(r.url()); }) }, async (page, errors) => {
      await page.waitForTimeout(1500);
      assert.equal((await state(page)).running, true);
      assert.deepEqual(errors, [], `console at ${viewport.width}`);
    });
    assert.deepEqual(foreign, [], `requests at ${viewport.width}`);
  }
});
