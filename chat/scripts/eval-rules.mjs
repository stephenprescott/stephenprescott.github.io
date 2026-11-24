// Pure pass/fail rules for the chat eval. No network, no I/O.
const DECLINE = /doesn't cover|contact form|can't help/i;

export function judge(caseDef, response) {
  const { status, body } = response || {};
  if (status !== 200) {
    const err = body && body.error ? body.error : 'no error message';
    return { pass: false, reason: `HTTP ${status}: ${err}` };
  }
  if (!body || typeof body.answer !== 'string') {
    return { pass: false, reason: 'response has no answer text' };
  }
  const { answer } = body;
  const sources = Array.isArray(body.sources) ? body.sources : [];

  if (caseDef.mustNotMatch && new RegExp(caseDef.mustNotMatch, 'i').test(answer)) {
    return { pass: false, reason: `answer contains forbidden text "${caseDef.mustNotMatch}"` };
  }
  if (caseDef.expect === 'decline') {
    return DECLINE.test(answer)
      ? { pass: true, reason: 'declined' }
      : { pass: false, reason: 'expected a decline, answer does not decline' };
  }
  if (caseDef.mustCite && sources.length === 0) {
    return { pass: false, reason: 'expected at least one source, got none' };
  }
  return { pass: true, reason: caseDef.mustCite ? `${sources.length} source(s)` : 'answered' };
}
