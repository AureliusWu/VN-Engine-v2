import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileTextScript, checkTextScriptProject } from '../dist/script/text.js';
import { createProject } from '../dist/runtime/project.js';
import { runRouteSuite } from '../dist/regression/suite.js';
import { executeAgentRequest } from '../dist/agent/sdk.js';
import { runAgentFileRequest } from '../tools/agent-node.mjs';
import { compileScriptFile } from '../tools/compile-script.mjs';
import { AGENT_RESPONSE_SCHEMA, schemaErrors } from '../dist/agent/schema.js';

const exec = promisify(execFile);
const source = await readFile('examples/dsl/stage.vn.txt', 'utf8');
const project = JSON.parse(await readFile('examples/runtime/stage.json', 'utf8'));
const context = value => ({ type: value.type, game: value.game, version: value.version, assets: value.assets.map(({ id, kind }) => ({ id, kind })) });
const request = params => ({ protocol: 'vn-agent-v1', requestId: 'p3-compile', command: 'script.compile', params });

test('the documented stage example compiles to the checked-in IR and preserves both routes and canonical restores', () => {
  const compiled = checkTextScriptProject(compileTextScript(source), project);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.program, project.program);
  assert.equal(compiled.sourceMap.filter(item => item.kind === 'cue').length, 17);
  const runtime = createProject(project, 'https://example.invalid/assets/');
  try { assert.equal(runtime.session.getView().frame.stage.voice, 'greeting'); }
  finally { runtime.session.dispose(); }
  const report = runRouteSuite(project); assert.equal(report.status, 'PASS', JSON.stringify(report));
  assert.deepEqual([...report.coverage.covered].sort(), ['good', 'neutral']);
  assert.ok(report.restoreChecks >= 6);
  assert.equal(project.program.sourceMap, undefined);
});

test('pure API, CLI and Agent return the same precise missing/type asset diagnostics without writing outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-p3-context-'));
  const input = join(root, 'stage.vn.txt'), catalog = join(root, 'project.json');
  await writeFile(input, source);
  for (const kind of ['missing', 'type']) {
    const invalid = structuredClone(project);
    if (kind === 'missing') invalid.assets = invalid.assets.filter(asset => asset.id !== 'greeting');
    else invalid.assets.find(asset => asset.id === 'classroom').kind = 'audio';
    const bytes = JSON.stringify(invalid); await writeFile(catalog, bytes);
    const direct = checkTextScriptProject(compileTextScript(source, { fileName: input }), invalid);
    const expected = direct.diagnostics.find(item => item.code === (kind === 'missing' ? 'DSL_ASSET_MISSING' : 'DSL_ASSET_KIND'));
    assert.ok(expected); assert.ok(expected.origin.path[0] === 'program'); assert.equal(expected.origin.sourceSha256, undefined);
    const output = join(root, kind + '.json'), map = join(root, kind + '-map.json');
    const cli = await compileScriptFile(input, output, map, { project: catalog });
    assert.deepEqual(cli.diagnostics.find(item => item.code === expected.code), expected);
    await assert.rejects(access(output), { code: 'ENOENT' }); await assert.rejects(access(map), { code: 'ENOENT' });
    const response = await runAgentFileRequest(request({ source, fileName: input, projectContext: context(invalid), limit: 100 }));
    assert.equal(response.status, 'FAIL'); assert.equal(response.project, null); assert.deepEqual(response.artifacts, []);
    assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA, response), []);
    const { id, kind: itemKind, ...diagnostic } = response.data.items.find(item => item.kind === 'diagnostic' && item.code === expected.code);
    assert.equal(itemKind, 'diagnostic'); assert.ok(id); assert.deepEqual(diagnostic, expected);
    assert.equal(response.data.items.some(item => item.id === 'program'), false);
    assert.equal(await readFile(catalog, 'utf8'), bytes); assert.equal(await readFile(input, 'utf8'), source);
    await assert.rejects(access(catalog + '.agent-journal.json'), { code: 'ENOENT' });
  }
});

test('CLI project context remains read-only, writes canonical IR/maps only on success and keeps syntax failures primary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-p3-cli-'));
  const input = join(root, 'stage.vn'), catalog = join(root, 'workspace.json'), output = join(root, 'program.json'), map = join(root, 'map.json');
  await writeFile(input, source); await writeFile(catalog, JSON.stringify(project));
  const call = await exec(process.execPath, ['tools/compile-script.mjs', input, '--out', output, '--map', map, '--project', catalog], { cwd: resolve('.') });
  const summary = JSON.parse(call.stdout); assert.equal(summary.ok, true); assert.equal(summary.projectContext.checked, true);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), project.program);
  assert.ok(JSON.parse(await readFile(map, 'utf8')).sourceMap.some(item => item.kind === 'cue'));
  await assert.rejects(compileScriptFile(input, output, map, { project: catalog }), /exist/);
  await writeFile(catalog, JSON.stringify({ format: 'vn-engine-editor', schema: 1, project, positions: {} }));
  assert.equal((await compileScriptFile(input, join(root, 'workspace-program.json'), undefined, { project: catalog })).ok, true);
  await writeFile(input, 'vn-script 1\nexecute javascript\n');
  const failed = await compileScriptFile(input, join(root, 'invalid.json'), undefined, { project: join(root, 'absent-context.json') });
  assert.equal(failed.ok, false); assert.ok(failed.diagnostics.some(item => item.code === 'DSL_UNKNOWN_COMMAND'));
  await assert.rejects(access(join(root, 'invalid.json')), { code: 'ENOENT' });
});

test('Agent contextual compilation is optional, read-only, paged and binds cursors to resource identity and kinds', async () => {
  const params = { source, projectContext: context(project), limit: 1, maxBytes: 4096 };
  const first = await executeAgentRequest(request(params));
  assert.equal(first.response.status, 'PASS'); assert.equal(first.candidate, undefined); assert.equal(first.reviewCandidate, undefined);
  assert.ok(first.response.data.nextCursor); assert.equal(first.response.data.items[0].projectContext.checked, true);
  const changed = structuredClone(params.projectContext); changed.assets.find(asset => asset.id === 'classroom').kind = 'audio';
  const stale = await executeAgentRequest(request({ ...params, projectContext: changed, cursor: first.response.data.nextCursor }));
  assert.equal(stale.response.diagnostics.at(-1).code, 'STALE_CURSOR');
  let cursor = first.response.data.nextCursor, pages = 0;
  while (cursor) {
    const page = await executeAgentRequest(request({ ...params, cursor }));
    assert.equal(page.response.status, 'PASS'); assert.ok(Buffer.byteLength(JSON.stringify(page.response)) <= 4096);
    cursor = page.response.data.nextCursor; assert.ok(++pages < 200);
  }
  const independent = await executeAgentRequest(request({ source, limit: 100 }));
  assert.equal(independent.response.status, 'PASS'); assert.equal(independent.response.data.items[0].projectContext.checked, false);
});
