import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from './helpers/build.mjs';

const root = resolve(import.meta.dirname, '..');
const resume = JSON.parse(readFileSync(join(root, 'src/_data/resume.json'), 'utf8'));

test('resume page renders contact including the 651 number', async () => {
  const html = readFileSync(join(await build(), 'resume/index.html'), 'utf8');
  assert.match(html, /651-300-7201/);
  assert.match(html, /href="\/resume\/stephen-groff-resume\.pdf"/);
});

test('resume never mentions Steppenwolf or Jobscan', async () => {
  const html = readFileSync(join(await build(), 'resume/index.html'), 'utf8');
  assert.doesNotMatch(html, /steppenwolf|jobscan/i);
  assert.doesNotMatch(JSON.stringify(resume), /steppenwolf|jobscan/i);
});

test('resume data has the agreed shape and is approved (no placeholder flag)', () => {
  assert.equal(resume.placeholder, undefined);
  for (const k of ['name', 'title', 'location', 'phone', 'email', 'linkedin']) assert.ok(resume.contact[k], k);
  assert.equal(resume.experience.length, 5);
  assert.ok(resume.earlier.length === 4);
  assert.ok(resume.experience.every((e) => e.period && e.title && e.org && e.bullets.length));
});

test('resume page links its print stylesheet and the nav shows one Résumé button', async () => {
  const dir = await build();
  const html = readFileSync(join(dir, 'resume/index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/assets\/css\/print\.css" media="print">/);
  const home = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.equal((home.match(/Résumé/g) || []).length, 1);
  const css = readFileSync(join(root, 'src/assets/css/print.css'), 'utf8');
  assert.match(css, /@media print/);
  assert.match(css, /\[data-chat\]/);
});

test('pdf script writes a PDF', async () => {
  const dir = await build();
  const r = spawnSync(process.execPath, ['scripts/build-resume-pdf.mjs', dir], { cwd: root });
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(readFileSync(join(dir, 'resume/stephen-groff-resume.pdf')).subarray(0, 4).toString(), '%PDF');
});

test('pdf script fails and writes nothing when /resume/ is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'empty-site-'));
  const r = spawnSync(process.execPath, ['scripts/build-resume-pdf.mjs', dir], { cwd: root });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(join(dir, 'resume/stephen-groff-resume.pdf')), false);
});
