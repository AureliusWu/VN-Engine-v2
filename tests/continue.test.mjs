import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuation, createProject, createSaveContract } from '../dist/index.js';
import { memoryStorage, readJSON } from './helpers.mjs';

test('Continue finds the latest actually reachable save for every driver without probing the active session', () => {
  for (const name of ['campus', 'netlove', 'circuit', 'rain']) {
    const project = readJSON(`examples/runtime/${name}.json`), storage = memoryStorage();
    const create = () => createProject(project, 'https://test.invalid/', { settings: { textDelayMs: 0 } }).session;
    const session = create(), contract = createSaveContract({ game: project.game, gameVersion: project.version, storage });
    contract.saveAuto(session.save(), undefined, new Date(1000));
    if (session.getView().frame.canAdvance) session.next(); else session.act(session.getView().frame.actions[0].id);
    const expected = session.getView().frame.id; contract.saveQuick(session.save(), undefined, new Date(2000));
    const forged = contract.envelope('manual-1', { invented: true }, undefined, new Date(3000)); storage.setItem(contract.keyFor('manual-1'), JSON.stringify(forged));
    session.restart();
    const continuation = createContinuation(session, contract, value => { const isolated = create(); try { isolated.restore(value); return isolated.save(); } finally { isolated.dispose(); } });
    const before = [...storage.data], view = session.getView();
    assert.equal(continuation.latest().value.slot, 'quick'); assert.equal(session.getView(), view); assert.deepEqual([...storage.data], before);
    assert.equal(continuation.resume().status, 'valid'); assert.equal(session.getView().frame.id, expected); assert.deepEqual([...storage.data], before);
    contract.saveAuto(session.save(), undefined, new Date(2000)); assert.equal(continuation.latest().value.slot, 'auto');
    session.dispose();
  }
});

test('Continue retains corrupt and mismatched slots, reports empty/unavailable, and rechecks after preview', () => {
  const project = readJSON('examples/runtime/campus.json'), storage = memoryStorage();
  const { session } = createProject(project, 'https://test.invalid/', { settings: { textDelayMs: 0 } });
  const contract = createSaveContract({ game: project.game, gameVersion: project.version, storage });
  const continuation = createContinuation(session, contract, value => { const isolated = createProject(project, 'https://test.invalid/').session; try { isolated.restore(value); return value; } finally { isolated.dispose(); } });
  assert.equal(continuation.latest().status, 'empty'); contract.saveAuto(session.save());
  const raw = storage.getItem(contract.keyFor('auto')); storage.setItem(contract.keyFor('quick'), raw); storage.setItem(contract.keyFor('auto'), '{broken');
  const before = session.getView(); assert.equal(continuation.resume().status, 'invalid'); assert.equal(session.getView(), before);
  assert.equal(storage.getItem(contract.keyFor('auto')), '{broken'); assert.equal(storage.getItem(contract.keyFor('quick')), raw);
  contract.saveManual(1, session.save()); assert.equal(continuation.latest().value.slot, 'manual-1');
  storage.setItem(contract.keyFor('manual-1'), '{changed}'); assert.equal(continuation.resume().status, 'invalid'); assert.equal(session.getView(), before);
  assert.equal(createContinuation(session, createSaveContract({game:project.game,gameVersion:project.version,storage:null}), v=>v).latest().status, 'unavailable');
  session.dispose();
});

test('explicit initial title pause prevents typing and actions until the host begins reading', () => {
  const p=readJSON('examples/runtime/campus.json');p.titleScreen=true;let scheduled=0;
  const clock={now:()=>0,set:()=>++scheduled,clear:()=>{}};
  const {session}=createProject(p,'https://test.invalid/',{initialPause:'title',settings:{textDelayMs:10},clock});
  assert.equal(scheduled,0);assert.equal(session.next(),false);assert.ok(session.getView().pauseReasons.includes('title'));
  session.pause('title',false);assert.equal(scheduled,1);session.dispose();
  assert.throws(()=>createProject({...p,titleScreen:'true'},'https://test.invalid/'),/titleScreen/);
});
