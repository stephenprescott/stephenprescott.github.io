/**
 * Throw if any node in `data` carries `placeholder: true`.
 * Reports every offending path, e.g. `projects[1]`, `home.stats[0]`.
 */
export function assertNoPlaceholders(data) {
  const found = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      if (node.placeholder === true) {
        found.push(path);
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(data, '');
  if (found.length) throw new Error(`placeholder content in production: ${found.join(', ')}`);
}
