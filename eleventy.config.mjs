import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNoPlaceholders } from './lib/placeholders.mjs';
import { assertProductionConfig, chatEndpointFor } from './lib/production.mjs';
import { jsonLd } from './lib/json-ld.mjs';

export default function (eleventyConfig) {
  const icons = JSON.parse(readFileSync(new URL('./src/_data/icons.json', import.meta.url), 'utf8'));
  eleventyConfig.addNunjucksGlobal('icons', icons);
  eleventyConfig.addNunjucksFilter('jsonLd', jsonLd);
  // Chat widget renders only when an endpoint is set (env var wins, for local dev and deploys)
  // and chat.json does not say "enabled": false.
  const chatData = JSON.parse(readFileSync(new URL('./src/_data/chat.json', import.meta.url), 'utf8'));
  // A value a test or caller already supplied through addGlobalData (that callback runs
  // before this file) wins, even an empty one; otherwise left unset when empty.
  const chatEndpoint = chatEndpointFor(chatData, process.env);
  if (chatEndpoint && !('chatEndpoint' in (eleventyConfig.globalData ?? {}))) {
    eleventyConfig.addGlobalData('chatEndpoint', chatEndpoint);
  }
  eleventyConfig.setNunjucksEnvironmentOptions({ autoescape: true });

  // Production builds refuse placeholder content (any data node with `placeholder: true`)
  // and missing launch values (chat endpoint, Web3Forms key).
  eleventyConfig.on('eleventy.before', () => {
    if (process.env.ELEVENTY_ENV !== 'production') return;
    // PLACEHOLDER_SCAN_DIR lets tests point the guard at fixture data.
    const dataDir = process.env.PLACEHOLDER_SCAN_DIR
      ? pathToFileURL(join(process.env.PLACEHOLDER_SCAN_DIR, '/'))
      : new URL('./src/_data/', import.meta.url);
    const all = {};
    for (const f of readdirSync(dataDir).filter((n) => n.endsWith('.json') && n !== 'icons.json')) {
      all[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'));
    }
    assertNoPlaceholders(all);
    assertProductionConfig({ chat: all.chat, contact: all.contact }, process.env);
  });
  eleventyConfig.addPassthroughCopy('src/assets');
  for (const file of [
    'favicon.svg',
    'icon-16.png',
    'icon-32.png',
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png',
  ]) {
    eleventyConfig.addPassthroughCopy({ [`src/${file}`]: file });
  }
  eleventyConfig.ignores.add('src/**/README.md');

  return {
    dir: { input: 'src', includes: '_includes', data: '_data' },
    templateFormats: ['njk', 'html', 'md', '11ty.js'],
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
  };
}
