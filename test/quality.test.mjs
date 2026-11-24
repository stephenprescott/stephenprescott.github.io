import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { build } from './helpers/build.mjs';
import { settleReveals } from './helpers/reveal.mjs';
import { serve } from './helpers/serve.mjs';
import { renderMacro } from './helpers/render.mjs';
import { buildLandingData } from '../lib/landing-data.mjs';

const root = resolve(import.meta.dirname, '..');
const projects = JSON.parse(readFileSync(join(root, 'src/_data/projects.json'), 'utf8'));
const home = JSON.parse(readFileSync(join(root, 'src/_data/home.json'), 'utf8'));
const landing = buildLandingData(home, projects);
// Pages with the light/dark theme toggle (the old shell), and pages on the dark-only shell.
const THEMED = ['/resume/'];
const SHELL = ['/', '/projects/', '/projects/data-central/', '/404.html'];
const PAGES = [...THEMED, ...SHELL];

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

for (const theme of ['dark', 'light']) {
  test(`axe: no serious or critical violations in ${theme} theme`, async () => {
    for (const p of THEMED) {
      const ctx = await browser.newContext();
      await ctx.addInitScript((t) => localStorage.setItem('ws-theme', t), theme);
      const page = await ctx.newPage();
      await page.goto(server.url + p);
      assert.equal(await page.getAttribute('html', 'data-theme'), theme);
      await settleReveals(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      assert.deepEqual(bad.map((v) => `${p} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), []);
      await ctx.close();
    }
  });
}

test('axe: no serious or critical violations on the dark shell pages', async () => {
  for (const p of SHELL) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(server.url + p);
    assert.equal(await page.evaluate(() => document.body.classList.contains('sh-root')), true, p + ' on the shell');
    await settleReveals(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(bad.map((v) => p + ' ' + v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | ')), []);
    await ctx.close();
  }
});

test('chat panel open on /projects/ (dark shell): dark and readable, axe finds no serious or critical violations', async () => {
  const live = await serve(await build('development', { chatEndpoint: 'https://chat.test/ask' }));
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(live.url + '/projects/');
    await page.click('[data-chat-launcher]');
    assert.equal(await page.locator('[role=dialog]').isVisible(), true);
    const panel = await page.$eval('[role=dialog]', (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color, border: s.borderTopColor, font: s.fontFamily }; });
    assert.equal(panel.bg, 'rgb(13, 17, 23)');
    assert.equal(panel.fg, 'rgb(216, 222, 233)');
    assert.equal(panel.border, 'rgba(154, 167, 187, 0.16)', 'soft border from chat-shell.css');
    assert.match(panel.font, /Space Grotesk/);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | ')), []);
    await ctx.close();
  } finally {
    await live.close();
  }
});

test('320px wide: no horizontal page scroll on any page', async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.goto(server.url + p);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 320, `${p} scrollWidth ${w}`);
    await page.close();
  }
  await ctx.close();
});

test('320px wide: a 60-character unbroken title and 12 tags do not overflow the project grid', async () => {
  const css = ['tokens.css', 'bundle.css', 'site.css'].map((f) => readFileSync(join(root, 'src/assets/css', f), 'utf8')).join('\n');
  const grid = renderMacro('components/project-grid.njk', 'projectGrid', {
    projects: [{
      title: 'Supercalifragilisticexpialidocious'.repeat(2).slice(0, 60),
      summary: 'Summary', href: '/p/', tags: Array.from({ length: 12 }, (_, i) => `Tag number ${i + 1}`),
    }],
  });
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="ws-root"><section class="ws-section"><div class="ws-container">${grid}</div></section></body></html>`);
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 320);
  await ctx.close();
});

test('without JavaScript the landing page shows the headline, every project, the figures and the expertise areas', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  const shown = async (loc, what) => assert.ok(await loc.boundingBox(), what + ' has a box');
  assert.equal(await page.innerText('h1'), 'I turn data into decisions.');
  await shown(page.locator('h1'), 'headline');
  for (const p of landing.projects) {
    await shown(page.locator(`.lp-projects li[data-slug="${p.slug}"] .lp-proj-t`), p.slug + ' in the hero');
    const row = page.locator(`.lp-work li[data-slug="${p.slug}"] h3`);
    await shown(row, p.slug + ' in the work list');
    assert.equal(await row.innerText(), p.title);
  }
  assert.deepEqual(await page.locator('.lp-stats .lp-num').allInnerTexts(), ['10+', '600+', '70%+', '12+']);
  for (const f of landing.figures) await shown(page.locator(`[data-fig="${f.id}"]`), f.id);
  assert.equal(await page.locator('li[data-area] h3').count(), 6);
  for (const ar of landing.areas) await shown(page.locator(`li[data-area="${ar.id}"] h3`), ar.id);
  await ctx.close();
});

test('prefers-reduced-motion removes transitions', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('.lp-btn')).transitionDuration);
  assert.match(d, /^0s(, 0s)*$/);
  await ctx.close();
});

test('keyboard: skip link is first and every focusable element shows a focus outline', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'sh-skip');
  // only rendered controls take a tab stop (the shell's menu button is display:none on wide screens; links in a
  // closed accordion are visibility:hidden; the star chart's stars are one roving tab stop)
  const count = await page.evaluate(() => [...document.querySelectorAll('a[href], button:not([disabled]):not([hidden]), input:not([type=radio]):not([type=hidden]), textarea')]
    .filter((e) => e.getAttribute('tabindex') !== '-1' && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length);
  const lacking = [];
  for (let i = 0; i < count; i++) {
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      const filter = el.closest('.ws-filter');
      return { desc: el.tagName + '.' + el.className, shown: el.offsetParent !== null || el === document.body, style: s.outlineStyle, width: parseFloat(s.outlineWidth), hiddenFilter: !!filter && filter.hidden };
    });
    if (info.shown && info.style === 'none') lacking.push(info.desc);
    await page.keyboard.press('Tab');
  }
  assert.deepEqual(lacking, []);
  await ctx.close();
});

// Live contact form (a Web3Forms key is set): the hidden inputs and honeypot must not break the gates.
// The no-key build above stays covered.
test('live contact form: axe finds no serious or critical violations on / (dark only)', async () => {
  const live = await serve(await build('development', { contact: { web3formsKey: 'test-key' } }));
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(live.url + '/');
    assert.equal(await page.locator('#contact input[name=access_key]').count(), 1);
    await settleReveals(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), []);
    await ctx.close();
  } finally {
    await live.close();
  }
});

test('live contact form: controls meet the 44px touch target at 375px and the honeypot is not focusable', async () => {
  const live = await serve(await build('development', { contact: { web3formsKey: 'test-key' } }));
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(live.url + '/');
    const lacking = [];
    for (const sel of ['#contact input.ws-input', '#contact textarea', '#contact button[type=submit]']) {
      const heights = await page.$$eval(sel, (els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      assert.ok(heights.length > 0, `${sel} not found`);
      for (const h of heights) if (h < 43.5) lacking.push(`${sel} ${h}`);
    }
    assert.deepEqual(lacking, []);
    assert.equal(await page.locator('#contact button[type=submit]').isEnabled(), true);
    assert.equal(await page.locator('#contact input[name=botcheck]').isVisible(), false);
    await ctx.close();
  } finally {
    await live.close();
  }
});

// Chat widget built in, panel open: axe on / (dark only).
test('chat widget open: axe finds no serious or critical violations on / (dark only)', async () => {
  const live = await serve(await build('development', { chatEndpoint: 'https://chat.test/ask' }));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); // 1440×900: the launcher is clear of the hero projects
    const page = await ctx.newPage();
    await page.goto(live.url + '/');
    await page.click('[data-chat-launcher]');
    assert.equal(await page.locator('[role=dialog]').isVisible(), true);
    // the landing page loads no bundle.css: the panel is styled by chat.css (via shell-content.css) and chat-shell.css
    const panel = await page.$eval('[role=dialog]', (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, border: s.borderTopColor, pad: s.paddingTop }; });
    assert.deepEqual(panel, { bg: 'rgb(13, 17, 23)', border: 'rgba(154, 167, 187, 0.16)', pad: '24px' });
    assert.match(await page.$eval('.ws-chat-title', (el) => getComputedStyle(el).fontFamily), /^"?Space Grotesk/);
    assert.equal(await page.$eval('[data-chat-send]', (el) => getComputedStyle(el).borderTopWidth), '0px');
    await settleReveals(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), []);
    await ctx.close();
  } finally {
    await live.close();
  }
});

// Chat states with real content on / (dark only; fake Worker via page.route).
const CHAT_ENDPOINT = 'https://chat.test/ask';
const CHAT_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
const LONG = 'Stephen has led data and analytics work for over ten years, across strategy, governance and delivery. '.repeat(3);

async function axeBad(page) {
  // Let reveal fades finish first: a half-faded section is not a real contrast failure.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
    .map((a) => a.finished.catch(() => {}))));
  await settleReveals(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test('chat with content on /: axe finds no serious or critical violations (dark only)', async () => {
  const live = await serve(await build('development', { chatEndpoint: CHAT_ENDPOINT }));
  const newPage = async (seed) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); // 1440×900: the launcher is clear of the hero projects
    await ctx.addInitScript((s) => {
      if (s && !sessionStorage.getItem('ws-chat-seeded')) {
        sessionStorage.setItem('ws-chat', JSON.stringify(s));
        sessionStorage.setItem('ws-chat-seeded', '1');
      }
    }, seed || null);
    const page = await ctx.newPage();
    await page.route(CHAT_ENDPOINT, (route) => route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CHAT_CORS })
      : route.fulfill({ status: 200, headers: CHAT_CORS, contentType: 'application/json', body: JSON.stringify({ answer: 'Ten years [1].', sources: [{ id: 1, title: 'Resume', url: 'https://stephenprescott.github.io/resume/' }] }) }));
    return { ctx, page };
  };
  try {
    // 1. After an answered question.
    let { ctx, page } = await newPage();
    await page.goto(live.url + '/');
    await page.click('[data-chat-launcher]');
    await page.fill('[data-chat-input]', 'How long?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=log] .ws-chat-sources a');
    assert.deepEqual(await axeBad(page), [], 'answered question');
    await ctx.close();

    // 2. Restored conversation that overflows the log.
    const turns = [];
    for (let i = 0; i < 4; i++) turns.push({ role: 'user', content: `Question ${i}?` }, { role: 'assistant', content: LONG });
    ({ ctx, page } = await newPage(turns));
    await page.goto(live.url + '/');
    await page.click('[data-chat-launcher]');
    assert.ok(await page.$eval('[data-chat-log]', (l) => l.scrollHeight > l.clientHeight), 'log overflows');
    assert.deepEqual(await axeBad(page), [], 'restored overflowing conversation');
    await ctx.close();
  } finally {
    await live.close();
  }
});

test('JavaScript off at 320 and 390 px: the shell nav fits, no horizontal page scroll', async () => {
  const lacking = [];
  for (const width of [320, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, javaScriptEnabled: false });
    for (const p of SHELL) {
      const page = await ctx.newPage();
      await page.goto(server.url + p);
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      if (sw > iw) lacking.push(`${width} ${p} scrollWidth ${sw}`);
      // every nav link and the Résumé pill stay reachable and keep a 44px target
      for (const sel of ['.sh-links a', '.sh-res']) {
        for (const box of await page.$$eval(sel, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, right: r.right, w: r.width }; }))) {
          if (box.h < 43.5 || box.right > iw + 0.5 || box.w === 0) lacking.push(`${width} ${p} ${sel} ${JSON.stringify(box)}`);
        }
      }
      await page.close();
    }
    await ctx.close();
  }
  assert.deepEqual(lacking, []);
});

// The résumé keeps the old shell and its light/dark chat panel: axe with the panel open in both themes.
for (const theme of ['dark', 'light']) {
  test(`chat panel open on /resume/: axe finds no serious or critical violations in ${theme} theme`, async () => {
    const live = await serve(await build('development', { chatEndpoint: 'https://chat.test/ask' }));
    try {
      const ctx = await browser.newContext();
      await ctx.addInitScript((t) => localStorage.setItem('ws-theme', t), theme);
      const page = await ctx.newPage();
      await page.goto(live.url + '/resume/');
      assert.equal(await page.getAttribute('html', 'data-theme'), theme);
      await page.click('[data-chat-launcher]');
      assert.equal(await page.locator('[role=dialog]').isVisible(), true);
      assert.deepEqual(await axeBad(page), []);
      await ctx.close();
    } finally {
      await live.close();
    }
  });
}
