import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fingerprintFiles, renderWorker } from './pwa.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const aliases = { 'index.html': 'examples/demo/index.html', 'app.mjs': 'examples/demo/app.mjs', 'style.css': 'examples/demo/style.css', 'demo-font.woff2': 'examples/demo/demo-font.woff2' };
const fixtures = ['examples/healing/story.json', 'examples/netlove/story.json', 'examples/circuit/chapters.json'];
async function listJS(dir) {
  const result = [];
  for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) result.push(...await listJS(path));
    else if (entry.name.endsWith('.js')) result.push(path);
  }
  return result;
}
export async function createDemoServer() {
  const names = [...Object.keys(aliases), ...fixtures, ...await listJS('dist')];
  const files = await Promise.all(names.map(async name => ({ name, bytes: await readFile(resolve(root, aliases[name] ?? name)) })));
  const worker = renderWorker({ namespace: 'vn-engine-demo', version: fingerprintFiles(files), urls: names });
  return createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
      if (name === 'sw.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }); response.end(worker); return;
      }
      const path = resolve(root, aliases[name] ?? name);
      // A demo server, never a directory listing or arbitrary workspace file server.
      if (!path.startsWith(root + sep) || !/^(examples|dist)\//.test(aliases[name] ?? name)) { response.writeHead(404); response.end(); return; }
      const bytes = await readFile(path);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.rpy': 'text/plain', '.woff2': 'font/woff2' }[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(bytes);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createDemoServer();
  server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`VN Engine v2: http://127.0.0.1:${server.address().port}`));
}
