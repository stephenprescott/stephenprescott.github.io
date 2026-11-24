import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from './helpers/build.mjs';
import { renderTemplate } from './helpers/render.mjs';
import { assertNoPlaceholders } from '../lib/placeholders.mjs';
import { assertProductionConfig, chatEndpointFor } from '../lib/production.mjs';

const root = resolve(import.meta.dirname, '..');
const data = (f) => JSON.parse(readFileSync(join(root, 'src/_data', f), 'utf8'));
const site = data('site.json');
const home = data('home.json');

const ctx = (over = {}) => ({ site, home, experience: data('experience.json'), projects: data('projects.json'), articles: data('articles.json'), ...over });

test('development build: landing landmarks appear in the specified order', async () => {
  const html = readFileSync(join(await build(), 'index.html'), 'utf8');
  const marks = ['class="ws-skip"', 'class="ws-root ws-nav"', 'class="ws-hero-title"', 'id="expertise"', 'id="work"', 'id="about"', 'id="contact"', 'class="ws-root ws-footer"'];
  const at = marks.map((m) => html.indexOf(m));
  assert.ok(at.every((i) => i > -1), `missing landmark: ${marks.filter((_, i) => at[i] === -1)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'landmarks out of order');
});

test('empty data omits its section entirely (no orphan headings)', () => {
  const html = renderTemplate('partials/landing.njk', ctx({ home: { ...home, stats: [] }, experience: [], projects: [], articles: [] }));
  assert.doesNotMatch(html, /ws-stat/);
  assert.doesNotMatch(html, /id="writing"/);
  assert.doesNotMatch(html, /id="work"/);
  assert.doesNotMatch(html, /ws-timeline/);
});

test('present data renders its section', () => {
  const html = renderTemplate('partials/landing.njk', ctx({
    home: { ...home, stats: [{ value: '10+', label: 'Years' }] },
    articles: [{ title: 'A talk', meta: '2026' }],
  }));
  assert.match(html, /ws-stat-value">10\+</);
  assert.match(html, /id="writing"/);
});

test('HTML special characters in data are escaped', () => {
  const nasty = 'A & B <script>alert(1)</script> "q"';
  const html = renderTemplate('partials/landing.njk', ctx({
    home: { ...home, hero: { ...home.hero, pre: nasty, highlight: nasty, post: nasty } },
    experience: [{ period: nasty, title: nasty, org: nasty, body: nasty }],
  }));
  assert.match(html, /A &amp; B &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('assertNoPlaceholders is silent without placeholders and names every placeholder path', () => {
  assert.doesNotThrow(() => assertNoPlaceholders({ a: [{ placeholder: false }], b: { c: 1 } }));
  assert.throws(
    () => assertNoPlaceholders({ projects: [{ title: 'x' }, { title: 'y', placeholder: true }], home: { stats: [{ placeholder: true }] } }),
    (e) => e.message.includes('placeholder content in production') && e.message.includes('projects[1]') && e.message.includes('home.stats[0]'),
  );
});

async function withScanDir(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'scan-'));
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(value));
  const prev = process.env.PLACEHOLDER_SCAN_DIR;
  process.env.PLACEHOLDER_SCAN_DIR = dir;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.PLACEHOLDER_SCAN_DIR; else process.env.PLACEHOLDER_SCAN_DIR = prev;
  }
}

test('production build fails when scanned data holds a placeholder; development build ignores it', async () => {
  await withScanDir({ 'projects.json': [{ title: 'x', placeholder: true }] }, async () => {
    await assert.rejects(() => build('production'), /placeholder content in production: projects\[0\]/);
    await assert.doesNotReject(() => build('development'));
  });
});

const LIVE_CHAT = { endpoint: 'https://ask.example.workers.dev/', starters: [] };
const LIVE_CONTACT = { web3formsKey: 'public-test-key' };

test('production build succeeds when scanned data has no placeholders and launch values are set', async () => {
  await withScanDir({ 'projects.json': [{ title: 'x', placeholder: false }], 'chat.json': LIVE_CHAT, 'contact.json': LIVE_CONTACT }, async () => {
    await assert.doesNotReject(() => build('production'));
  });
});

test('assertProductionConfig: needs an https chat endpoint and a contact key unless disabled', () => {
  assert.doesNotThrow(() => assertProductionConfig({ chat: LIVE_CHAT, contact: LIVE_CONTACT }));
  assert.throws(() => assertProductionConfig({ chat: { endpoint: '' }, contact: LIVE_CONTACT }), /chat\.json endpoint/);
  assert.throws(() => assertProductionConfig({ chat: { endpoint: 'http://ask.example.dev/' }, contact: LIVE_CONTACT }), /chat\.json endpoint/);
  assert.throws(() => assertProductionConfig({ chat: undefined, contact: LIVE_CONTACT }), /chat\.json endpoint/);
  assert.throws(() => assertProductionConfig({ chat: LIVE_CHAT, contact: { web3formsKey: '  ' } }), /contact\.json web3formsKey/);
  assert.throws(() => assertProductionConfig({ chat: LIVE_CHAT, contact: undefined }), /contact\.json web3formsKey/);
  assert.throws(() => assertProductionConfig({ chat: { endpoint: '' }, contact: { web3formsKey: '' } }), (e) => /chat\.json/.test(e.message) && /contact\.json/.test(e.message));
  assert.doesNotThrow(() => assertProductionConfig({ chat: { endpoint: '', enabled: false }, contact: { web3formsKey: '', enabled: false } }));
  // CHAT_ENDPOINT (which wins over chat.json when rendering) also satisfies the gate.
  assert.doesNotThrow(() => assertProductionConfig({ chat: { endpoint: '' }, contact: LIVE_CONTACT }, { CHAT_ENDPOINT: 'https://ask.example.dev/' }));
});

test('chatEndpointFor: env var wins; "enabled": false renders no chat', () => {
  assert.equal(chatEndpointFor({ endpoint: 'https://a.dev/' }, {}), 'https://a.dev/');
  assert.equal(chatEndpointFor({ endpoint: 'https://a.dev/' }, { CHAT_ENDPOINT: 'http://localhost:8787/' }), 'http://localhost:8787/');
  assert.equal(chatEndpointFor({ endpoint: '' }, {}), '');
  assert.equal(chatEndpointFor({ endpoint: 'https://a.dev/', enabled: false }, { CHAT_ENDPOINT: 'http://localhost:8787/' }), '');
});

test('production build fails on an empty or non-https chat endpoint or an empty contact key', async () => {
  const ok = { 'projects.json': [{ title: 'x' }] };
  await withScanDir({ ...ok, 'chat.json': { endpoint: '' }, 'contact.json': LIVE_CONTACT }, async () => {
    await assert.rejects(() => build('production'), /chat\.json endpoint/);
    await assert.doesNotReject(() => build('development'));
  });
  await withScanDir({ ...ok, 'chat.json': { endpoint: 'http://ask.example.dev/' }, 'contact.json': LIVE_CONTACT }, async () => {
    await assert.rejects(() => build('production'), /chat\.json endpoint/);
  });
  await withScanDir({ ...ok, 'chat.json': LIVE_CHAT, 'contact.json': { web3formsKey: '' } }, async () => {
    await assert.rejects(() => build('production'), /contact\.json web3formsKey/);
  });
  await withScanDir({ ...ok, 'chat.json': { endpoint: '', enabled: false }, 'contact.json': { web3formsKey: '', enabled: false } }, async () => {
    await assert.doesNotReject(() => build('production'));
  });
});

test('contact "enabled": false renders email and LinkedIn links, no form', () => {
  const html = renderTemplate('partials/landing.njk', ctx({ contact: { web3formsKey: '', enabled: false } }));
  const section = html.slice(html.indexOf('id="contact"'));
  assert.doesNotMatch(section, /<form/);
  assert.doesNotMatch(section, /not connected/);
  assert.match(section, new RegExp(`href="mailto:${site.email}"`));
  assert.match(section, /href="https:\/\/www\.linkedin\.com\/in\/groffstephen"/);
});

test('landing order: hero, expertise, work, about, contact', async () => {
  const html = readFileSync(join(await build(), 'index.html'), 'utf8');
  const at = ['class="ws-hero-title"', 'id="expertise"', 'id="work"', 'id="about"', 'id="contact"'].map((m) => html.indexOf(m));
  assert.ok(at.every((i) => i > -1)); assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.doesNotMatch(html, /id="what-i-do"/);
});

test('expertise covers the six themes and is approved (no placeholder flag)', () => {
  const text = JSON.stringify(home.expertise).toLowerCase();
  for (const k of ['lifecycle', 'strategy', 'ai', 'analytics', 'governance', 'advantage']) assert.ok(text.includes(k), k);
  assert.equal(home.expertise.placeholder, undefined);
  assert.equal(home.hero.placeholder, undefined);
  assert.equal(home.expertise.items.length, 6);
});

test('hero has a contact call to action, one LinkedIn link (the social icon) and a JS-only Ask button', async () => {
  const html = readFileSync(join(await build(), 'index.html'), 'utf8');
  assert.match(html, /href="#contact"/);
  const hero = html.match(/<header class="ws-root ws-hero">[\s\S]*?<\/header>/)[0];
  assert.equal((hero.match(/linkedin\.com\/in\/groffstephen/g) || []).length, 1, 'LinkedIn appears once in the hero');
  assert.match(hero, /class="ws-social"[\s\S]*linkedin\.com\/in\/groffstephen/);
  assert.ok(!home.hero.ctas.some((c) => /linkedin/i.test(c.label + (c.href || ''))), 'no LinkedIn CTA button');
  assert.match(html, /<button[^>]*data-chat-open[^>]*hidden/);
  assert.doesNotMatch(html, /consultation|book a (call|meeting)|schedule a/i);
  assert.equal(home.hero.cta, undefined);
});

test('hero eyebrow and headline position Stephen for data and AI strategy', async () => {
  const html = readFileSync(join(await build(), 'index.html'), 'utf8');
  const eyebrow = html.match(/<header class="ws-root ws-hero"><p class="ws-eyebrow">(.*?)<\/p>/s)?.[1] ?? '';
  const title = html.match(/<h1 class="ws-hero-title">(.*?)<\/h1>/s)?.[1] ?? '';
  const text = (eyebrow + ' ' + title).replace(/<[^>]+>/g, ' ');
  assert.match(text, /\bdata\b/i);
  assert.match(text, /\bAI\b/);
  assert.match(text, /strateg/i);
});

test('landing with a contact key: form is live and enabled with JavaScript off', async () => {
  const { chromium } = await import('playwright');
  const { serve } = await import('./helpers/serve.mjs');
  const out = await build('development', { contact: { web3formsKey: 'test-key-123', placeholder: true } });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /action="https:\/\/api\.web3forms\.com\/submit"/);
  const server = await serve(out);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(server.url + '/');
    assert.equal(await page.locator('#contact form button[type=submit]').isEnabled(), true);
    assert.equal(await page.locator('#contact input[name=access_key]').count(), 1);
    assert.equal(await page.locator('#contact input[name=botcheck]').isVisible(), false);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('landing without a contact key: form stays disabled', async () => {
  const html = readFileSync(join(await build('development', { contact: { web3formsKey: '' } }), 'index.html'), 'utf8');
  assert.doesNotMatch(html, /web3forms/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
});
