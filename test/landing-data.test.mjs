import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLandingData, assertProofLinks, slugId } from '../lib/landing-data.mjs';
const home = JSON.parse(readFileSync(new URL('../src/_data/home.json', import.meta.url)));
const projects = JSON.parse(readFileSync(new URL('../src/_data/projects.json', import.meta.url)));

test('figures: the four approved figures with verbatim bodies', () => {
  const d = buildLandingData(home, projects);
  assert.deepEqual(d.figures.map((f) => f.value + f.suffix), ['10+', '600+', '70%+', '12+']);
  assert.equal(d.figures[0].body, '10+ years of enterprise reporting in healthcare, manufacturing and supply chain.');
  assert.ok(d.figures[1].body.startsWith('At Tactile Medical I audited 600+ Power BI reports'));
  assert.equal(d.figures[3].body, home.expertise.items[1].body);
});
test('proof pairings match the spec table', () => {
  const d = buildLandingData(home, projects);
  const by = (id) => [...d.projects.filter((p) => p.proves.includes(id)).map((p) => p.slug), ...d.figures.filter((f) => f.proves.includes(id)).map((f) => f.id)];
  assert.deepEqual(by('enterprise-data-lifecycle'), ['data-central']);
  assert.deepEqual(by('data-strategy'), ['models']);
  assert.deepEqual(by('ai-tools-and-platforms'), ['data-central', 'kyber-praxis', 'praxis-fasti', 'jobscan-board']);
  assert.deepEqual(by('analytics-and-executive-reporting'), ['years']);
  assert.deepEqual(by('governance-and-compliance'), ['data-central']);
  assert.deepEqual(by('data-as-competitive-advantage'), ['audited', 'retired']);
  assert.deepEqual(d.projects.find((p) => p.slug === 'steppenwolf').proves, []);
});
test('short titles: split at the first colon, whole title otherwise', () => {
  const d = buildLandingData(home, projects);
  const dc = d.projects.find((p) => p.slug === 'data-central');
  assert.equal(dc.shortTitle, 'Data Central'); assert.equal(dc.subtitle, 'the journey of one row');
  assert.equal(d.projects.find((p) => p.slug === 'kyber-praxis').subtitle, '');
});
test('assertProofLinks names every unknown expertise id', () => {
  const bad = structuredClone(projects); bad[0].proves = ['nope', 'ai-tools-and-platforms'];
  assert.throws(() => assertProofLinks(home, bad), /nope/);
  assert.doesNotThrow(() => assertProofLinks(home, projects));
});
test('empty optional data: no stats, a project with no proves field', () => {
  const h = structuredClone(home); h.stats = [];
  const p = structuredClone(projects); delete p[1].proves;
  const d = buildLandingData(h, p);
  assert.deepEqual(d.figures, []); assert.deepEqual(d.projects[1].proves, []);
});
test('slugId', () => assert.equal(slugId('AI tools and platforms'), 'ai-tools-and-platforms'));
