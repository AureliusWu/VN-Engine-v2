import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';

const conflict = () => Error('Output must be a new or empty directory; existing files are preserved');
async function maybeStat(path) {
  try { return await lstat(path, { bigint: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

/** Portable output paths must not alias files or put a file above another entry. */
export function validateOutputPaths(names) {
  const folded = new Map();
  for (const name of names) {
    if (typeof name !== 'string' || /[\\:%?#\u0000-\u001f*"<>|]/.test(name)
      || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))
      throw Error('Unsafe output path');
    const key = name.toLowerCase(), previous = folded.get(key);
    if (previous !== undefined && previous !== name) throw Error(`Output path casing collision: ${previous} / ${name}`);
    folded.set(key, name);
  }
  for (const [key, name] of folded) {
    const parts = key.split('/');
    for (let length = 1; length < parts.length; length++) {
      const ancestor = folded.get(parts.slice(0, length).join('/'));
      if (ancestor !== undefined) throw Error(`Output file/directory path conflict: ${ancestor} / ${name}`);
    }
  }
}

async function directories(path, create = false, owned = []) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let entry = await maybeStat(current);
    if (!entry && create) {
      try { await mkdir(current); entry = await lstat(current, { bigint: true }); owned.push({ path: current, entry }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; entry = await lstat(current, { bigint: true }); }
    }
    if (!entry) return;
    if (entry.isSymbolicLink()) throw Error('Output directory cannot pass through a symlink or junction');
    if (!entry.isDirectory()) throw conflict();
  }
}

export async function checkOutputDirectory(output) {
  const destination = resolve(output);
  await directories(dirname(destination));
  const entry = await maybeStat(destination);
  if (entry?.isSymbolicLink()) throw Error('Output cannot be a symlink or junction');
  if (entry && (!entry.isDirectory() || (await readdir(destination)).length)) throw conflict();
}

async function cleanOwnedStage(files, folders) {
  // Never recursively remove a failed output or unexpected files added to our stage.
  for (const file of files.reverse()) {
    try {
      const current = await lstat(file.path, { bigint: true });
      if (current.isFile() && sameFile(current, file.entry) && (await readFile(file.path)).equals(file.bytes)) await unlink(file.path);
    } catch { /* Leave changed or inaccessible files in place. */ }
  }
  for (const folder of folders.reverse()) {
    try {
      const current = await lstat(folder.path, { bigint: true });
      if (current.isDirectory() && !current.isSymbolicLink() && sameFile(current, folder.entry)) await rmdir(folder.path);
    } catch { /* rmdir preserves nonempty folders, including concurrent user files. */ }
  }
}

/** Stage complete bytes, then publish a directory without overwriting a populated target.
 * An existing empty target is removed with rmdir before rename, leaving a short gap.
 * Checks reject observed symlinks; this is not an OS sandbox against concurrent ancestor replacement.
 */
export async function publishOutputDirectory(output, entries, { beforePublish } = {}) {
  const destination = resolve(output), parent = dirname(destination), snapshot = new Map();
  for (const [name, input] of entries) {
    const bytes = Buffer.from(input);
    if (snapshot.has(name) && !snapshot.get(name).equals(bytes)) throw Error('Conflicting bytes for one output path');
    snapshot.set(name, bytes);
  }
  validateOutputPaths(snapshot.keys());
  await checkOutputDirectory(destination);
  await directories(parent, true);
  const stage = await mkdtemp(join(parent, '.vn-engine-build-'));
  const ownedFiles = [], ownedFolders = [{ path: stage, entry: await lstat(stage, { bigint: true }) }];
  let published = false, removedEmptyTarget = false;
  try {
    for (const [name, bytes] of snapshot) {
      const path = resolve(stage, name);
      if (!path.startsWith(stage + sep)) throw Error('Unsafe output path');
      await directories(dirname(path), true, ownedFolders);
      const file = await open(path, 'wx', 0o600);
      try {
        const entry = await file.stat({ bigint: true });
        await file.writeFile(bytes); ownedFiles.push({ path, entry, bytes });
      } finally { await file.close(); }
    }
    await beforePublish?.({ stage });
    await checkOutputDirectory(destination);
    // rmdir only removes an empty directory. A newly populated target is preserved.
    try { await rmdir(destination); removedEmptyTarget = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await directories(parent);
    await rename(stage, destination);
    published = true;
  } finally {
    if (!published) {
      await cleanOwnedStage(ownedFiles, ownedFolders);
      if (removedEmptyTarget) {
        // Restore only an absent empty target; never replace a concurrent file or link.
        try { await directories(parent); await mkdir(destination); } catch { }
      }
    }
  }
}
