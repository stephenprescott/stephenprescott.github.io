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
const withData = (mutate) => async (page) => {
  await page.route(server.url + '/', async (route) => {
    const res = await route.fetch();
    const html = await res.text();
    const body = html.replace(/(<script type="application\/json" id="lp-data">)([\s\S]*?)(<\/script>)/, (_, a, json, c) => {
      const next = typeof mutate === 'string' ? mutate : JSON.stringify(mutate(JSON.parse(json))).replace(/</g, '\\u003c');
      return a + next + c;
    });
    assert.notEqual(body, html, 'lp-data replaced');
    await route.fulfill({ response: res, body });
  });
};

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
    // a figure opens its area's accordion
    await page.click('#results [data-fig="models"]');
    assert.equal(await page.getAttribute('#lp-x-data-strategy .lp-trig', 'aria-expanded'), 'true');
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
