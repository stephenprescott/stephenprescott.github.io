import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';

const ENDPOINT = 'https://chat.test/ask';
const ORIGINAL = ['data-central', 'kyber-praxis', 'praxis-fasti', 'jobscan-board', 'steppenwolf'];
const CLIENT_STARTERS = [
  'What kinds of projects does Stephen take on?',
  'How does Stephen use AI in the data lifecycle?',
  'How can I contact Stephen?',
];

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

const order = (page) => page.$$eval('#work article.ws-project', (els) => els.map((e) => e.dataset.slug));

test('picker is hidden without JavaScript and the grid keeps its order', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(live.url + '/');
  assert.equal(await page.locator('fieldset[data-role-picker]').isVisible(), false);
  assert.deepEqual(await order(page), ORIGINAL);
  await ctx.close();
});

test('picker is a fieldset with legend and three native radios, shown with JS, nothing chosen', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(live.url + '/');
  const fs = page.locator('fieldset[data-role-picker]');
  assert.equal(await fs.isVisible(), true);
  assert.equal((await fs.locator('legend').innerText()).trim(), 'I\u2019m a\u2026'.replace('\u2019', "'"));
  assert.equal(await fs.locator('input[type=radio]').count(), 3);
  assert.equal(await fs.locator('input:checked').count(), 0);
  assert.deepEqual(await order(page), ORIGINAL);
  assert.equal(await page.locator('[role=dialog]').isVisible(), false);
  for (const box of await fs.locator('label').all()) assert.ok((await box.boundingBox()).height >= 44);
  await ctx.close();
});

test('choosing Client moves kyber-praxis first and changes the chat starters', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(live.url + '/');
  await page.getByLabel('Client').check();
  assert.deepEqual((await order(page))[0], 'kyber-praxis');
  assert.deepEqual((await order(page)).slice().sort(), ORIGINAL.slice().sort());
  await page.click('[data-chat-launcher]');
  const chips = await page.locator('[data-chat-starters] button').allInnerTexts();
  assert.deepEqual(chips.map((s) => s.trim()), CLIENT_STARTERS);
  await ctx.close();
});

test('switching roles reorders again; reload in the same tab keeps the choice', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(live.url + '/');
  await page.getByLabel('Client').check();
  await page.getByLabel('Recruiter').check();
  assert.equal((await order(page))[0], 'data-central');
  assert.deepEqual(await order(page), ORIGINAL);
  await page.getByLabel('Client').check();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ws-role')), 'client');
  await page.reload();
  assert.equal((await order(page))[0], 'kyber-praxis');
  assert.equal(await page.getByLabel('Client').isChecked(), true);
  await page.click('[data-chat-launcher]');
  const chips = await page.locator('[data-chat-starters] button').allInnerTexts();
  assert.deepEqual(chips.map((s) => s.trim()), CLIENT_STARTERS);
  await ctx.close();
});

test('without the chat widget only the grid reorders and nothing throws', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(plain.url + '/');
  await page.getByLabel('Client').check();
  assert.equal((await order(page))[0], 'kyber-praxis');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('project filter on /projects/ still works and has no role picker', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(live.url + '/projects/');
  assert.equal(await page.locator('[data-role-picker]').count(), 0);
  const buttons = page.locator('.ws-filter button');
  assert.ok((await buttons.count()) > 1);
  await buttons.nth(1).click();
  assert.ok((await page.locator('article.ws-project:visible').count()) < 5);
  await ctx.close();
});

test('Reset undoes a role choice: order, starters, storage, reload', async () => {
  const defaults = JSON.parse((await import('node:fs')).readFileSync('src/_data/chat.json', 'utf8')).starters;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(live.url + '/');
  const reset = page.locator('[data-role-reset]');
  assert.equal(await reset.isVisible(), false);
  await page.getByLabel('Client').check();
  assert.equal(await reset.isVisible(), true);
  assert.ok((await reset.boundingBox()).height >= 44);
  await reset.click();
  assert.deepEqual(await order(page), ORIGINAL);
  assert.equal(await page.locator('fieldset[data-role-picker] input:checked').count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ws-role')), null);
  assert.equal(await reset.isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.type), 'radio');
  await page.click('[data-chat-launcher]');
  const chips = await page.locator('[data-chat-starters] button').allInnerTexts();
  assert.deepEqual(chips.map((s) => s.trim()), defaults);
  await page.reload();
  assert.deepEqual(await order(page), ORIGINAL);
  assert.equal(await reset.isVisible(), false);
  await ctx.close();
});
