import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, createSaveContract, bindSessionPersistence } from '../dist/index.js';
import { EditorModel } from '../dist/editor/index.js';

test('the actual 0.8.2 workspace and save fixture opens and restores without changing story identity or bytes', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/v0.8.2-compatibility.json', import.meta.url), 'utf8'));
  assert.equal(fixture.producerEngineVersion, '0.8.2');
  const model = new EditorModel(fixture.workspace), project = model.getView().project;
  assert.deepEqual(project, fixture.workspace.project);
  assert.deepEqual(JSON.parse(model.serialize()), fixture.workspace);
  const values = new Map(), storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const contract = createSaveContract({ game: project.game, gameVersion: project.version, storage });
  const raw = JSON.stringify(fixture.saveEnvelope);
  storage.setItem(contract.keyFor('manual-1'), raw);
  const instance = createProject(project, 'https://fixture.invalid/');
  try {
    const persistence = bindSessionPersistence(instance.session, contract);
    instance.session.configure({ textDelayMs: 0 });
    assert.equal(instance.session.act(instance.session.getView().frame.actions[0].id), true);
    assert.notDeepEqual(instance.session.save(), fixture.saveEnvelope.payload);
    assert.equal(persistence.loadManual(1).status, 'valid');
    assert.deepEqual(instance.session.save(), fixture.saveEnvelope.payload);
    assert.equal(project.game, fixture.saveEnvelope.game);
    assert.equal(project.version, fixture.saveEnvelope.game_version);
    assert.equal(storage.getItem(contract.keyFor('manual-1')), raw);
  } finally { instance.session.dispose(); }
});
