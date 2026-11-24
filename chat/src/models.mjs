import { buildSystemPrompt, extractCitations } from './prompt.mjs';

const REFUSAL = "I can't help with that here. Please use the contact form.";
const PACK_TTL_MS = 300_000;
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export class BusyError extends Error {
  constructor(message = 'busy') { super(message); this.name = 'BusyError'; }
}

export async function askWorkersAI(ai, model, system, history, question) {
  const out = await ai.run(model, {
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: question }],
    max_tokens: 600,
    // Gemma 4 reasons by default; its reasoning used the whole token budget and left content empty.
    chat_template_kwargs: { enable_thinking: false },
  });
  // Gemma 4 returns OpenAI-style choices; older Workers AI models return { response }.
  const raw = out?.choices?.[0]?.message?.content ?? out?.response;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('Empty Workers AI response');
  return text;
}

export async function askHaiku(client, system, history, question) {
  const res = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 2048, // thinking counts toward max_tokens
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [...history, { role: 'user', content: question }],
  });
  if (res.stop_reason === 'refusal') return REFUSAL;
  const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('Empty Haiku response');
  return text;
}

export async function answer({ question, history, pack, env, deps }) {
  const system = buildSystemPrompt(pack);
  let text;
  let provider;
  try {
    text = await askWorkersAI(deps.ai, env.WORKERS_AI_MODEL || DEFAULT_MODEL, system, history, question);
    provider = 'workers-ai';
  } catch (err) {
    console.warn('workers-ai failed', err?.message);
    try {
      text = await askHaiku(deps.anthropic, system, history, question);
      provider = 'haiku';
    } catch (err2) {
      console.warn('haiku failed', err2?.message);
      throw new BusyError();
    }
  }
  console.log('answered', provider);
  const { answer: clean, sources } = extractCitations(text, pack);
  return { answer: clean, sources, provider };
}

let packCache = null;
export function _resetPackCache() { packCache = null; }

export async function loadPack(env, fetchImpl = fetch, now = Date.now()) {
  if (packCache && packCache.url === env.KNOWLEDGE_URL && now - packCache.at < PACK_TTL_MS) return packCache.pack;
  let pack;
  try {
    const res = await fetchImpl(env.KNOWLEDGE_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    pack = await res.json();
    if (!pack || !Array.isArray(pack.sources) || pack.sources.length === 0) throw new Error('bad pack');
  } catch {
    throw new BusyError();
  }
  packCache = { url: env.KNOWLEDGE_URL, at: now, pack };
  return pack;
}
