import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvestigationEngine, decodeCircuitSave } from '../dist/index.js';
import { circuit, collectAll, readJSON } from './helpers.mjs';

test('investigation cycles retain evidence; gates and consumed hotspots constrain actions', () => {
  const engine = circuit(), state = engine.initial();
  assert.equal(engine.transition(state, 'reason'), null);
  const collected = engine.transition(state, 'inspect-a');
  assert.deepEqual(state.evidence, []);
  const hub = engine.transition(collected, 'return');
  assert.equal(hub.nodeId, state.nodeId);
  assert.deepEqual(hub.evidence, ['record']);
  assert.equal(engine.transition(hub, 'inspect-a'), null);
  const puzzle = collectAll(engine);
  assert.equal(puzzle.nodeId, 'puzzle');
  assert.deepEqual(puzzle.evidence, ['record', 'photo']);
});

test('failed reasoning can retry with a reset; it does not unlock another chapter', () => {
  const engine = circuit(), puzzle = collectAll(engine);
  const failed = engine.transition(puzzle, 'wrong');
  const session = engine.complete({ ...engine.newCampaign(), state: failed });
  assert.deepEqual(session.completed, []);
  assert.deepEqual(engine.unlocked(session.completed), ['chapter-one']);
  assert.throws(() => engine.startChapter(session, 'chapter-two'));
  const retry = engine.transition(failed, 'retry');
  assert.deepEqual(retry, engine.initial());
});

test('chapter completion proves evidence, unlocks in sequence and allows chapter replays', () => {
  const engine = circuit();
  let session = engine.complete({ ...engine.newCampaign(), state: engine.transition(collectAll(engine), 'right') });
  assert.deepEqual(session.completed, ['chapter-one']);
  session = engine.startChapter(session, 'chapter-two');
  assert.deepEqual(session.state.evidence, []);
  session.state = engine.transition(collectAll(engine, session.state), 'right');
  session = engine.complete(session);
  assert.deepEqual(session.completed, ['chapter-one', 'chapter-two']);
  assert.equal(engine.startChapter(session, 'chapter-one').state.chapterId, 'chapter-one');
});

test('campaign restore rejects invented unlocks, unknown evidence and inconsistent inventory', () => {
  const engine = circuit(), session = engine.newCampaign();
  assert.throws(() => engine.restoreCampaign({ ...session, completed: ['chapter-two'] }));
  assert.throws(() => engine.restoreCampaign({ ...session, state: { ...session.state, chapterId: 'chapter-two' } }));
  assert.equal(engine.reachable({ ...session.state, evidence: ['unknown'] }), false);
  assert.equal(engine.reachable({ ...session.state, nodeId: 'puzzle' }), false);
  assert.throws(() => engine.restoreCampaign({ ...session, completed: ['chapter-one'], archive: { 'chapter-one': ['record'] } }));
});

test('inventory search rejects structurally plausible but unreachable save states', () => {
  const chapter = structuredClone(readJSON('examples/circuit/chapters.json').chapters[0]);
  chapter.nodes.hub.excludesEvidence = ['photo'];
  assert.throws(() => new InvestigationEngine([chapter]), /inventory gate|unreachable|ending/);
  const engine = circuit();
  assert.equal(engine.reachable({ chapterId: 'chapter-one', nodeId: 'a', evidence: ['photo', 'record'] }), true);
  assert.equal(engine.reachable({ chapterId: 'chapter-one', nodeId: 'a', evidence: [] }), false);
});

test('chapter authoring validates hotspots, missing targets, core evidence and finite budgets', () => {
  for (const mutate of [
    chapter => { chapter.nodes.hub.scene.hotspots[0].x = 101; },
    chapter => { chapter.nodes.hub.actions[0].next = 'missing'; },
    chapter => { chapter.nodes.complete.requiresEvidence = []; },
    chapter => { chapter.nodes.hub.actions[0].resetEvidence = true; }
  ]) {
    const chapter = structuredClone(readJSON('examples/circuit/chapters.json').chapters[0]); mutate(chapter);
    assert.throws(() => new InvestigationEngine([chapter]));
  }
  assert.throws(() => new InvestigationEngine(readJSON('examples/circuit/chapters.json').chapters, 1), /budget/);
});

test('native Circuit v1/v2 envelopes are read without writing any source game storage', () => {
  const engine = circuit();
  const payload = { version: 1, ...engine.initial(), history: ['hub'], savedAt: '2026-10-25T00:00:00.000Z' };
  assert.deepEqual(decodeCircuitSave(engine, JSON.stringify(payload)).state, engine.initial());
  assert.throws(() => decodeCircuitSave(engine, JSON.stringify({ ...payload, version: '1' })));
  assert.throws(() => decodeCircuitSave(engine, JSON.stringify({ ...payload, nodeId: 'complete', history: ['complete'] })));
  const session = engine.complete({ ...engine.newCampaign(), state: engine.transition(collectAll(engine), 'right') });
  const v2 = { ...payload, version: 2, ...session.state, completed: session.completed, archive: session.archive, history: ['complete'] };
  assert.deepEqual(decodeCircuitSave(engine, JSON.stringify(v2)).session, session);
});
