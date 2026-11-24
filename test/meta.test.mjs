import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { build } from './helpers/build.mjs';

const root = resolve(import.meta.dirname, '..');
const site = JSON.parse(readFileSync(join(root, 'src/_data/site.json'), 'utf8'));
const read = (dir, p) => readFileSync(join(dir, p), 'utf8');

function textFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'fonts' ? [] : textFiles(p);
    return ['.html', '.xml', '.txt', '.webmanifest', '.js'].includes(extname(p)) ? [p] : [];
  });
}

test('no design-system placeholder strings survive in the built site', async () => {
  const dir = await build();
  for (const f of textFiles(dir)) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /example\.com/, f);
    assert.doesNotMatch(text, /Your Name/, f);
  }
});

test('sitemap lists the real pages and not the 404', async () => {
  const xml = read(await build(), 'sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes(`${site.url}/`));
  assert.ok(locs.includes(`${site.url}/projects/`));
  assert.ok(locs.includes(`${site.url}/projects/data-central/`));
  assert.ok(!locs.some((l) => l.includes('404')));
  assert.ok(locs.every((l) => l.startsWith(site.url)));
});

test('robots.txt points at this site\'s sitemap', async () => {
  const txt = read(await build(), 'robots.txt');
  assert.match(txt, /Allow: \//);
  assert.match(txt, new RegExp(`Sitemap: ${site.url.replace(/[.]/g, '\\.')}/sitemap\\.xml`));
});

test('web manifest is valid JSON carrying the site name', async () => {
  const m = JSON.parse(read(await build(), 'site.webmanifest'));
  assert.equal(m.short_name, site.name);
  assert.ok(m.name.startsWith(site.name));
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512']);
});

test('canonical and og:url on every page start with the site url', async () => {
  const dir = await build();
  for (const p of ['index.html', 'projects/index.html', 'projects/data-central/index.html', '404.html']) {
    const html = read(dir, p);
    assert.match(html, new RegExp(`<link rel="canonical" href="${site.url.replace(/[.]/g, '\\.')}/`), p);
    assert.match(html, new RegExp(`<meta property="og:url" content="${site.url.replace(/[.]/g, '\\.')}/`), p);
  }
});
