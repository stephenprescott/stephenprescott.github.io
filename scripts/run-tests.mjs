// Windows cmd does not expand globs, so list test files ourselves.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..', 'test');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f));
const result = spawnSync(process.execPath, ['--test', ...files, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
