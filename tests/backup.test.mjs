import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveBackup, createSaveContract, createProject, bindSessionPersistence, MAX_SAVE_BACKUP_SIZE } from '../dist/index.js';
import { newProject } from '../dist/editor/index.js';
import { memoryStorage, readJSON } from './helpers.mjs';

function setup(project = readJSON('examples/runtime/campus.json'), storage = memoryStorage()) {
  const { session } = createProject(project, 'https://test.invalid/', { settings: { textDelayMs: 0 } });
  const contract = createSaveContract({ game: project.game, gameVersion: project.version, storage });
  const persistence = bindSessionPersistence(session, contract);
  const backup = createSaveBackup(contract, storage, value => {
    const isolated = createProject(project, 'https://test.invalid/', { settings: { textDelayMs: 0 } });
    try { isolated.session.restore(value); return isolated.session.save(); } finally { isolated.session.dispose(); }
  });
  return { session, persistence, contract, backup, storage };
}

test('four independent driver formats round-trip all populated slots without mutating current state, Meta or settings', () => {
  for (const type of ['campus', 'netlove', 'circuit', 'rain']) {
    const { session, persistence, contract, backup, storage } = setup(readJSON(`examples/runtime/${type}.json`));
    storage.setItem('unrelated-game:save', 'untouched'); storage.setItem(`vn-engine:${contract.game}:meta`, 'meta'); storage.setItem(`vn-engine:${contract.game}:settings`, 'settings');
    persistence.saveManual(1); persistence.quickSave(); persistence.autoSave();
    const view = session.getView(), before = [...storage.data];
    const raw = backup.export(new Date(0)), preview = backup.preview(raw);
    assert.equal(preview.slots.length, 3); assert.deepEqual(preview.slots.map(item => item.slot), ['manual-1', 'quick', 'auto']);
    assert.ok(Object.isFrozen(preview.slots)); assert.throws(() => { preview.slots[0].slot = 'manual-7'; });
    assert.equal(session.getView(), view); assert.deepEqual([...storage.data], before);
    const empty = memoryStorage(), other = setup(readJSON(`examples/runtime/${type}.json`), empty);
    other.persistence.saveManual(2); const preserved = empty.getItem(other.contract.keyFor('manual-2'));
    assert.equal(other.backup.commit(other.backup.preview(raw)).status, 'saved');
    assert.equal(other.contract.loadManual(1).status, 'valid'); assert.equal(other.contract.loadAuto().status, 'valid'); assert.equal(other.contract.loadQuick().status, 'valid');
    assert.equal(empty.getItem(other.contract.keyFor('manual-2')), preserved);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['createdAt', 'format', 'game', 'slots', 'version']);
    other.session.dispose(); session.dispose();
  }
});

test('backup validation rejects incompatible identities, duplicate/out-of-range slots and impossible routes before any writes', () => {
  const { session, persistence, backup, storage } = setup(); persistence.saveManual(1); persistence.quickSave();
  const archive = JSON.parse(backup.export()), before = [...storage.data], view = session.getView();
  for (const change of [
    b => { b.game = 'other'; }, b => { b.version = 99; }, b => { b.slots[0].save_version = 99; },
    b => { b.slots[1].slot = b.slots[0].slot; }, b => { b.slots[1].slot = 'manual-7'; },
    b => { b.slots[1].payload.state.decisions = [{ sceneId: 'arrival', choiceId: 'invented' }]; },
    b => { b.slots[1].payload.state.sceneId = 'nonexistent'; }, b => { b.slots[1].game = 'other'; }
  ]) {
    const bad = structuredClone(archive); change(bad); assert.throws(() => backup.preview(JSON.stringify(bad)));
    assert.deepEqual([...storage.data], before); assert.equal(session.getView(), view);
  }
  assert.throws(() => backup.preview('x'.repeat(MAX_SAVE_BACKUP_SIZE + 1)), /too large/);
  const fakeDerived = structuredClone(archive); fakeDerived.slots[0].payload.state.stats.honesty = 999;
  const clean = backup.preview(JSON.stringify(fakeDerived)); assert.equal(backup.commit(clean).status, 'saved');
  assert.equal(JSON.parse(storage.getItem('vn-engine:vn-self-campus:v2:save:manual-1')).payload.state.stats.honesty, 0);
  session.dispose();
});

test('prepared previews are owned, one-use and reject a slot changed by another writer', () => {
  const { session, persistence, contract, backup, storage } = setup(); persistence.saveManual(1);
  const raw = backup.export(), preview = backup.preview(raw);
  assert.throws(() => backup.commit(structuredClone(preview)), /Unknown/);
  storage.setItem(contract.keyFor('manual-1'), '{newer or corrupt}');
  assert.equal(backup.commit(preview).status, 'conflict'); assert.equal(storage.getItem(contract.keyFor('manual-1')), '{newer or corrupt}');
  assert.throws(() => backup.commit(preview), /consumed/);
  const repaired = backup.preview(raw); assert.equal(repaired.slots[0].replaces, 'invalid');
  assert.equal(backup.commit(repaired).status, 'saved');
  const broken = JSON.parse(storage.getItem(contract.keyFor('manual-1'))); broken.payload.state.sceneId = 'unreachable';
  storage.setItem(contract.keyFor('manual-1'), JSON.stringify(broken));
  assert.equal(backup.preview(raw).slots[0].replaces, 'invalid'); session.dispose();
});

test('backup writes roll back quota failures and report failure of rollback explicitly', () => {
  for (const failRollback of [false, true]) {
    const port = memoryStorage(); let armed = false, failed = false;
    const storage = { ...port, setItem(key, raw) {
      if (armed && key.endsWith(':quick')) { failed = true; throw new Error('quota'); }
      if (failed && failRollback) throw new Error('restore unavailable');
      port.setItem(key, raw);
    } };
    const { session, persistence, contract, backup } = setup(undefined, storage);
    persistence.saveManual(1); persistence.quickSave(); const raw = backup.export(); session.next(); persistence.saveManual(1);
    const before = port.getItem(contract.keyFor('manual-1')); port.removeItem(contract.keyFor('quick'));
    const preview = backup.preview(raw); armed = true;
    const result = backup.commit(preview); assert.equal(result.status, 'unavailable'); assert.equal(result.rollbackFailed, failRollback);
    if (!failRollback) assert.equal(port.getItem(contract.keyFor('manual-1')), before);
    session.dispose();
  }
});

test('corrupt or unavailable stored slots block exports without discarding their bytes', () => {
  const { session, persistence, contract, backup, storage } = setup();
  assert.throws(() => backup.export(), /No saved/); persistence.saveManual(1); storage.setItem(contract.keyFor('quick'), '{broken');
  const before = [...storage.data]; assert.throws(() => backup.export()); assert.deepEqual([...storage.data], before);
  const unavailable = createSaveBackup(contract, null, v => v); assert.throws(() => unavailable.export(), /unavailable/); session.dispose();
});

test('archives use declared save migrations and retain the source bytes during preview', () => {
  const storage = memoryStorage();
  const contract = createSaveContract({ game: 'migrate', gameVersion: 'v2', legacyGameVersions: ['v1'], storage,
    migrations: [{ from: 1, to: 2, migrate: v => ({ ...v, schema: 2, save_version: 2 }) }] });
  const backup = createSaveBackup(contract, storage, v => { if (!v || v.reachable !== true) throw Error(); return v; });
  const raw = JSON.stringify({ format: 'VN_ENGINE_SAVE_BACKUP', version: 1, game: 'migrate', createdAt: new Date(0).toISOString(), slots: [
    { schema: 1, save_version: 1, game: 'migrate', game_version: 'v1', slot: 'quick', savedAt: new Date(0).toISOString(), payload: { reachable: true } }
  ] });
  const preview = backup.preview(raw); assert.equal(storage.data.size, 0); assert.equal(backup.commit(preview).status, 'saved');
  assert.equal(contract.loadQuick().value.save_version, 2); assert.equal(contract.loadQuick().value.game_version, 'v1');
});

test('mid-game journals survive archive transfer and forged outcomes cannot enter any slot', () => {
  const p = newProject('script'); p.settings = { textDelayMs: 0 };
  const next = p.program.blocks[1].id; p.program.blocks[0].exit.choices = [{ id: 'yes', text: 'yes', next }, { id: 'no', text: 'no', next }];
  p.program.blocks[0].cue = { miniGame: { id: 'switches', kind: 'switches', initial: [false, false], target: [true, true], maxMoves: 3, results: { success: 'yes', failure: 'no', abort: 'no' } } };
  const { session, persistence, backup, contract, storage } = setup(p); session.startMiniGame(); session.playMiniGame(0); persistence.quickSave();
  const raw = backup.export(); session.playMiniGame(0); const view = session.getView();
  assert.equal(backup.commit(backup.preview(raw)).status, 'saved'); assert.equal(session.getView(), view);
  persistence.quickLoad(); assert.deepEqual(session.getView().miniGame.board, [true, false]);
  const forged = JSON.parse(raw); forged.slots[0].payload.vnMiniGame.state.phase = 'complete'; forged.slots[0].payload.vnMiniGame.state.result = 'success';
  const before = storage.getItem(contract.keyFor('quick')); assert.throws(() => backup.preview(JSON.stringify(forged))); assert.equal(storage.getItem(contract.keyFor('quick')), before);
  session.dispose();
});
