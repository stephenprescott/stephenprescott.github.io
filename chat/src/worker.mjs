import { answer, loadPack, BusyError } from './models.mjs';
import { cleanHistory } from './prompt.mjs';
import { checkLimits } from './limits.mjs';

const BUSY = 'The assistant is busy right now. Please try again in a minute, or use the contact form.';
const MSG_IP = "You're asking quickly. Please wait a few minutes and try again.";
const MSG_DAILY = "The assistant has reached today's limit. Please use the contact form.";
const MAX_QUESTION = 500;

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && list.includes(origin) ? origin : null;
}

function respond(status, body, origin) {
  const headers = { 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  if (body === null) return new Response(null, { status, headers });
  headers['content-type'] = 'application/json';
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handle(request, env, deps = {}) {
  const origin = allowedOrigin(request, env);

  if (request.method === 'OPTIONS') {
    const res = respond(204, null, origin);
    if (origin) {
      res.headers.set('access-control-allow-methods', 'POST, GET, OPTIONS');
      res.headers.set('access-control-allow-headers', 'content-type');
      res.headers.set('access-control-max-age', '600');
    }
    return res;
  }
  if (request.method === 'GET') return respond(200, { ok: true }, origin);
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' }, origin);

  if (!origin) return respond(403, { error: 'Origin not allowed' }, null);

  let body;
  try { body = await request.json(); } catch { return respond(400, { error: 'Invalid JSON' }, origin); }
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return respond(400, { error: 'Question is required' }, origin);
  if (question.length > MAX_QUESTION) return respond(400, { error: `Question must be ${MAX_QUESTION} characters or fewer` }, origin);

  const now = deps.now ? deps.now() : Date.now();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  let limited;
  try {
    limited = await checkLimits(env.LIMITS, ip, now);
  } catch {
    return respond(503, { error: BUSY }, origin);
  }
  if (limited) return respond(429, { error: limited === 'ip' ? MSG_IP : MSG_DAILY }, origin);

  try {
    const pack = await loadPack(env, deps.fetch ?? fetch, now);
    const history = cleanHistory(body.history);
    while (history.length && history[0].role !== 'user') history.shift();
    const { answer: text, sources } = await answer({ question, history, pack, env, deps });
    return respond(200, { answer: text, sources }, origin);
  } catch (err) {
    if (!(err instanceof BusyError)) console.error('chat error', err?.message);
    return respond(503, { error: BUSY }, origin);
  }
}

let anthropicClient;
function lazyAnthropic(env) {
  return {
    messages: {
      async create(params) {
        if (!anthropicClient) {
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        }
        return anthropicClient.messages.create(params);
      },
    },
  };
}

export default {
  fetch(request, env) {
    return handle(request, env, { ai: env.AI, anthropic: lazyAnthropic(env) });
  },
};
