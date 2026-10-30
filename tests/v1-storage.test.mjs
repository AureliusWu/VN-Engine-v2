import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSessionPersistence, createProject, createSaveContract } from '../dist/index.js';
import { memoryStorage } from './helpers.mjs';

test('manual, quick and auto loads reject a valid envelope stored under another slot without rewriting it', () => {
  const storage = memoryStorage(), contract = createSaveContract({ game: 'v1-slot-identity', gameVersion: 'v1', storage });
  const slots = ['manual-1', 'manual-2', 'quick', 'auto'];
  const load = slot => slot.startsWith('manual-') ? contract.loadManual(Number(slot.slice(7))) : slot === 'quick' ? contract.loadQuick() : contract.loadAuto();
  for (const actual of slots) for (const claimed of slots.filter(slot => slot !== actual)) {
    const raw = JSON.stringify(contract.envelope(claimed, { from: claimed }, { title: 'Preserve mismatched bytes' }, new Date(0)));
    storage.setItem(contract.keyFor(actual), raw);
    assert.equal(load(actual).status, 'invalid', `${actual} must reject a ${claimed} envelope`);
    assert.equal(storage.getItem(contract.keyFor(actual)), raw);
    assert.equal(contract.decode(raw).slot, claimed, 'portable decoding remains independent of a destination key');
  }
});

test('a mismatched slot cannot move an active session through manual, quick or automatic loading', () => {
  const project = { schema: 1, game: 'v1-bound-slot', version: 'v1', title: 'Bound slot', type: 'narrative', assets: [],
    settings: { textDelayMs: 0 }, scenes: [{ id: 'start', lines: [{ id: 'one', speaker: 'N', text: 'First' }, { id: 'two', speaker: 'N', text: 'Second' }], ending: 'done' }] };
  const { session } = createProject(project, 'https://example.test/game/');
  try {
    const storage = memoryStorage(), contract = createSaveContract({ game: project.game, gameVersion: project.version, storage });
    const persistence = bindSessionPersistence(session, contract);
    persistence.saveManual(1); const raw = storage.getItem(contract.keyFor('manual-1'));
    session.next(); const before = session.getView();
    for (const [slot, load] of [['manual-2', () => persistence.loadManual(2)], ['quick', () => persistence.quickLoad()], ['auto', () => persistence.autoLoad()]]) {
      storage.setItem(contract.keyFor(slot), raw);
      assert.equal(load().status, 'invalid'); assert.equal(session.getView(), before);
      assert.equal(storage.getItem(contract.keyFor(slot)), raw);
    }
  } finally { session.dispose(); }
});

test('correct-slot registered migrations remain compatible and do not eagerly rewrite legacy bytes', () => {
  const storage = memoryStorage(), contract = createSaveContract({ game: 'v1-legacy-slots', gameVersion: '2', legacyGameVersions: ['1'], storage,
    migrations: [{ from: 1, to: 2, migrate: value => ({ ...value, schema: 2, save_version: 2 }) }] });
  for (const [slot, load] of [['manual-1', () => contract.loadManual(1)], ['quick', () => contract.loadQuick()], ['auto', () => contract.loadAuto()]]) {
    const raw = JSON.stringify({ schema: 1, save_version: 1, game: contract.game, game_version: '1', slot,
      savedAt: new Date(0).toISOString(), payload: { legacy: slot } });
    storage.setItem(contract.keyFor(slot), raw); const loaded = load();
    assert.equal(loaded.status, 'valid'); assert.equal(loaded.value.slot, slot); assert.equal(loaded.value.save_version, 2);
    assert.equal(loaded.value.game_version, '1'); assert.deepEqual(loaded.value.payload, { legacy: slot });
    assert.equal(storage.getItem(contract.keyFor(slot)), raw);
  }
  const wrong = createSaveContract({ game: 'v1-bad-migration', gameVersion: '2', storage,
    migrations: [{ from: 1, to: 2, migrate: value => ({ ...value, schema: 2, save_version: 2, slot: 'auto' }) }] });
  const raw = JSON.stringify({ schema: 1, save_version: 1, game: wrong.game, game_version: '2', slot: 'quick', savedAt: new Date(0).toISOString(), payload: {} });
  storage.setItem(wrong.keyFor('quick'), raw); assert.equal(wrong.loadQuick().status, 'invalid');
  assert.equal(storage.getItem(wrong.keyFor('quick')), raw);
});

test('slot identity checks preserve empty, unavailable and malformed storage results and valid saves', () => {
  const storage = memoryStorage(), contract = createSaveContract({ game: 'v1-slot-status', gameVersion: 'v1', storage });
  assert.equal(contract.loadAuto().status, 'empty');
  storage.setItem(contract.keyFor('quick'), '{broken'); assert.equal(contract.loadQuick().status, 'invalid');
  assert.equal(storage.getItem(contract.keyFor('quick')), '{broken');
  const denied = createSaveContract({ game: contract.game, gameVersion: 'v1', storage: { ...storage, getItem() { throw Error('denied'); } } });
  assert.equal(denied.loadManual(1).status, 'unavailable'); assert.equal(denied.loadQuick().status, 'unavailable'); assert.equal(denied.loadAuto().status, 'unavailable');
  contract.saveManual(2, { slot: 'manual' }); contract.saveQuick({ slot: 'quick' }); contract.saveAuto({ slot: 'auto' });
  assert.deepEqual(contract.loadManual(2).value.payload, { slot: 'manual' });
  assert.deepEqual(contract.loadQuick().value.payload, { slot: 'quick' }); assert.deepEqual(contract.loadAuto().value.payload, { slot: 'auto' });
  assert.throws(() => contract.loadManual(0)); assert.throws(() => contract.loadManual(7));
});
