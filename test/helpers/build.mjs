import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Eleventy from '@11ty/eleventy';

const root = resolve(import.meta.dirname, '..', '..');

/** Build the site into a fresh temp dir and return its path. */
/** `globalData` ({name: value}) overrides site data for this build only (tests). */
/** Chat is off unless a test passes `chatEndpoint`, so tests don't depend on chat.json. */
export async function build(env = 'development', overrides = {}) {
  const globalData = { chatEndpoint: '', ...overrides };
  const out = await mkdtemp(join(tmpdir(), 'site-'));
  const previous = process.env.ELEVENTY_ENV;
  process.env.ELEVENTY_ENV = env;
  try {
    const elev = new Eleventy(join(root, 'src'), out, {
      configPath: join(root, 'eleventy.config.mjs'),
      quietMode: true,
      config(eleventyConfig) {
        for (const [k, v] of Object.entries(globalData)) eleventyConfig.addGlobalData(k, v);
      },
    });
    await elev.write();
  } finally {
    if (previous === undefined) delete process.env.ELEVENTY_ENV;
    else process.env.ELEVENTY_ENV = previous;
  }
  return out;
}
