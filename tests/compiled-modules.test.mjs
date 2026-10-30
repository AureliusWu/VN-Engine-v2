import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { listCompiledModules } from '../tools/compiled-modules.mjs';

async function removeOwned(root, path, options) {
  const owner = resolve(root), target = resolve(path);
  assert.ok(target === owner || target.startsWith(owner + sep), 'Fixture removal must stay inside its own directory');
  await rm(target, options);
}

async function fixture(t, modules = ['index']) {
  const temporary = resolve(tmpdir()), root = await mkdtemp(join(temporary, 'vn-compiled-modules-'));
  assert.equal(dirname(root), temporary);
  t.after(() => removeOwned(root, root, { recursive: true, force: true }));
  for (const name of modules) {
    for (const [directory, extension] of [['src', '.ts'], ['dist', '.js']]) {
      const path = join(root, directory, name + extension);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'export {};\n');
    }
  }
  return root;
}
const names = values => values.map(value => value.relativePath);
const directoryLink = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');

test('current source modules select sorted JS outputs while orphan JS and non-JS files stay untouched', async t => {
  const root = await fixture(t, ['z-last', 'runtime/session', 'index', 'Alpha']);
  await writeFile(join(root, 'src', 'types.d.ts'), 'declare const fixture: string;\n');
  const extras = ['orphan.js', 'runtime/old.js', 'notes.txt', 'index.js.map', 'index.d.ts'];
  for (const path of extras) await writeFile(join(root, 'dist', path), 'unrelated bytes');
  const modules = await listCompiledModules(root);
  assert.deepEqual(names(modules), ['Alpha.js', 'index.js', 'runtime/session.js', 'z-last.js']);
  for (const module of modules) assert.equal(module.path, join(root, 'dist', ...module.relativePath.split('/')));
  for (const path of extras) assert.equal(await readFile(join(root, 'dist', path), 'utf8'), 'unrelated bytes');
});

test('a current source module without its JS output fails instead of silently omitting or creating it', async t => {
  const root = await fixture(t, ['index', 'runtime/session']);
  await removeOwned(root, join(root, 'dist', 'runtime/session.js'));
  await assert.rejects(listCompiledModules(root), /Missing Compiled module.*session\.js/);
  assert.deepEqual(await readdir(join(root, 'dist', 'runtime')), []);
});

test('players keep the existing author exclusions while Studio requires all author modules', async t => {
  const root = await fixture(t, ['index', 'script/engine', 'script/text', 'script/text/parser', 'script/text-helper', 'editor/index', 'agent/sdk', 'nested/editor/model']);
  assert.deepEqual(names(await listCompiledModules(root, { target: 'game' })), ['index.js', 'script/engine.js', 'script/text-helper.js']);
  assert.deepEqual(names(await listCompiledModules(root)), ['agent/sdk.js', 'editor/index.js', 'index.js', 'nested/editor/model.js', 'script/engine.js', 'script/text-helper.js', 'script/text.js', 'script/text/parser.js']);
  await removeOwned(root, join(root, 'dist', 'editor/index.js'));
  assert.deepEqual(names(await listCompiledModules(root, { target: 'game' })), ['index.js', 'script/engine.js', 'script/text-helper.js']);
  await assert.rejects(listCompiledModules(root, { target: 'studio' }), /Missing Compiled module.*index\.js/);
});

test('unrelated compiled links and their contents are never traversed', async t => {
  const root = await fixture(t), outside = join(root, 'outside');
  await mkdir(outside); await writeFile(join(outside, 'unowned.js'), 'external sentinel');
  await directoryLink(outside, join(root, 'dist', 'unused'));
  await directoryLink(outside, join(root, 'dist', 'orphan.js'));
  await directoryLink(outside, join(root, 'dist', 'notes.txt'));
  for (const target of ['game', 'studio']) assert.deepEqual(names(await listCompiledModules(root, { target })), ['index.js']);
  assert.equal(await readFile(join(outside, 'unowned.js'), 'utf8'), 'external sentinel');
});

test('source directory links are refused without following them', async t => {
  const root = await fixture(t), outside = join(root, 'outside');
  await mkdir(outside); await writeFile(join(outside, 'external.ts'), 'external sentinel');
  await directoryLink(outside, join(root, 'src', 'linked'));
  await assert.rejects(listCompiledModules(root), /Source input cannot be a symlink or junction/);
  assert.equal(await readFile(join(outside, 'external.ts'), 'utf8'), 'external sentinel');
});

test('source root and compiled root, ancestor and required module links are refused', async t => {
  for (const path of ['src', 'dist', 'dist/runtime', 'dist/runtime/session.js']) {
    await t.test(path, async child => {
      const root = await fixture(child, ['index', 'runtime/session']), outside = join(root, 'outside');
      await mkdir(outside); await writeFile(join(outside, 'sentinel.txt'), 'external sentinel');
      await removeOwned(root, join(root, path), { recursive: true, force: true });
      await directoryLink(outside, join(root, path));
      await assert.rejects(listCompiledModules(root), /symlink or junction/);
      assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'external sentinel');
    });
  }
});

test('an invalid target is refused before module selection', async t => {
  const root = await fixture(t);
  await assert.rejects(listCompiledModules(root, { target: 'other' }), /target must be game or studio/);
});
