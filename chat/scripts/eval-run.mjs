// Eval runner: asks each case, spaced to stay under the Worker's per-visitor limit.
// fetch and sleep are injectable so tests run with no network and no waiting.
import { judge } from './eval-rules.mjs';

// The Worker allows 8 questions per visitor per 5 minutes: 38 s spacing keeps any
// 5-minute window at 8 requests or fewer.
export const DEFAULT_SPACING_MS = 38_000;
export const RETRY_AFTER_429_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 30_000;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Spacing from EVAL_SPACING_MS (milliseconds), else the default. */
export function spacingMs(env = process.env) {
  const raw = env.EVAL_SPACING_MS;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? n : DEFAULT_SPACING_MS;
}

async function askOnce(endpoint, question, fetchImpl, timeoutMs) {
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8080' },
      body: JSON.stringify({ question, history: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: { error: e.message } };
  }
}

/** Ask once; on a 429 wait and retry one time before giving up. */
export async function askWithRetry(endpoint, question, { fetchImpl = fetch, sleep = realSleep, retryMs = RETRY_AFTER_429_MS, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let r = await askOnce(endpoint, question, fetchImpl, timeoutMs);
  if (r.status === 429) {
    await sleep(retryMs);
    r = await askOnce(endpoint, question, fetchImpl, timeoutMs);
  }
  return r;
}

export async function runEval({ endpoint, cases, spacing = DEFAULT_SPACING_MS, fetchImpl = fetch, sleep = realSleep, log = console.log, retryMs, timeoutMs }) {
  let failed = 0;
  for (let i = 0; i < cases.length; i++) {
    if (i > 0) await sleep(spacing);
    const c = cases[i];
    const { pass, reason } = judge(c, await askWithRetry(endpoint, c.q, { fetchImpl, sleep, retryMs, timeoutMs }));
    if (!pass) failed++;
    log(`${pass ? 'PASS' : 'FAIL'}  [${i + 1}/${cases.length}] ${c.q}\n      ${reason}`);
  }
  log(`\n${cases.length - failed}/${cases.length} passed`);
  return { total: cases.length, failed };
}
