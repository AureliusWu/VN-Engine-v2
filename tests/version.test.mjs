import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ENGINE_VERSION } from '../dist/index.js';

test('npm, lockfile, exported engine and native assembly share a single compatible version', async () => {
  const root = new URL('../', import.meta.url), load = path => readFile(new URL(path, root), 'utf8');
  const [pkg, lock, native] = await Promise.all([load('package.json').then(JSON.parse), load('package-lock.json').then(JSON.parse), load('hosts/windows/VNEngine.Windows.csproj')]);
  assert.match(ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, ENGINE_VERSION); assert.equal(lock.version, ENGINE_VERSION); assert.equal(lock.packages[''].version, ENGINE_VERSION);
  assert.equal(native.match(/<Version>([^<]+)<\/Version>/)?.[1], ENGINE_VERSION);
});
