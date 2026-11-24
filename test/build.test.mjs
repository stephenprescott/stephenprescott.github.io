import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from './helpers/build.mjs';

test('build produces index.html', async () => {
  const dir = await build();
  assert.ok(existsSync(join(dir, 'index.html')));
});
