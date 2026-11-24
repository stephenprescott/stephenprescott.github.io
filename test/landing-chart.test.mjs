// The star chart, proof panel and work accordion (src/assets/js/landing-chart.js), in a real browser.
// Fixture tests swap the #lp-data JSON in the served HTML before the script runs; the server-rendered
// fallback lists then no longer match the data, which is fine for tests of the script itself.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';
import { withData as withLpData } from './helpers/lp-data.mjs';
import { buildLandingData } from '../lib/landing-data.mjs';

const root = resolve(import.meta.dirname, '..');
const data = (f) => JSON.parse(readFileSync(join(root, 'src/_data', f), 'utf8'));
const landing = buildLandingData(data('home.json'), data('projects.json'));
const area = (id) => landing.areas.find((a) => a.id === id);

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

// Open / in a fresh context. `setup(page)` runs before navigation (routes); `ready: false` skips
// waiting for the chart (for tests where the script is expected not to enhance the page).
async function withPage(opts, fn) {
  const { setup, ready = true, ...ctxOpts } = opts;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts });
  try {
    const page = await ctx.newPage();
    if (setup) await setup(page);
    await page.goto(server.url + '/');
    if (ready) await page.waitForFunction(() => window.LandingChart && document.querySelector('#expertise[data-selected]'));
    await fn(page);
  } finally {
    await ctx.close();
  }
}

// Serve / with #lp-data replaced by mutate(original data) (or by a raw string).
const withData = (mutate) => withLpData(server.url, mutate);

// 19 extra projects (24 in all), each proving "AI tools and platforms" and one other area in turn.
const twentyFour = (d) => {
  const extra = Array.from({ length: 19 }, (_, i) => {
    const n = String(i + 6).padStart(2, '0');
    const proves = [...new Set(['ai-tools-and-platforms', d.areas[i % d.areas.length].id])];
    return { slug: `fixture-${n}`, title: `Fixture project ${n}`, shortTitle: `Fixture project ${n}`, subtitle: '', eyebrow: 'Personal project · 2026', summary: `Summary ${n}.`, status: '', href: `/projects/fixture-${n}/`, proves, problem: `Problem ${n}.`, approach: `Approach ${n}.`, result: `Result ${n}.` };
  });
  return { ...d, projects: [...d.projects, ...extra] };
};

// Let every finite animation and transition finish (the hero's rise, the panel's fade-in, accordion opening).
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
  .map((a) => a.finished.catch(() => {}))));
const selected = (page) => page.getAttribute('#expertise', 'data-selected');
const opened = (page) => page.evaluate(() => document.getElementById('expertise').getAttribute('data-open'));
const panelNames = (page) => page.$$eval('.lp-panel li .lp-pr > span:first-of-type', (els) => els.map((e) => e.textContent.trim()));

test('the landing page loads landing-chart.js deferred', () => {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/assets\/js\/landing-chart\.js" defer><\/script>/);
});

test('chart replaces the fallback list; first area selected by default; counter "09 stars · 6 areas"', async () => {
  await withPage({}, async (page) => {
    assert.equal(await page.locator('#expertise ul.lp-areas').count(), 0, 'fallback list replaced');
    assert.equal(await page.locator('svg.lp-chart').getAttribute('viewBox'), '0 0 780 400');
    assert.equal(await page.locator('.lp-node[data-area]').count(), 6);
    assert.equal(await page.locator('.lp-dot[data-id]').count(), 9);
    const first = landing.areas[0];
    assert.equal(await selected(page), first.id);
    const proof = landing.projects.filter((p) => p.proves.includes(first.id)).length + landing.figures.filter((f) => f.proves.includes(first.id)).length;
    assert.equal(await page.locator('.lp-panel li').count(), proof);
    assert.equal((await page.textContent('.lp-count')).trim(), '09 stars · 6 areas');
    assert.equal(await page.getAttribute(`.lp-node[data-area="${first.id}"]`, 'aria-pressed'), 'true');
  });
});

test('click area "AI tools and platforms": four proof rows, four lines, the area body and "See the résumé"', async () => {
  await withPage({}, async (page) => {
    await page.click('.lp-node[data-area="ai-tools-and-platforms"]');
    assert.equal(await selected(page), 'ai-tools-and-platforms');
    assert.deepEqual(await panelNames(page), ['Data Central', 'Kyber Praxis', 'Praxis Fasti', 'Jobscan Board']);
    assert.equal(await page.locator('svg.lp-chart .lp-lines path').count(), 4);
    assert.equal((await page.textContent('.lp-cap-b')).trim(), area('ai-tools-and-platforms').body);
    assert.equal(await page.getAttribute('.lp-cap a', 'href'), '/resume/');
    assert.equal((await page.textContent('.lp-cap a')).replace(/→/, '').trim(), 'See the résumé');
    assert.equal(await page.locator('.lp-dot.lit').count(), 4);
  });
});

test('hovering a star shows its name; clicking it opens it in the panel with "Read the case study"', async () => {
  await withPage({}, async (page) => {
    await page.hover('.lp-dot[data-id="kyber-praxis"]');
    assert.match(await page.textContent('.lp-tip'), /^Kyber Praxis/);
    await page.click('.lp-dot[data-id="kyber-praxis"]');
    assert.equal(await opened(page), 'kyber-praxis');
    const link = page.locator('.lp-panel a.lp-tlink');
    assert.equal(await link.getAttribute('href'), '/projects/kyber-praxis/');
    assert.match(await link.textContent(), /^Read the case study/);
  });
});

test('keyboard: Tab reaches an area node, ArrowRight moves the selection, Enter on a panel row opens its item', async () => {
  await withPage({}, async (page) => {
    await page.focus('.lp-dot[tabindex="0"]');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.area), landing.areas[0].id);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.area), landing.areas[1].id);
    assert.equal(await selected(page), landing.areas[1].id);
    await page.focus('.lp-panel li .lp-pr');
    await page.keyboard.press('Enter');
    assert.equal(await opened(page), 'models');
    assert.equal(await page.getAttribute('.lp-panel a.lp-tlink', 'href'), '/resume/');
    assert.match(await page.textContent('.lp-panel'), new RegExp(landing.figures.find((f) => f.id === 'models').body.slice(0, 40)));
  });
});

test('figure 600+ selects "Data as competitive advantage"; scrolling a node under the resting mouse keeps the selection', async () => {
  // Reduced motion makes the figure's scroll instant, so positions are stable.
  await withPage({ reducedMotion: 'reduce' }, async (page) => {
    const fig = page.locator('#results [data-fig="audited"]');
    await fig.scrollIntoViewIfNeeded();
    const fb = await fig.boundingBox();
    // Click the figure where some other area's node shares its x range, so scrolling can bring that node under the mouse.
    const nodes = await page.$$eval('.lp-node', (ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { id: n.dataset.area, x0: r.left, x1: r.right }; }));
    const other = nodes.find((n) => n.id !== 'data-as-competitive-advantage' && n.x1 > fb.x + 8 && n.x0 < fb.x + fb.width - 8);
    assert.ok(other, 'a node overlaps the figure horizontally');
    const x = (Math.max(other.x0, fb.x) + Math.min(other.x1, fb.x + fb.width)) / 2;
    const y = fb.y + fb.height / 2;
    await page.mouse.click(x, y);
    assert.equal(await selected(page), 'data-as-competitive-advantage');
    assert.equal(await opened(page), 'audited');
    assert.equal(await page.locator('.lp-dot.on').getAttribute('data-id'), 'audited');
    assert.ok(await page.evaluate(() => { const r = document.querySelector('.lp-starchart').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), 'chart scrolled into view');
    // Scroll (wheel only, the mouse does not move) until that node sits under the cursor.
    const ny = await page.$eval(`.lp-node[data-area="${other.id}"] .nd`, (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
    await page.mouse.wheel(0, Math.round(ny - y));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('.lp-node')?.dataset.area, [x, y]), other.id, 'node is under the mouse');
    assert.equal(await selected(page), 'data-as-competitive-advantage');
    assert.equal(await opened(page), 'audited');
    // A real mouse movement over a node still selects it.
    await page.mouse.move(x + 3, y, { steps: 3 });
    await page.waitForFunction((id) => document.getElementById('expertise').dataset.selected === id, other.id);
  });
});

test('work list: rows open in place, one at a time, with problem/approach/result and the case-study link', async () => {
  await withPage({}, async (page) => {
    const trig = page.locator('#work .lp-trig');
    assert.equal(await trig.count(), landing.projects.length);
    assert.equal(await trig.nth(0).getAttribute('aria-expanded'), 'false');
    await trig.nth(0).click();
    assert.equal(await trig.nth(0).getAttribute('aria-expanded'), 'true');
    const p = landing.projects[0];
    const region = page.locator('#' + await trig.nth(0).getAttribute('aria-controls'));
    await region.waitFor({ state: 'visible' });
    assert.deepEqual(await region.locator('dt').allTextContents(), ['Problem', 'Approach', 'Result']);
    assert.deepEqual(await region.locator('dd').allTextContents(), [p.problem, p.approach, p.result]);
    assert.ok(await region.locator(`a[href="/projects/${p.slug}/"]`).isVisible());
    await trig.nth(1).click();
    assert.equal(await trig.nth(0).getAttribute('aria-expanded'), 'false');
    assert.equal(await trig.nth(1).getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#work .lp-more').count(), 0, 'five projects: no "Show all"');
  });
});

test('fixture data, 24 projects (server lists do not match): panel and work list show 6 rows then "Show all N"; stars do not overlap', async () => {
  await withPage({ setup: withData(twentyFour) }, async (page) => {
    await page.click('.lp-node[data-area="ai-tools-and-platforms"]');
    assert.equal(await page.locator('.lp-panel li').count(), 6);
    const more = page.locator('.lp-panel button.lp-more');
    assert.equal((await more.textContent()).trim(), 'Show all 23');
    await more.click();
    assert.equal(await page.locator('.lp-panel li').count(), 23);
    assert.equal(await page.locator('.lp-panel button.lp-more').count(), 0);

    const dots = await page.$$eval('.lp-dot', (ds) => ds.map((d) => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width }; }));
    assert.equal(dots.length, 28);
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
        assert.ok(dist >= dots[i].d, `stars ${i} and ${j} are ${dist.toFixed(1)}px apart`);
      }
    }
    assert.equal((await page.textContent('.lp-count')).trim(), '28 stars · 6 areas');

    const rows = page.locator('#work ol.lp-work > li');
    assert.equal(await rows.count(), 24);
    assert.equal(await page.locator('#work ol.lp-work > li:visible').count(), 6);
    const wmore = page.locator('#work button.lp-more');
    assert.equal((await wmore.textContent()).trim(), 'Show all 24');
    await wmore.click();
    assert.equal(await page.locator('#work ol.lp-work > li:visible').count(), 24);
    assert.equal(await page.locator('#work button.lp-more').count(), 0);
  });
});

test('fixture data, an area with no proof (server lists do not match): only its body, no list, no "Proof" heading', async () => {
  const noStrategy = (d) => ({ ...d, figures: d.figures.map((f) => (f.proves.includes('data-strategy') ? { ...f, proves: [] } : f)) });
  await withPage({ setup: withData(noStrategy) }, async (page) => {
    await page.click('.lp-node[data-area="data-strategy"]');
    assert.equal(await page.locator('.lp-panel li, .lp-panel .lp-more').count(), 0);
    assert.doesNotMatch((await page.locator('#expertise .lp-mod-b, .lp-panel').allTextContents()).join(' '), /Proof/);
    assert.equal(await page.locator('svg.lp-chart .lp-lines path').count(), 0);
    assert.equal((await page.textContent('.lp-cap-b')).trim(), area('data-strategy').body);
    assert.equal(await page.locator('.lp-node[data-area="data-strategy"] .nc').count(), 0, 'no "0 stars" label');
  });
  await withPage({ setup: withData(noStrategy), viewport: { width: 390, height: 844 } }, async (page) => {
    const li = page.locator('#lp-x-data-strategy');
    await li.locator('.lp-trig').click();
    assert.doesNotMatch(await li.textContent(), /Proof/);
    assert.equal(await li.locator('.lp-pp-list, li').count(), 0);
    assert.match(await li.textContent(), new RegExp(area('data-strategy').body.slice(0, 40)));
  });
});

test('390×844: no chart; one accordion per area listing its proof; no horizontal scroll', async () => {
  await withPage({ viewport: { width: 390, height: 844 } }, async (page) => {
    assert.equal(await page.locator('svg.lp-chart').count(), 0);
    assert.equal(await page.locator('.lp-panel').count(), 0);
    const items = page.locator('#expertise .lp-xacc > li');
    assert.equal(await items.count(), 6);
    const ai = page.locator('#lp-x-ai-tools-and-platforms');
    assert.match(await ai.locator('.lp-trig').textContent(), /Proof · 04/);
    await ai.locator('.lp-trig').click();
    assert.equal(await ai.locator('.lp-trig').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await ai.locator('.lp-pr > span:first-of-type').allTextContents(), ['Data Central', 'Kyber Praxis', 'Praxis Fasti', 'Jobscan Board']);
    assert.equal(await page.locator('#expertise .lp-xacc .lp-trig[aria-expanded="true"]').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    // hints as in the mockup: nothing lights up on phones, so the expertise hint goes; the other two stay
    assert.equal(await page.locator('#expertise .lp-hint').isVisible(), false);
    assert.equal(await page.locator('#results .lp-hint').isVisible(), true);
    assert.equal(await page.locator('#work .lp-hint').isVisible(), true);
    // a figure opens its area's accordion
    await page.click('#results [data-fig="models"]');
    assert.equal(await page.getAttribute('#lp-x-data-strategy .lp-trig', 'aria-expanded'), 'true');
  });
});

test('700px wide is still a phone layout (breakpoint 760px): accordions, no chart', async () => {
  await withPage({ viewport: { width: 700, height: 900 } }, async (page) => {
    assert.equal(await page.locator('svg.lp-chart').count(), 0);
    assert.equal(await page.locator('#expertise .lp-xacc > li').count(), 6);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  });
  await withPage({ viewport: { width: 761, height: 900 } }, async (page) => {
    assert.equal(await page.locator('svg.lp-chart').count(), 1);
  });
});

test('LandingChart.select(areaId) and .open(itemId) drive the chart (1440) and the accordions (390)', async () => {
  await withPage({ reducedMotion: 'reduce' }, async (page) => {
    await page.evaluate(() => window.LandingChart.select('governance-and-compliance'));
    assert.equal(await selected(page), 'governance-and-compliance');
    assert.equal(await page.getAttribute('.lp-node[data-area="governance-and-compliance"]', 'aria-pressed'), 'true');
    assert.deepEqual(await panelNames(page), ['Data Central']);
    await page.evaluate(() => window.LandingChart.open('kyber-praxis'));
    assert.equal(await opened(page), 'kyber-praxis');
    assert.equal(await selected(page), 'ai-tools-and-platforms');
    assert.equal(await page.locator('.lp-dot.on').getAttribute('data-id'), 'kyber-praxis');
    await page.evaluate(() => { window.LandingChart.select('nope'); window.LandingChart.open('nope'); });
    assert.equal(await opened(page), 'kyber-praxis', 'unknown ids are ignored');
  });
  await withPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } }, async (page) => {
    await page.evaluate(() => window.LandingChart.select('data-strategy'));
    assert.equal(await page.getAttribute('#lp-x-data-strategy .lp-trig', 'aria-expanded'), 'true');
    await page.evaluate(() => window.LandingChart.open('audited'));
    assert.equal(await page.getAttribute('#lp-x-data-as-competitive-advantage .lp-trig', 'aria-expanded'), 'true');
    assert.equal(await page.locator('#expertise .lp-xacc .lp-trig[aria-expanded="true"]').count(), 1);
  });
});

test('fixture data, a slug with quotes and "<" (server lists do not match): ids are escaped and the accordion still works', async () => {
  const odd = 'x" data-injected="1<b>';
  const withOdd = (d) => ({ ...d, projects: d.projects.map((p, i) => (i === 0 ? { ...p, slug: odd } : p)) });
  await withPage({ setup: withData(withOdd) }, async (page) => {
    assert.equal(await page.locator('[data-injected]').count(), 0);
    const trig = page.locator('#work .lp-trig').first();
    assert.equal(await trig.getAttribute('aria-controls'), `lp-w-${odd}-p`);
    await trig.click();
    assert.ok(await page.evaluate((id) => !!document.getElementById(id) && document.getElementById(id).closest('.lp-item').classList.contains('open'), `lp-w-${odd}-p`));
    assert.equal(await page.$$eval('.lp-dot', (ds, v) => ds.filter((d) => d.dataset.id === v).length, odd), 1);
  });
});

test('crossing the phone breakpoint swaps the chart for the accordions and back, keeping the selection', async () => {
  await withPage({}, async (page) => {
    await page.click('.lp-node[data-area="governance-and-compliance"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('svg.lp-chart') && document.querySelector('.lp-xacc'));
    assert.equal(await page.getAttribute('#lp-x-governance-and-compliance .lp-trig', 'aria-expanded'), 'true');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.querySelector('svg.lp-chart'));
    assert.equal(await selected(page), 'governance-and-compliance');
  });
});

test('reduced motion: no running animations after selecting an area', async () => {
  await withPage({ reducedMotion: 'reduce' }, async (page) => {
    await page.click('.lp-node[data-area="ai-tools-and-platforms"]');
    await page.hover('.lp-dot[data-id="data-central"]');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  });
});

// The hero scene marks #top with .lp-arc (projects on the arc), so the chart's arc path must not use that class: its
// stroke would be inherited by every star drawn in the hero.
test('1440: the chart arc keeps its stroke and the hero (#top.lp-arc) inherits none', async () => {
  await withPage({}, async (page) => {
    await page.waitForFunction(() => document.querySelector('#top.lp-arc'), null, { timeout: 30000 });
    const s = await page.evaluate(() => {
      const arc = document.querySelector('svg.lp-chart .lp-chart-arc');
      return { top: getComputedStyle(document.getElementById('top')).stroke, arc: arc && getComputedStyle(arc).stroke };
    });
    assert.equal(s.top, 'none');
    assert.equal(s.arc, 'rgba(154, 167, 187, 0.2)');
  });
});

// Points along each line of the selected area (25%, 50%, 75% and 97% of its length) where no line pixel shows. Stars,
// nodes, tooltip and the page's starfield are hidden first so only the lines can match (cyan: green well above red).
async function lineGaps(page) {
  await page.addStyleTag({ content: '.lp-dot,.lp-nodes,.lp-tip,.lp-bg{visibility:hidden!important}' });
  await page.evaluate(() => document.querySelector('.lp-starchart').scrollIntoView({ block: 'center', behavior: 'instant' }));
  const pts = await page.evaluate(() => [...document.querySelectorAll('svg.lp-chart .lp-lines path')].flatMap((p, i) => {
    const len = p.getTotalLength(), m = p.getScreenCTM();
    return [0.25, 0.5, 0.75, 0.97].map((t) => { const q = p.getPointAtLength(len * t).matrixTransform(m); return { line: i, t, x: Math.round(q.x), y: Math.round(q.y) }; });
  }));
  assert.ok(pts.length >= 4, 'lines drawn');
  const png = (await page.screenshot()).toString('base64');
  const gaps = await page.evaluate(async ({ png, pts }) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    return pts.filter(({ x, y }) => {
      const d = g.getImageData(x - 2, y - 2, 5, 5).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] - d[i] > 25) return false;
      return true;
    });
  }, { png, pts });
  return { pts, gaps };
}

// Lines use pathLength="1" with a non-scaling stroke, so their dash is measured on screen; from 781 to 1180px the chart
// is wider than its 780-unit viewBox and a fixed dash of 1 used to stop short of the star.
for (const width of [800, 1024, 1180, 1440, 1600]) {
  test(`${width}px, reduced motion: every line of the selected area reaches its star`, async () => {
    await withPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }, async (page) => {
      await page.evaluate(() => window.LandingChart.select('ai-tools-and-platforms'));
      const { gaps } = await lineGaps(page);
      assert.deepEqual(gaps, []);
    });
  });
}

test('resizing 1440 → 1180px (reduced motion): the lines still reach their stars', async () => {
  await withPage({ reducedMotion: 'reduce' }, async (page) => {
    await page.evaluate(() => window.LandingChart.select('ai-tools-and-platforms'));
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.waitForFunction(() => document.querySelector('.lp-starchart').getBoundingClientRect().width > 1000);
    // the hero re-lays out on a debounce after a resize and moves the chart down the page: wait until the chart's
    // box and dash have stopped changing, or the sampled points and the screenshot disagree (seen on slow CI runners)
    await page.evaluate(async () => {
      const c = document.querySelector('svg.lp-chart');
      const snap = () => { const r = c.getBoundingClientRect(); return [Math.round(r.top + scrollY), Math.round(r.width), c.style.getPropertyValue('--lp-dash'), document.documentElement.scrollHeight].join(); };
      let last = snap(), still = 0;
      while (still < 5) { await new Promise((r) => setTimeout(r, 100)); const now = snap(); still = now === last ? still + 1 : 0; last = now; }
    });
    const { gaps } = await lineGaps(page);
    assert.deepEqual(gaps, []);
  });
});

test('1024px: the lines still draw in (nothing shows at the start of the animation) and end complete', async () => {
  await withPage({ viewport: { width: 1024, height: 900 } }, async (page) => {
    await page.evaluate(() => window.LandingChart.select('ai-tools-and-platforms'));
    // every animation on the area's lines: count, rewind and pause, or finish
    const lines = (what) => page.evaluate((w) => {
      const anims = [...document.querySelectorAll('svg.lp-chart .lp-lines path')].flatMap((p) => p.getAnimations());
      if (w === 'start') anims.forEach((a) => { a.pause(); a.currentTime = 0; });
      if (w === 'end') anims.forEach((a) => a.finish());
      return anims.length;
    }, what);
    assert.ok((await lines('count')) >= 4, 'each line animates');
    await lines('start');
    const start = await lineGaps(page);
    assert.equal(start.gaps.length, start.pts.length, 'no line pixel at the start');
    await lines('end');
    const end = await lineGaps(page);
    assert.deepEqual(end.gaps, []);
  });
});

test('bad #lp-data leaves the server-rendered lists in place', async () => {
  for (const bad of ['{', '{"areas":"x","figures":"y","projects":"z"}']) {
    await withPage({ setup: withData(bad), ready: false }, async (page) => {
      await page.waitForLoadState('load');
      assert.equal(await page.locator('#expertise ul.lp-areas > li').count(), 6, bad);
      assert.equal(await page.locator('#work ol.lp-work > li.lp-row').count(), landing.projects.length, bad);
      assert.equal(await page.locator('svg.lp-chart, .lp-panel, .lp-trig').count(), 0, bad);
    });
  }
});

// A late init step throws: wiring the handlers (document pointermove listener), or the very last step,
// listening to the phone breakpoint. The page must keep its fallback lists, working plain links and one logged error.
const lateFailures = {
  'wiring the handlers': () => {
    const add = Document.prototype.addEventListener;
    Document.prototype.addEventListener = function (type, fn, opts) {
      if (type === 'pointermove' && opts === true) throw new Error('test: wire fails');
      return add.call(this, type, fn, opts);
    };
  },
  'listening to the breakpoint': () => {
    MediaQueryList.prototype.addEventListener = function () { throw new Error('test: matchMedia listener fails'); };
  },
};
for (const [step, stub] of Object.entries(lateFailures)) {
  test(`a failure while ${step} leaves the fallback intact and usable, logs one error, builds nothing`, async () => {
    const errors = [];
    await withPage({ ready: false, setup: async (page) => {
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(stub);
    } }, async (page) => {
      await page.waitForLoadState('load');
      assert.deepEqual(errors.length, 1, errors.join(' | '));
      assert.match(errors[0], /test: /);
      assert.equal(await page.evaluate(() => typeof window.LandingChart), 'undefined');
      assert.equal(await page.locator('#expertise ul.lp-areas > li').count(), 6);
      assert.equal(await page.locator('#work ol.lp-work > li.lp-row').count(), landing.projects.length);
      assert.equal(await page.locator('svg.lp-chart, .lp-starchart, .lp-panel, .lp-trig, .lp-go, .lp-sc, #expertise[data-selected]').count(), 0);
      // the figures stay plain links to #expertise, and the fallback proof links are there
      await page.click('#results [data-fig="audited"]');
      assert.equal(await page.evaluate(() => location.hash), '#expertise');
      assert.equal(await page.getAttribute('#expertise ul.lp-areas a.lp-pr >> nth=0', 'href'), '/projects/data-central/');
    });
  });
}

test('without MediaQueryList.addEventListener (Safari before 14) the chart builds and still follows the breakpoint', async () => {
  await withPage({ setup: (page) => page.addInitScript(() => { MediaQueryList.prototype.addEventListener = undefined; }) }, async (page) => {
    assert.equal(await page.locator('svg.lp-chart').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('svg.lp-chart') && document.querySelector('.lp-xacc'));
  });
});

test('axe: no serious or critical violations with the chart built (1440) and the accordions built (390)', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await withPage({ viewport }, async (page) => {
      if (viewport.width > 760) await page.click('.lp-dot[data-id="steppenwolf"]');
      else await page.click('#work .lp-trig >> nth=0');
      await settle(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      assert.deepEqual(bad.map((v) => `${viewport.width} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), []);
    });
  }
});
