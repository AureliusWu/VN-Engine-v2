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
async function listRuntime(dir = 'examples/runtime') {
  const files = [];
  for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) files.push(...await listRuntime(path));
    else files.push(path);
  }
  return files;
}
export async function createDemoServer() {
  const names = [...Object.keys(aliases), ...fixtures, ...await listJS('dist')];
  const files = await Promise.all(names.map(async name => ({ name, bytes: await readFile(resolve(root, aliases[name] ?? name)) })));
  const worker = renderWorker({ namespace: 'vn-engine-demo', version: fingerprintFiles(files), urls: names });
  const engineFiles = [...(await listRuntime()).map(path => ({ name: path.slice('examples/runtime/'.length), path })),
    ...(await listJS('dist')).map(path => ({ name: 'lib/' + path.slice('dist/'.length), path }))];
  const engineBytes = await Promise.all(engineFiles.map(async file => ({ name: file.name, bytes: await readFile(resolve(root, file.path)) })));
  const engineWorker = renderWorker({ namespace: 'vn-self-engine', version: fingerprintFiles(engineBytes), urls: engineFiles.map(file => file.name) });
  return createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
      if (name === 'engine' || name === 'editor') { response.writeHead(302, { Location: '/' + name + '/' }); response.end(); return; }
      if (name === 'sw.js' || name === 'engine/sw.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }); response.end(name === 'sw.js' ? worker : engineWorker); return;
      }
      const mapped = name.startsWith('engine/lib/') ? 'dist/' + name.slice('engine/lib/'.length)
        : name.startsWith('lib/') ? 'dist/' + name.slice('lib/'.length)
        : name.startsWith('samples/') ? 'examples/runtime/' + name.slice('samples/'.length)
        : name === 'editor/' ? 'editor/index.html'
        : name.startsWith('engine/') ? 'examples/runtime/' + (name.slice('engine/'.length) || 'index.html') : aliases[name] ?? name;
      const path = resolve(root, mapped);
      // A demo server, never a directory listing or arbitrary workspace file server.
      if (!path.startsWith(root + sep) || !/^(examples|dist|editor)\//.test(mapped)) { response.writeHead(404); response.end(); return; }
      const bytes = await readFile(path);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.rpy': 'text/plain', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wav': 'audio/wav' }[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(bytes);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createDemoServer();
  server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`VN Engine v2 自研运行时: http://127.0.0.1:${server.address().port}/engine/`));
}
