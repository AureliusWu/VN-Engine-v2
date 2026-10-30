import {fingerprintFiles,renderWorker} from './pwa.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '../dist/index.js';
import { checkOutputDirectory, publishOutputDirectory } from './package-output.mjs';
import { listCompiledModules } from './compiled-modules.mjs';
const repository = fileURLToPath(new URL('..', import.meta.url));

export async function packageStudio(output) {
  const destination = resolve(output);
  await checkOutputDirectory(destination);
  // Read inputs before creating the output. Includes licence and all local preview assets.
  const files = [];
  async function visit(directory, prefix) {
    for (const entry of await readdir(resolve(repository, directory), { withFileTypes: true })) {
      const path = directory + '/' + entry.name, name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Studio inputs cannot be symlinks');
      if (entry.isDirectory()) await visit(path, name + '/');
      else if (!/\.(map|d\.ts)$/.test(name)) files.push({ name, bytes: await readFile(resolve(repository, path)) });
    }
  }
  await visit('editor', 'editor/');
  for (const { relativePath, path } of await listCompiledModules(repository, { target: 'studio' }))
    files.push({ name: 'lib/' + relativePath, bytes: await readFile(path) });
  await visit('examples/runtime', 'samples/');
  files.push({ name: 'LICENSE.txt', bytes: await readFile(resolve(repository, 'LICENSE')) });
  const index=files.find(f=>f.name==='editor/index.html');
  index.bytes=Buffer.from(index.bytes.toString('utf8').replace('</body>','<script type="module" src="./offline.mjs"></script></body>'));
  files.push({name:'editor/offline.mjs',bytes:Buffer.from("if('serviceWorker' in navigator){navigator.serviceWorker.register('../sw.js',{scope:'../',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>document.body.dataset.studioOffline='ready').catch(()=>document.body.dataset.studioOffline='unavailable');}\n")});
  files.push({name:'sw.js',bytes:Buffer.from(renderWorker({namespace:'vn-studio',version:fingerprintFiles(files),urls:files.map(f=>f.name).concat('studio-manifest.json'),shell:'editor/index.html',navigationShellFirst:false}))});
  const metadata = { schema: 1, engine: ENGINE_VERSION, files: files.map(({ name, bytes }) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  await publishOutputDirectory(destination, [...files.map(({ name, bytes }) => [name, bytes]), ['studio-manifest.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n')]]);
  return { output: destination, files: files.length + 1, engine: ENGINE_VERSION };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await packageStudio(process.argv[2] ?? 'build/studio')));
