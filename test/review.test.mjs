import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';
import { renderMacro, renderTemplate } from './helpers/render.mjs';

const root = resolve(import.meta.dirname, '..');
const data = (f) => JSON.parse(readFileSync(join(root, 'src/_data', f), 'utf8'));
const site = data('site.json');
const projects = data('projects.json');
const css = ['tokens.css', 'bundle.css', 'site.css'].map((f) => readFileSync(join(root, 'src/assets/css', f), 'utf8')).join('\n');

let dir;
let server;
let browser;
before(async () => {
  dir = await build();
  server = await serve(dir);
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await server.close();
});

test('résumé without JavaScript: footer links stay visible and only the theme toggle is hidden', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(server.url + '/resume/');
  assert.equal(await page.locator('.ws-footer a').first().isVisible(), true);
  assert.equal(await page.locator('.ws-nav button.ws-icon-btn').isVisible(), false);
  await ctx.close();
});

test('case-study title and summary are escaped exactly once in <title>, description and og tags', () => {
  const html = renderTemplate('layouts/base.njk', {
    site, page: { url: '/projects/x/' }, content: '',
    cs: { title: `R&D it's "big"`, summary: `A & B's <summary>` },
  });
  assert.match(html, /<title>R&amp;D it&#39;s &quot;big&quot; — Stephen Groff<\/title>/);
  assert.match(html, /<meta name="description" content="A &amp; B&#39;s &lt;summary&gt;">/);
  assert.match(html, /<meta property="og:title" content="R&amp;D it&#39;s &quot;big&quot;">/);
  assert.doesNotMatch(html, /&amp;amp;|&amp;#39;/);
});

test('built case-study page has single-escaped title for a title with special characters', async () => {
  const html = readFileSync(join(dir, 'projects/data-central/index.html'), 'utf8');
  assert.match(html, /<title>Data Central: the journey of one row — Stephen Groff<\/title>/);
});

test('sitemap lists every case study, not just the first', () => {
  const xml = readFileSync(join(dir, 'sitemap.xml'), 'utf8');
  const slugs = projects.filter((p) => p.caseStudy).map((p) => p.slug);
  assert.ok(slugs.length >= 2);
  for (const s of slugs) assert.ok(xml.includes(`${site.url}/projects/${s}/`), s);
});

test('a project card links to its case study when it has one and no explicit href', () => {
  const html = renderMacro('components/project-grid.njk', 'projectGrid', {
    projects: [
      { slug: 'x', title: 'X', tags: [], caseStudy: {} },
      { slug: 'y', title: 'Y', tags: [], caseStudy: {}, href: 'https://example.org/y' },
      { slug: 'z', title: 'Z', tags: [] },
    ],
  });
  assert.match(html, /href="\/projects\/x\/"/);
  assert.match(html, /href="https:\/\/example\.org\/y"/);
  assert.doesNotMatch(html, /href="\/projects\/z\/"/);
});

test('résumé button renders in the navbar only when site.resume is set', () => {
  const base = { page: { url: '/' }, content: '', title: 'Home' };
  const withResume = renderTemplate('layouts/base.njk', { ...base, site: { ...site, resume: '/resume.pdf' } });
  assert.match(withResume, /<a class="ws-btn ws-btn-quiet" href="\/resume\.pdf">[\s\S]*Résumé<\/a>/);
  const without = renderTemplate('layouts/base.njk', { ...base, site: { ...site, resume: '' } });
  assert.doesNotMatch(without, /Résumé/);
});

test('375px: nav, footer, breadcrumb and mailto links meet the 44px touch target', async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const lacking = [];
  for (const [path, sels] of [
    ['/resume/', ['.ws-nav-brand', '.ws-nav .ws-link', '.ws-footer .ws-link']],
    ['/', ['.sh-brand', '.sh-menu-btn', '.sh-res', '.sh-foot-links a', '.sh-links a', '.lp-proj', '.lp-stat', '.lp-pr', '.lp-tlink', '.lp-c-link']],
    ['/projects/', ['.sh-brand', '.sh-menu-btn', '.sh-res', '.sh-foot-links a', '.sh-links a']],
    ['/projects/data-central/', ['.sh-brand', '.sh-foot-links a', '.ws-crumbs .ws-link']],
  ]) {
    const page = await ctx.newPage();
    await page.goto(server.url + path);
    if (sels.includes('.sh-links a')) await page.click('.sh-menu-btn'); // the collapsed menu's links
    for (const sel of sels) {
      const heights = await page.$$eval(sel, (els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      assert.ok(heights.length > 0, `${path} ${sel} not found`);
      for (const h of heights) if (h < 43.5) lacking.push(`${path} ${sel} ${h}`);
    }
    await page.close();
  }
  assert.deepEqual(lacking, []);
  await ctx.close();
});

const W = 'Antidisestablishmentarianism'.repeat(3);
const C = 'components/';
const cases = {
  hero: () => renderMacro(C + 'hero.njk', 'hero', { eyebrow: W, title: W, body: W }),
  sectionHeading: () => renderMacro(C + 'section-heading.njk', 'sectionHeading', { eyebrow: W, title: W }),
  featureCard: () => renderMacro(C + 'feature-card.njk', 'featureCard', { eyebrow: W, title: W, body: W }),
  articleList: () => renderMacro(C + 'article-list.njk', 'articleList', { items: [{ title: W, meta: W, href: '/a/' }] }),
  caseStudyHeader: () => renderMacro(C + 'case-study-header.njk', 'caseStudyHeader', { eyebrow: W, title: W, summary: W, meta: [{ label: W, value: W }] }),
  caseStudySection: () => renderMacro(C + 'case-study-section.njk', 'caseStudySection', { label: W, title: W, $caller: `<p>${W}</p>` }),
  projectNav: () => renderMacro(C + 'project-nav.njk', 'projectNav', { prev: { title: W, href: '/p/' }, next: { title: W, href: '/n/' } }),
  stat: () => renderMacro(C + 'stat.njk', 'stat', { value: W, label: W, note: W }),
  skillGroup: () => renderMacro(C + 'skill-group.njk', 'skillGroup', { title: W, skills: [W] }),
  timeline: () => renderMacro(C + 'timeline.njk', 'timeline', { items: [{ period: W, title: W, org: W, body: W }] }),
  navbar: () => renderMacro(C + 'navbar.njk', 'navbar', { brand: W, links: [{ label: W, href: '#' }] }),
  footer: () => renderMacro(C + 'footer.njk', 'footer', { brand: W, columns: [{ title: W, links: [{ label: W, href: '#' }] }], legal: W }),
  breadcrumbs: () => renderMacro(C + 'breadcrumbs.njk', 'breadcrumbs', { items: [{ label: W, href: '/' }, { label: W }] }),
  figure: () => renderMacro(C + 'figure.njk', 'figure', { src: '/x.png', alt: '', caption: W }),
  contactForm: () => renderMacro(C + 'contact-form.njk', 'contactForm', { disabled: true, email: `${W}@example.org` }),
  projectGrid: () => renderMacro(C + 'project-grid.njk', 'projectGrid', { projects: [{ title: W, eyebrow: W, summary: W, href: '/p/', tags: [W] }] }),
};

test('320px: an unbroken 84-character word never causes horizontal scroll in any component', async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  const overflowing = [];
  for (const [name, render] of Object.entries(cases)) {
    await page.setContent(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="ws-root"><section class="ws-section"><div class="ws-container">${render()}</div></section></body></html>`);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 320) overflowing.push(`${name} ${w}`);
  }
  assert.deepEqual(overflowing, []);
  await ctx.close();
});

test('each case study that holds placeholder text carries its own placeholder flag', () => {
  for (const p of projects.filter((x) => x.caseStudy)) {
    const text = JSON.stringify(p.caseStudy);
    if (/Placeholder/.test(text)) assert.equal(p.caseStudy.placeholder, true, `${p.slug} caseStudy needs placeholder:true`);
  }
});
