import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judge } from '../chat/scripts/eval-rules.mjs';
import { runEval, askWithRetry, spacingMs, DEFAULT_SPACING_MS, RETRY_AFTER_429_MS, REQUEST_TIMEOUT_MS } from '../chat/scripts/eval-run.mjs';

const ok = (answer, sources = []) => ({ status: 200, body: { answer, sources } });
const src = [{ id: 1, title: 'Resume', url: 'https://example.com/resume/' }];

test('answer + mustCite passes with a source', () => {
  assert.equal(judge({ expect: 'answer', mustCite: true }, ok('Yes [1].', src)).pass, true);
});
test('answer + mustCite fails with no sources', () => {
  const r = judge({ expect: 'answer', mustCite: true }, ok('Yes.', []));
  assert.equal(r.pass, false);
  assert.match(r.reason, /source/i);
});
test('answer without mustCite passes with no sources', () => {
  assert.equal(judge({ expect: 'answer' }, ok('Yes.')).pass, true);
});
test('decline passes on each decline phrase', () => {
  for (const t of ["The site doesn't cover that.", 'Please use the contact form.', "Sorry, I can't help with that."]) {
    assert.equal(judge({ expect: 'decline' }, ok(t)).pass, true, t);
  }
});
test('decline fails when answer does not decline', () => {
  assert.equal(judge({ expect: 'decline' }, ok('It will be sunny tomorrow.')).pass, false);
});
test('mustNotMatch is case-insensitive and fails on a hit', () => {
  const r = judge({ expect: 'decline', mustNotMatch: 'Google' }, ok("I can't help; he never worked at GOOGLE."));
  assert.equal(r.pass, false);
  assert.match(r.reason, /Google/);
});
test('mustNotMatch passes when absent', () => {
  assert.equal(judge({ expect: 'decline', mustNotMatch: 'Google' }, ok("I can't help with that.")).pass, true);
});
test('non-200 fails with status and error', () => {
  const r = judge({ expect: 'answer' }, { status: 503, body: { error: 'busy' } });
  assert.equal(r.pass, false);
  assert.match(r.reason, /503/);
  assert.match(r.reason, /busy/);
});
test('missing body fails cleanly', () => {
  assert.equal(judge({ expect: 'answer' }, { status: 200, body: null }).pass, false);
});

test('questions.json is well formed and covers required kinds', () => {
  const qs = JSON.parse(readFileSync(new URL('../chat/evals/questions.json', import.meta.url), 'utf8'));
  assert.ok(qs.length >= 20);
  for (const c of qs) {
    assert.equal(typeof c.q, 'string');
    assert.ok(['answer', 'decline'].includes(c.expect));
  }
  assert.ok(qs.some((c) => c.mustNotMatch === 'Google'));
  assert.ok(qs.some((c) => /salary/i.test(c.q) && c.expect === 'decline'));
  assert.ok(qs.some((c) => /phone/i.test(c.q) && c.expect === 'answer' && c.mustCite));
});

// Eval runner: spacing, 429 retry and per-request timeout (no network: fetch and sleep are fakes).

function fakeFetch(statuses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return { status, json: async () => (status === 200 ? { answer: "The site doesn't cover that.", sources: src } : { error: 'Too many questions.' }) };
  };
  fn.calls = calls;
  return fn;
}
function fakeSleep() {
  const waits = [];
  const fn = async (ms) => { waits.push(ms); };
  fn.waits = waits;
  return fn;
}

test('eval defaults: 38 s spacing (fits 8 questions per 5 minutes), 60 s retry, 30 s timeout', () => {
  assert.equal(DEFAULT_SPACING_MS, 38_000);
  assert.ok(300_000 / DEFAULT_SPACING_MS < 8, 'never more than 7 gaps fit in the 5-minute window');
  assert.equal(RETRY_AFTER_429_MS, 60_000);
  assert.equal(REQUEST_TIMEOUT_MS, 30_000);
});
test('eval spacing is configurable through EVAL_SPACING_MS', () => {
  assert.equal(spacingMs({}), 38_000);
  assert.equal(spacingMs({ EVAL_SPACING_MS: '5000' }), 5000);
  assert.equal(spacingMs({ EVAL_SPACING_MS: 'junk' }), 38_000);
});
test('eval sends each request with a timeout signal', async () => {
  const f = fakeFetch([200]);
  const r = await askWithRetry('https://x.test/ask', 'Q', { fetchImpl: f, sleep: fakeSleep() });
  assert.equal(r.status, 200);
  assert.ok(f.calls[0].init.signal instanceof AbortSignal);
  assert.equal(f.calls[0].init.method, 'POST');
});
test('eval waits 60 s and retries once after a 429', async () => {
  const f = fakeFetch([429, 200]);
  const s = fakeSleep();
  const r = await askWithRetry('https://x.test/ask', 'Q', { fetchImpl: f, sleep: s });
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(s.waits, [60_000]);
});
test('eval fails after a second 429 (no endless retry)', async () => {
  const f = fakeFetch([429, 429, 429]);
  const s = fakeSleep();
  const r = await askWithRetry('https://x.test/ask', 'Q', { fetchImpl: f, sleep: s });
  assert.equal(r.status, 429);
  assert.equal(f.calls.length, 2);
});
test('eval reports a timed-out request as a failure with its message', async () => {
  const f = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  const r = await askWithRetry('https://x.test/ask', 'Q', { fetchImpl: f, sleep: fakeSleep() });
  assert.equal(r.status, 0);
  assert.match(r.body.error, /timeout/i);
});
test('runEval spaces requests and counts failures', async () => {
  const s = fakeSleep();
  const lines = [];
  const cases = [{ q: 'a', expect: 'decline' }, { q: 'b', expect: 'decline' }, { q: 'c', expect: 'answer', mustCite: true }];
  const r = await runEval({ endpoint: 'https://x.test/ask', cases, fetchImpl: fakeFetch([200]), sleep: s, log: (l) => lines.push(l) });
  assert.deepEqual(s.waits, [38_000, 38_000]);
  assert.deepEqual(r, { total: 3, failed: 0 });
  assert.match(lines.at(-1), /3\/3 passed/);
});
