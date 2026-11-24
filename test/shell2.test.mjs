import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { build } from './helpers/build.mjs';
import { renderMacro, renderTemplate } from './helpers/render.mjs';

const root = resolve(import.meta.dirname, '..');
const site = JSON.parse(readFileSync(join(root, 'src/_data/site.json'), 'utf8'));
const chat = JSON.parse(readFileSync(join(root, 'src/_data/chat.json'), 'utf8'));
const $ = (html) => cheerio.load(html);
const C = 'components/';

test('shellNav: Main nav, brand, three links, one Résumé pill, no theme toggle', () => {
  const d = $(renderMacro(C + 'shell-nav.njk', 'shellNav', { site }));
  assert.equal(d('nav[aria-label="Main"]').length, 1);
  assert.equal(d('a.sh-brand').attr('href'), '/');
  assert.deepEqual(d('nav[aria-label="Main"] a').map((_, a) => d(a).text()).get(), ['Work', 'Expertise', 'Contact']);
  assert.equal(d('a[href="/resume/"]').length, 1);
  assert.equal(d('a[href="/resume/"]').text(), 'Résumé');
  assert.equal(d('[data-theme-toggle]').length, 0);
});

test('shellFooter: legal line, LinkedIn and mailto links', () => {
  const d = $(renderMacro(C + 'shell-footer.njk', 'shellFooter', { site }));
  assert.ok(d('footer').text().includes('© 2026 Stephen Groff.'));
  assert.equal(d('a[href*="linkedin.com"]').length, 1);
  assert.equal(d('a[href^="mailto:"]').length, 1);
});

test('shell layout: dark shell head, shell.css only, no theme script, deferred page scripts', () => {
  const html = renderTemplate('layouts/shell.njk', { site, chat, title: 'Test', content: '<p>hi</p>', scripts: ['/assets/js/x.js'], page: { url: '/x/' } });
  const d = $(html);
  assert.equal(d('html').attr('lang'), 'en');
  assert.ok(d('html').hasClass('sh'));
  assert.equal(d('html').attr('data-theme'), undefined);
  assert.ok(!html.includes('ws-theme'));
  assert.deepEqual(d('link[rel=stylesheet]').map((_, l) => d(l).attr('href')).get(), ['/assets/css/shell.css']);
  assert.ok(d('body').hasClass('sh-root'));
  assert.equal(d('a.sh-skip').attr('href'), '#main');
  assert.equal(d('main#main').text().trim(), 'hi');
  assert.equal(d('footer.sh-foot').length, 1);
  assert.equal(d('script[src="/assets/js/x.js"][defer]').length, 1);
  assert.equal(d('script[type="application/ld+json"]').length, 0);
});

test('shell layout: JSON-LD only on /', () => {
  const home = renderTemplate('layouts/shell.njk', { site, chat, content: '', page: { url: '/' } });
  assert.equal($(home)('script[type="application/ld+json"]').length, 1);
});

test('shell layout: chat panel, chat.js and chat.css only when chatEndpoint is set', () => {
  const base = { site, chat, title: 'Test', content: '', page: { url: '/x/' } };
  const on = $(renderTemplate('layouts/shell.njk', { ...base, chatEndpoint: 'https://chat.example/ask' }));
  assert.equal(on('[data-chat]').length, 1);
  assert.equal(on('script[src="/assets/js/chat.js"]').length, 1);
  assert.equal(on('link[href="/assets/css/chat.css"]').length, 1);
  const off = $(renderTemplate('layouts/shell.njk', base));
  assert.equal(off('[data-chat]').length, 0);
  assert.equal(off('script[src="/assets/js/chat.js"]').length, 0);
  assert.equal(off('link[href="/assets/css/chat.css"]').length, 0);
});

test('built site ships shell.css, Space Grotesk files and licence; shell.css is clean', async () => {
  const dir = await build();
  for (const w of [300, 400, 500, 600, 700]) {
    assert.ok(existsSync(join(dir, `assets/css/fonts/space-grotesk-latin-${w}-normal.woff2`)), String(w));
  }
  assert.ok(existsSync(join(dir, 'assets/css/fonts/space-grotesk-LICENSE.txt')));
  const css = readFileSync(join(dir, 'assets/css/shell.css'), 'utf8');
  assert.match(css, /Space Grotesk/);
  for (const bad of ['Gelasio', 'font-style:italic', 'background-clip:text']) assert.ok(!css.includes(bad), bad);
});
