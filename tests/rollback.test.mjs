import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, NarrativeDriver, NarrativeEngine, RuntimeSession, InvestigationDriver } from '../dist/index.js';
import { newProject } from '../dist/editor/index.js';
import { circuit } from './helpers.mjs';

test('rollback restores route, variables, stage, audio bindings and history cursor before a choice', () => {
  const project = newProject('script'); project.settings = { textDelayMs: 0 }; project.program.variables = { trust: { initial: 0 } };
  project.program.blocks[0].cue = { music: 'before', background: 'room', timeline: { durationMs: 100, animations: [{ id: 'move', layer: 'character', to: { x: 40 }, durationMs: 100 }] } };
  project.program.blocks[0].exit.choices[0].effects = [{ op: 'add', key: 'trust', value: 5 }];
  project.program.blocks[1].cue = { music: 'after', background: 'other' };
  const { session } = createProject(project, 'https://test.invalid/'); const before = session.save(), frame = session.getSnapshot().frame, history = session.history();
  session.act(project.program.blocks[0].exit.choices[0].id); assert.equal(session.driver.engine.decode(JSON.stringify(session.save())).variables.trust, 5);
  session.setAuto(true); assert.equal(session.rollback(), true); assert.equal(session.getSnapshot().reason, 'rollback');
  assert.deepEqual(session.save(), before); assert.deepEqual(session.getSnapshot().frame, frame); assert.deepEqual(session.history(), history);
  assert.equal(session.getSnapshot().auto, false); assert.equal(session.getSnapshot().canRollback, false);
  assert.equal(session.getView().frame.stage.music, 'before'); session.dispose();
});

test('narrative and investigation checkpoints restore real driver state, not only a text position', () => {
  const engine = new NarrativeEngine({ game: 'rollback-vn', storyVersion: 'v1', entry: 'a', stats: { trust: 0 }, scenes: [
    { id: 'a', lines: [{ id: 'one', speaker: 'N', text: 'choose' }], choices: [{ id: 'yes', text: 'yes', next: 'b', effect: { trust: 3 } }] },
    { id: 'b', lines: [{ id: 'two', speaker: 'N', text: 'done' }], ending: 'done' }
  ] });
  const narrative = new RuntimeSession(new NarrativeDriver(engine), { settings: { textDelayMs: 0 } });
  narrative.act('yes'); narrative.rollback(); assert.equal(narrative.save().state.stats.trust, 0); assert.deepEqual(narrative.save().state.decisions, []); narrative.dispose();
  const investigation = new RuntimeSession(new InvestigationDriver('rollback-investigation', 'v1', circuit()), { settings: { textDelayMs: 0 } });
  investigation.act('inspect-a'); assert.equal(investigation.getView().frame.evidence.length, 1);
  investigation.rollback(); assert.equal(investigation.getView().frame.evidence.length, 0); assert.deepEqual(investigation.save().journal, []); investigation.dispose();
});

test('rollback limits, disable policy, pause guards and load/restart boundaries are deterministic', () => {
  const project = newProject('vn'); project.settings = { textDelayMs: 0 }; project.rollback = { limit: 2 };
  project.scenes[0].lines = Array.from({ length: 5 }, (_, i) => ({ id: 'l' + i, speaker: 'N', text: 'line ' + i }));
  const { session } = createProject(project, 'https://test.invalid/'); for (let i = 0; i < 4; i++) session.next();
  assert.equal(session.getView().rollbackDepth, 2); session.pause('panel', true); assert.equal(session.rollback(), false); session.pause('panel', false);
  assert.throws(() => session.restore({ schema: 999 })); assert.equal(session.getView().rollbackDepth, 2);
  assert.equal(session.rollback(2), true); assert.equal(session.getView().frame.lineId, 'l2'); assert.equal(session.rollback(), false);
  session.next(); const save = session.save(); session.next(); session.restore(save); assert.equal(session.rollback(), false);
  session.next(); session.restart(); assert.equal(session.rollback(), false); session.dispose();
  project.rollback = { enabled: false }; const disabled = createProject(project, 'https://test.invalid/'); disabled.session.next(); assert.equal(disabled.session.rollback(), false); disabled.session.dispose();
  project.rollback = { limit: 0 }; assert.throws(() => createProject(project, 'https://test.invalid/'), /Rollback limit/);
});

test('unavailable optional checkpoints preserve reading, and disabling rollback performs no checkpoint work', () => {
  const engine = new NarrativeEngine({ game: 'checkpoint-failure', storyVersion: '1', entry: 'a', stats: {}, scenes: [{ id: 'a', lines: [{ speaker: 'N', text: 'one' }, { speaker: 'N', text: 'two' }], ending: 'done' }] });
  for (const enabled of [true, false]) {
    const driver = new NarrativeDriver(engine); let attempts = 0;
    driver.checkpoint = () => { attempts++; throw Error('Checkpoint unavailable'); };
    const session = new RuntimeSession(driver, { settings: { textDelayMs: 0 }, rollback: { enabled } });
    assert.equal(session.next(), true); assert.equal(session.getView().frame.text, 'two'); assert.equal(session.rollback(), false);
    assert.equal(attempts, enabled ? 2 : 0); session.dispose();
  }
});
