import { lstat, readdir } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';

const authorModule = name => name.split('/').slice(0, -1).some(part => part === 'editor' || part === 'agent')
  || name === 'script/text.js' || name.startsWith('script/text/');

async function entry(path, label) {
  let value;
  try { value = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    throw new Error(`Missing ${label}: ${path}`, { cause: error });
  }
  if (value.isSymbolicLink()) throw new Error(`${label} cannot be a symlink or junction: ${path}`);
  return value;
}

async function directories(path, label, checked) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (checked.has(current)) continue;
    if (!(await entry(current, label)).isDirectory()) throw new Error(`${label} must be a directory: ${current}`);
    checked.add(current);
  }
}

/** Select current TypeScript outputs without trusting or cleaning the contents of dist.
 * This rejects observed links; it is not a sandbox against concurrent OS path replacement.
 * Presence in this list does not prove that an existing JS file is freshly compiled.
 */
export async function listCompiledModules(repository, { target = 'studio' } = {}) {
  if (target !== 'game' && target !== 'studio') throw new Error('Compiled module target must be game or studio');
  const sourceRoot = resolve(repository, 'src'), compiledRoot = resolve(repository, 'dist');
  const checked = new Set(), names = [];
  await directories(sourceRoot, 'Source directory', checked);
  async function visit(directory, prefix = '') {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, child.name), name = prefix + child.name;
      if (child.isSymbolicLink()) throw new Error(`Source input cannot be a symlink or junction: ${path}`);
      if (child.isDirectory()) await visit(path, name + '/');
      else if (child.name.endsWith('.ts') && !child.name.endsWith('.d.ts')) {
        if (!child.isFile()) throw new Error(`Source module must be a regular file: ${path}`);
        names.push(name.slice(0, -3) + '.js');
      }
    }
  }
  await visit(sourceRoot);
  const result = [];
  for (const relativePath of names.sort()) {
    if (target === 'game' && authorModule(relativePath)) continue;
    const path = resolve(compiledRoot, ...relativePath.split('/'));
    await directories(dirname(path), 'Compiled module directory', checked);
    if (!(await entry(path, 'Compiled module')).isFile()) throw new Error(`Compiled module must be a regular file: ${path}`);
    result.push({ relativePath, path });
  }
  return result;
}
