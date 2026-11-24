import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { build } from './helpers/build.mjs';

// Size budgets for the landing page, on the built, unminified files.
// Each limit is the first measurement x 1.15, rounded up to the next KB (hero-scene.js 91300, landing-chart.js 27477,
// landing.css 33407 + shell.css 6233 = 39640, chat-shell.css 3289). Re-measured 2026-11-24 after the final review fixes
// (bytes): hero-scene.js 89881, landing-chart.js 28280, landing.css 35336 + shell.css 6807 = 42143, chat-shell.css 3289.
const KB = 1024;
const BUDGET = {
  'hero-scene.js': 103 * KB,
  'landing-chart.js': 31 * KB,
  'landing.css + shell.css': 45 * KB,
  'chat-shell.css': 4 * KB,
};

let site;
const built = () => (site ??= build('development', { chatEndpoint: 'https://ask.example.workers.dev/' }));
const size = async (rel) => statSync(join(await built(), 'assets', rel)).size;

test('hero-scene.js stays within its size budget', async () => {
  const n = await size('js/hero-scene.js');
  assert.ok(n <= BUDGET['hero-scene.js'], `${n} > ${BUDGET['hero-scene.js']} bytes`);
});

test('landing-chart.js stays within its size budget', async () => {
  const n = await size('js/landing-chart.js');
  assert.ok(n <= BUDGET['landing-chart.js'], `${n} > ${BUDGET['landing-chart.js']} bytes`);
});

test('landing.css and shell.css together stay within their size budget', async () => {
  const n = (await size('css/landing.css')) + (await size('css/shell.css'));
  assert.ok(n <= BUDGET['landing.css + shell.css'], `${n} > ${BUDGET['landing.css + shell.css']} bytes`);
});

test('chat-shell.css stays within its size budget', async () => {
  const n = await size('css/chat-shell.css');
  assert.ok(n <= BUDGET['chat-shell.css'], `${n} > ${BUDGET['chat-shell.css']} bytes`);
});

test('the landing page requests no script other than chat.js, hero-scene.js and landing-chart.js; both landing scripts are deferred', async () => {
  const $ = cheerio.load(readFileSync(join(await built(), 'index.html'), 'utf8'));
  const srcs = $('script[src]').map((_, e) => e.attribs.src).get().sort();
  assert.deepEqual(srcs, ['/assets/js/chat.js', '/assets/js/hero-scene.js', '/assets/js/landing-chart.js']);
  for (const s of ['hero-scene.js', 'landing-chart.js']) {
    assert.ok($(`script[src$="/${s}"]`).is('[defer]'), `${s} is deferred`);
  }
});
