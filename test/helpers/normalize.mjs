import { load } from 'cheerio';

/** Parse HTML into an order-insensitive structure: tag, sorted attrs (sorted classes), children, collapsed text. */
function walk(node) {
  if (node.type === 'text') {
    const t = node.data.replace(/\s+/g, ' ').trim();
    return t ? t : null;
  }
  if (node.type !== 'tag') return null;
  const attrs = Object.entries(node.attribs || {})
    .map(([k, v]) => (k === 'class' ? [k, v.split(/\s+/).filter(Boolean).sort().join(' ')] : [k, v]))
    .sort(([a], [b]) => a.localeCompare(b));
  const kids = (node.children || []).map((c) => walk(c)).filter((c) => c !== null);
  return { tag: node.name, attrs, kids };
}

export function normalizeHtml(html) {
  const $ = load(html, null, false);
  return JSON.stringify($.root().contents().toArray().map((n) => walk(n)).filter((n) => n !== null));
}
