import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from './helpers/build.mjs';
import { buildCaseStudies } from '../lib/case-studies.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (dir, p) => readFileSync(join(dir, p), 'utf8');

test('projects index page has heading, filterable grid and footer', async () => {
  const html = read(await build(), 'projects/index.html');
  assert.match(html, /<h2 class="ws-section-title">Projects<\/h2>/);
  assert.match(html, /ws-grid-wrap/);
  assert.match(html, /class="ws-tags ws-filter" hidden/);
  assert.match(html, /\/assets\/js\/filter\.js/);
  assert.match(html, /class="ws-root ws-footer"/);
});

test('case study page: breadcrumbs, header, Problem/Approach/Result, project nav', async () => {
  const dir = await build();
  const html = read(dir, 'projects/data-central/index.html');
  assert.match(html, /<span aria-current="page">/);
  assert.match(html, /class="ws-root ws-case-head"/);
  for (const label of ['Problem', 'Approach', 'Result']) assert.match(html, new RegExp(`<p class="ws-eyebrow">${label}</p>`));
  assert.match(html, /class="ws-root ws-pnav"/);
  assert.match(html, /href="\/projects\/kyber-praxis\/"/, 'next link');
  const second = read(dir, 'projects/kyber-praxis/index.html');
  assert.match(second, /href="\/projects\/data-central\/"/, 'previous link');
});

test('404 page exists with the not-found block', async () => {
  const html = read(await build(), '404.html');
  assert.match(html, /class="ws-404-code"/);
  assert.match(html, /Back to home/);
});

test('buildCaseStudies makes one page per project with a caseStudy, linked prev/next in order', () => {
  const cs = { meta: [], problem: 'p', approach: 'a', result: 'r' };
  const pages = buildCaseStudies([
    { slug: 'a', title: 'A', caseStudy: cs },
    { slug: 'skip', title: 'No case study' },
    { slug: 'b', title: 'B', caseStudy: cs },
    { slug: 'c', title: 'C', caseStudy: cs },
  ]);
  assert.deepEqual(pages.map((p) => p.slug), ['a', 'b', 'c']);
  assert.equal(pages[0].prev, null);
  assert.deepEqual(pages[0].next, { title: 'B', href: '/projects/b/' });
  assert.deepEqual(pages[1].prev, { title: 'A', href: '/projects/a/' });
  assert.equal(pages[2].next, null);
  assert.deepEqual(buildCaseStudies([]), []);
});

test('README documents how to add a project', () => {
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /## Adding a project/);
  assert.ok(existsSync(join(root, 'src/projects/case-study.njk')));
});
