import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build } from './helpers/build.mjs';
import { serve } from './helpers/serve.mjs';
import { renderMacro, assertMatchesGolden } from './helpers/render.mjs';

const links = [
  { label: 'Work', href: '#work' },
  { label: 'About', href: '#about' },
  { label: 'Contact', href: '#contact' },
];
const C = 'components/';

test('SkipLink matches golden', () => {
  assertMatchesGolden('SkipLink', renderMacro(C + 'skip-link.njk', 'skipLink'));
});

test('Button primary and quiet match golden', () => {
  assertMatchesGolden('Button', renderMacro(C + 'button.njk', 'button', { label: 'See my work', href: '#work', variant: 'primary' }));
  assertMatchesGolden('Button.quiet', renderMacro(C + 'button.njk', 'button', { label: 'Resume', href: '/resume.pdf', variant: 'quiet' }));
});

test('Icon matches golden', () => {
  assertMatchesGolden('Icon', renderMacro(C + 'icon.njk', 'icon', { name: 'github-logo', size: 20 }));
});

test('ThemeToggle matches golden in dark and light states', () => {
  assertMatchesGolden('ThemeToggle', renderMacro(C + 'theme-toggle.njk', 'themeToggle'));
  assertMatchesGolden('ThemeToggle.light', renderMacro(C + 'theme-toggle.njk', 'themeToggle', { theme: 'light' }));
});

test('Navbar matches golden', () => {
  const action = renderMacro(C + 'theme-toggle.njk', 'themeToggle');
  assertMatchesGolden('Navbar', renderMacro(C + 'navbar.njk', 'navbar', { brand: 'Stephen Groff', brandHref: '/', links, action }));
});

test('Footer matches golden', () => {
  assertMatchesGolden('Footer', renderMacro(C + 'footer.njk', 'footer', {
    brand: 'Stephen Groff',
    columns: [{ title: 'Site', links }, { title: 'Elsewhere', links: [{ label: 'GitHub', href: 'https://github.com/x' }] }],
    legal: '© 2026 Stephen Groff.',
  }));
});

test('built page: theme script precedes stylesheets, which load tokens, bundle, site, motion; skip link present', async () => {
  const dir = await build();
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const script = html.indexOf("localStorage.getItem('ws-theme')");
  const first = html.indexOf('rel="stylesheet"');
  assert.ok(script > -1 && first > -1 && script < first, 'theme script must come before first stylesheet');
  const css = [...html.matchAll(/href="(\/assets\/css\/[^"]+\.css)"/g)].map((m) => m[1]);
  assert.deepEqual(css, ['/assets/css/tokens.css', '/assets/css/bundle.css', '/assets/css/site.css', '/assets/css/motion.css', '/assets/css/print.css']);
  assert.match(html, /<a class="ws-skip" href="#main">/);
  assert.match(html, /<main id="main">/);
});

test('theme toggle switches data-theme even when localStorage throws', async () => {
  const dir = await build();
  const server = await serve(dir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    await page.goto(server.url + '/');
    const before = await page.getAttribute('html', 'data-theme');
    assert.ok(['dark', 'light'].includes(before));
    await page.click('.ws-icon-btn');
    const after = await page.getAttribute('html', 'data-theme');
    assert.notEqual(after, before);
    assert.match(await page.getAttribute('.ws-icon-btn', 'aria-label'), /Switch to/);
  } finally {
    await browser.close();
    await server.close();
  }
});
