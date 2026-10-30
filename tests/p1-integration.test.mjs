import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetCatalog } from '../dist/assets/catalog.js';
import { compileScriptFile } from '../tools/compile-script.mjs';
import { runAgentFileRequest } from '../tools/agent-node.mjs';
import { packageGame } from '../tools/package-game.mjs';

test('P1 asset URL cache is optional, validates kinds/protocols, and preserves source URLs', () => {
  let cached;
  const assets = new AssetCatalog([{ id: 'room', kind: 'background', src: 'room.svg' }], 'https://example.com/game/', undefined, () => cached);
  assert.equal(assets.url('room'), 'https://example.com/game/room.svg');
  cached = 'blob:https://example.com/ready'; assert.equal(assets.url('room'), cached);
  assert.equal(assets.sourceURL('room'), 'https://example.com/game/room.svg');
  assert.throws(() => assets.url('room', 'audio'), /mismatched/);
  cached = 'javascript:alert(1)'; assert.throws(() => assets.url('room'), /Unsupported/);
});

test('P1 standalone compiler writes canonical IR + separate map without overwriting files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vn-p1-compile-'));
  try {
    const input = join(dir, 'source.vn'), output = join(dir, 'program.json'), map = join(dir, 'source-map.json');
    await writeFile(input, 'vn-script 1\ngame "p1-cli"\nversion "1"\nentry start\nblock start\nline hello "旁白" "你好"\nend done\n');
    await writeFile(map, 'existing map');
    await assert.rejects(compileScriptFile(input, output, map), /exist/);
    await assert.rejects(access(output)); assert.equal(await readFile(map, 'utf8'), 'existing map');
    await rm(map); const result = await compileScriptFile(input, output, map);
    assert.equal(result.ok, true); assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result.program);
    assert.ok(JSON.parse(await readFile(map, 'utf8')).sourceMap.some(item => item.lineId === 'hello'));
    const project = join(dir, 'project.json'), built = join(dir, 'player');
    await writeFile(project, JSON.stringify({ schema: 1, game: 'p1-cli', version: '1', title: 'P1 DSL output', type: 'script', assets: [], program: result.program }));
    await packageGame(project, built);
    await assert.rejects(access(join(built, 'lib/script/text.js')));
    const manifest = JSON.parse(await readFile(join(built, 'build-manifest.json'), 'utf8'));
    assert.ok(!manifest.files.some(item => /script\/text(?:\/|\.js)/.test(item.name)));
    assert.ok(!(await readFile(join(built, 'sw.js'), 'utf8')).includes('script/text.js'));
    await assert.rejects(compileScriptFile(input, output), /exist/);
    await writeFile(input, 'execute javascript\n');
    const badOutput = join(dir, 'bad.json'); assert.equal((await compileScriptFile(input, badOutput)).ok, false);
    await assert.rejects(access(badOutput));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('P1 Agent Node host compiles without a project path or journal writes', async () => {
  const response = await runAgentFileRequest({ protocol: 'vn-agent-v1', requestId: 'p1-no-project', command: 'script.compile', params: {
    source: 'vn-script 1\ngame "p1-agent-cli"\nversion "1"\nentry start\nblock start\nline one "N" "One"\nend done\n'
  } });
  assert.equal(response.status, 'PASS', JSON.stringify(response));
});
