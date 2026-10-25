import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, writeBatch, createHealingSaveCodec } from '../dist/index.js';
import { healing, memoryStorage } from './helpers.mjs';

test('same-origin stores have independent namespaces and explicit slots', () => {
  const engine = healing(), codec = createHealingSaveCodec(engine), storage = memoryStorage();
  const a = createStore('vn-engine-demo:healing:v1', storage, codec), b = createStore('vn-engine-demo:netlove:v1', storage, codec);
  assert.equal(a.write('auto', codec.encode(engine.newGame())).status, 'saved');
  assert.equal(a.load('auto').status, 'valid'); assert.equal(b.load('auto').status, 'empty');
  assert.throws(() => a.keyFor('../slot')); assert.throws(() => createStore('', storage, codec));
});

test('corrupt records are retained and denied storage allows continued play', () => {
  const engine = healing(), codec = createHealingSaveCodec(engine), storage = memoryStorage();
  const store = createStore('demo', storage, codec);
  storage.setItem(store.keyFor('1'), 'corrupt');
  assert.equal(store.load('1').status, 'invalid');
  assert.equal(storage.getItem(store.keyFor('1')), 'corrupt');
  const denied = createStore('demo', { ...storage, getItem() { throw new Error('denied'); } }, codec);
  assert.equal(denied.load('1').status, 'unavailable');
  assert.equal(createStore('demo', null, codec).write('1', codec.encode(engine.newGame())).status, 'unavailable');
});

test('failed backup batches restore previous slots and report rollback failures accurately', () => {
  const storage = memoryStorage(); storage.setItem('a', 'old');
  let fail = true;
  const flaky = { ...storage, setItem(key, raw) { if (key === 'b' && fail) { fail = false; throw new Error('quota'); } storage.setItem(key, raw); } };
  assert.deepEqual(writeBatch(flaky, [['a', 'new'], ['b', 'new']]), { status: 'unavailable', reason: 'Storage write failed; play can continue', rollbackFailed: false });
  assert.equal(storage.getItem('a'), 'old'); assert.equal(storage.getItem('b'), null);
  let writes = 0;
  const deniedRollback = { ...storage, setItem(key, raw) { if (++writes > 1) throw new Error('denied'); storage.setItem(key, raw); } };
  assert.equal(writeBatch(deniedRollback, [['a', 'new'], ['b', 'new']]).rollbackFailed, true);
  assert.throws(() => writeBatch(storage, [['a', 'x'], ['a', 'y']]));
});
