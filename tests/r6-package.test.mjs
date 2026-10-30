import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { packageGame } from '../tools/package-game.mjs';
import { packageStudio } from '../tools/package-studio.mjs';
import { newProject } from '../dist/editor/index.js';
import { publishOutputDirectory, validateOutputPaths } from '../tools/package-output.mjs';

const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'vn-r6-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = newProject('script'), source = join(root, 'project.json');
  await writeFile(source, JSON.stringify(project));
  return { root, project, source, output: join(root, 'output') };
}

test('game packaging refuses generated-file collisions regardless of path casing', async t => {
  const { root, project, source, output } = await fixture(t);
  for (const src of ['Index.html', 'LiB/nested.svg']) {
    project.assets = [{ id: 'picture', kind: 'background', src }];
    project.defaults = { background: 'picture' };
    await mkdir(dirname(join(root, src)), { recursive: true });
    await writeFile(join(root, src), picture); await writeFile(source, JSON.stringify(project));
    await assert.rejects(packageGame(source, output), /collid|conflict/i);
    await assert.rejects(readdir(output), { code: 'ENOENT' });
  }
});

test('license paths cannot collide with generated files by casing', async t => {
  const { root, project, source, output } = await fixture(t);
  project.assets = [{ id: 'picture', kind: 'background', src: 'picture.svg', license: { name: 'Test fixture', src: 'Icon.svg' } }];
  project.defaults = { background: 'picture' };
  await writeFile(join(root, 'picture.svg'), picture); await writeFile(join(root, 'Icon.svg'), 'fixture license');
  await writeFile(source, JSON.stringify(project));
  await assert.rejects(packageGame(source, output), /collid|conflict/i);
  await assert.rejects(readdir(output), { code: 'ENOENT' });
});

test('exact repeated resource paths remain legal and produce one output entry', async t => {
  const { root, project, source, output } = await fixture(t);
  project.assets = ['first', 'second'].map(id => ({ id, kind: 'background', src: 'picture.svg', license: { name: 'Test fixture', src: 'shared-license.txt' } }));
  project.defaults = { background: 'first' };
  await writeFile(join(root, 'shared-license.txt'), 'Shared fixture license');
  await writeFile(join(root, 'picture.svg'), picture); await writeFile(source, JSON.stringify(project));
  await packageGame(source, output);
  const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.files.filter(file => file.name === 'picture.svg').length, 1);
  assert.equal(manifest.files.filter(file => file.name === 'shared-license.txt').length, 1);
  assert.equal(await readFile(join(output, 'picture.svg'), 'utf8'), picture);
});

test('portable paths reject casing, nonadjacent file ancestors and unsafe entries', () => {
  validateOutputPaths(['same.svg', 'same.svg', 'folder/one.svg', 'Folder/two.svg']);
  assert.throws(() => validateOutputPaths(['art.svg', 'ART.svg']), /casing collision/);
  assert.throws(() => validateOutputPaths(['a', 'a-foo', 'A/b']), /file\/directory path conflict/);
  assert.throws(() => validateOutputPaths(['LICENSE.TXT', 'license.txt/notice']), /file\/directory path conflict/);
  for (const name of ['../escape', '/absolute', 'C:relative', 'a\\b', 'trailing.', 'NUL.txt'])
    assert.throws(() => validateOutputPaths([name]), /Unsafe output path/);
});

test('nested generated-file aliases are refused before an output is written', async t => {
  const { root, project, source, output } = await fixture(t);
  project.assets = [{ id: 'picture', kind: 'background', src: 'INDEX.HTML/picture.svg' }];
  project.defaults = { background: 'picture' };
  await mkdir(join(root, 'INDEX.HTML')); await writeFile(join(root, 'INDEX.HTML/picture.svg'), picture);
  await writeFile(source, JSON.stringify(project));
  await assert.rejects(packageGame(source, output), /file\/directory path conflict/);
  await assert.rejects(readdir(output), { code: 'ENOENT' });
});

test('materializing a complete stage preserves a later target file and cleans only its own stage', async t => {
  const { root, output } = await fixture(t); await mkdir(output);
  await assert.rejects(publishOutputDirectory(output, [['index.html', 'generated']], { beforePublish: async () => {
    await writeFile(join(output, 'user.txt'), 'concurrent user bytes');
  } }), /preserved/);
  assert.equal(await readFile(join(output, 'user.txt'), 'utf8'), 'concurrent user bytes');
  assert.deepEqual((await readdir(root)).sort(), ['output', 'project.json']);
});

test('failed stage cleanup preserves unexpected files and changed file bytes', async t => {
  const { output } = await fixture(t); let stage;
  await assert.rejects(publishOutputDirectory(output, [['index.html', 'generated'], ['lib/runtime.js', 'own module']], { beforePublish: async value => {
    stage = value.stage;
    await writeFile(join(stage, 'user.txt'), 'unexpected user file');
    await writeFile(join(stage, 'index.html'), 'user changed the staged file');
    throw Error('controlled publication failure');
  } }), /controlled publication failure/);
  assert.equal(await readFile(join(stage, 'user.txt'), 'utf8'), 'unexpected user file');
  assert.equal(await readFile(join(stage, 'index.html'), 'utf8'), 'user changed the staged file');
  assert.deepEqual((await readdir(stage)).sort(), ['index.html', 'user.txt']);
  await assert.rejects(readdir(output), { code: 'ENOENT' });
});

test('publication rechecks a target changed to a junction after staging', async t => {
  const { root, output } = await fixture(t), target = join(root, 'outside'); await mkdir(target);
  await assert.rejects(publishOutputDirectory(output, [['index.html', 'generated']], { beforePublish: async () => {
    await symlink(target, output, process.platform === 'win32' ? 'junction' : 'dir');
  } }), /link|junction/i);
  assert.deepEqual(await readdir(target), []);
  assert.equal((await readdir(root)).some(name => name.startsWith('.vn-engine-build-')), false);
});

test('complete staged output publishes into a previously empty directory', async t => {
  const { output } = await fixture(t); await mkdir(output);
  await publishOutputDirectory(output, [['index.html', 'generated'], ['assets/picture.svg', picture]]);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'generated');
  assert.equal(await readFile(join(output, 'assets/picture.svg'), 'utf8'), picture);
});

test('a user file appearing after the game snapshot is preserved and refuses publication', async t => {
  const { source, output } = await fixture(t);
  await mkdir(output); const sentinel = 'User work created while packaging was running';
  await assert.rejects(packageGame(source, output, { onPhase: async phase => {
    if (phase === 'snapshot-ready') await writeFile(join(output, 'index.html'), sentinel);
  } }), /preserved|empty|exist/i);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), sentinel);
  assert.deepEqual(await readdir(output), ['index.html']);
});

for (const type of ['game', 'studio']) test(`${type} packaging refuses output junctions and leaves the target untouched`, async t => {
  const { root, source, output } = await fixture(t), target = join(root, 'outside');
  await mkdir(target); await symlink(target, output, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(type === 'game' ? packageGame(source, output) : packageStudio(output), /link|junction/i);
  assert.deepEqual(await readdir(target), []);
});

test('game packaging refuses output paths below a junction', async t => {
  const { root, source } = await fixture(t), target = join(root, 'outside'), alias = join(root, 'alias');
  await mkdir(target); await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packageGame(source, join(alias, 'output')), /link|junction/i);
  assert.deepEqual(await readdir(target), []);
});
