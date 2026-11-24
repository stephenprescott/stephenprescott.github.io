import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { build } from './helpers/build.mjs';

const root = resolve(import.meta.dirname, '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('design system css, fonts and site files are vendored into the build', async () => {
  const dir = await build();
  const tokens = readFileSync(join(dir, 'assets/css/tokens.css'));
  assert.ok(tokens.toString().startsWith('/* WARMING STRIPES'));
  for (const f of ['gelasio-latin-400-normal', 'gelasio-latin-400-italic', 'gelasio-latin-700-normal']) {
    assert.ok(existsSync(join(dir, `assets/css/fonts/${f}.woff2`)), f);
  }
  assert.match(readFileSync(join(dir, 'assets/css/bundle.css'), 'utf8'), /\.ws-hero-title/);
  assert.ok(existsSync(join(dir, 'assets/css/site.css')));
  for (const f of ['shell.css', 'landing.css', 'chat-shell.css']) assert.ok(existsSync(join(dir, `assets/css/${f}`)), f);
  for (const w of [300, 400, 500, 600, 700]) assert.ok(existsSync(join(dir, `assets/css/fonts/space-grotesk-latin-${w}-normal.woff2`)), `Space Grotesk ${w}`);
  for (const f of ['robots.txt', 'site.webmanifest', 'favicon.svg', 'icon-16.png', 'icon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  const doc = readFileSync(join(root, 'scripts/sync-design-system.md'), 'utf8');
  assert.ok(doc.includes(sha(tokens)), 'tokens.css sha256 recorded in sync-design-system.md');
});
