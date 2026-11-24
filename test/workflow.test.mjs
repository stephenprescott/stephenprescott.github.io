import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const file = join(resolve(import.meta.dirname, '..'), '.github/workflows/deploy.yml');

test('deploy workflow builds for production with minimal permissions and deploys to Pages', () => {
  const wf = parse(readFileSync(file, 'utf8'));
  assert.deepEqual(wf.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.equal(wf.concurrency.group, 'pages');
  const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run).filter(Boolean));
  assert.ok(runs.includes('npm ci'));
  assert.ok(runs.includes('npm test'));
  assert.ok(runs.includes('npm run build:prod'));
  const uses = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.uses).filter(Boolean)).join(' ');
  assert.match(uses, /upload-pages-artifact/);
  assert.match(uses, /deploy-pages/);
});

test('deploy workflow generates the resume PDF after the production build', () => {
  const wf = parse(readFileSync(file, 'utf8'));
  const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run).filter(Boolean));
  const build = runs.indexOf('npm run build:prod');
  const pdf = runs.indexOf('node scripts/build-resume-pdf.mjs _site');
  assert.ok(pdf > build && build >= 0, 'pdf step must follow build:prod');
});
