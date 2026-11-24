import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { build } from './helpers/build.mjs';
import { renderTemplate } from './helpers/render.mjs';
import { assertNoPlaceholders } from '../lib/placeholders.mjs';
import { assertProductionConfig, chatEndpointFor } from '../lib/production.mjs';
import { buildLandingData } from '../lib/landing-data.mjs';

const root = resolve(import.meta.dirname, '..');
const data = (f) => JSON.parse(readFileSync(join(root, 'src/_data', f), 'utf8'));
const site = data('site.json');
const home = data('home.json');
const projects = data('projects.json');
const chat = data('chat.json');
const landing = buildLandingData(home, projects);

// The partial on its own, with the data the layout would see (chat off unless a test turns it on).
const ctx = (over = {}) => ({ site, home, chat, contact: { web3formsKey: '' }, chatEndpoint: '', landing, ...over });
const render = (over) => cheerio.load(renderTemplate('partials/landing.njk', ctx(over)));
const text = (el) => el.text().replace(/\s+/g, ' ').trim();
// Text of a section label without its generated number.
const label = ($, sel) => text($(sel).clone().children('.no').remove().end());

let built;
const page = () => (built ??= build().then((out) => cheerio.load(readFileSync(join(out, 'index.html'), 'utf8'))));

test('landing: hero, results, expertise, work and contact in order; old sections gone', async () => {
  const $ = await page();
  assert.deepEqual($('#top, #results, #expertise, #work, #contact').map((_, e) => e.attribs.id).get(), ['top', 'results', 'expertise', 'work', 'contact']);
  assert.ok($('#top').is('section.lp-hero'));
  assert.equal($('#about').length, 0);
  assert.equal($('[data-role-picker]').length, 0);
  assert.equal($('[data-theme-toggle]').length, 0);
  assert.doesNotMatch($('body').text(), /Experience and skills/);
});

test('landing: on the dark shell with landing.css, without the old stylesheets or landing scripts', async () => {
  const $ = await page();
  assert.ok($('body').hasClass('sh-root'));
  const css = $('link[rel=stylesheet]').map((_, l) => l.attribs.href).get();
  assert.deepEqual(css, ['/assets/css/shell.css', '/assets/css/landing.css']);
  for (const s of ['roles.js', 'filter.js', 'motion.js', 'theme.js']) assert.equal($(`script[src$="${s}"]`).length, 0, s);
});

test('hero: eyebrow, headline with its accent word, sentence, buttons and the scene hooks', async () => {
  const $ = await page();
  const hero = $('#top');
  assert.equal(text(hero.find('.lp-eyebrow')), home.hero.eyebrow);
  assert.equal($('h1').length, 1);
  assert.equal(text(hero.find('h1.lp-headline')), 'I turn data into decisions.');
  assert.equal(text(hero.find('h1 .acc')), 'decisions');
  assert.equal(text(hero.find('p.lp-lede')), 'I turn data into decisions for leadership, with AI in the data lifecycle.');
  assert.equal(text(hero.find('a[href="#contact"]')), 'Get in touch');
  const scene = hero.find('#lp-scene');
  assert.ok(scene.is('div'));
  assert.equal(scene.attr('aria-hidden'), 'true');
  assert.equal(scene.children().length, 0);
  assert.equal(text(hero.find('.lp-core-label')), "Stephen's AI");
  assert.equal(text(hero.find('p.sr')), "Illustration: a black hole labelled Stephen's AI. Each project is a constellation, and a stream of data runs from every constellation into it.");
  assert.doesNotMatch($('body').text(), /consultation|book a (call|meeting)|schedule a/i);
});

test('hero: one constellation per project, each with a drawing and a link to its case study', async () => {
  const $ = await page();
  const items = $('#top ul.lp-projects > li[data-slug]');
  assert.equal(items.length, projects.length);
  for (const p of landing.projects) {
    const li = items.filter((_, e) => e.attribs['data-slug'] === p.slug);
    assert.equal(li.find('svg').length, 1, p.slug);
    assert.equal(li.find(`a[href="/projects/${p.slug}/"]`).length, 1, p.slug);
    assert.ok(text(li).includes(p.shortTitle), p.slug);
  }
  assert.match(text($('ol.lp-work > li[data-slug="steppenwolf"]')), /In progress/);
});

test('results: four figures under "Results", heading "By the numbers."', async () => {
  const $ = await page();
  const figs = $('#results .lp-stats > [data-fig]');
  assert.deepEqual(figs.map((_, e) => text($(e).find('.lp-num'))).get(), ['10+', '600+', '70%+', '12+']);
  assert.deepEqual(figs.map((_, e) => e.attribs['data-fig']).get(), landing.figures.map((f) => f.id));
  assert.equal(label($, '#results .lp-label'), 'Results');
  assert.equal(text($('#results h2')), 'By the numbers.');
});

test('expertise: six areas server-rendered with body and proof links', async () => {
  const $ = await page();
  const areas = $('#expertise ul.lp-areas > li[data-area]');
  assert.equal(areas.length, 6);
  assert.deepEqual(areas.map((_, e) => label($, $(e).find('h3'))).get(), home.expertise.items.map((i) => i.title));
  for (const i of home.expertise.items) assert.ok(text($(`li[data-area="${i.id}"]`)).includes(i.body), i.id);
  const ai = $('li[data-area="ai-tools-and-platforms"]');
  for (const s of ['data-central', 'kyber-praxis', 'praxis-fasti', 'jobscan-board']) assert.equal(ai.find(`a[href="/projects/${s}/"]`).length, 1, s);
  assert.equal(ai.find('a[href="/projects/steppenwolf/"]').length, 0);
  assert.match(text($('li[data-area="data-strategy"]')), /12\+/);
  assert.equal(label($, '#expertise .lp-label'), home.expertise.eyebrow);
  assert.equal(text($('#expertise h2')), 'Data and AI strategy, end to end.');
});

test('work: one row per project with heading, summary and case-study link', async () => {
  const $ = await page();
  const rows = $('#work ol.lp-work > li[data-slug]');
  assert.deepEqual(rows.map((_, e) => e.attribs['data-slug']).get(), projects.map((p) => p.slug));
  assert.equal($('#work details').length, 0);
  rows.each((i, e) => {
    const r = $(e);
    assert.equal(r.find('h3').length, 1);
    assert.ok(text(r).includes(projects[i].summary));
    assert.equal(r.find(`a[href="/projects/${projects[i].slug}/"]`).length, 1);
  });
  assert.equal(text($('#work h2')), "What I've built with AI.");
  assert.equal(text($('#contact h2')), "Let's talk.");
});

test('#lp-data holds the landing data as JSON, and nothing for a hero chat', async () => {
  const $ = await page();
  const json = JSON.parse($('script#lp-data[type="application/json"]').html());
  assert.deepEqual(Object.keys(json).sort(), ['areas', 'figures', 'projects']);
  for (const k of ['areas', 'figures', 'projects']) assert.deepEqual(json[k], landing[k], k);
});

test('data is escaped: HTML in titles renders as text and every "<" in the JSON script is escaped', () => {
  const nasty = '<b>x</b> & "y"';
  const tricky = 'a <!-- b <script>c</script> d';
  const html = renderTemplate('partials/landing.njk', ctx({
    home: { ...home, hero: { ...home.hero, pre: nasty } },
    landing: buildLandingData(home, [{ ...projects[0], title: nasty }, { ...projects[1], title: tricky, summary: tricky }]),
  }));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /<!-- b|<script>c/);
  const raw = html.match(/<script type="application\/json" id="lp-data">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(raw, /</);
  const lt = String.fromCharCode(92) + 'u003c'; // the six characters backslash-u-0-0-3-c
  assert.ok(raw.includes(lt + '!--') && raw.includes(lt + 'script'), 'every < is written as its \\u escape');
  const json = JSON.parse(raw);
  assert.equal(json.projects[0].title, nasty);
  assert.equal(json.projects[1].title, tricky);
  assert.equal(json.projects[1].summary, tricky);
});

test('no figures: the results section is omitted entirely', () => {
  const $ = render({ landing: { ...landing, figures: [] } });
  assert.equal($('#results').length, 0);
  assert.equal($('#expertise').length, 1);
});

test('a project without a drawing gets the generic glyph', () => {
  const $ = render({ landing: buildLandingData(home, [{ slug: 'new-thing', title: 'New thing', summary: 'S', caseStudy: {} }]) });
  assert.equal($('.lp-projects li[data-slug="new-thing"] svg.lp-glyph-generic').length, 1);
  assert.equal($('.lp-projects svg').length, 1);
});

test('a sixth project with a 60-character unbroken title renders in the hero and the work list', () => {
  const long = 'Supercalifragilisticexpialidocious'.repeat(2).slice(0, 60);
  const $ = render({ landing: buildLandingData(home, [...projects, { slug: 'long-one', title: long, summary: 'S', caseStudy: {} }]) });
  assert.equal($('.lp-projects > li').length, 6);
  assert.ok(text($('.lp-projects li[data-slug="long-one"]')).includes(long));
  assert.ok(text($('ol.lp-work li[data-slug="long-one"]')).includes(long));
});

test('chat: no endpoint renders no Ask button; an endpoint renders the hero Ask button and no hero chat box', () => {
  const off = render();
  assert.equal(off('[data-chat-open]').length, 0);
  const on = render({ chatEndpoint: 'https://chat.example/ask' });
  const ask = on('#top button[data-chat-open]');
  assert.equal(ask.length, 1);
  assert.notEqual(ask.attr('hidden'), undefined);
  assert.equal(text(ask), 'Ask my AI');
  for (const $ of [off, on]) {
    assert.equal($('.lp-chat, [data-chat-inline], [data-chat-starter]').length, 0);
    assert.deepEqual(Object.keys(JSON.parse($('#lp-data').html())).sort(), ['areas', 'figures', 'projects']);
  }
});

test('built / with a chat endpoint: no hero chat box; the floating launcher and the shell chat styles are there', async () => {
  const $ = cheerio.load(readFileSync(join(await build('development', { chatEndpoint: 'https://chat.example/ask' }), 'index.html'), 'utf8'));
  assert.equal($('.lp-chat, [data-chat-inline], [data-chat-starter]').length, 0);
  assert.equal($('#top button[data-chat-open]').length, 1);
  assert.equal($('.ws-chat-launcher[data-chat-launcher]').length, 1);
  assert.equal($('#ws-chat-panel').length, 1);
  const css = $('link[rel=stylesheet]').map((_, l) => l.attribs.href).get();
  assert.ok(css.indexOf('/assets/css/chat-shell.css') > css.indexOf('/assets/css/chat.css'), css.join(' '));
  assert.ok(css.indexOf('/assets/css/chat.css') > -1);
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
  const $ = render({ contact: { web3formsKey: '', enabled: false } });
  const section = $('#contact');
  assert.equal(section.find('form').length, 0);
  assert.doesNotMatch(section.html(), /not connected/);
  assert.equal(section.find(`a[href="mailto:${site.email}"]`).length, 1);
  assert.equal(section.find('a[href="https://www.linkedin.com/in/groffstephen"]').length, 1);
});

test('expertise covers the six themes and is approved (no placeholder flag)', () => {
  const text = JSON.stringify(home.expertise).toLowerCase();
  for (const k of ['lifecycle', 'strategy', 'ai', 'analytics', 'governance', 'advantage']) assert.ok(text.includes(k), k);
  assert.equal(home.expertise.placeholder, undefined);
  assert.equal(home.hero.placeholder, undefined);
  assert.equal(home.expertise.items.length, 6);
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
