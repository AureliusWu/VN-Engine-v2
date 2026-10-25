import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '../dist/index.js';
const repository = fileURLToPath(new URL('..', import.meta.url));

export async function packageStudio(output) {
  const destination = resolve(output);
  let exists; try { exists = await stat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists && (!exists.isDirectory() || (await readdir(destination)).length)) throw new Error('Studio output must be new or empty; existing files are preserved');
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
  await visit('editor', 'editor/'); await visit('dist', 'lib/'); await visit('examples/runtime', 'samples/');
  files.push({ name: 'LICENSE.txt', bytes: await readFile(resolve(repository, 'LICENSE')) });
  const metadata = { schema: 1, engine: ENGINE_VERSION, files: files.map(({ name, bytes }) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  await mkdir(destination, { recursive: true });
  for (const { name, bytes } of files) { const path = resolve(destination, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
  await writeFile(resolve(destination, 'studio-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { output: destination, files: files.length + 1, engine: ENGINE_VERSION };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await packageStudio(process.argv[2] ?? 'build/studio')));
