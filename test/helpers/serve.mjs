import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml',
  '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

/** Serve a built site directory on a random port; returns { url, close }. */
export async function serve(dir) {
  const server = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/') || p.endsWith('\\')) p = join(p, 'index.html');
    try {
      const body = await readFile(join(dir, p));
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      try {
        const nf = await readFile(join(dir, '404.html'));
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end(nf);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
