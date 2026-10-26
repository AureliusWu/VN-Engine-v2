import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSessionPersistence, createMetaStateStore, createProject, createSaveContract } from '../dist/index.js';
import { memoryStorage, readJSON } from './helpers.mjs';

test('save contract v2 isolates manual, quick and auto slots with explicit versions', () => {
  const storage = memoryStorage();
  const saves = createSaveContract({ game: 'demo', gameVersion: '1.2.3', storage });
  assert.equal(saves.manualSlots, 6);
  assert.equal(saves.saveManual(1, { route: 'a' }).status, 'saved');
  assert.equal(saves.saveQuick({ route: 'q' }).status, 'saved');
  assert.equal(saves.saveAuto({ route: 'auto' }).status, 'saved');
  assert.equal(saves.loadManual(1).value.payload.route, 'a');
  assert.equal(saves.loadQuick().value.payload.route, 'q');
  assert.equal(saves.loadAuto().value.payload.route, 'auto');
  assert.equal(saves.loadQuick().value.save_version, 2);
  assert.equal(saves.loadQuick().value.game_version, '1.2.3');
  assert.notEqual(saves.keyFor('manual-1'), saves.keyFor('quick'));
  assert.throws(() => saves.saveManual(0, {}));
  assert.throws(() => saves.saveManual(7, {}));
});

test('save contract upgrades registered legacy envelopes and retains corrupt saves', () => {
  const storage = memoryStorage();
  const saves = createSaveContract({
    game: 'demo', gameVersion: '2.0.0', legacyGameVersions: ['1.0.0'], storage,
    migrations: [{ from: 1, to: 2, migrate(value) { return { ...value, schema: 2, save_version: 2, game_version: value.game_version ?? '1.0.0' }; } }]
  });
  const legacy = { schema: 1, save_version: 1, game: 'demo', game_version: '1.0.0', slot: 'quick', savedAt: new Date(0).toISOString(), payload: { legacy: true } };
  storage.setItem(saves.keyFor('quick'), JSON.stringify(legacy));
  const upgraded = saves.loadQuick();
  assert.equal(upgraded.status, 'valid');
  assert.equal(upgraded.value.save_version, 2);
  assert.equal(upgraded.value.payload.legacy, true);
  storage.setItem(saves.keyFor('auto'), '{broken');
  assert.equal(saves.loadAuto().status, 'invalid');
  assert.equal(storage.getItem(saves.keyFor('auto')), '{broken');
});

test('session persistence restores quick saves through the runtime session boundary', () => {
  const project = readJSON('examples/runtime/campus.json');
  const { session } = createProject(project, new URL('../examples/runtime/', import.meta.url), { settings: { textDelayMs: 0 } });
  const storage = memoryStorage();
  const persistence = bindSessionPersistence(session, createSaveContract({ game: project.game, gameVersion: project.version, storage }));
  const before = session.getSnapshot().frame.lineId;
  assert.equal(persistence.quickSave().status, 'saved');
  session.next();
  assert.notEqual(session.getSnapshot().frame.lineId, before);
  assert.equal(persistence.quickLoad().status, 'valid');
  assert.equal(session.getSnapshot().frame.lineId, before);
  session.dispose();
});

test('meta state persists endings, CG unlocks, playthroughs and isolated replay context', () => {
  const storage = memoryStorage();
  const meta = createMetaStateStore('demo', storage, { endings: ['normal', 'true'], cgs: ['cg-1', 'cg-2'] });
  assert.equal(meta.read().status, 'empty');
  assert.equal(meta.markEndingSeen('normal').status, 'saved');
  assert.equal(meta.unlockCg('cg-1').status, 'saved');
  assert.equal(meta.recordPlaythrough().status, 'saved');
  assert.equal(meta.unlockTrueRoute().status, 'saved');
  const state = meta.read();
  assert.equal(state.status, 'valid');
  assert.deepEqual(state.value.ending_seen, ['normal']);
  assert.deepEqual(state.value.cg_unlocked, ['cg-1']);
  assert.equal(state.value.playthrough_count, 1);
  assert.equal(state.value.true_route_unlocked, true);
  const collections = meta.collections(state.value);
  assert.deepEqual(collections.endings, { unlocked: 1, total: 2, entries: [{ id: 'normal', unlocked: true }, { id: 'true', unlocked: false }] });
  const replay = meta.replay('ending', 'normal', new Date(0));
  assert.deepEqual(replay, { mode: 'replay', game: 'demo', kind: 'ending', id: 'normal', startedAt: new Date(0).toISOString() });
  assert.throws(() => meta.replay('ending', 'true'));
});

test('corrupt meta state is retained and never overwritten by unlock operations', () => {
  const storage = memoryStorage();
  const meta = createMetaStateStore('demo', storage);
  storage.setItem(meta.key, '{broken');
  assert.equal(meta.read().status, 'invalid');
  assert.equal(meta.unlockCg('cg-1').status, 'invalid');
  assert.equal(storage.getItem(meta.key), '{broken');
});
