// Geometry the landing page shares with the approved mockup (round-11/full-page.html), checked in a real browser:
// differences found by scripts/compare-landing.mjs, pinned here so they stay fixed.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';

let server;
let browser;
before(async () => {
  server = await serve(await build());
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await server.close();
});

async function withPage(viewport, fn) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    await page.goto(server.url + '/');
    await page.evaluate(() => document.fonts.ready);
    await fn(page);
  } finally {
    await ctx.close();
  }
}
const sceneOn = (page) => page.waitForFunction(() => document.documentElement.classList.contains('lp-scene-on'), null, { timeout: 30000 });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a}, want ${b} ± ${tol}`);

// In the mockup every hero label has an eyebrow line (hidden on the arc until hover), so every title sits one eyebrow
// line below its drawing. Projects without an eyebrow keep that line empty, so the titles line up the same way.
test('hero arc at 1440: every project title sits one eyebrow line under its drawing', async () => {
  await withPage({ width: 1440, height: 900 }, async (page) => {
    await sceneOn(page);
    const gaps = await page.evaluate(() => [...document.querySelectorAll('.lp-projects > li:not(.lp-off)')].map((li) => {
      const t = li.querySelector('.lp-proj-t').getBoundingClientRect();
      return { slug: li.dataset.slug, gap: t.top - li.getBoundingClientRect().bottom };
    }));
    // as many labels as the scene shows (all projects, or as many as fit on the arc)
    assert.ok(gaps.length > 0, 'project labels on the arc');
    assert.equal(gaps.length, await page.evaluate(() => window.HeroScene.state().shown));
    // 4px under the box, then the 12px/1.6 eyebrow line
    for (const { slug, gap } of gaps) near(gap, 4 + 12 * 1.6, 1, slug);
  });
});

test('hero cards at 390: each title sits right under its eyebrow, or where a one-line eyebrow would end', async (t) => {
  await withPage({ width: 390, height: 844 }, async (page) => {
    await sceneOn(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lp-projects > li:not(.lp-off)')].map((li) => {
      const e = li.querySelector('.lp-proj-e');
      return {
        slug: li.dataset.slug, hasE: !!e,
        title: li.querySelector('.lp-proj-t').getBoundingClientRect().top,
        above: e ? e.getBoundingClientRect().bottom : li.querySelector('.lp-cst-card').getBoundingClientRect().bottom,
      };
    }));
    assert.ok(rows.length > 0, 'project cards');
    // each kind is checked when today's data has it
    if (!rows.some((r) => r.hasE)) t.diagnostic('no project with an eyebrow: that case is not checked');
    if (!rows.some((r) => !r.hasE)) t.diagnostic('no project without an eyebrow: that case is not checked');
    // no gap under an eyebrow; without one: card, 10px, the empty 12px/1.6 eyebrow line
    for (const r of rows) near(r.title - r.above, r.hasE ? 0 : 10 + 12 * 1.6, 1, r.slug);
  });
});

// The mockup's lower half uses its own gutter: 72px, 48px up to 1180px wide, 20px on phones.
for (const [width, want] of [[1440, 120], [1190, 72], [1024, 48], [390, 20]]) {
  test(`lower half at ${width}: sections and footer start ${want}px from the left edge`, async () => {
    await withPage({ width, height: 900 }, async (page) => {
      const x = await page.evaluate(() => ['#results .lp-wrap', '#contact .lp-wrap', '.sh-foot .sh-container'].map((s) => document.querySelector(s).getBoundingClientRect().left));
      for (const v of x) near(v, want, 0.5, 'left');
    });
  });
}

test('contact at 1440 and 390: a four-row message box and the send button at the right, with no icon', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await withPage(viewport, async (page) => {
      const m = await page.evaluate(() => {
        const f = document.querySelector('#contact form'), b = f.querySelector('button[type=submit]'), icon = b.querySelector('svg');
        return {
          ta: document.querySelector('#contact textarea').getBoundingClientRect().height,
          fr: f.getBoundingClientRect().right, br: b.getBoundingClientRect().right,
          icon: icon ? getComputedStyle(icon).display : 'none',
        };
      });
      // four 17px/1.5 lines, 10px padding top and bottom, the 1px underline
      near(m.ta, 4 * 17 * 1.5 + 21, 1, `${viewport.width}: textarea height`);
      near(m.br, m.fr, 0.5, `${viewport.width}: button right edge`);
      assert.equal(m.icon, 'none');
    });
  }
});

test('work at 1440: 10px under the list before the section ends (the mockup\'s list foot)', async () => {
  await withPage({ width: 1440, height: 900 }, async (page) => {
    await page.waitForFunction(() => document.querySelector('#work .lp-acc'), null, { timeout: 30000 });
    const gap = await page.evaluate(() => document.querySelector('#work .lp-mod').getBoundingClientRect().bottom - document.querySelector('#work ol.lp-work').getBoundingClientRect().bottom);
    near(gap, 10, 0.5, 'gap');
  });
});
