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

async function open(opts = {}) {
  const ctx = await browser.newContext(opts);
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

test('hero Ask button and inline form open the panel and send', async () => {
  const { ctx, page } = await open();
  const bodies = await fakeWorker(page);
  await page.goto(live.url + '/');
  assert.equal(await page.locator('[data-chat-open]').isVisible(), true);
  assert.equal(await page.locator('form[data-chat-inline]').isVisible(), true);
  await page.click('[data-chat-open]');
  assert.equal(await page.locator('[role=dialog]').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').isVisible(), false);
  await page.fill('form[data-chat-inline] input', 'What do you do?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=log] >> text=Ten years');
  assert.equal(await page.locator('[role=dialog]').isVisible(), true);
  assert.equal(bodies[0].question, 'What do you do?');
  assert.equal(await page.inputValue('form[data-chat-inline] input'), '');
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
  const text = await page.evaluate(() => document.querySelector('[data-chat]').textContent + document.querySelector('form[data-chat-inline]').textContent);
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
  assert.equal(await page.locator('form[data-chat-inline]').isVisible(), false);
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
    await page.waitForSelector('form[data-chat-inline] button', { state: 'visible' });
    assert.equal(await lineCount(page, 'form[data-chat-inline] button'), 1, 'inline Ask');
    await page.click('[data-chat-launcher]');
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
