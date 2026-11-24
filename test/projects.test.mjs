import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { renderMacro, assertMatchesGolden } from './helpers/render.mjs';
import { build } from './helpers/build.mjs';

const root = resolve(import.meta.dirname, '..');
const C = 'components/';
const css = ['tokens.css', 'bundle.css', 'site.css'].map((f) => readFileSync(join(root, 'src/assets/css', f), 'utf8')).join('\n');
const filterJs = readFileSync(join(root, 'src/assets/js/filter.js'), 'utf8');

const proj = (title, tags) => ({ title, eyebrow: 'Dashboard', summary: 'One-line summary.', image: '/img/a.png', imageAlt: '', tags, href: '/projects/a/' });
const projects = [proj('One', ['BI', 'SQL']), proj('Two', ['SQL', 'Python'])];

/** The shipped grid hides its filter row until JavaScript reveals it; strip that one attribute to compare with the golden. */
const withoutHidden = (html) => html.replace('class="ws-tags ws-filter" hidden', 'class="ws-tags ws-filter"');

test('ProjectCard matches golden', () => {
  assertMatchesGolden('ProjectCard', renderMacro(C + 'project-card.njk', 'projectCard', proj('Project title', ['BI', 'SQL'])));
});

test('ProjectGrid matches golden apart from the hidden filter row', () => {
  assertMatchesGolden('ProjectGrid', withoutHidden(renderMacro(C + 'project-grid.njk', 'projectGrid', { projects, filter: true, allLabel: 'All' })));
});

test('ProjectGrid server output: filter row hidden, every card visible, filter buttons in first-seen tag order', () => {
  const html = renderMacro(C + 'project-grid.njk', 'projectGrid', { projects, filter: true, allLabel: 'All' });
  assert.match(html, /class="ws-tags ws-filter" hidden/);
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.doesNotMatch(html, /<article[^>]*hidden/);
  assert.deepEqual([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ['All', 'BI', 'SQL', 'Python']);
  assert.doesNotMatch(renderMacro(C + 'project-grid.njk', 'projectGrid', { projects, filter: false }), /ws-filter/);
});

test('ProjectCard without an image renders no img element', () => {
  const html = renderMacro(C + 'project-card.njk', 'projectCard', { title: 'No image', href: '/p/', tags: [] });
  assert.doesNotMatch(html, /<img/);
});

test('Breadcrumbs, CaseStudyHeader, CaseStudySection, Figure, ProjectNav, NotFound match golden', () => {
  assertMatchesGolden('Breadcrumbs', renderMacro(C + 'breadcrumbs.njk', 'breadcrumbs', {
    items: [{ label: 'Home', href: '/' }, { label: 'Projects', href: '/projects/' }, { label: 'Project title' }],
  }));
  assertMatchesGolden('CaseStudyHeader', renderMacro(C + 'case-study-header.njk', 'caseStudyHeader', {
    eyebrow: 'Case study', title: 'Project title', summary: 'Project summary.',
    meta: [{ label: 'Role', value: 'Lead' }, { label: 'Timeline', value: '3 months' }], image: '/img/a.png', imageAlt: '',
  }));
  assertMatchesGolden('CaseStudySection', renderMacro(C + 'case-study-section.njk', 'caseStudySection', {
    label: 'Problem', title: 'What needed solving', $caller: '<p>Body paragraph.</p>',
  }));
  assertMatchesGolden('Figure', renderMacro(C + 'figure.njk', 'figure', { src: '/img/a.png', alt: 'Screenshot', caption: 'Caption text.', frame: 'browser' }));
  assertMatchesGolden('ProjectNav', renderMacro(C + 'project-nav.njk', 'projectNav', {
    prev: { title: 'Previous project', href: '/projects/p/' }, next: { title: 'Next project', href: '/projects/n/' },
  }));
  assertMatchesGolden('NotFound', renderMacro(C + 'not-found.njk', 'notFound', { homeHref: '/' }));
});

test('ProjectNav with only a next link renders no previous link', () => {
  const html = renderMacro(C + 'project-nav.njk', 'projectNav', { next: { title: 'Next project', href: '/n/' } });
  assert.doesNotMatch(html, /Previous/);
  assert.match(html, /ws-pnav-next/);
});

const gridHtml = renderMacro(C + 'project-grid.njk', 'projectGrid', { projects, filter: true, allLabel: 'All' });
const pageHtml = `<!doctype html><html data-theme="dark"><head><style>${css}</style></head><body class="ws-root">${gridHtml}</body></html>`;

test('filter with JavaScript: row appears, a tag hides non-matching cards, All restores', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(pageHtml);
    assert.equal(await page.isVisible('.ws-filter'), false);
    await page.addScriptTag({ content: filterJs });
    assert.equal(await page.isVisible('.ws-filter'), true);
    await page.click('.ws-filter button:has-text("Python")');
    assert.equal(await page.locator('article:visible').count(), 1);
    assert.equal(await page.getAttribute('.ws-filter button:has-text("Python")', 'aria-pressed'), 'true');
    await page.click('.ws-filter button:has-text("All")');
    assert.equal(await page.locator('article:visible').count(), 2);
  } finally {
    await browser.close();
  }
});

test('without JavaScript: every project shows and the filter row stays hidden', async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.setContent(pageHtml);
    assert.equal(await page.locator('article:visible').count(), 2);
    assert.equal(await page.isVisible('.ws-filter'), false);
  } finally {
    await browser.close();
  }
});

const launchProjects = JSON.parse(readFileSync(join(root, 'src/_data/projects.json'), 'utf8'));

test('launch case studies exist in order with case-study pages', () => {
  const slugs = launchProjects.filter((p) => p.caseStudy).map((p) => p.slug);
  for (const s of ['data-central', 'kyber-praxis', 'praxis-fasti', 'jobscan-board', 'steppenwolf']) assert.ok(slugs.includes(s), s);
  assert.equal(launchProjects.find((p) => p.slug === 'multi-source-pipeline'), undefined);
  assert.deepEqual(launchProjects.map((p) => p.slug), ['data-central', 'kyber-praxis', 'praxis-fasti', 'jobscan-board', 'steppenwolf']);
});
test('steppenwolf is marked In progress and the card shows the badge', async () => {
  assert.equal(launchProjects.find((p) => p.slug === 'steppenwolf').status, 'In progress');
  const html = readFileSync(join(await build(), 'projects/index.html'), 'utf8');
  assert.match(html, /class="ws-tag-status"[^>]*>\s*<span class="ws-tag">In progress<\/span>/);
});
test('jobscan is described plainly as a job-search tool', () => {
  const j = launchProjects.find((p) => p.slug === 'jobscan-board');
  assert.match(`${j.summary} ${j.caseStudy.problem}`, /job (search|postings)/i);
});
test('data central links to the live journey', () => {
  const d = launchProjects.find((p) => p.slug === 'data-central');
  assert.match(JSON.stringify(d), /groffia\.github\.io\/data-central\/journey\//);
});
