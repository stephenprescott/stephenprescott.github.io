import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';
import { renderMacro } from './helpers/render.mjs';

const root = resolve(import.meta.dirname, '..');

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

test('landing page: reduced motion leaves no running animations', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await ctx.close();
});

test('landing page no longer loads motion.js, motion.css or the old landing scripts', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(server.url + '/');
  assert.equal(res.status(), 200);
  for (const sel of ['link[href="/assets/css/motion.css"]', 'script[src="/assets/js/motion.js"]', 'script[src="/assets/js/roles.js"]', 'script[src="/assets/js/filter.js"]', '[data-reveal]']) assert.equal(await page.locator(sel).count(), 0, sel);
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

test('motion JS and CSS together stay under 15 KB', () => {
  const size = statSync(join(root, 'src/assets/js/motion.js')).size + statSync(join(root, 'src/assets/css/motion.css')).size;
  assert.ok(size < 15 * 1024, `${size} bytes`);
});

test('stat: count is opt-in; data-count carries the number', () => {
  assert.ok(!renderMacro('components/stat.njk', 'stat', { value: '12', label: 'L' }).includes('data-count'));
  assert.match(renderMacro('components/stat.njk', 'stat', { value: '12+', label: 'L', count: true }), /data-count="12"/);
});

test('count-up (résumé, which still loads motion.js): wsMotion.count animates a data-count value and ends at its final text', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/resume/');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'probe';
    p.setAttribute('data-count', '40');
    p.textContent = '40+';
    document.querySelector('main').append(p);
    window.seen = new Set();
    new MutationObserver(() => window.seen.add(p.textContent)).observe(p, { childList: true, characterData: true, subtree: true });
    window.wsMotion.count(p);
  });
  await page.waitForFunction(() => document.getElementById('probe').textContent === '40+' && window.seen.size > 3);
  await ctx.close();
});
