import test from 'node:test';
import assert from 'node:assert/strict';
import { packageRepositoryFixture, runPackageFixture } from './package-repository-fixture.mjs';

test('isolated game and Studio packages ignore compiler leftovers in files, manifests and offline workers', async () => {
  const fixture = await packageRepositoryFixture({ baseline: process.env.VN_PACKAGE_BASELINE === '1' });
  const result = await runPackageFixture(fixture, `
    import assert from 'node:assert/strict';
    import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
    import { packageGame } from './tools/package-game.mjs';
    import { packageStudio } from './tools/package-studio.mjs';
    await packageGame('examples/runtime/campus.json', '../game-clean');
    await packageStudio('../studio-clean');
    await mkdir('dist/retired', { recursive: true });
    for (const [path, text] of [['retired.js', 'throw Error("obsolete root module")'], ['retired/nested.js', 'obsolete nested module'], ['private-notes.txt', 'author-only notes']])
      await writeFile('dist/' + path, text);
    await packageGame('examples/runtime/campus.json', '../game-dirty');
    await packageStudio('../studio-dirty');
    for (const [kind, manifestName] of [['game', 'build-manifest.json'], ['studio', 'studio-manifest.json']]) {
      const clean = JSON.parse(await readFile('../' + kind + '-clean/' + manifestName, 'utf8'));
      const dirty = JSON.parse(await readFile('../' + kind + '-dirty/' + manifestName, 'utf8'));
      assert.deepEqual(dirty, clean, kind + ' output changed because of unrelated dist files');
      assert.deepEqual(await readFile('../' + kind + '-dirty/sw.js'), await readFile('../' + kind + '-clean/sw.js'));
      for (const name of ['retired.js', 'retired/nested.js', 'private-notes.txt']) await assert.rejects(access('../' + kind + '-dirty/lib/' + name), { code: 'ENOENT' });
      assert.ok(dirty.files.some(item => item.name === 'lib/runtime/session.js'));
      assert.equal(dirty.files.some(item => item.name === 'lib/script/text.js'), kind === 'studio');
      assert.equal(dirty.files.some(item => item.name.startsWith('lib/agent/')), kind === 'studio');
      assert.equal(dirty.files.some(item => item.name.startsWith('lib/editor/')), kind === 'studio');
    }
    assert.equal(await readFile('dist/private-notes.txt', 'utf8'), 'author-only notes');
    console.log('PASS isolated game/Studio clean versus dirty dist outputs are identical');
  `);
  assert.match(result.stdout, /PASS isolated/);
});

test('source-based package QA rejects a self-consistent orphan module', async () => {
  const fixture = await packageRepositoryFixture({ baseline: process.env.VN_PACKAGE_BASELINE === '1' });
  const result = await runPackageFixture(fixture, `
    import assert from 'node:assert/strict';
    import { readFile, writeFile } from 'node:fs/promises';
    import { createHash } from 'node:crypto';
    import { packageGame } from './tools/package-game.mjs';
    import { buildQaReport } from './tools/qa-report.mjs';
    import { fingerprintFiles, renderWorker } from './tools/pwa.mjs';
    const source = 'examples/runtime/campus.json', output = '../qa-game';
    await packageGame(source, output);
    assert.equal((await buildQaReport(source, { buildDirectory: output })).build.status, 'PASS');
    const manifest = JSON.parse(await readFile(output + '/build-manifest.json', 'utf8'));
    const files = new Map(await Promise.all(manifest.files.map(async item => [item.name, await readFile(output + '/' + item.name)])));
    files.set('lib/retired.js', Buffer.from('export const obsolete = true;'));
    const version = fingerprintFiles([...files].filter(([name]) => name !== 'sw.js').map(([name, bytes]) => ({ name, bytes })));
    files.set('sw.js', Buffer.from(renderWorker({ namespace: 'vn-self-' + manifest.game, version, urls: [...files.keys()].filter(name => name !== 'sw.js') })));
    manifest.contentFingerprint = version;
    manifest.files = [...files].map(([name, bytes]) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    for (const [name, bytes] of files) await writeFile(output + '/' + name, bytes);
    await writeFile(output + '/build-manifest.json', JSON.stringify(manifest));
    const report = await buildQaReport(source, { buildDirectory: output });
    assert.equal(report.build.status, 'FAIL', 'orphan module passed QA despite being absent from current source');
    assert.match(report.build.reason, /module|source/i);
    console.log('PASS self-consistent orphan module rejected by source-based QA');
  `);
  assert.match(result.stdout, /PASS self-consistent/);
});
