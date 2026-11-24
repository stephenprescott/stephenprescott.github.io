import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import nunjucks from 'nunjucks';
import { normalizeHtml } from './normalize.mjs';
import { jsonLd } from '../../lib/json-ld.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(join(root, 'src/_includes')), { autoescape: true });
env.addFilter('jsonLd', jsonLd);
env.addGlobal('icons', JSON.parse(readFileSync(join(root, 'src/_data/icons.json'), 'utf8')));

/**
 * Render one macro from src/_includes/<file> with keyword args.
 * Pass args.$caller (HTML string) to render a macro that uses {% call %}.
 */
export function renderMacro(file, macro, args = {}) {
  const { $caller, ...rest } = args;
  const call = `${macro}(${Object.keys(rest).map((k) => `${k}=${k}`).join(', ')})`;
  const tpl = $caller === undefined
    ? `{% from "${file}" import ${macro} %}{{ ${call} }}`
    : `{% from "${file}" import ${macro} %}{% call ${call} %}{{ caller_html | safe }}{% endcall %}`;
  return env.renderString(tpl, { ...rest, caller_html: $caller });
}

/** Render a whole template from src/_includes with a data context (the page data the layout would see). */
export function renderTemplate(file, ctx = {}) {
  return env.render(file, ctx);
}

export function assertMatchesGolden(name, html) {
  const golden = readFileSync(join(root, 'test/golden', `${name}.html`), 'utf8');
  assert.equal(normalizeHtml(html), normalizeHtml(golden), `${name} markup differs from golden`);
}
