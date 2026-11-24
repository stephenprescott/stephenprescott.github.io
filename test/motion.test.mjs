import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { build } from './helpers/build.mjs';
import { settleReveals } from './helpers/reveal.mjs';
import { serve } from './helpers/serve.mjs';
import { renderMacro } from './helpers/render.mjs';

const root = resolve(import.meta.dirname, '..');
const STAGES = ['Generation', 'Collection', 'Processing', 'Storage', 'Management', 'Analysis', 'Visualization', 'Interpretation', 'AI'];

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

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
}

test('reduced motion: no running animations and all reveal content visible', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await scrollThrough(page);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  const opacities = await page.$$eval('[data-reveal]', (els) => els.map((e) => getComputedStyle(e).opacity));
  assert.ok(opacities.length >= 3, 'sections are marked data-reveal');
  assert.ok(opacities.every((o) => o === '1'), opacities.join());
  await ctx.close();
});

test('JavaScript off: every [data-reveal] section is visible', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  const opacities = await page.$$eval('[data-reveal]', (els) => els.map((e) => getComputedStyle(e).opacity));
  assert.ok(opacities.length >= 3);
  assert.ok(opacities.every((o) => o === '1'), opacities.join());
  await ctx.close();
});

test('motion on: hero visual animates and sections reveal on scroll', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => document.getAnimations().length)) > 0);
  assert.equal(await page.evaluate(() => document.querySelector('#contact').classList.contains('is-in')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#contact')).opacity), '0');
  await scrollThrough(page);
  await page.waitForFunction(() => document.querySelector('#contact').classList.contains('is-in'));
  await page.waitForTimeout(900);
  const opacities = await page.$$eval('[data-reveal]', (els) => els.map((e) => getComputedStyle(e).opacity));
  assert.ok(opacities.every((o) => o === '1'), opacities.join());
  await ctx.close();
});

test('motion animates only transform and opacity', async () => {
  const css = readFileSync(join(root, 'src/assets/css/motion.css'), 'utf8');
  const props = [...css.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)].map((m) => m[1]);
  for (const p of props) assert.ok(!/\b(width|height|top|left|margin|padding|stroke-dash|all)\b/.test(p), p);
  const kf = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]).join('\n');
  const used = [...kf.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  for (const u of used) assert.ok(['transform', 'opacity'].includes(u), `keyframe animates ${u}`);
});

test('hero visual is decorative, labelled with the eight lifecycle stages and AI', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  const svg = page.locator('.hero-visual svg');
  assert.equal(await svg.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(await svg.locator('text').evaluateAll((els) => els.map((e) => e.textContent.trim())), STAGES);
  await ctx.close();
});

test('motion JS and CSS together stay under 15 KB', () => {
  const size = statSync(join(root, 'src/assets/js/motion.js')).size + statSync(join(root, 'src/assets/css/motion.css')).size;
  assert.ok(size < 15 * 1024, `${size} bytes`);
});

test('motion.js and the hero visual are loaded on the landing page only for motion', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(server.url + '/');
  assert.equal(res.status(), 200);
  assert.ok(await page.locator('link[href="/assets/css/motion.css"]').count());
  assert.ok(await page.locator('script[src="/assets/js/motion.js"]').count());
  await ctx.close();
});

for (const theme of ['dark', 'light']) {
  test(`motion on: axe finds no serious or critical violations on / in ${theme} theme`, async () => {
    const ctx = await browser.newContext({ colorScheme: theme, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await page.goto(server.url + '/');
    await page.waitForTimeout(300);
    await settleReveals(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(bad.map((v) => v.id), []);
    await ctx.close();
  });
}

test('motion on: 320px wide has no horizontal scroll', async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 320);
  await ctx.close();
});

test('motion on: role picker still reorders cards that stay visible', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.getByLabel('Client').check();
  const first = await page.$eval('#work article.ws-project', (e) => e.dataset.slug);
  assert.equal(first, 'kyber-praxis');
  assert.equal(await page.$eval('#work article.ws-project', (e) => getComputedStyle(e).opacity), '1');
  await ctx.close();
});

test('stat: count is opt-in; data-count carries the number', () => {
  assert.ok(!renderMacro('components/stat.njk', 'stat', { value: '12', label: 'L' }).includes('data-count'));
  assert.match(renderMacro('components/stat.njk', 'stat', { value: '12+', label: 'L', count: true }), /data-count="12"/);
});

test('count-up: wsMotion.count animates a data-count value and ends at its final text', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'probe';
    p.setAttribute('data-count', '40');
    p.textContent = '40+';
    document.querySelector('#about').after(p);
    window.seen = new Set();
    new MutationObserver(() => window.seen.add(p.textContent)).observe(p, { childList: true, characterData: true, subtree: true });
    window.wsMotion.count(p);
  });
  await page.waitForFunction(() => document.getElementById('probe').textContent === '40+' && window.seen.size > 3);
  await ctx.close();
});

test('failsafe: if motion.js never loads, every [data-reveal] section becomes visible after 3 s', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.route('**/assets/js/motion.js', (r) => r.abort());
  await page.goto(server.url + '/');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#contact')).opacity), '0');
  await page.waitForTimeout(4000); // 3 s timeout plus the 0.7 s fade
  const opacities = await page.$$eval('[data-reveal]', (els) => els.map((e) => getComputedStyle(e).opacity));
  assert.ok(opacities.length >= 3);
  assert.ok(opacities.every((o) => o === '1'), opacities.join());
  await ctx.close();
});

test('failsafe is failure-only: with motion.js running, an unseen section stays hidden past 3 s, then reveals on scroll', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.waitForTimeout(3500);
  const op = () => page.evaluate(() => getComputedStyle(document.querySelector('#contact')).opacity);
  assert.equal(await op(), '0');
  await page.evaluate(() => document.querySelector('#contact').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('#contact').classList.contains('is-in'));
  await page.waitForTimeout(900);
  assert.equal(await op(), '1');
  await ctx.close();
});

test('motion.js arriving after 3 s: sections end visible and are never re-hidden', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.route('**/assets/js/motion.js', async (r) => { await new Promise((x) => setTimeout(x, 4000)); await r.continue(); });
  await page.goto(server.url + '/', { waitUntil: 'commit' });
  await page.waitForTimeout(3900); // after the 3 s timeout and its 0.7 s fade, before motion.js arrives
  const op = () => page.evaluate(() => getComputedStyle(document.querySelector('#contact')).opacity);
  assert.equal(await op(), '1');
  await page.waitForTimeout(1500);
  assert.equal(await op(), '1');
  await page.waitForTimeout(1000);
  assert.equal(await op(), '1');
  await ctx.close();
});
