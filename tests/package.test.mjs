import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageGame } from '../tools/package-game.mjs';

test('standalone build contains our runtime, native author data, scoped worker and asset hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-build-'));
  const result = await packageGame('examples/runtime/rain.json', join(root, 'game'));
  const manifest = JSON.parse(await readFile(join(result.output, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.game, 'vn-self-rain'); assert.ok(manifest.files.some(file => file.name === 'lib/script/engine.js'));
  assert.ok(manifest.files.some(file => file.name === 'assets/OFL.txt'));
  assert.ok(manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  const bootstrap = await readFile(join(result.output, 'app.mjs'), 'utf8'); assert.ok(bootstrap.includes('mountGame'));
  assert.equal(/https?:|renpy|wasm/i.test(bootstrap), false);
  await assert.rejects(packageGame('examples/runtime/rain.json', result.output), /preserved/);
});

test('all four author project types compile into independent standalone games', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-four-build-'));
  for (const name of ['campus', 'netlove', 'circuit', 'rain']) {
    const result = await packageGame(`examples/runtime/${name}.json`, join(root, name)); assert.ok(result.files > 35);
  }
});

test('build refuses altered assets, escaping symlinks and generated-file collisions before writing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-invalid-build-'));
  const original = JSON.parse(await readFile('examples/runtime/rain.json', 'utf8'));
  for (const [name, mutate, pattern] of [
    ['checksum', data => { data.assets = [{ id: 'bad', kind: 'audio', src: 'sample.txt', sha256: '0'.repeat(64) }]; delete data.font; }, /checksum/],
    ['escape', data => { data.assets = [{ id: 'bad', kind: 'audio', src: 'escape.txt' }]; delete data.font; }, /symlink/],
    ['collision', data => { data.assets = [{ id: 'bad', kind: 'audio', src: 'app.mjs' }]; delete data.font; }, /collides/]
  ]) {
    const data = structuredClone(original); mutate(data); const path = join(root, name); await mkdir(path); await writeFile(join(path, 'project.json'), JSON.stringify(data));
    await writeFile(join(path, 'sample.txt'), 'fixture'); await symlink(resolve('package.json'), join(path, 'escape.txt')); await writeFile(join(path, 'app.mjs'), 'fixture');
    await assert.rejects(packageGame(join(path, 'project.json'), join(root, 'out-' + name)), pattern);
  }
});
