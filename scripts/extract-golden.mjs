// Renders each design-system component with the real React bundle in headless
// Chromium and saves its markup to test/golden/<name>.html.
// Props files: {"props":{...},"children":...}; an element is {"$el":"Name"|"tag","props":{},"children":...}.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const propsDir = join(root, 'test/golden/props');

const scripts = [
  read('node_modules/react/umd/react.development.js'),
  read('node_modules/react-dom/umd/react-dom.development.js'),
  read('scripts/vendor/bundle.js'),
];
const css = read('src/assets/css/tokens.css').replace(/url\("fonts\//g, 'url("about:blank#') + read('src/assets/css/bundle.css');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!doctype html><html data-theme="dark"><head><style>${css}</style></head><body class="ws-root"><div id="root"></div></body></html>`);
for (const s of scripts) await page.addScriptTag({ content: s });

const render = (spec) =>
  page.evaluate((spec) => {
    const E = window.WarmingStripes, R = window.React;
    const build = (n) => {
      if (Array.isArray(n)) return n.map((c, i) => { const b = build(c); return R.isValidElement(b) ? R.cloneElement(b, { key: i }) : b; });
      if (n && typeof n === 'object' && n.$el) {
        const type = E[n.$el] || n.$el;
        const props = {};
        for (const [k, v] of Object.entries(n.props || {})) props[k] = build(v);
        const kids = n.children === undefined ? [] : [build(n.children)];
        return R.createElement(type, props, ...kids);
      }
      if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, build(v)]));
      return n;
    };
    return new Promise((done) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = window.ReactDOM.createRoot(host);
      const el = build({ $el: spec.name, props: spec.props, children: spec.children });
      root.render(el);
      setTimeout(() => { const html = host.innerHTML; root.unmount(); host.remove(); done(html); }, 50);
    });
  }, spec);

for (const file of readdirSync(propsDir).filter((f) => f.endsWith('.json')).sort()) {
  const key = file.replace(/\.json$/, '');
  const spec = JSON.parse(readFileSync(join(propsDir, file), 'utf8'));
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), spec.theme || 'dark');
  const html = await render({ name: key.split('.')[0], props: spec.props, children: spec.children });
  writeFileSync(join(root, 'test/golden', `${key}.html`), html + '\n');
  console.log(key, html.length);
}
// Every icon as inner SVG markup, for the static icon macro.
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
const icons = await page.evaluate(() => {
  const E = window.WarmingStripes, R = window.React, out = {};
  for (const name of E.iconNames) {
    const host = document.createElement('div');
    const root = window.ReactDOM.createRoot(host);
    window.ReactDOM.flushSync(() => root.render(R.createElement(E.Icon, { name, size: 20 })));
    out[name] = host.firstChild.innerHTML;
    root.unmount();
  }
  return out;
});
writeFileSync(join(root, 'src/_data/icons.json'), JSON.stringify(icons) + '\n');
console.log('icons', Object.keys(icons).length);
await browser.close();
