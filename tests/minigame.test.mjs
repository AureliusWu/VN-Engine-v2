import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MiniGameSession, createProject } from '../dist/index.js';
import { newProject, diagnoseProject } from '../dist/editor/index.js';

const definition = () => ({ id: 'switches-1', kind: 'switches', initial: [false, false], target: [true, true], maxMoves: 3,
  results: { success: 'yes', failure: 'no', abort: 'no', skip: 'yes' } });
function project() {
  const p = newProject('script'); p.settings = { textDelayMs: 0 };
  const next = p.program.blocks[1].id; p.program.blocks[0].exit.choices = [{ id: 'yes', text: 'success', next }, { id: 'no', text: 'failure', next }];
  p.program.blocks[0].cue = { miniGame: definition() }; return p;
}
test('mini-game lifecycle supports entry, all declared outcomes and a validated replay journal', () => {
  const game = new MiniGameSession(definition()); assert.equal(game.play(0), false); game.start(); game.play(0);
  const saved = game.save(), restored = new MiniGameSession(definition()); restored.restore(saved); assert.deepEqual(restored.getView().board, [true, false]);
  restored.play(1); assert.equal(restored.getView().result, 'success'); assert.equal(restored.resultAction(), 'yes'); assert.equal(restored.play(0), false);
  const failed = new MiniGameSession(definition()); failed.start(); for (const i of [0, 0, 0]) failed.play(i); assert.equal(failed.getView().result, 'failure');
  for (const [command, expected] of [['skip', 'skip'], ['abort', 'abort']]) { const item = new MiniGameSession(definition()); item.start(); item[command](); assert.equal(item.getView().result, expected); new MiniGameSession(definition()).restore(item.save()); }
  const locked = definition(); delete locked.results.skip; const noSkip = new MiniGameSession(locked); noSkip.start(); assert.equal(noSkip.skip(), false);
  assert.throws(() => game.restore({ ...saved, phase: 'complete', result: 'success' }), /Forged/); assert.deepEqual(game.getView().board, [true, false]);
  assert.throws(() => game.restore({ ...saved, journal: [999] }));
});

test('runtime saves and rollback restore mini-game progress while outcomes use normal story decisions', () => {
  const { session } = createProject(project(), 'https://test.invalid/'); assert.equal(session.act('yes'), false);
  session.startMiniGame(); session.playMiniGame(0); const saved = session.save(); session.playMiniGame(0); session.restore(saved);
  assert.deepEqual(session.getView().miniGame.board, [true, false]); session.playMiniGame(1); assert.equal(session.finishMiniGame(), true);
  assert.equal(session.save().state.decisions[0].choiceId, 'yes'); assert.equal(session.rollback(), true);
  assert.equal(session.getView().miniGame.result, 'success'); assert.equal(session.getView().miniGame.phase, 'complete');
  const before = session.save(); assert.throws(() => session.restore({ ...saved, vnMiniGame: { ...saved.vnMiniGame, state: { ...saved.vnMiniGame.state, result: 'success', phase: 'complete' } } }));
  assert.deepEqual(session.save(), before); session.dispose();
});

test('mini-game commands obey reading/pause guards and external definitions cannot mutate a running game', () => {
  const p = project(), { session } = createProject(p, 'https://test.invalid/');
  p.program.blocks[0].cue.miniGame.target[0] = false;
  session.pause('native-host', true); assert.equal(session.startMiniGame(), false); session.pause('native-host', false);
  session.startMiniGame(); session.hide(true); assert.equal(session.playMiniGame(0), false); session.hide(false);
  session.playMiniGame(0); session.playMiniGame(1); assert.equal(session.getView().miniGame.result, 'success'); session.dispose();
});

test('author validation rejects missing result actions and games placed before the final choice line', () => {
  const p = project(); p.program.blocks[0].cue.miniGame.results.failure = 'missing'; assert.throws(() => createProject(p, 'https://test.invalid/'), /available story action/);
  p.program.blocks[0].cue.miniGame.results.failure = 'no'; p.program.blocks[0].lines.push({ id: 'extra', speaker: 'N', text: 'extra' });
  assert.throws(() => createProject(p, 'https://test.invalid/'), /final line/); assert.ok(diagnoseProject(p).some(item => item.severity === 'error'));
});
