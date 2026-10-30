import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextCompileTask } from '../editor/text-compile-task.mjs';

class FakeWorker {
  onmessage = null; onerror = null; onmessageerror = null; terminated = 0; messages = [];
  postMessage(message) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated++; }
  complete(requestId, extra = {}) { this.onmessage?.({ data: { requestId, result: { ok: true, program: { schema: 1 }, diagnostics: [], sourceMap: [] },
    syntaxOk: true, identity: { game: 'fixture', version: '1' }, output: '{}', ...extra } }); }
}
function setup(options = {}) {
  const workers = [], timers = new Map(), cleared = [], results = [], failures = [], busy = []; let timerId = 0;
  const task = createTextCompileTask({
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    setTimer: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimer: id => { cleared.push(id); timers.delete(id); },
    onResult: message => results.push(message), onFailure: error => failures.push(error), onBusy: value => busy.push(value),
    ...options
  });
  return { task, workers, timers, cleared, results, failures, busy };
}
const request = source => ({ source, fileName: 'story.vn', projectContext: { type: 'script', game: 'fixture', version: '1', assets: [] } });

test('task import does not access Worker, DOM or browser storage', async () => {
  const names = ['Worker', 'document', 'localStorage'], previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { throw Error('Import accessed ' + name); } });
    const imported = await import('../editor/text-compile-task.mjs?no-import-side-effects');
    assert.equal(typeof imported.createTextCompileTask, 'function');
  } finally {
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
});

test('successful completion accepts only its request ID and releases timer and worker before notifying', () => {
  const env = setup(), id = env.task.run(request('first')), worker = env.workers[0];
  assert.equal(env.task.busy, true); assert.equal(env.timers.size, 1); assert.deepEqual(env.busy, [true]);
  assert.deepEqual(worker.messages[0], { requestId: id, ...request('first') });
  worker.complete(id + 1); assert.equal(env.task.busy, true); assert.equal(env.results.length, 0);
  const lateMessage = worker.onmessage, lateError = worker.onerror;
  worker.complete(id, { identity: { game: 'fixture', version: '1' } });
  assert.equal(env.results.length, 1); assert.equal(env.results[0].requestId, id);
  assert.equal(env.task.busy, false); assert.equal(worker.terminated, 1); assert.equal(env.timers.size, 0);
  assert.deepEqual(env.busy, [true, false]);
  lateMessage({ data: { requestId: id, result: { ok: false } } }); lateError({ message: 'old error' });
  assert.equal(env.results.length, 1); assert.equal(env.failures.length, 0);
});

test('replacement and cancellation ignore old messages, errors and expired timer callbacks', () => {
  const env = setup(), first = env.task.run(request('A')), old = env.workers[0];
  const oldMessage = old.onmessage, oldError = old.onerror, oldTimer = [...env.timers.values()][0];
  const second = env.task.run(request('B')), current = env.workers[1];
  assert.ok(second > first); assert.equal(old.terminated, 1); assert.equal(env.timers.size, 1); assert.deepEqual(env.busy, [true]);
  oldMessage({ data: { requestId: second, result: { ok: true } } }); oldError({ message: 'late A' }); oldTimer();
  assert.equal(env.task.busy, true); assert.equal(env.results.length, 0); assert.equal(env.failures.length, 0);
  current.complete(first); assert.equal(env.results.length, 0);
  const cancelledMessage = current.onmessage, cancelledTimer = [...env.timers.values()][0];
  env.task.cancel(); cancelledMessage({ data: { requestId: second, result: { ok: true } } }); cancelledTimer();
  assert.equal(current.terminated, 1); assert.equal(env.task.busy, false); assert.equal(env.timers.size, 0);
  assert.equal(env.results.length, 0); assert.equal(env.failures.length, 0); assert.deepEqual(env.busy, [true, false]);
});

test('worker errors, decode errors and explicit failure replies cleanly allow a fresh retry', async t => {
  for (const boundary of ['error', 'messageerror', 'error-reply', 'invalid-reply']) await t.test(boundary, () => {
    const env = setup(), id = env.task.run(request('A')), worker = env.workers[0]; let prevented = false;
    if (boundary === 'error') worker.onerror({ message: 'worker could not load', preventDefault() { prevented = true; } });
    if (boundary === 'messageerror') worker.onmessageerror({});
    if (boundary === 'error-reply') worker.onmessage({ data: { requestId: id, error: 'compile failed' } });
    if (boundary === 'invalid-reply') worker.onmessage({ data: { requestId: id, result: {} } });
    assert.equal(env.task.busy, false); assert.equal(worker.terminated, 1); assert.equal(env.timers.size, 0);
    assert.equal(env.failures.length, 1); assert.ok(env.failures[0] instanceof Error); assert.equal(env.results.length, 0);
    if (boundary === 'error') assert.equal(prevented, true);
    const next = env.task.run(request('retry')); env.workers[1].complete(next); assert.equal(env.results.length, 1);
  });
});

test('a timed-out worker cannot publish later and its replacement may complete', () => {
  const env = setup({ timeoutMs: 25 }), id = env.task.run(request('slow')), worker = env.workers[0], late = worker.onmessage;
  [...env.timers.values()][0]();
  assert.equal(env.task.busy, false); assert.equal(worker.terminated, 1); assert.equal(env.timers.size, 0);
  assert.match(env.failures[0].message, /timed out/);
  late({ data: { requestId: id, result: { ok: true } } }); assert.equal(env.results.length, 0);
  const next = env.task.run(request('retry')); env.workers[1].complete(next); assert.equal(env.results.length, 1);
});

test('worker construction and postMessage clone failures settle busy state without synchronous compilation', () => {
  let attempts = 0; const worker = new FakeWorker();
  const construction = setup({ createWorker: () => { if (++attempts === 1) throw Error('Worker blocked'); return worker; } });
  construction.task.run(request('A')); assert.equal(construction.task.busy, false); assert.match(construction.failures[0].message, /Worker blocked/);
  const retry = construction.task.run(request('B')); worker.complete(retry); assert.equal(construction.results.length, 1);
  const clone = setup(); clone.task.run({ source: 'A', projectContext: { invalid: () => {} } });
  assert.equal(clone.task.busy, false); assert.equal(clone.workers[0].terminated, 1); assert.equal(clone.timers.size, 0);
  assert.equal(clone.failures.length, 1); assert.ok(clone.failures[0] instanceof Error);
  const id = clone.task.run(request('valid retry')); clone.workers[1].complete(id); assert.equal(clone.results.length, 1);
  for (const value of [null, undefined, false, 0, '']) {
    const falsy = setup({ createWorker() { throw value; } }); falsy.task.run(request('A'));
    assert.equal(falsy.failures.length, 1); assert.ok(falsy.failures[0] instanceof Error); assert.equal(falsy.results.length, 0); assert.equal(falsy.task.busy, false);
  }
});

test('malformed active result envelopes fail safely while syntax and catalog failures remain valid results', () => {
  const emptySpan = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } };
  const valid = { result: { ok: true, program: {}, diagnostics: [], sourceMap: [] }, syntaxOk: true, identity: { game: 'fixture', version: '1' }, output: '{}' };
  const malformed = [
    { syntaxOk: undefined }, { syntaxOk: 'true' }, { identity: undefined }, { identity: { game: 'fixture' } }, { identity: { game: '', version: '1' } },
    { output: undefined }, { output: {} }, { output: 'x'.repeat(100001) },
    { result: { ...valid.result, diagnostics: null } }, { result: { ...valid.result, sourceMap: {} } },
    { result: { ...valid.result, program: null } }, { result: { ...valid.result, program: [] } },
    { result: { ...valid.result, diagnostics: [null] } }, { result: { ...valid.result, sourceMap: [{ kind: 'line', id: 'line' }] } }
  ];
  for (const changes of malformed) {
    const env = setup(), id = env.task.run(request('A')), worker = env.workers[0];
    worker.onmessage({ data: { requestId: id, ...valid, ...changes } });
    assert.equal(env.results.length, 0); assert.equal(env.failures.length, 1); assert.match(env.failures[0].message, /Invalid compiler worker response/);
    assert.equal(env.task.busy, false); assert.equal(env.timers.size, 0); assert.equal(worker.terminated, 1);
  }
  for (const syntaxOk of [false, true]) {
    const env = setup(), id = env.task.run(request('A'));
    env.workers[0].complete(id, { syntaxOk, identity: syntaxOk ? valid.identity : undefined, output: '',
      result: { ok: false, diagnostics: [{ code: 'DSL_FAILURE', message: 'Candidate rejected', span: emptySpan }], sourceMap: [] } });
    assert.equal(env.results.length, 1); assert.equal(env.failures.length, 0); assert.equal(env.results[0].result.ok, false);
  }
});

test('dispose is idempotent, prevents run and rejects all late callbacks', () => {
  const env = setup(), id = env.task.run(request('A')), worker = env.workers[0];
  const message = worker.onmessage, error = worker.onerror, decodeError = worker.onmessageerror, timeout = [...env.timers.values()][0];
  env.task.dispose(); env.task.dispose(); env.task.cancel();
  message({ data: { requestId: id, result: { ok: true } } }); error({ message: 'late' }); decodeError({}); timeout();
  assert.equal(worker.terminated, 1); assert.equal(env.timers.size, 0); assert.equal(env.task.busy, false);
  assert.equal(env.results.length, 0); assert.equal(env.failures.length, 0); assert.deepEqual(env.busy, [true, false]);
  assert.throws(() => env.task.run(request('after disposal')), /disposed/);
});

test('a synchronous cancellation from busy notification never creates a ghost worker', () => {
  let task; const env = setup({ onBusy: value => { if (value) task.cancel(); } }); task = env.task;
  task.run(request('A')); assert.equal(task.busy, false); assert.equal(env.workers.length, 0); assert.equal(env.timers.size, 0);
});

test('a reentrant replacement after completion cannot receive the previous result', () => {
  let task, replacing = false;
  const env = setup({ onBusy: value => { if (!value && !replacing) { replacing = true; task.run(request('B')); } } }); task = env.task;
  const first = task.run(request('A')); env.workers[0].complete(first);
  assert.equal(env.results.length, 0); assert.equal(task.busy, true);
  const current = env.workers[1].messages[0].requestId; env.workers[1].complete(current);
  assert.equal(env.results.length, 1); assert.equal(env.results[0].requestId, current); assert.equal(task.busy, false);
});
