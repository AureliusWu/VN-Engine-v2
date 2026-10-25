import { mkdir, readFile, writeFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createProject, localAssetPath, ENGINE_VERSION } from '../dist/index.js';
import { fingerprintFiles, renderWorker } from './pwa.mjs';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
async function modules(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'editor') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await modules(path)); else if (entry.name.endsWith('.js')) result.push(path);
  }
  return result;
}

/** Bundle local author data with our compiled runtime; no game engine downloads. */
export async function packageGame(projectFile, output) {
  const source = resolve(projectFile), sourceRoot = await realpath(dirname(source)), destination = resolve(output);
  let existing;
  try { existing = await stat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isDirectory() || (await readdir(destination)).length)) throw new Error('Output must be a new or empty directory; existing files are preserved');
  const project = JSON.parse(await readFile(source, 'utf8'));
  const instance = createProject(project, pathToFileURL(sourceRoot + sep)); instance.session.dispose();
  if (!/^[a-zA-Z0-9_-]+$/.test(project.game)) throw new Error('Packaged game ID needs a path-safe identifier');
  const files = new Map();
  for (const asset of project.assets) {
    if (!localAssetPath(asset.src)) throw new Error('Asset must be a local relative path');
    if (asset.kind === 'font' && !asset.license) throw new Error('Bundled font needs its own license record');
    if (/^(lib\/|index.html$|app.mjs$|project.json$|sw.js$|build-manifest.json$|manifest.webmanifest$|icon.svg$|LICENSE.txt$)/.test(asset.src)) throw new Error('Asset path collides with a generated file');
    const path = await realpath(resolve(sourceRoot, asset.src));
    if (!path.startsWith(sourceRoot + sep)) throw new Error('Asset symlink leaves the project directory');
    const bytes = await readFile(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (asset.sha256 && asset.sha256 !== digest) throw new Error(`Asset checksum mismatch: ${asset.id}`);
    files.set(asset.src, bytes);
    if (asset.license) {
      if (!localAssetPath(asset.license.src) || /^(lib\/|index.html$|app.mjs$|project.json$|sw.js$|build-manifest.json$|manifest.webmanifest$|icon.svg$|LICENSE.txt$)/.test(asset.license.src)) throw new Error('Invalid or conflicting license path');
      const license = await realpath(resolve(sourceRoot, asset.license.src));
      if (!license.startsWith(sourceRoot + sep)) throw new Error('License leaves the project directory');
      files.set(asset.license.src, await readFile(license));
    }
  }
  files.set('project.json', Buffer.from(JSON.stringify(project, null, 2) + '\n'));
  for (const path of await modules(resolve(repository, 'dist'))) {
    const name = 'lib/' + relative(resolve(repository, 'dist'), path).split(sep).join('/');
    files.set(name, Buffer.from((await readFile(path, 'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm, '')));
  }
  files.set('index.html', Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(project.title)}</title><link rel="manifest" href="manifest.webmanifest"><style>html,body{margin:0;background:#111820}main{max-width:1280px;margin:auto;padding:10px}#status{font:12px system-ui;color:#c0dfd1;margin:8px}#error{font:16px system-ui;color:#ffd8c2;white-space:pre-wrap}</style></head><body><main id="game"></main><p id="status" role="status">正在下载离线资源</p><p id="error" role="alert"></p><script type="module" src="./app.mjs"></script></body></html>`));
  files.set('app.mjs', Buffer.from(`import {mountGame} from './lib/index.js';
const error=document.getElementById('error');
try{const response=await fetch('./project.json');if(!response.ok)throw Error('Project unavailable');const project=await response.json();const game=mountGame(document.getElementById('game'),project,{baseURL:new URL('./',location.href)});window.addEventListener('pagehide',event=>{if(!event.persisted)game.dispose();});
if('serviceWorker' in navigator){const owner=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});const show=()=>{document.getElementById('status').textContent=owner.active?.state==='activated'?'已下载，可离线游玩':'正在下载离线资源';};(owner.installing??owner.waiting??owner.active)?.addEventListener('statechange',show);show();}}
catch(failure){error.textContent='启动未完成：'+failure.message;}
`));
  files.set('icon.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="#1d393e"/><path d="M48 136V56h22l52 54V56h22v80h-22L70 82v54z" fill="#c2ebd5"/></svg>'));
  files.set('manifest.webmanifest', Buffer.from(JSON.stringify({ id: './', name: project.title, short_name: project.title, start_url: './', scope: './', display: 'standalone', background_color: '#111820', theme_color: '#1d393e', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] })));
  files.set('LICENSE.txt', await readFile(resolve(repository, 'LICENSE')));
  if (project.font && !project.assets.find(asset => asset.id === project.font)?.license) throw new Error('Bundled project font needs its own license record');
  const bytes = [...files].map(([name, bytes]) => ({ name, bytes }));
  const version = fingerprintFiles(bytes);
  files.set('sw.js', Buffer.from(renderWorker({ namespace: 'vn-self-' + project.game, version, urls: [...files.keys()] })));
  const metadata = { schema: 1, game: project.game, version: project.version, engine: 'VN Engine v2 self runtime ' + ENGINE_VERSION, contentFingerprint: version,
    files: [...files].map(([name, bytes]) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  files.set('build-manifest.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n'));
  await mkdir(destination, { recursive: true });
  for (const [name, bytes] of files) { const path = resolve(destination, name); if (!path.startsWith(destination + sep)) throw new Error('Unsafe output path'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
  return { output: destination, files: files.size, game: project.game, fingerprint: version };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2], output = process.argv[3];
  if (!source || !output) throw new Error('Usage: node tools/package-game.mjs project.json output-directory');
  console.log(JSON.stringify(await packageGame(source, output)));
}
