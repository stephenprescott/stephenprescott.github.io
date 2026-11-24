import assert from 'node:assert/strict';

const LP_DATA = /(<script type="application\/json" id="lp-data">)([\s\S]*?)(<\/script>)/;

/**
 * A page setup (for Playwright, before navigation) that serves `${url}/` with #lp-data replaced by
 * mutate(original data), or by a raw string. `alter(html, data)` may change the served page further
 * (for example to add the server-rendered markup that matches the new data).
 */
export const withData = (url, mutate, alter) => async (page) => {
  await page.route(url + '/', async (route) => {
    const res = await route.fetch();
    const html = await res.text();
    let data = null;
    let body = html.replace(LP_DATA, (_, a, json, c) => {
      if (typeof mutate === 'string') return a + mutate + c;
      data = mutate(JSON.parse(json));
      return a + JSON.stringify(data).replace(/</g, '\\u003c') + c;
    });
    assert.notEqual(body, html, 'lp-data replaced');
    if (alter) body = alter(body, data);
    await route.fulfill({ response: res, body });
  });
};
