# stephen-ask (chat Worker)

Answers visitor questions from the site's knowledge pack. Workers AI answers first; Claude Haiku answers only when Workers AI fails or its free allowance is used up.

On the Workers Free plan, Workers AI errors once its daily free allocation is used, and Haiku takes over. On Workers Paid, usage past the free allocation is billed instead of erroring, so the Haiku fallback only triggers on the free plan (or on a real Workers AI failure).

## Local dev

```
cd chat
npm install
npx wrangler dev
```

To test against a local knowledge pack, override `KNOWLEDGE_URL`:

```
npx wrangler dev --var KNOWLEDGE_URL:http://localhost:8080/chat/knowledge.json
```

For the Haiku fallback locally, put `ANTHROPIC_API_KEY=...` in an untracked `chat/.dev.vars` file. Never commit it.

## Deploy

1. Create the limits namespace: `npx wrangler kv namespace create LIMITS`. Put the returned id in `wrangler.toml` under `[[kv_namespaces]]`.
2. Set the secret. Stephen types the key himself when prompted: `npx wrangler secret put ANTHROPIC_API_KEY`
3. Deploy: `npx wrangler deploy`

The key lives only as a Worker secret, never in the repo.

## Eval

`node chat/scripts/eval.mjs <endpoint>` asks the 25 questions in `evals/questions.json` and prints pass/fail per case. It waits 38 s between questions to stay under the limit of 8 questions per visitor per 5 minutes (override with `EVAL_SPACING_MS`), retries once after 60 s on a 429, and times out each request after 30 s. A full run takes about 16 minutes. Against the deployed Worker it uses 25 of the 300 daily questions.

Run it locally first (the deployed Worker can't read the knowledge pack until the site is live):

1. Repo root: `npm run dev` (site on :8080).
2. In `chat/`: `npx wrangler dev --var KNOWLEDGE_URL:http://localhost:8080/chat/knowledge.json`
3. Repo root: `node chat/scripts/eval.mjs http://localhost:8787/`

When a case fails, fix the prompt or the pack, never the eval.

## Tests

From the repo root: `npm test`. Tests use fakes: no network, no key, no `npm install` in `chat/`.
