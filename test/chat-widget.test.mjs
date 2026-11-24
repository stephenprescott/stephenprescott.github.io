import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';

const ENDPOINT = 'https://chat.test/ask';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
const OK = { answer: 'Ten years [1].', sources: [{ id: 1, title: 'Resume', url: 'https://stephenprescott.github.io/resume/' }] };

let live;
let plain;
let browser;
before(async () => {
  live = await serve(await build('development', { chatEndpoint: ENDPOINT }));
  plain = await serve(await build('development', { chatEndpoint: '' }));
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await live.close();
  await plain.close();
});

/** Fake the Worker. `handler(body)` returns { status, json }. Returns the collected request bodies. */
async function fakeWorker(page, handler = () => ({ status: 200, json: OK })) {
  const bodies = [];
  await page.route(ENDPOINT, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    bodies.push(body);
    const { status, json } = handler(body);
    return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(json) });
  });
  return bodies;
}

// 1440×900 unless a test sets its own viewport: on / the launcher steps aside while it would sit on a hero project,
// and at this size it does not, so tests about the chat itself can use it.
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  return { ctx, page };
}

test('panel never opens on its own', async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + '/');
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('[role=dialog]').isVisible(), false);
  assert.equal(await page.locator('[data-chat-launcher]').isVisible(), true);
  await ctx.close();
});

test('asking shows the answer and its source links', async () => {
  const { ctx, page } = await open();
  const bodies = await fakeWorker(page);
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  assert.equal(await page.locator('[role=dialog]').isVisible(), true);
  assert.equal(await page.getAttribute('[role=dialog]', 'aria-label'), "Ask Stephen's AI");
  assert.equal(await page.getAttribute('[role=log]', 'aria-live'), 'polite');
  assert.equal(await page.getAttribute('[data-chat-panel] [data-chat-input]', 'maxlength'), '500');
  await page.fill('[data-chat-panel] [data-chat-input]', 'How long?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] >> text=Ten years');
  const log = await page.innerText('[role=log]');
  assert.ok(log.includes('Ten years [1].'), 'keeps the [1] marker');
  assert.equal(await page.locator('[role=log] a[href="/resume/"]').count(), 1);
  assert.equal(await page.locator('[role=log] a[href="/resume/"]').innerText(), 'Resume');
  assert.deepEqual(bodies[0], { question: 'How long?', history: [] });
  // the second question carries the first turn as history
  await page.fill('[data-chat-panel] [data-chat-input]', 'And more?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('[role=log] [data-role=assistant]').length === 2);
  assert.equal(bodies[1].history.length, 2);
  assert.deepEqual(bodies[1].history[0], { role: 'user', content: 'How long?' });
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ws-chat')));
  assert.equal(stored.length, 4);
  await ctx.close();
});

test('model output is rendered as text, never HTML', async () => {
  const { ctx, page } = await open();
  await fakeWorker(page, () => ({
    status: 200,
    json: { answer: '<img src=x onerror="window.__pwn=1">hi', sources: [{ id: 1, title: 'Bad', url: 'javascript:alert(1)' }] },
  }));
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.fill('[data-chat-input]', 'x');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] >> text=hi');
  assert.equal(await page.locator('[role=log] img').count(), 0);
  assert.equal(await page.evaluate(() => window.__pwn), undefined);
  const hrefs = await page.$$eval('[role=log] a', (as) => as.map((a) => a.getAttribute('href')));
  assert.ok(hrefs.every((h) => !/^javascript:/i.test(h)), 'no javascript: links');
  await ctx.close();
});

test('no hero chat box on /: the floating launcher shows, and the hero Ask button opens the panel with its input focused', async () => {
  const { ctx, page } = await open();
  const bodies = await fakeWorker(page);
  await page.goto(live.url + '/');
  assert.equal(await page.locator('.lp-chat, [data-chat-inline], [data-chat-starter]').count(), 0);
  assert.equal(await page.locator('.ws-chat-launcher').isVisible(), true);
  assert.equal(await page.locator('button[data-chat-open]').isVisible(), true);
  await page.click('button[data-chat-open]');
  assert.equal(await page.locator('#ws-chat-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#ws-chat-panel [data-chat-input]')), true);
  await page.keyboard.type('What do you do?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] >> text=Ten years');
  assert.equal(bodies[0].question, 'What do you do?');
  await ctx.close();
});

test('starter chips send their question', async () => {
  const { ctx, page } = await open();
  const bodies = await fakeWorker(page);
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.click('[data-chat-starters] button >> nth=0');
  await page.waitForSelector('[role=log] >> text=Ten years');
  assert.equal(bodies[0].question, 'What has Stephen built with AI?');
  await ctx.close();
});

test('StephenChat API and ws:role starters', async () => {
  const { ctx, page } = await open();
  const bodies = await fakeWorker(page);
  await page.goto(live.url + '/');
  assert.deepEqual(await page.evaluate(() => Object.keys(window.StephenChat).sort()), ['ask', 'open', 'setStarters']);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('ws:role', { detail: { starters: ['Role question one?', 'Two?'] } })));
  await page.evaluate(() => window.StephenChat.open());
  assert.deepEqual(await page.$$eval('[data-chat-starters] button', (b) => b.map((x) => x.textContent.trim())), ['Role question one?', 'Two?']);
  await page.evaluate(() => window.StephenChat.ask('Via API'));
  await page.waitForSelector('[role=log] >> text=Ten years');
  assert.equal(bodies[0].question, 'Via API');
  await ctx.close();
});

test('error response shows the error text and keeps the input', async () => {
  const { ctx, page } = await open();
  await fakeWorker(page, () => ({ status: 429, json: { error: 'Too many questions. Try again soon.' } }));
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.fill('[data-chat-input]', 'Will this fail?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] >> text=Too many questions');
  assert.equal(await page.inputValue('[data-chat-input]'), 'Will this fail?');
  assert.equal(await page.locator('[data-chat-input]').isEnabled(), true);
  await ctx.close();
});

test('network failure shows a plain error and keeps the input', async () => {
  const { ctx, page } = await open();
  await page.route(ENDPOINT, (route) => route.abort());
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.fill('[data-chat-input]', 'Offline?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] [data-role=error]');
  assert.equal(await page.inputValue('[data-chat-input]'), 'Offline?');
  await ctx.close();
});

test('Escape closes the panel and returns focus to the launcher', async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chat-input]')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chat-launcher]')), true);
  await ctx.close();
});

test('focus is trapped in the panel while open', async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')), true, `tab ${i}`);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')), true, `shift-tab ${i}`);
  }
  await ctx.close();
});

test('hero Ask button is keyboard-focusable with a visible focus outline once revealed', async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + '/');
  await page.waitForSelector('[data-chat-open]', { state: 'visible' });
  await page.focus('[data-chat-open]');
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { is: el.matches('[data-chat-open]'), style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  assert.equal(info.is, true);
  assert.notEqual(info.style, 'none');
  assert.ok(info.width > 0);
  // reachable by Tab and opens with Enter
  await page.reload();
  await page.waitForSelector('[data-chat-open]', { state: 'visible' });
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement.matches('[data-chat-open]'));
  }
  assert.equal(reached, true, 'reachable by Tab');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[role=dialog]').isVisible(), true);
  await ctx.close();
});

test('no chat UI or AI-provider notice text in the page', async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  const text = await page.evaluate(() => document.querySelector('[data-chat]').textContent);
  assert.doesNotMatch(text, /Gemini|Gemma|Google|Anthropic|Claude|Cloudflare|Workers AI|improve .* products/i);
  await ctx.close();
});

test('reduced motion: chat widget has no transitions', async () => {
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  const bad = await page.$$eval('[data-chat], [data-chat] *', (els) =>
    els
      .map((e) => `${e.tagName}.${e.className}:${getComputedStyle(e).transitionDuration}|${getComputedStyle(e).animationName}`)
      .filter((d) => !/:0s(, 0s)*\|none$/.test(d)));
  assert.deepEqual(bad, []);
  await ctx.close();
});

test('320px: panel fits the viewport with no horizontal scroll', async () => {
  const { ctx, page } = await open({ viewport: { width: 320, height: 640 } });
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 320);
  const box = await page.locator('[role=dialog]').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 320, JSON.stringify(box));
  await ctx.close();
});

test('JavaScript off: no chat UI visible, contact section reachable', async () => {
  const { ctx, page } = await open({ javaScriptEnabled: false });
  await page.goto(live.url + '/');
  assert.equal(await page.locator('[data-chat-launcher]').isVisible(), false);
  assert.equal(await page.locator('[role=dialog]').isVisible(), false);
  assert.equal(await page.locator('[data-chat-open]').isVisible(), false);
  assert.equal(await page.locator('#contact').isVisible(), true);
  await ctx.close();
});

test('no endpoint configured: no chat markup at all', async () => {
  const { ctx, page } = await open();
  await page.goto(plain.url + '/');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.equal(await page.locator('[data-chat]').count(), 0);
  assert.equal(await page.locator('form[data-chat-inline]').count(), 0);
  assert.equal(await page.locator('[data-chat-open]').isVisible(), false);
  assert.equal(await page.evaluate(() => typeof window.StephenChat), 'undefined');
  await ctx.close();
});

/** Distinct line tops of an element's text: 1 means the label sits on one line. */
const lineCount = (page, sel) => page.$eval(sel, (el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
});

for (const vp of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
  test(`${vp.width}px: Send, Close and hero Ask labels stay on one line`, async () => {
    const { ctx, page } = await open({ viewport: vp });
    await page.goto(live.url + '/');
    await page.waitForSelector('button[data-chat-open]', { state: 'visible' });
    assert.equal(await lineCount(page, 'button[data-chat-open]'), 1, 'hero Ask');
    assert.equal(await lineCount(page, '[data-chat-launcher]'), 1, 'launcher');
    await page.click('button[data-chat-open]'); // the launcher may be stepping aside for the hero projects here
    for (const sel of ['[data-chat-send]', '[data-chat-close]']) {
      assert.equal(await lineCount(page, sel), 1, sel);
      const { h, lh } = await page.$eval(sel, (el) => {
        const s = getComputedStyle(el);
        const pad = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
        const r = document.createRange();
        r.selectNodeContents(el);
        const line = parseFloat(s.lineHeight) || r.getClientRects()[0].height; // lineHeight may be "normal"
        return { h: el.getBoundingClientRect().height, lh: Math.max(parseFloat(s.minHeight) || 0, line + pad) };
      });
      assert.ok(h <= lh + 1, `${sel} height ${h} exceeds one line box ${lh}`);
    }
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= vp.width);
    await ctx.close();
  });
}

test('citation markers match the numbers shown in the source list (non-sequential ids)', async () => {
  const { ctx, page } = await open();
  await fakeWorker(page, () => ({
    status: 200,
    json: {
      answer: 'Built Data Central [7]. Ten years [12].',
      sources: [
        { id: 7, title: 'Data Central', url: 'https://stephenprescott.github.io/projects/data-central/' },
        { id: 12, title: 'Resume', url: 'https://stephenprescott.github.io/resume/' },
      ],
    },
  }));
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.fill('[data-chat-input]', 'What?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] .ws-chat-sources li');
  const shown = await page.$$eval('[role=log] .ws-chat-sources li', (lis) => lis.map((li) => [li.value, li.textContent.trim()]));
  assert.deepEqual(shown, [[7, 'Data Central'], [12, 'Resume']]);
  await ctx.close();
});

test('a request that never answers times out: busy text shown, form usable again', async () => {
  const { ctx, page } = await open();
  await page.clock.install();
  await page.route(ENDPOINT, () => { /* never fulfilled */ });
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.fill('[data-chat-input]', 'Hello?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] [data-role=pending]');
  await page.clock.fastForward('00:31');
  await page.waitForSelector('[role=log] [data-role=error]');
  assert.match(await page.innerText('[role=log] [data-role=error]'), /busy right now/);
  assert.equal(await page.locator('[role=log] [data-role=pending]').count(), 0);
  assert.equal(await page.inputValue('[data-chat-input]'), 'Hello?');
  assert.equal(await page.$eval('[data-chat-input]', (el) => el.readOnly || el.disabled), false);
  assert.equal(await page.getAttribute('[data-chat-form]', 'aria-busy'), 'false');
  await ctx.close();
});

test('focus stays on the question field while a request is in flight', async () => {
  const { ctx, page } = await open();
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(ENDPOINT, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    await held;
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(OK) });
  });
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.fill('[data-chat-input]', 'Wait?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] [data-role=pending]');
  const during = await page.evaluate(() => {
    const i = document.querySelector('[data-chat-input]');
    return {
      focused: document.activeElement === i,
      readOnly: i.readOnly,
      ariaDisabled: i.getAttribute('aria-disabled'),
      busy: document.querySelector('[data-chat-form]').getAttribute('aria-busy'),
      logBusy: document.querySelector('[data-chat-log]').getAttribute('aria-busy'),
    };
  });
  assert.deepEqual(during, { focused: true, readOnly: true, ariaDisabled: 'true', busy: 'true', logBusy: 'true' });
  release();
  await page.waitForSelector('[role=log] >> text=Ten years');
  const afterIt = await page.evaluate(() => {
    const i = document.querySelector('[data-chat-input]');
    return { focused: document.activeElement === i, readOnly: i.readOnly, ariaDisabled: i.getAttribute('aria-disabled'), busy: document.querySelector('[data-chat-form]').getAttribute('aria-busy') };
  });
  assert.deepEqual(afterIt, { focused: true, readOnly: false, ariaDisabled: 'false', busy: 'false' });
  await ctx.close();
});

test('starter chip click keeps focus inside the dialog', async () => {
  const { ctx, page } = await open();
  await fakeWorker(page);
  await page.goto(live.url + '/');
  await page.click('[data-chat-launcher]');
  await page.click('[data-chat-starters] button >> nth=0');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')), true);
  await page.waitForSelector('[role=log] >> text=Ten years');
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chat-input]')), true);
  await ctx.close();
});

test('conversation log is keyboard-focusable and the launcher controls the panel', async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + '/');
  assert.equal(await page.getAttribute('[data-chat-log]', 'tabindex'), '0');
  assert.equal(await page.getAttribute('[data-chat-launcher]', 'aria-expanded'), 'false');
  const id = await page.getAttribute('[data-chat-launcher]', 'aria-controls');
  assert.ok(id);
  assert.equal(await page.getAttribute(`#${id}`, 'role'), 'dialog');
  await ctx.close();
});

// The dark restyle (chat-shell.css) on the shell: Space Grotesk, borderless pills, a pill launcher clear of the text.
for (const path of ['/', '/projects/']) test(`shell chat restyle on ${path}: Space Grotesk, palette colours, borderless pill buttons, a soft pill input`, async () => {
  const { ctx, page } = await open();
  await page.goto(live.url + path);
  await page.waitForSelector('[data-chat-launcher]', { state: 'visible' });
  // read before the click: afterwards the pointer rests on the launcher and it shows its hover colour
  const launcherBg = await page.$eval('[data-chat-launcher]', (el) => getComputedStyle(el).backgroundColor);
  await page.click('[data-chat-launcher]');
  const s = await page.evaluate(() => {
    const g = (sel) => getComputedStyle(document.querySelector(sel));
    const launcher = g('[data-chat-launcher]'), send = g('[data-chat-send]'), close = g('[data-chat-close]'), input = g('[data-chat-input]'), panel = g('#ws-chat-panel'), title = g('.ws-chat-title');
    return {
      title: title.fontFamily, input: input.fontFamily, sendFont: send.fontFamily,
      panelBg: panel.backgroundColor, panelInk: panel.color,
      sendBorder: send.borderTopWidth, closeBorder: close.borderTopWidth, launcherBorder: launcher.borderTopWidth,
      sendBg: send.backgroundColor,
      radii: [launcher, send, close, input].map((x) => parseFloat(x.borderTopLeftRadius)),
      inputBorder: input.borderTopColor,
    };
  });
  assert.match(s.title, /^"?Space Grotesk/);
  assert.match(s.input, /^"?Space Grotesk/);
  assert.match(s.sendFont, /^"?Space Grotesk/);
  assert.equal(s.panelBg, 'rgb(13, 17, 23)');
  assert.equal(s.panelInk, 'rgb(216, 222, 233)');
  assert.deepEqual([s.sendBorder, s.closeBorder, s.launcherBorder], ['0px', '0px', '0px']);
  assert.equal(s.sendBg, 'rgb(255, 138, 92)');
  assert.equal(launcherBg, 'rgb(255, 138, 92)');
  for (const r of s.radii) assert.ok(r >= 22, `pill radius ${r}`);
  // a barely visible border on the input: low alpha
  const alpha = Number((s.inputBorder.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1]);
  assert.ok(alpha > 0 && alpha <= 0.2, `input border ${s.inputBorder}`);
  await ctx.close();
});

// The launcher yields to the hero's projects: on / it hides (out of the tab order) while it would sit on a project
// item or the "+N more below" line, and comes back once nothing is under it. The hero's "Ask my AI" is the entry meanwhile.
const LAUNCHER_SIZES = [
  { width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1280, height: 780 }, { width: 1280, height: 760 },
  { width: 1280, height: 740 }, { width: 1024, height: 768 }, { width: 390, height: 844 },
];
// rAF twice, then let the fade finish
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))));
const launcherShown = (page) => page.$eval('[data-chat-launcher]', (l) => !l.hidden && getComputedStyle(l).visibility !== 'hidden');
// visible hero project items (box, glyph, label) and the "+N more below" line that the launcher overlaps
const launcherHits = (page) => page.evaluate(() => {
  const l = document.querySelector('[data-chat-launcher]').getBoundingClientRect();
  const items = [...document.querySelectorAll('.lp-projects > li:not(.lp-off), .lp-projects > li:not(.lp-off) .lp-proj-t, .lp-projects > li:not(.lp-off) .lp-proj-e, a.lp-more-below')];
  return items.filter((e) => [...e.getClientRects()].some((b) => b.width && Math.min(b.right, l.right) > Math.max(b.left, l.left) && Math.min(b.bottom, l.bottom) > Math.max(b.top, l.top)))
    .map((e) => (e.closest('li') ? e.closest('li').dataset.slug : 'more') + ' ' + e.className);
});
const loadLanding = async (page) => {
  await page.goto(live.url + '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-scene-on'), null, { timeout: 30000 });
  await page.waitForSelector('[data-chat-launcher]', { state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('[data-chat-launcher]').hidden);
  await settle(page);
};

for (const vp of LAUNCHER_SIZES) {
  test(`${vp.width}×${vp.height}: the launcher never sits on a hero project while shown, covers no hero or footer text`, async () => {
    const { ctx, page } = await open({ viewport: vp });
    await loadLanding(page);
    const heroEnd = await page.evaluate(() => { const h = document.getElementById('top'); return h.offsetTop + h.offsetHeight; });
    const bad = [];
    for (let y = 0; y <= heroEnd + 60; y += 60) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await settle(page);
      if (await launcherShown(page)) for (const h of await launcherHits(page)) bad.push(`scroll ${y}: ${h}`);
    }
    assert.deepEqual(bad, []);
    // and no hero or footer text under it while it shows
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await settle(page);
    const covered = (sel) => page.evaluate((s) => {
      const el = document.querySelector('[data-chat-launcher]');
      if (getComputedStyle(el).visibility === 'hidden') return [];
      const l = el.getBoundingClientRect();
      const out = [];
      for (const e of document.querySelectorAll(s)) {
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent.trim()) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const b of r.getClientRects()) {
            if (b.width && Math.min(b.right, l.right) > Math.max(b.left, l.left) && Math.min(b.bottom, l.bottom) > Math.max(b.top, l.top)) out.push(n.textContent.trim());
          }
        }
      }
      return out;
    }, sel);
    assert.deepEqual(await covered('.lp-text, .lp-projects > li:not(.lp-off), .lp-more-note'), [], 'hero');
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await settle(page);
    assert.equal(await launcherShown(page), true, 'shown at the bottom of the page');
    assert.deepEqual(await covered('.sh-foot'), [], 'footer');
    await ctx.close();
  });
}

for (const vp of [{ width: 1280, height: 740 }, { width: 1280, height: 760 }, { width: 1280, height: 780 }, { width: 1024, height: 768 }]) {
  test(`${vp.width}×${vp.height}: the launcher is hidden on load (Ask my AI still opens the chat) and returns past the hero`, async () => {
    const { ctx, page } = await open({ viewport: vp });
    await loadLanding(page);
    assert.equal(await launcherShown(page), false, 'hidden on load');
    assert.equal(await page.locator('[data-chat-launcher]').isVisible(), false);
    // out of the tab order: it cannot take focus while hidden
    assert.equal(await page.$eval('[data-chat-launcher]', (l) => { l.focus(); return document.activeElement === l; }), false, 'not focusable');
    await page.click('button[data-chat-open]');
    assert.equal(await page.locator('#ws-chat-panel').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#ws-chat-panel').isVisible(), false);
    await page.evaluate(() => { const h = document.getElementById('top'); window.scrollTo({ top: h.offsetTop + h.offsetHeight, behavior: 'instant' }); });
    await settle(page);
    assert.equal(await launcherShown(page), true, 'back after scrolling past the hero');
    await page.click('[data-chat-launcher]');
    assert.equal(await page.locator('#ws-chat-panel').isVisible(), true);
    await ctx.close();
  });
}

test('1440×900: the launcher shows on load', async () => {
  const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
  await loadLanding(page);
  assert.equal(await launcherShown(page), true);
  assert.equal(await page.locator('[data-chat-launcher]').isVisible(), true);
  await ctx.close();
});

test('reduced motion: the launcher yields without a fade', async () => {
  const { ctx, page } = await open({ viewport: { width: 1280, height: 760 }, reducedMotion: 'reduce' });
  await loadLanding(page);
  const s = await page.$eval('[data-chat-launcher]', (l) => ({ v: getComputedStyle(l).visibility, t: getComputedStyle(l).transitionDuration }));
  assert.equal(s.v, 'hidden');
  assert.match(s.t, /^0s(, 0s)*$/);
  await ctx.close();
});

// No flash: on / the launcher stays invisible from first paint until the scene's first yield check has run.
// A rAF loop (installed before any page script) records every frame in which the launcher is actually visible.
const watchLauncher = (page) => page.addInitScript(() => {
  const w = (window.__lw = { shownFrames: 0, firstShownAt: -1, waitClassSeen: false });
  const tick = () => {
    const l = document.querySelector('[data-chat-launcher]');
    if (l && !l.hidden) {
      const cs = getComputedStyle(l);
      if (cs.display !== 'none' && cs.visibility === 'visible' && Number(cs.opacity) > 0) {
        w.shownFrames++;
        if (w.firstShownAt < 0) w.firstShownAt = performance.now();
        w.sceneReadyWhenShown = document.documentElement.classList.contains('lp-scene-on') && !document.documentElement.classList.contains('lp-chat-wait');
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

test('1280×740: the launcher yields on load and is never visible on the way (no flash)', async () => {
  const { ctx, page } = await open({ viewport: { width: 1280, height: 740 } });
  await watchLauncher(page);
  await page.goto(live.url + '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-scene-on'), null, { timeout: 30000 });
  await page.waitForFunction(() => !document.documentElement.classList.contains('lp-chat-wait'), null, { timeout: 30000 });
  await settle(page);
  assert.equal(await launcherShown(page), false);
  assert.equal(await page.evaluate(() => window.__lw.shownFrames), 0);
  await ctx.close();
});

test('1440×900: the launcher appears only after the scene is ready', async () => {
  const { ctx, page } = await open();
  await watchLauncher(page);
  await page.goto(live.url + '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-scene-on'), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__lw.shownFrames > 0, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__lw.sceneReadyWhenShown), true);
  assert.equal(await page.locator('[data-chat-launcher]').isVisible(), true);
  await ctx.close();
});

test('the scene script blocked: the launcher still ends up visible', async () => {
  const { ctx, page } = await open();
  await page.route('**/hero-scene.js', (route) => route.abort());
  await page.goto(live.url + '/');
  await page.waitForFunction(() => !document.querySelector('[data-chat-launcher]').hidden && getComputedStyle(document.querySelector('[data-chat-launcher]')).visibility === 'visible' && Number(getComputedStyle(document.querySelector('[data-chat-launcher]')).opacity) > 0, null, { timeout: 10000 });
  assert.equal(await page.locator('[data-chat-launcher]').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lp-chat-wait')), false);
  await ctx.close();
});

test('the scene script failing to run: the launcher is not left hidden', async () => {
  const { ctx, page } = await open();
  await page.route('**/hero-scene.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("scene down");' }));
  page.on('pageerror', () => {});
  await page.goto(live.url + '/');
  await page.waitForFunction(() => !document.documentElement.classList.contains('lp-chat-wait'), null, { timeout: 15000 });
  assert.equal(await page.locator('[data-chat-launcher]').isVisible(), true);
  await ctx.close();
});

// /resume/ keeps its own chat panel: values captured before the shell restyle (Task 7).
for (const [theme, bg] of [['light', 'rgb(216, 222, 233)'], ['dark', 'rgb(13, 17, 23)']]) {
  test(`/resume/ chat panel unchanged in ${theme} theme`, async () => {
    const { ctx, page } = await open();
    await ctx.addInitScript((t) => localStorage.setItem('ws-theme', t), theme);
    await page.goto(live.url + '/resume/');
    await page.click('[data-chat-launcher]');
    const s = await page.evaluate(() => {
      const g = (sel) => getComputedStyle(document.querySelector(sel));
      return { bg: g('.ws-chat-panel').backgroundColor, font: g('.ws-chat-panel').fontFamily, launcherRadius: g('.ws-chat-launcher').borderTopLeftRadius, sendRadius: g('[data-chat-send]').borderTopLeftRadius };
    });
    assert.deepEqual(s, { bg, font: 'Georgia, Gelasio, serif', launcherRadius: '4px', sendRadius: '4px' });
    await ctx.close();
  });
}
