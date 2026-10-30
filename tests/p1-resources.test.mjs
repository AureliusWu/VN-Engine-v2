import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResourcePlan, RESOURCE_PLAN_VERSION } from '../dist/assets/plan.js';
import { ResourcePrefetcher, fetchResourceBytes } from '../dist/assets/prefetch.js';
import { InvestigationEngine } from '../dist/investigation/engine.js';
import { InvestigationDriver } from '../dist/runtime/drivers.js';

const asset = (id, kind = 'background') => ({ id, kind, src: `assets/${id.replaceAll('/', '-')}.bin` });
const base = (type = 'script') => ({ schema: 1, game: 'p1-resources', version: 'story-v1', title: 'Resource fixture', type,
  assets: [asset('now'), asset('next'), asset('branch'), asset('music', 'audio'), asset('layer', 'portrait'), asset('video', 'video'), asset('fallback', 'cg'), asset('font', 'font'), asset('key', 'ui')] });
const script = () => ({ ...base(), font: 'font', program: { schema: 1, game: 'p1-resources', version: 'story-v1', entry: 'start', variables: {}, blocks: [
  { id: 'start', cue: { background: 'now', music: 'music' }, lines: [{ id: 'l1', speaker: 'N', text: 'one' }, { id: 'l2', speaker: 'N', text: 'two', cue: { background: 'next', sound: 'music' } }],
    exit: { type: 'choice', choices: [{ id: 'a', text: 'a', next: 'end' }, { id: 'b', text: 'b', next: 'hidden' }] } },
  { id: 'hidden', lines: [], cue: { background: 'branch' }, exit: { type: 'jump', next: 'end' } },
  { id: 'end', lines: [{ id: 'end-line', speaker: 'N', text: 'end', cue: { background: 'branch' } }], exit: { type: 'jump', next: 'start' } }
] } });
const current = () => ({ sceneId: 'start', lineId: 'l1', line: 0, stage: { background: 'now', music: 'music',
  layers: { character: { asset: 'layer', kind: 'portrait' } }, video: { asset: 'video', fallback: { asset: 'fallback', kind: 'cg' } }, keyVisual: { asset: 'key', scope: 'banner', sceneType: 'story', durationMs: 100 } } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const entry = id => ({ assetId: id, kind: 'background', src: `${id}.png`, owners: [`line:${id}`], dependencies: [], origins: [], distance: 1, estimatedBytes: null });
const plan = (ids, active = []) => ({ contract: RESOURCE_PLAN_VERSION, game: 'fixture', storyVersion: 'v1', position: {},
  active: active.map(entry), candidates: ids.map(entry), unknown: [], estimates: { knownBytes: 0, unknownAssets: ids.length },
  budget: { maxDepth: 2, maxVisits: 64, maxAssets: 32 }, visits: 0, truncated: false });
const deferredLoader = () => {
  const requests = [];
  return { requests, loader: request => new Promise((resolve, reject) => requests.push({ ...request, resolve, reject })) };
};

test('maximum lookahead retains every repeated-asset origin without quadratic serialization', () => {
  const project = script(); project.font = undefined;
  project.program.blocks = [{ id: 'start', lines: Array.from({ length: 4097 }, (_, i) => ({ id: 'large-' + i, speaker: 'N', text: 'Line', cue: { background: i ? 'next' : 'now' } })), exit: { type: 'end', ending: 'done' } }];
  const stringify = JSON.stringify; let calls = 0;
  try {
    JSON.stringify = (...args) => { if (++calls > 100_000) throw Error('Resource origin serialization exceeded a linear work budget'); return stringify(...args); };
    const result = createResourcePlan(project, { sceneId: 'start', lineId: 'large-0', stage: { background: 'now' } }, { maxVisits: 4096 });
    assert.equal(result.candidates.find(item => item.assetId === 'next').origins.length, 4096);
    assert.equal(result.candidates.find(item => item.assetId === 'next').owners.length, 4096);
  } finally { JSON.stringify = stringify; }
});

test('static plans retain authoritative active media and exclude it from future candidates', () => {
  const project = script(), before = JSON.stringify(project);
  const result = createResourcePlan(project, current(), { sourceSha256: 'a'.repeat(64), estimates: { next: 12 } });
  assert.equal(result.contract, RESOURCE_PLAN_VERSION);
  assert.deepEqual(new Set(result.active.map(item => item.assetId)), new Set(['font', 'now', 'music', 'layer', 'video', 'fallback', 'key']));
  assert.deepEqual(result.active.find(item => item.assetId === 'video').dependencies, ['fallback']);
  assert.deepEqual(result.candidates.map(item => item.assetId), ['next', 'branch']);
  assert.equal(result.candidates[0].estimatedBytes, 12);
  assert.equal(result.candidates[1].estimatedBytes, null);
  assert.equal(result.candidates[0].origins[0].sourceSha256, 'a'.repeat(64));
  assert.deepEqual(result.candidates[0].origins[0].path, ['program', 'blocks', 0, 'lines', 1, 'cue', 'background']);
  for (const item of result.candidates) for (const origin of item.origins) assert.notEqual(origin.path.reduce((value, key) => value[key], project), undefined);
  assert.ok(Object.isFrozen(result.candidates[0].origins));
  assert.equal(JSON.stringify(project), before);
});

test('planner bounds cyclic exploration, candidate count, node depth and unknown references', () => {
  const project = script();
  project.program.blocks[1].cue.voice = 'missing';
  const result = createResourcePlan(project, current(), { maxVisits: 2, maxAssets: 1, maxDepth: 1 });
  assert.equal(result.visits, 2); assert.equal(result.candidates.length, 1); assert.equal(result.truncated, true);
  const noDepth = createResourcePlan(project, { sceneId: 'start', lineId: 'l2', stage: { background: 'next' } }, { maxDepth: 0 });
  assert.equal(noDepth.candidates.length, 0); assert.equal(noDepth.truncated, true);
  const broad = createResourcePlan(project, current());
  assert.ok(broad.unknown.some(item => item.assetId === 'missing' && item.reason === 'missing-asset'));
  assert.ok(broad.visits <= broad.budget.maxVisits);
  assert.throws(() => createResourcePlan(project, {}, { maxVisits: Infinity }), /budget/);
});

test('narrative plans inspect static scene/line references without calling custom presentation code', () => {
  let invoked = 0;
  const project = { ...base('narrative'), scenes: [{ id: 'first', lines: [{ id: 'a', speaker: 'N', text: 'a' }], next: 'second' },
    { id: 'second', background: 'next', lines: [{ id: 'b', speaker: 'N', text: 'b' }], ending: 'done' }],
    stage: { presentation: () => { invoked++; throw Error('must not run'); }, lines: { b: { sound: 'music' } } } };
  const result = createResourcePlan(project, { sceneId: 'first', lineId: 'a', stage: {} });
  assert.equal(invoked, 0); assert.deepEqual(result.candidates.map(item => item.assetId), ['next', 'music']);
  assert.deepEqual(result.candidates[1].origins[0].path, ['stage', 'lines', 'b', 'sound']);
  assert.ok(result.unknown.some(item => item.reason.includes('not-evaluated')));
});

test('investigation and Rain plans preserve chapter/response origins and do not evaluate conditions', () => {
  const investigation = { ...base('investigation'), chapters: [{ id: 'c1', order: 0, entryNode: 'one', evidence: {}, requiredEvidence: [], nodes: {
    one: { kind: 'choice', text: 'one', location: '', time: '', progress: 0, actions: [{ id: 'go', label: 'go', next: 'two', requiresEvidence: ['unowned'] }] },
    two: { kind: 'ending', text: 'two', location: '', time: '', progress: 100, actions: [] }
  } }], stage: { nodes: { 'c1/two': { background: 'next' } } } };
  const result = createResourcePlan(investigation, { sceneId: 'one', lineId: 'c1/one', stage: {} });
  assert.equal(result.candidates[0].origins[0].chapterId, 'c1');
  assert.deepEqual(result.candidates[0].origins[0].path, ['stage', 'nodes', 'c1/two', 'background']);
  const rain = { ...base('rain'), story: { schema_version: 1, entry: 'one', initial_state: {}, state_definitions: {}, nodes: [
    { id: 'one', lines: [{ id: 'r1', speaker: 'n', text: 'one' }], choices: [{ id: 'go', text: 'go', next: 'two', effects: {}, response: [{ id: 'response', speaker: 'n', text: 'response', bgm: 'music' }] }] },
    { id: 'two', background: 'next', lines: [{ id: 'r2', speaker: 'n', text: 'two' }], ending: 'done' }
  ] } };
  const rainPlan = createResourcePlan(rain, { sceneId: 'one', lineId: 'r1', stage: {} });
  assert.equal(rainPlan.candidates[0].assetId, 'music');
  assert.deepEqual(rainPlan.candidates[0].origins[0].path, ['story', 'nodes', 0, 'choices', 0, 'response', 0, 'bgm']);
  const responsePlan = createResourcePlan(rain, { sceneId: '@response/one/go', lineId: 'response', stage: { music: 'music' } });
  assert.equal(responsePlan.candidates[0].assetId, 'next');
});

test('investigation resource positions distinguish prefix chapters and colliding combined IDs', () => {
  const node = (next) => ({ kind: next ? 'dialogue' : 'ending', text: 'Investigation fixture', location: '', time: '',
    progress: next ? 0 : 100, actions: next ? [{ id: 'go', label: 'Go', next }] : [],
    ...(next ? {} : { outcome: 'complete', requiresEvidence: [] }) });
  for (const colliding of [false, true]) for (const reverse of [false, true]) {
    const first = { id: 'a', order: 0, title: 'First', entryNode: colliding ? 'b/start' : 'start', evidence: {}, requiredEvidence: [],
      nodes: { [colliding ? 'b/start' : 'start']: node('a-only'), 'a-only': node() } };
    const second = { id: 'a/b', order: 1, title: 'Second', entryNode: 'start', evidence: {}, requiredEvidence: [],
      nodes: { start: node('end'), end: node() } };
    const project = { ...base('investigation'), chapters: reverse ? [second, first] : [first, second],
      stage: { nodes: { 'a/a-only': { background: 'branch' }, 'a/b/end': { background: 'next' } } } };
    const driver = new InvestigationDriver(project.game, project.version, new InvestigationEngine(project.chapters), project.stage);
    const check = (position, expected, chapterId, nodeId) => {
      const result = createResourcePlan(project, position, { maxDepth: 1 });
      assert.deepEqual(result.candidates.map(item => item.assetId), [expected], JSON.stringify({ colliding, reverse, position, result }));
      assert.ok(!result.unknown.some(item => item.reason === 'unknown-position'));
      assert.equal(result.candidates[0].origins[0].chapterId, chapterId);
      assert.equal(result.candidates[0].origins[0].nodeId, nodeId);
      const path = result.candidates[0].origins[0].path;
      assert.equal(path.reduce((value, key) => value[key], project), expected);
    };
    const firstFrame = driver.frame();
    check(firstFrame, 'branch', 'a', 'a-only');
    check({}, 'branch', 'a', 'a-only');
    check({ chapterId: 'a', sceneId: first.entryNode }, 'branch', 'a', 'a-only');
    assert.equal(driver.advance(), true);
    assert.equal(driver.act('@chapter:a/b'), true);
    const secondFrame = driver.frame();
    assert.equal(secondFrame.sceneId, 'start'); assert.equal(secondFrame.lineId, 'a/b/start');
    if (colliding) assert.equal(firstFrame.lineId, secondFrame.lineId);
    check(secondFrame, 'next', 'a/b', 'end');
    check({ chapterId: 'a/b', sceneId: 'start' }, 'next', 'a/b', 'end');
    if (colliding) {
      const ambiguous = createResourcePlan(project, { lineId: 'a/b/start' });
      assert.deepEqual(ambiguous.candidates, []);
      assert.ok(ambiguous.unknown.some(item => item.reason === 'unknown-position'));
    } else check({ lineId: 'a/b/start' }, 'next', 'a/b', 'end');
    const save = driver.save(); driver.reset(); driver.restore(save);
    assert.deepEqual(driver.frame(), secondFrame);
    check(driver.frame(), 'next', 'a/b', 'end');
  }
});

test('missing resource target diagnostics keep public node owners for every project type', () => {
  const missing = 'missing/target';
  const projects = [
    { ...base('script'), program: { schema: 1, game: 'p1-resources', version: 'story-v1', entry: 'start', variables: {},
      blocks: [{ id: 'start', lines: [{ id: 'one', speaker: 'N', text: 'One' }], exit: { type: 'jump', next: missing } }] } },
    { ...base('narrative'), scenes: [{ id: 'start', lines: [{ id: 'one', speaker: 'N', text: 'One' }], next: missing }] },
    { ...base('rain'), story: { entry: 'start', nodes: [{ id: 'start', lines: [{ id: 'one', speaker: 'n', text: 'One' }], next: missing }] } },
    { ...base('investigation'), chapters: [{ id: 'a/b', order: 0, entryNode: 'start', nodes: {
      start: { actions: [{ next: missing }] }
    } }] }
  ];
  for (const project of projects) {
    const result = createResourcePlan(project);
    const target = result.unknown.find(item => item.reason === 'missing-target');
    assert.equal(target?.owner, `node:${project.type === 'investigation' ? 'a/b/' : ''}${missing}`, project.type);
  }
});

test('unknown source positions preserve actual active media and never pretend to be the entry', () => {
  const result = createResourcePlan(script(), { sceneId: 'missing', lineId: 'missing', stage: { music: 'music' } });
  assert.ok(result.active.some(item => item.assetId === 'music')); assert.equal(result.candidates.length, 0);
  assert.ok(result.unknown.some(item => item.reason === 'unknown-position'));
});

test('tiny visit budgets do not normalize unrelated nodes, huge line arrays or entire branch fanout', () => {
  const project = script(); let lineCues = 0, targets = 0;
  project.program.blocks[0].lines = Array.from({ length: 10000 }, (_, index) => ({ id: `large-${index}`, speaker: 'N', text: 'line', get cue() { lineCues++; return { background: 'next' }; } }));
  project.program.blocks.push(...Array.from({ length: 1000 }, (_, index) => ({ id: `unused-${index}`, get lines() { throw Error('unrelated node normalized'); } })));
  const result = createResourcePlan(project, { sceneId: 'start', lineId: 'large-0', stage: {} }, { maxVisits: 1 });
  assert.equal(result.visits, 1); assert.ok(lineCues <= 3); assert.equal(result.truncated, true);
  project.program.blocks[0].lines = [{ id: 'only', speaker: 'N', text: 'one' }];
  project.program.blocks[0].exit = { type: 'choice', choices: Array.from({ length: 10000 }, (_, index) => ({ id: `choice-${index}`, text: 'x', get next() { targets++; return `unused-${index}`; } })) };
  createResourcePlan(project, { sceneId: 'start', lineId: 'only', stage: {} }, { maxVisits: 0 });
  assert.equal(targets, 1);
});

test('prefetch deduplicates pending promises and exposes lazy URLs only for retained bytes', async () => {
  const pending = deferredLoader(), created = [], revoked = [];
  const cache = new ResourcePrefetcher({ resolveURL: id => `https://fixture/${id}`, loader: pending.loader,
    maxConcurrent: 1, maxBytes: 8, maxTransferBytes: 4,
    createObjectURL: (bytes, item) => { created.push([item.assetId, ...bytes]); return `blob:${item.assetId}`; }, revokeObjectURL: url => revoked.push(url) });
  cache.update(plan(['a'])); cache.update(plan(['a'])); await tick();
  assert.equal(pending.requests.length, 1); assert.equal(cache.snapshot().loading, 1);
  const input = new Uint8Array([1, 2]); pending.requests[0].resolve(input); await tick(); input[0] = 9;
  assert.equal(cache.snapshot().bytes, 2); assert.equal(cache.url('a'), undefined); assert.equal(created.length, 0);
  cache.retain('renderer', ['a']); assert.equal(cache.url('a'), 'blob:a'); assert.equal(cache.url('a'), 'blob:a');
  assert.deepEqual(created, [['a', 1, 2]]);
  cache.retain('media', ['a']); cache.release('renderer'); assert.deepEqual(revoked, []);
  cache.release('media'); assert.deepEqual(revoked, ['blob:a']);
  assert.ok(Object.isFrozen(cache.snapshot().resources)); cache.dispose();
});

test('an aborted loader that ignores signal keeps its physical slot and reservation until settlement', async () => {
  const pending = deferredLoader();
  const cache = new ResourcePrefetcher({ resolveURL: id => id, loader: pending.loader, maxConcurrent: 1, maxBytes: 4, maxTransferBytes: 4 });
  cache.update(plan(['a'])); await tick(); cache.update(plan(['b'])); await tick();
  assert.equal(pending.requests[0].signal.aborted, true); assert.equal(pending.requests.length, 1);
  assert.equal(cache.snapshot().loading, 1); assert.equal(cache.snapshot().reservedBytes, 4);
  pending.requests[0].resolve(new Uint8Array([1])); await tick();
  assert.equal(cache.snapshot().ready, 0); assert.equal(pending.requests.length, 2); assert.equal(pending.requests[1].assetId, 'b');
  cache.dispose(); assert.equal(pending.requests[1].signal.aborted, true); assert.equal(cache.snapshot().loading, 1);
  pending.requests[1].resolve(new Uint8Array([2])); await tick();
  assert.equal(cache.snapshot().ready, 0); assert.equal(cache.snapshot().loading, 0); assert.equal(cache.snapshot().reservedBytes, 0);
});

test('same asset requested again after cancellation uses a new loader and never caches the stale result', async () => {
  const pending = deferredLoader();
  const cache = new ResourcePrefetcher({ resolveURL: id => id, loader: pending.loader, maxConcurrent: 1, maxBytes: 4, maxTransferBytes: 4 });
  cache.update(plan(['a'])); await tick(); cache.update(plan([])); cache.update(plan(['a']));
  pending.requests[0].resolve(new Uint8Array([1])); await tick();
  assert.equal(pending.requests.length, 2); assert.equal(cache.snapshot().ready, 0);
  pending.requests[1].resolve(new Uint8Array([2])); await tick(); assert.equal(cache.snapshot().ready, 1); cache.dispose();
});

test('owner-pinned active resources block speculative eviction until release', async () => {
  const pending = deferredLoader(), revoked = [];
  const cache = new ResourcePrefetcher({ resolveURL: id => id, loader: pending.loader, maxConcurrent: 1, maxBytes: 4, maxTransferBytes: 4,
    createObjectURL: () => 'blob:a', revokeObjectURL: url => revoked.push(url) });
  cache.update(plan(['a'])); await tick(); pending.requests[0].resolve(new Uint8Array([1, 2, 3])); await tick();
  cache.update(plan(['b'], ['a'])); cache.retain('renderer', ['a']); assert.equal(cache.url('a'), 'blob:a');
  await tick(); assert.equal(pending.requests.length, 1); assert.equal(cache.snapshot().pinned, 1); assert.equal(cache.snapshot().queued, 1);
  cache.update(plan(['b'])); await tick(); assert.equal(pending.requests.length, 1); assert.deepEqual(revoked, []);
  cache.release('renderer'); await tick(); assert.equal(pending.requests.length, 2); assert.deepEqual(revoked, ['blob:a']);
  pending.requests[1].resolve(new Uint8Array([4])); await tick(); assert.equal(cache.snapshot().bytes, 1); cache.dispose();
});

test('queue, physical concurrency and encoded bytes plus reservations remain bounded', async () => {
  const pending = deferredLoader();
  const cache = new ResourcePrefetcher({ resolveURL: id => id, loader: pending.loader, maxConcurrent: 2, maxQueued: 3, maxBytes: 8, maxTransferBytes: 4 });
  cache.update(plan(['a', 'b', 'c', 'd', 'e'])); await tick();
  assert.equal(pending.requests.length, 2); assert.equal(cache.snapshot().queued, 1); assert.equal(cache.snapshot().truncated, true);
  assert.equal(cache.snapshot().bytes + cache.snapshot().reservedBytes, 8);
  pending.requests[0].resolve(new Uint8Array([1, 2, 3])); await tick();
  assert.ok(cache.snapshot().bytes + cache.snapshot().reservedBytes <= 8); assert.ok(cache.snapshot().loading <= 2);
  pending.requests[1].resolve(new Uint8Array([1, 2, 3])); await tick();
  assert.ok(cache.snapshot().bytes + cache.snapshot().reservedBytes <= 8);
  for (const request of pending.requests.slice(2)) request.resolve(new Uint8Array([1])); await tick(); cache.dispose();
});

test('failed and oversized loads retry only on a new explicit plan intent', async () => {
  let attempts = 0;
  const cache = new ResourcePrefetcher({ resolveURL: id => id, maxBytes: 4, maxTransferBytes: 4, loader: async () => {
    attempts++; if (attempts === 1) throw Error('network'); if (attempts === 2) return new Uint8Array(5); return new Uint8Array(2);
  } });
  cache.update(plan(['a'])); await tick(); assert.equal(cache.snapshot().failed, 1); assert.equal(attempts, 1);
  cache.release('unrelated'); await tick(); assert.equal(attempts, 1);
  cache.update(plan(['a'])); await tick(); assert.equal(cache.snapshot().failed, 1); assert.equal(cache.snapshot().ready, 0);
  cache.update(plan(['a'])); await tick(); assert.equal(cache.snapshot().ready, 1); assert.equal(attempts, 3); cache.dispose();
});

test('hiding cancels speculative work and safely resumes without playback or stale caching', async () => {
  const pending = deferredLoader();
  const cache = new ResourcePrefetcher({ resolveURL: id => id, loader: pending.loader, maxConcurrent: 1, maxBytes: 4, maxTransferBytes: 4 });
  cache.update(plan(['a', 'b'])); await tick(); cache.setPaused(true);
  assert.equal(cache.snapshot().queued, 0); assert.equal(pending.requests[0].signal.aborted, true);
  pending.requests[0].resolve(new Uint8Array([1])); await tick(); assert.equal(cache.snapshot().ready, 0); assert.equal(pending.requests.length, 1);
  cache.setPaused(false); await tick(); assert.equal(pending.requests.length, 2);
  cache.dispose(); pending.requests[1].reject(Error('closed')); await tick(); assert.equal(cache.snapshot().bytes, 0);
});

test('project/source changes invalidate stale cached or in-flight bytes even when asset IDs match', async () => {
  const pending = deferredLoader();
  const cache = new ResourcePrefetcher({ resolveURL: id => id, loader: pending.loader, maxConcurrent: 1, maxBytes: 4, maxTransferBytes: 4 });
  cache.update(plan(['a'])); await tick(); const replacement = plan(['a']); replacement.candidates[0].src = 'replacement.png'; cache.update(replacement);
  assert.equal(pending.requests[0].signal.aborted, true); pending.requests[0].resolve(new Uint8Array([1])); await tick();
  pending.requests[1].resolve(new Uint8Array([2])); await tick(); assert.equal(cache.snapshot().ready, 1);
  const other = plan([], ['a']); other.storyVersion = 'v2'; cache.update(other); assert.equal(cache.snapshot().ready, 0); cache.dispose();
});

test('default streaming fetch enforces absent/dishonest length caps and cancels the stream', async () => {
  const original = globalThis.fetch; let cancelled = 0;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled++; } }), { headers: { 'content-length': '1' } });
    await assert.rejects(fetchResourceBytes({ assetId: 'a', url: 'https://fixture/a', signal: new AbortController().signal, maxBytes: 4 }), /transfer budget/);
    assert.equal(cancelled, 1);
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2]));
    assert.deepEqual(await fetchResourceBytes({ assetId: 'a', url: 'https://fixture/a', signal: new AbortController().signal, maxBytes: 4 }), new Uint8Array([1, 2]));
  } finally { globalThis.fetch = original; }
});
