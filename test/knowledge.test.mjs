import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from './helpers/build.mjs';
import { buildKnowledgePack } from '../lib/knowledge.mjs';

const root = resolve(import.meta.dirname, '..');
const load = (n) => JSON.parse(readFileSync(join(root, 'src/_data', `${n}.json`), 'utf8'));
const data = {
  site: load('site'), home: load('home'), experience: load('experience'),
  resume: load('resume'), projects: load('projects'),
};

test('pack has sequential ids, absolute urls, and plain text', () => {
  const pack = buildKnowledgePack(data);
  pack.sources.forEach((s, i) => { assert.equal(s.id, i + 1); assert.match(s.url, /^https:\/\/stephenprescott\.github\.io\//); assert.doesNotMatch(s.text, /<[a-z]/i); });
});
test('pack covers every case study, the resume and the phone number', () => {
  const all = JSON.stringify(buildKnowledgePack(data));
  for (const s of ['data-central', 'kyber-praxis', 'praxis-fasti', 'jobscan-board', 'steppenwolf']) assert.match(all, new RegExp(`/projects/${s}/`));
  assert.match(all, /651-300-7201/);
});
test('pack contains only published data (no local file paths)', () => {
  assert.doesNotMatch(JSON.stringify(buildKnowledgePack(data)), /[A-Za-z]:\\|\/Users\//);
});
test('pack strips placeholder flags, strips HTML, and carries status, earlier roles and training', () => {
  const pack = buildKnowledgePack(data);
  const all = pack.sources.map((s) => s.text).join('\n');
  assert.doesNotMatch(all, /placeholder/i);
  assert.match(all, /Status: In progress/);
  assert.match(all, /Kalmar Solutions/);
  assert.match(all, /Model Context Protocol/);
  assert.ok(!Number.isNaN(Date.parse(pack.builtAt)));
  const tagged = buildKnowledgePack({ ...data, site: { ...data.site, description: 'Hi <b>there</b>' } });
  assert.doesNotMatch(tagged.sources[0].text, /<b>/);
});
test('build emits /chat/knowledge.json, /llms.txt and Person JSON-LD on home', async () => {
  const out = await build();
  assert.ok(JSON.parse(readFileSync(join(out, 'chat/knowledge.json'), 'utf8')).sources.length > 5);
  const llms = readFileSync(join(out, 'llms.txt'), 'utf8');
  assert.match(llms, /^# Stephen Groff/m);
  assert.match(llms, /\/projects\/steppenwolf\//);
  assert.match(llms, /\/resume\//);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /"@type":\s*"Person"/);
});
test('JSON-LD is valid on home only; sitemap excludes knowledge.json and llms.txt', async () => {
  const out = await build();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const ld = JSON.parse(m[1]);
  assert.equal(ld.name, 'Stephen Groff');
  assert.equal(ld.jobTitle, data.site.title);
  assert.deepEqual(ld.sameAs, ['https://www.linkedin.com/in/groffstephen']);
  assert.doesNotMatch(readFileSync(join(out, 'resume/index.html'), 'utf8'), /ld\+json/);
  const xml = readFileSync(join(out, 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(xml, /knowledge\.json|llms\.txt/);
});

test('JSON-LD survives "<" in data: script content round-trips through JSON.parse', async () => {
  const title = 'Data </script><b>AI</b> & lead';
  const out = await build('development', { site: { ...data.site, title } });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(raw, /</, 'no raw "<" inside the script');
  assert.equal(JSON.parse(raw).jobTitle, title);
});

test('every source url resolves to a built page, and its #fragment matches an id on that page', async () => {
  const out = await build();
  const pack = JSON.parse(readFileSync(join(out, 'chat/knowledge.json'), 'utf8'));
  for (const s of pack.sources) {
    const u = new URL(s.url);
    const file = join(out, u.pathname, 'index.html');
    assert.ok(existsSync(file), `${s.url} has no built page`);
    if (u.hash) assert.match(readFileSync(file, 'utf8'), new RegExp(`id="${u.hash.slice(1)}"`), `${s.url} fragment`);
  }
});

test('expertise source cites the #expertise section, not the projects grid', () => {
  const src = buildKnowledgePack(data).sources.find((s) => s.title === data.home.expertise.title);
  assert.equal(src.url, `${data.site.url}/#expertise`);
});
