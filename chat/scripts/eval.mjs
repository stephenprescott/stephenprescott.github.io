// Usage: node chat/scripts/eval.mjs <endpoint>
// A full run takes about 16 minutes (38 s between questions). EVAL_SPACING_MS overrides the spacing.
import { readFileSync } from 'node:fs';
import { runEval, spacingMs } from './eval-run.mjs';

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chat/scripts/eval.mjs <endpoint>');
  process.exit(2);
}
const cases = JSON.parse(readFileSync(new URL('../evals/questions.json', import.meta.url), 'utf8'));
const { failed } = await runEval({ endpoint, cases, spacing: spacingMs() });
process.exit(failed ? 1 : 0);
