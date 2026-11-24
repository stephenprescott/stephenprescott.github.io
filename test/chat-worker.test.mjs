import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { askWorkersAI, askHaiku, answer, loadPack, BusyError, _resetPackCache } from '../chat/src/models.mjs';
import { handle } from '../chat/src/worker.mjs';

const pack = {
  builtAt: '2026-01-01T00:00:00.000Z',
  sources: [
    { id: 1, title: 'About', url: 'https://example.com/about/', text: 'Stephen builds things.' },
    { id: 2, title: 'Projects', url: 'https://example.com/projects/', text: 'Project list.' },
  ],
};
const ORIGIN = 'https://stephenprescott.github.io';
const env = {
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8080`,
  KNOWLEDGE_URL: 'https://example.com/knowledge.json',
  WORKERS_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it',
};

function memoryKv() {
  const m = new Map();
  return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); } };
}
function okAi(text) {
  const a = { calls: 0, last: null, async run(model, p) { a.calls++; a.last = { model, p }; return { response: text }; } };
  return a;
}
function throwingAi() {
  const a = { calls: 0, async run() { a.calls++; throw new Error('quota'); } };
  return a;
}
function okAnthropic(text, stop = 'end_turn') {
  const c = { calls: 0, params: null, messages: { async create(p) { c.calls++; c.params = p; return { stop_reason: stop, content: [{ type: 'text', text }] }; } } };
  return c;
}
function failAnthropic() {
  const c = { calls: 0, messages: { async create() { c.calls++; throw new Error('down'); } } };
  return c;
}
const okFetch = async () => ({ ok: true, async json() { return pack; } });
const badFetch = async () => { throw new Error('offline'); };

function post(body, { origin = ORIGIN, ip = '1.1.1.1', raw } = {}) {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
  if (origin) headers.origin = origin;
  return new Request('https://worker.example/', { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
}
function mkEnv() { return { ...env, LIMITS: memoryKv() }; }

const realWarn = console.warn;
const realLog = console.log;
let warns;
let logs;
beforeEach(() => {
  _resetPackCache();
  warns = [];
  logs = [];
  console.warn = (...a) => { warns.push(a.join(' ')); };
  console.log = (...a) => { logs.push(a.join(' ')); };
});
afterEach(() => { console.warn = realWarn; console.log = realLog; });

test('logs workers-ai failure, haiku failure and the provider used', async () => {
  await answer({ question: 'q', history: [], pack, env, deps: { ai: throwingAi(), anthropic: okAnthropic('H [1].') } });
  assert.ok(warns.some((w) => w.includes('workers-ai failed') && w.includes('quota')));
  assert.ok(logs.some((l) => l.includes('answered haiku')));
  warns.length = 0; logs.length = 0;
  await assert.rejects(answer({ question: 'q', history: [], pack, env, deps: { ai: throwingAi(), anthropic: failAnthropic() } }), BusyError);
  assert.ok(warns.some((w) => w.includes('workers-ai failed')));
  assert.ok(warns.some((w) => w.includes('haiku failed') && w.includes('down')));
  warns.length = 0; logs.length = 0;
  await answer({ question: 'q', history: [], pack, env, deps: { ai: okAi('Y [1].'), anthropic: failAnthropic() } });
  assert.deepEqual(warns, []);
  assert.ok(logs.some((l) => l.includes('answered workers-ai')));
});

test('workers ai answers first', async () => {
  const r = await answer({ question: 'q', history: [], pack, env, deps: { ai: okAi('Yes [1].'), anthropic: failAnthropic() } });
  assert.equal(r.provider, 'workers-ai');
  assert.deepEqual(r.sources.map((s) => s.id), [1]);
});
test('falls back to Haiku when Workers AI throws', async () => {
  const r = await answer({ question: 'q', history: [], pack, env, deps: { ai: throwingAi(), anthropic: okAnthropic('Haiku [2].') } });
  assert.equal(r.provider, 'haiku');
  assert.equal(r.answer, 'Haiku [1].');
  assert.deepEqual(r.sources, [{ id: 1, title: 'Projects', url: 'https://example.com/projects/' }]);
});
test('both fail throws BusyError', async () => {
  await assert.rejects(answer({ question: 'q', history: [], pack, env, deps: { ai: throwingAi(), anthropic: failAnthropic() } }), BusyError);
});
test('empty Workers AI response falls back', async () => {
  const r = await answer({ question: 'q', history: [], pack, env, deps: { ai: okAi('   '), anthropic: okAnthropic('H [1].') } });
  assert.equal(r.provider, 'haiku');
});
test('askWorkersAI sends system, history, question, max_tokens 600, thinking off', async () => {
  const ai = okAi(' hi ');
  const out = await askWorkersAI(ai, 'm', 'SYS', [{ role: 'user', content: 'a' }], 'Q');
  assert.equal(out, 'hi');
  assert.deepEqual(ai.last.p, {
    messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'a' }, { role: 'user', content: 'Q' }],
    max_tokens: 600,
    chat_template_kwargs: { enable_thinking: false },
  });
});
test('askWorkersAI reads OpenAI-style choices[0].message.content (Gemma 4 shape)', async () => {
  const ai = { async run() { return { object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: ' answer [1] ' } }] }; } };
  assert.equal(await askWorkersAI(ai, 'm', 'SYS', [], 'Q'), 'answer [1]');
});
test('askWorkersAI throws when content is empty (reasoning used the budget)', async () => {
  const ai = { async run() { return { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking...' } }] }; } };
  await assert.rejects(askWorkersAI(ai, 'm', 'SYS', [], 'Q'), /Empty Workers AI response/);
});
test('haiku request never sends temperature and uses claude-haiku-5-5', async () => {
  const an = okAnthropic('ok');
  await askHaiku(an, 'SYS', [], 'Q');
  const p = an.params;
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.ok(!('temperature' in p));
  assert.equal(p.max_tokens, 2048);
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.deepEqual(p.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(p.messages, [{ role: 'user', content: 'Q' }]);
});
test('haiku refusal returns the contact-form message', async () => {
  const out = await askHaiku(okAnthropic('', 'refusal'), 'S', [], 'Q');
  assert.equal(out, "I can't help with that here. Please use the contact form.");
});
test('loadPack caches for 300 s and throws BusyError on failure', async () => {
  let n = 0;
  const f = async () => { n++; return okFetch(); };
  await loadPack(env, f, 1000);
  await loadPack(env, f, 1000 + 299_000);
  assert.equal(n, 1);
  await loadPack(env, f, 1000 + 301_000);
  assert.equal(n, 2);
  _resetPackCache();
  await assert.rejects(loadPack(env, badFetch), BusyError);
  _resetPackCache();
  await assert.rejects(loadPack(env, async () => ({ ok: false, status: 500 })), BusyError);
});

test('OPTIONS gives 204 with CORS for allowed origin only', async () => {
  const deps = { fetch: okFetch };
  const ok = await handle(new Request('https://w/', { method: 'OPTIONS', headers: { origin: ORIGIN } }), mkEnv(), deps);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const bad = await handle(new Request('https://w/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), mkEnv(), deps);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
test('GET ok and other methods 405', async () => {
  const g = await handle(new Request('https://w/'), mkEnv(), {});
  assert.deepEqual(await g.json(), { ok: true });
  assert.equal(g.headers.get('cache-control'), 'no-store');
  const d = await handle(new Request('https://w/', { method: 'DELETE' }), mkEnv(), {});
  assert.equal(d.status, 405);
});
test('successful POST returns answer and sources; leading assistant turn dropped', async () => {
  const ai = okAi('Yes [1].');
  const body = { question: 'hi', history: [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'u' }] };
  const r = await handle(post(body), mkEnv(), { ai, anthropic: failAnthropic(), fetch: okFetch });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const b = await r.json();
  assert.equal(b.answer, 'Yes [1].');
  assert.deepEqual(b.sources.map((s) => s.id), [1]);
  const sent = ai.last.p.messages;
  assert.equal(sent.length, 3);
  assert.equal(sent[1].role, 'user');
  assert.equal(sent[1].content, 'u');
});
test('both models fail -> 503 busy JSON', async () => {
  const r = await handle(post({ question: 'hi' }), mkEnv(), { ai: throwingAi(), anthropic: failAnthropic(), fetch: okFetch });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /busy/);
});
test('rejects foreign origin, bad JSON, empty and 501-char questions without calling a model', async () => {
  const ai = okAi('x');
  const an = okAnthropic('x');
  const deps = { ai, anthropic: an, fetch: okFetch };
  const cases = [
    [post({ question: 'hi' }, { origin: 'https://evil.example' }), 403, 'Origin not allowed'],
    [post({ question: 'hi' }, { origin: null }), 403, 'Origin not allowed'],
    [post(null, { raw: '{nope' }), 400],
    [post({ question: '' }), 400],
    [post({}), 400],
    [post({ question: 'a'.repeat(501) }), 400],
  ];
  for (const [req, status, err] of cases) {
    const r = await handle(req, mkEnv(), deps);
    assert.equal(r.status, status);
    if (err) assert.deepEqual(await r.json(), { error: err });
  }
  assert.equal(ai.calls, 0);
  assert.equal(an.calls, 0);
});
test('9th question in 5 minutes -> 429', async () => {
  const e = mkEnv();
  const deps = { ai: okAi('A [1].'), anthropic: failAnthropic(), fetch: okFetch, now: () => 1_000_000 };
  for (let i = 0; i < 8; i++) assert.equal((await handle(post({ question: 'q' }), e, deps)).status, 200);
  const r = await handle(post({ question: 'q' }), e, deps);
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, "You're asking quickly. Please wait a few minutes and try again.");
});
test('daily limit message', async () => {
  const e = mkEnv();
  const day = new Date(1_000_000).toISOString().slice(0, 10);
  await e.LIMITS.put(`day:${day}`, '300');
  const r = await handle(post({ question: 'q' }), e, { ai: okAi('x'), anthropic: failAnthropic(), fetch: okFetch, now: () => 1_000_000 });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, "The assistant has reached today's limit. Please use the contact form.");
});
test('KV failure fails closed with 503 and no model call', async () => {
  const ai = okAi('x');
  const an = okAnthropic('x');
  const e = { ...env, LIMITS: { async get() { throw new Error('kv'); }, async put() {} } };
  const r = await handle(post({ question: 'q' }), e, { ai, anthropic: an, fetch: okFetch });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /busy/);
  assert.equal(ai.calls + an.calls, 0);
});
test('knowledge pack unreachable -> 503 and no model call', async () => {
  const ai = okAi('x');
  const an = okAnthropic('x');
  const r = await handle(post({ question: 'q' }), mkEnv(), { ai, anthropic: an, fetch: badFetch });
  assert.equal(r.status, 503);
  assert.equal(ai.calls + an.calls, 0);
});
