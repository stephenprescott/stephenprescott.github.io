import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../test/helpers/serve.mjs';

const siteDir = process.argv[2];
if (!siteDir) {
  console.error('usage: node scripts/build-resume-pdf.mjs <siteDir>');
  process.exit(1);
}

let server;
let browser;
try {
  server = await serve(resolve(siteDir));
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.emulateMedia({ colorScheme: 'light' });
  const res = await page.goto(`${server.url}/resume/`, { waitUntil: 'networkidle' });
  if (!res || !res.ok()) throw new Error(`/resume/ returned HTTP ${res ? res.status() : 'no response'}`);
  const text = await page.locator('main').innerText();
  if (!text.includes('Stephen Groff') || !text.includes('651-300-7201')) {
    throw new Error('/resume/ is missing expected resume content');
  }
  await page.pdf({
    path: resolve(siteDir, 'resume/stephen-groff-resume.pdf'),
    format: 'Letter',
    printBackground: true,
  });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
