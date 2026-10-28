import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeAgentRequest, AGENT_PROTOCOL, AGENT_REQUEST_SCHEMA, AGENT_RESPONSE_SCHEMA, AGENT_OPERATION_SCHEMA, schemaErrors, sourceHash } from '../dist/agent/index.js';
import { newProject, EditorModel } from '../dist/editor/index.js';
import { createProject } from '../dist/index.js';

const request = (command, params = {}) => ({ protocol: AGENT_PROTOCOL, requestId: 'unit-' + command, command, params });
const text = p => JSON.stringify(p, null, 2) + '\n';
const call = async (command, params, source, extra = {}) => executeAgentRequest(request(command, params), { source, ...extra });
const apply = async (source, operations, params = {}, extra = {}) => call('apply', { expectedSourceSha256: await sourceHash(source), operations, ...params }, source, extra);

test('agent capabilities and persisted JSON Schemas match actual supported requests and errors', async () => {
  const cap = (await call('capabilities', {})).response; assert.equal(cap.status, 'PASS'); assert.ok(cap.data.commands.includes('apply')); assert.ok(cap.data.operations.includes('stage.set'));
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA, cap), []);
  for (const [name, schema] of Object.entries({ request: AGENT_REQUEST_SCHEMA, response: AGENT_RESPONSE_SCHEMA, operation: AGENT_OPERATION_SCHEMA })) assert.deepEqual(JSON.parse(await readFile(new URL(`../schemas/vn-agent-v1.${name}.schema.json`, import.meta.url))), schema);
  for (const [value, code] of [[{ ...request('capabilities'), protocol: 'old' }, 'PROTOCOL_UNSUPPORTED'], [request('unknown'), 'UNKNOWN_COMMAND'], [{ ...request('capabilities'), extra: true }, 'INVALID_REQUEST'], [request('apply', { expectedSourceSha256: '0'.repeat(64), operations: [{ op: 'eval', code: 'bad' }] }), 'INVALID_REQUEST']]) {
    const response = (await executeAgentRequest(value)).response; assert.equal(response.ok, false); assert.equal(response.diagnostics[0].code, code); assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA, response), []);
  }
  assert.equal((await executeAgentRequest('{broken')).response.diagnostics[0].code, 'MALFORMED_JSON');
  assert.equal((await executeAgentRequest(JSON.parse('{"protocol":"vn-agent-v1","requestId":"x","command":"capabilities","params":{"__proto__":{}}}'))).response.diagnostics[0].code, 'INVALID_REQUEST');
});

test('agent creates all four templates with owned JSON and actual runtime-compatible entry states', async () => {
  for (const type of ['vn', 'chat', 'script', 'investigation']) {
    const result = await call('init', { type, game: 'agent-' + type, storyVersion: 'v1', title: 'Agent template', format: 'editor' });
    assert.equal(result.response.status, 'PASS'); assert.equal(JSON.parse(result.candidate.sourceText).format, 'vn-engine-editor');
    const instance = createProject(result.candidate.document.project, 'https://test.invalid/'); assert.ok(instance.session.getView().frame.text); instance.session.dispose();
    assert.equal(result.candidate.afterSha256, await sourceHash(result.candidate.sourceText));
  }
});

test('agent pagination bounds actual wire bytes and reconstructs a large Unicode item without losing characters', async () => {
  const p = newProject('script'); p.program.blocks[0].lines[0].text = '跨章🌧️变量'.repeat(3000); const source = text(p), fragments = [];
  let cursor, count = 0;
  do {
    const r = (await call('inspect', { kind: 'nodes', id: 'start', maxBytes: 4096, ...(cursor ? { cursor } : {}) }, source)).response;
    assert.equal(r.status, 'PASS'); assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 4096); assert.equal(r.data.items.length, 0);
    fragments.push(r.data.fragment.text); cursor = r.data.nextCursor; assert.ok(++count < 200);
  } while (cursor);
  assert.deepEqual(JSON.parse(fragments.join('')).value, p.program.blocks[0]);
  const first = (await call('inspect', { kind: 'nodes', limit: 1 }, source)).response;
  const stale = await call('inspect', { kind: 'nodes', limit: 1, cursor: first.data.nextCursor }, source + ' '); assert.equal(stale.response.diagnostics[0].code, 'STALE_CURSOR');
});

test('agent batches allow intermediate broken targets, preserve metadata and validate real routes at final state', async () => {
  const p = newProject('script'); p.authorMetadata = { preserve: 'yes' }; const source = text(p);
  const ops = [
    { op: 'node.patch', id: 'start', value: { exit: { type: 'choice', choices: [{ id: 'yes', text: '走进雨中', next: 'good', effects: [{ op: 'add', key: 'trust', value: 1 }] }, { id: 'no', text: '留下', next: 'end' }] } } },
    { op: 'node.put', id: 'good', value: { lines: [{ id: 'good-1', speaker: '作者', text: '雨中的结局。' }], exit: { type: 'end', ending: 'good' } } },
    { op: 'route.put', id: 'yes-route', value: { steps: [{ type: 'action', id: 'yes' }], expect: { ending: 'good', variables: { trust: 1 } } } },
    { op: 'route.put', id: 'no-route', value: { steps: [{ type: 'action', id: 'no' }], expect: { ending: '完成', variables: { trust: 0 } } } },
    { op: 'variable.rename', id: 'trust', newId: 'affinity' }
  ];
  const result = await apply(source, ops, { dryRun: true }); assert.equal(result.response.status, 'PASS'); assert.equal(result.response.data.applied, false); assert.equal(result.response.data.dryRun, true);
  assert.equal(result.candidate.document.project.authorMetadata.preserve, 'yes'); assert.equal(p.program.blocks[0].exit.choices[0].next, 'end');
  const run = await call('test', {}, result.candidate.sourceText); assert.equal(run.response.status, 'PASS'); assert.equal(run.response.data.cases.length, 2); assert.ok(run.response.data.restoreChecks > 2);
  const refs = await call('refs', { kind: 'variable', id: 'affinity' }, result.candidate.sourceText); assert.ok(refs.response.data.items.length >= 3);
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA, result.response), []);
});

test('agent failed and conflicting batches expose locations and never return a write candidate', async () => {
  const source = text(newProject('script'));
  const failed = await apply(source, [{ op: 'project.patch', value: { title: 'partial' } }, { op: 'node.remove', id: 'missing' }]);
  assert.equal(failed.candidate, undefined); assert.equal(failed.response.status, 'FAIL'); assert.equal(failed.response.diagnostics[0].operation, 1);
  const conflict = await call('apply', { expectedSourceSha256: '0'.repeat(64), operations: [{ op: 'node.remove', id: 'start' }] }, source);
  assert.equal(conflict.response.diagnostics[0].code, 'SOURCE_CONFLICT'); assert.equal(conflict.candidate, undefined);
  const broken = await apply(source, [{ op: 'node.patch', id: 'start', value: { exit: { type: 'jump', next: 'absent' } } }]);
  assert.equal(broken.candidate, undefined); assert.ok(broken.response.diagnostics.some(d => d.nodeId === 'start'));
});

test('agent asset bindings query exact fields and missing or changed bytes block the whole candidate', async () => {
  const source = text(newProject('script')), bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  const ops = [{ op: 'asset.put', id: 'background', value: { kind: 'background', src: 'assets/test.svg', sha256: await sourceHash(bytes) } }, { op: 'stage.set', scope: 'node', nodeId: 'start', value: { background: 'background' } }];
  const unverified = await apply(source, ops); assert.equal(unverified.response.status, 'UNVERIFIED'); assert.equal(unverified.candidate, undefined);
  const missing = await apply(source, ops, {}, { readAsset: async () => { throw Error('missing'); } }); assert.equal(missing.response.status, 'FAIL'); assert.equal(missing.response.diagnostics.find(d => d.assetId)?.assetId, 'background');
  const ok = await apply(source, ops, {}, { readAsset: async () => bytes }); assert.equal(ok.response.status, 'PASS');
  const refs = await call('refs', { kind: 'asset', id: 'background' }, ok.candidate.sourceText); assert.ok(refs.response.data.items.some(item => item.path.at(-1) === 'background'));
  const changed = await call('validate', {}, ok.candidate.sourceText, { readAsset: async () => new Uint8Array([0]) }); assert.equal(changed.response.diagnostics.find(d => d.assetId).code, 'ASSET_HASH_MISMATCH');
});

test('agent stable line, choice, chapter, evidence and action operations run real cross-chapter semantics', async () => {
  const source = text(newProject('investigation'));
  const ops = [
    { op: 'chapter.add', id: 'two', title: '第二章' }, { op: 'chapter.rename', id: 'two', newId: 'final' },
    { op: 'evidence.put', chapterId: 'final', id: 'clue', value: { title: '线索', detail: '作者说明' } },
    { op: 'action.put', chapterId: 'final', nodeId: 'start', id: 'finish', value: { label: '收集并完成', next: 'end', collect: 'clue' } },
    { op: 'node.patch', chapterId: 'final', id: 'end', value: { requiresEvidence: ['clue'] } },
    { op: 'chapter.patch', id: 'final', value: { requiredEvidence: ['clue'] } },
    { op: 'route.put', id: 'one', value: { steps: ['read', 'back', 'reason'].map(id => ({ type: 'action', id })), expect: { ending: 'chapter-1:complete' } } },
    { op: 'route.put', id: 'two', value: { steps: ['read', 'back', 'reason', '@chapter:final', 'finish'].map(id => ({ type: 'action', id })), expect: { ending: 'final:complete', evidence: ['clue'] } } }
  ];
  const result = await apply(source, ops); assert.equal(result.response.status, 'PASS'); assert.equal((await call('test', {}, result.candidate.sourceText)).response.status, 'PASS');
  const script = await apply(text(newProject('script')), [{ op: 'line.put', nodeId: 'start', id: 'start-1', value: { text: '改写后的台词。' } }, { op: 'node.rename', id: 'end', newId: 'final' }]);
  assert.equal(script.response.status, 'PASS'); assert.equal(script.candidate.document.project.program.blocks[0].exit.choices[0].next, 'final');
});

test('agent preserves editor layout and save identity and truthfully handles route budgets and cancellation', async () => {
  const model = new EditorModel(newProject('vn')); model.move('["start"]', { x: 30, y: 70 });
  const result = await apply(model.serialize(), [{ op: 'project.patch', value: { title: 'New title' } }]); assert.deepEqual(JSON.parse(result.candidate.sourceText).positions, { '["start"]': { x: 30, y: 70 } });
  const p = newProject('vn'); p.routeTests = { schema: 1, cases: [{ id: 'end', steps: [{ type: 'action', id: 'continue' }], expect: { ending: '完成' } }] };
  const budget = await call('test', { maxOperations: 1 }, text(p)); assert.equal(budget.response.status, 'UNVERIFIED'); assert.equal(budget.response.ok, false);
  const controller = new AbortController(); controller.abort(); const abort = await call('validate', {}, text(p), { signal: controller.signal }); assert.equal(abort.response.diagnostics[0].code, 'ABORTED');
  let time = 0; const timeout = await call('apply', { expectedSourceSha256: await sourceHash(text(p)), timeoutMs: 1, operations: [{ op: 'project.patch', value: { title: 'late' } }] }, text(p), { now: () => time++ }); assert.equal(timeout.response.status, 'UNVERIFIED'); assert.equal(timeout.candidate, undefined);
});

test('agent imports have no browser, storage, audio or filesystem initialization side effects', async () => {
  const before = globalThis.localStorage; Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('storage accessed on import'); } });
  try { await import('../dist/agent/index.js?isolated-import'); } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: before }); }
});
