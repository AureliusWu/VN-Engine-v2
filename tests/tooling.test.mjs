import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fingerprintFiles, renderWorker } from '../tools/pwa.mjs';
import { validateGraph } from '../tools/validate-graph.mjs';

test('offline fingerprints include filenames, byte boundaries and content in deterministic order', () => {
  const a = { name: 'a.js', bytes: Buffer.from('ab') }, b = { name: 'b.js', bytes: Buffer.from('c') };
  assert.equal(fingerprintFiles([a, b]), fingerprintFiles([b, a]));
  assert.notEqual(fingerprintFiles([a]), fingerprintFiles([{ ...a, name: 'renamed.js' }]));
  assert.notEqual(fingerprintFiles([a, b]), fingerprintFiles([{ ...a, bytes: Buffer.from('a') }, { ...b, bytes: Buffer.from('bc') }]));
});

test('worker cache cleanup is isolated by game namespace and registration scope', async () => {
  const handlers = {}, deleted = [], scope = 'https://example.test/one/';
  const prefix = 'game-a-v2:' + encodeURIComponent(scope) + ':';
  const caches = { keys: async () => [prefix + 'old', prefix + 'new', 'game-b-v2:any:old', 'game-a-v2:other-scope:old'], delete: async key => deleted.push(key) };
  vm.runInNewContext(renderWorker({ namespace: 'game-a', version: 'new', urls: ['index.html'] }), {
    self: { registration: { scope }, location: { origin: 'https://example.test' }, addEventListener: (name, handler) => { handlers[name] = handler; }, clients: { claim: async () => {} } }, caches, URL, Request, Response
  });
  await new Promise((resolve, reject) => handlers.activate({ waitUntil: value => value.then(resolve, reject) }));
  assert.deepEqual(deleted, [prefix + 'old']);
  let intercepted = false;
  handlers.fetch({ request: { url: 'https://example.test/two/image.png', method: 'GET' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});

test('failed offline installation rejects readiness instead of activating an incomplete cache', async () => {
  const handlers = {};
  vm.runInNewContext(renderWorker({ namespace: 'game', version: 'v1', urls: ['index.html', 'missing.ogg'] }), {
    self: { registration: { scope: 'https://example.test/game/' }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    caches: { open: async () => ({ addAll: async () => { throw new Error('missing file'); } }) }, URL, Request
  });
  let pending; handlers.install({ waitUntil: value => { pending = value; } });
  await assert.rejects(pending, /missing file/);
});

test('shared structural validator detects disconnected prose, duplicate line IDs and accidental cycles', () => {
  const graph = { entry: 'a', scenes: [{ id: 'a', lines: [{ id: 'one', text: 'a' }], next: 'b' }, { id: 'b', lines: [{ id: 'two', text: 'b' }], ending: 'done' }] };
  assert.equal(validateGraph(graph).scenes, 2);
  const duplicate = structuredClone(graph); duplicate.scenes[1].lines[0].id = 'one'; assert.throws(() => validateGraph(duplicate), /line ID/);
  const cycle = structuredClone(graph); cycle.scenes[0].next = 'a'; assert.throws(() => validateGraph(cycle), /cycle/);
  const disconnected = structuredClone(graph); disconnected.scenes.push({ id: 'unused', lines: [{ id: 'three', text: 'unread' }], ending: 'unused' });
  assert.throws(() => validateGraph(disconnected), /Unreachable/);
});
