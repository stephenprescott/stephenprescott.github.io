// Compare the built landing page with the approved mockup, section by section (a dev tool, not a test).
//   npm run build && node scripts/compare-landing.mjs <mockup-url> <out-dir> [--motion]
// Serves _site with scripts/serve-built.mjs, opens / and the mockup headless at 1440, 1024 and 390 wide, and saves a
// pair of screenshots per section: <out-dir>/<width>-<section>-site.png and -mockup.png, plus boxes.json (the
// position and size of the key elements on both pages, for checking by number). Stills use prefers-reduced-motion:
// reduce, so the animated scenes are complete and still. --motion adds one normal-motion hero pair per width, taken
// about 3s after load. The mockup's own "Mockup controls" box is hidden; it is not part of the design.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const [mockupUrl, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const motion = process.argv.includes('--motion');
if (!mockupUrl || !outArg) {
  console.error('usage: node scripts/compare-landing.mjs <mockup-url> <out-dir> [--motion]');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '..');
if (!existsSync(join(root, '_site', 'index.html'))) {
  console.error('No _site/index.html: run `npm run build` first.');
  process.exit(2);
}
const out = resolve(outArg);
await mkdir(out, { recursive: true });

const WIDTHS = [[1440, 900], [1024, 768], [390, 844]];
// section -> [site selector, mockup selector]; the hero shot runs from the top of the page (nav included) to the
// top of the first section below it, so the space under the hero projects is part of the comparison.
const SECTIONS = {
  results: ['#results', '#numbers'],
  expertise: ['#expertise', '#expertise'],
  work: ['#work', '#work'],
  contact: ['#contact', '#contact'],
  footer: ['footer', 'footer.foot'],
};
// elements whose boxes are recorded for both pages (site selector, mockup selector)
const BOXES = {
  nav: ['.sh-nav', '#nav'],
  eyebrow: ['.lp-eyebrow', '.zen-text .eyebrow'],
  headline: ['.lp-headline', '.zen-text .display'],
  lede: ['.lp-lede', '.zen-text .lede'],
  cta: ['.lp-cta', '.zen-text .cta'],
  coreLabel: ['.lp-core-label', '#coreBtn'],
  firstProject: ['.lp-projects > li:not(.lp-off)', '#skyHot > *, #mGrid > *'],
  results: ['#results', '#numbers'],
  resultsH2: ['#results .lp-h2', '#numbers .h2'],
  stats: ['#results .lp-stats', '#numbers .stats'],
  firstStat: ['#results .lp-stat', '#numbers .stat'],
  expertise: ['#expertise', '#expertise'],
  chart: ['.lp-starchart', '#chart'],
  panel: ['.lp-panel', '#panel'],
  legend: ['.lp-legend', '.legend'],
  caption: ['.lp-cap', '#cap'],
  work: ['#work', '#work'],
  workList: ['#work .lp-acc, #work .lp-work', '#cases'],
  firstWorkRow: ['#work .lp-item, #work .lp-row', '#cases > li'],
  contact: ['#contact', '#contact'],
  contactLinks: ['.lp-c-links', '.c-links'],
  form: ['#contact form', '#contactForm'],
  footer: ['footer', 'footer.foot'],
};

// serve the built site
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn(process.execPath, [join(root, 'scripts', 'serve-built.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => { if (String(d).includes('serving')) ok(); });
  server.on('exit', (c) => fail(new Error(`serve-built exited (${c})`)));
});
const siteUrl = `http://127.0.0.1:${port}/`;

async function open(browser, url, width, height, reducedMotion) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mock-ctl{display:none!important}' });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

// scroll through once so anything waiting to come into view (reveals, draw-ins) has run, then back to the top
async function settle(page) {
  await page.evaluate(async () => {
    const step = innerHeight * 0.6;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

async function boxes(page, which) {
  return page.evaluate(([map, i]) => {
    const r = {};
    for (const [k, sels] of Object.entries(map)) {
      const el = [...document.querySelectorAll(sels[i])].find((e) => e.getClientRects().length);
      if (!el) { r[k] = null; continue; }
      const b = el.getBoundingClientRect();
      r[k] = { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
    }
    return r;
  }, [BOXES, which]);
}

async function shoot(page, sel, file) {
  const top = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { y: b.top + scrollY, h: b.height };
  }, sel);
  if (!top) return false;
  const width = page.viewportSize().width;
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: top.y, width, height: Math.max(1, top.h) } });
  return true;
}

async function heroShot(page, firstSel, file) {
  const end = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.getBoundingClientRect().top + scrollY : innerHeight;
  }, firstSel);
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: page.viewportSize().width, height: end } });
}

const browser = await chromium.launch();
const report = {};
try {
  for (const [w, h] of WIDTHS) {
    const pages = {
      site: await open(browser, siteUrl, w, h, 'reduce'),
      mockup: await open(browser, mockupUrl, w, h, 'reduce'),
    };
    report[w] = {};
    for (const [name, i] of [['site', 0], ['mockup', 1]]) {
      const { page } = pages[name];
      await settle(page);
      await heroShot(page, SECTIONS.results[i], join(out, `${w}-hero-${name}.png`));
      for (const [sec, sels] of Object.entries(SECTIONS)) await shoot(page, sels[i], join(out, `${w}-${sec}-${name}.png`));
      await page.screenshot({ path: join(out, `${w}-full-${name}.png`), fullPage: true });
      report[w][name] = await boxes(page, i);
    }
    for (const { ctx } of Object.values(pages)) await ctx.close();

    if (motion) {
      for (const [name, url, i] of [['site', siteUrl, 0], ['mockup', mockupUrl, 1]]) {
        const { ctx, page } = await open(browser, url, w, h, 'no-preference');
        await page.waitForTimeout(3000);
        await heroShot(page, SECTIONS.results[i], join(out, `${w}-hero-motion-${name}.png`));
        await ctx.close();
      }
    }
    console.log(`${w}: done`);
  }
} finally {
  await browser.close();
  server.kill();
}
await writeFile(join(out, 'boxes.json'), JSON.stringify(report, null, 2));
console.log(`saved to ${out}`);
