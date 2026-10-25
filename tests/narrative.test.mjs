import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NarrativeEngine, createHealingSaveCodec, createNetLoveSaveCodec, healingPresentationAt, netlovePresentationAt,
  cgAt, reachedCg, filterHistory, canRead, canAutoAdvance, ReadingVisit, decodePreferences } from '../dist/index.js';
import { healing, netlove, toChoice } from './helpers.mjs';

test('choices cannot run before the final line, and never mutate the prior state', () => {
  const engine = healing(), initial = engine.newGame();
  assert.throws(() => engine.choose(initial, 'together'));
  const state = engine.choose(toChoice(engine), 'together');
  assert.deepEqual(initial.stats, { honesty: 0, lin: 0, chen: 0 });
  assert.equal(state.stats.honesty, 3);
  assert.equal(state.decisions.length, 1);
  assert.throws(() => engine.choose(toChoice(engine), 'unknown'));
});

for (const ending of ['together', 'letter', 'quiet']) test(`Healing resolves and replays ${ending}, including chapter continuation`, () => {
  const engine = healing();
  let state = engine.choose(toChoice(engine), ending);
  state = engine.advance(state);
  assert.equal(state.sceneId, 'end-' + ending);
  assert.deepEqual(engine.replay(state.decisions, state.sceneId, 0), state);
  assert.throws(() => engine.continueStory(state));
  state = engine.advance(state);
  const recorded = engine.advance(state);
  assert.equal(recorded.sceneId, state.sceneId);
  state = engine.continueStory(recorded);
  assert.equal(state.sceneId, 'c2-open');
  assert.equal(engine.advance(state).sceneId, 'c2-open');
  state = engine.continueStory(state);
  assert.equal(state.sceneId, 'final');
  assert.deepEqual(engine.replay(state.decisions, state.sceneId, 0), state);
});

test('native codecs rebuild stats/history, isolate games and enforce old chapter boundaries', () => {
  const engine = healing(), codec = createHealingSaveCodec(engine);
  const state = engine.choose(toChoice(engine), 'letter');
  const save = codec.encode(state, new Date('2026-10-25T00:00:00.000Z'));
  const forged = structuredClone(save);
  forged.state.stats.honesty = 999;
  forged.state.history = [{ text: 'unread future scene' }];
  assert.deepEqual(codec.decode(JSON.stringify(forged)).state, state);
  assert.throws(() => createNetLoveSaveCodec(netlove()).decode(JSON.stringify(save)));
  save.state.storyVersion = 'chapter1-v1';
  assert.equal(codec.decode(JSON.stringify(save)).state.storyVersion, 'moist-healing-v1');
  save.state.sceneId = 'final';
  assert.throws(() => codec.decode(JSON.stringify(save)));
  assert.throws(() => codec.decode('x'.repeat(2_000_001)));
  assert.throws(() => codec.decode(JSON.stringify({ ...forged, savedAt: 'invalid' })));
});

test('save replay rejects unreachable branches, bad lines and surplus decisions', () => {
  const engine = healing();
  assert.throws(() => engine.replay([], 'end-together', 0));
  assert.throws(() => engine.replay([{ sceneId: 'arrival', choiceId: 'quiet' }], 'end-together', 0));
  assert.throws(() => engine.replay([], 'arrival', -1));
  assert.throws(() => engine.replay([], 'arrival', .5));
  assert.throws(() => engine.replay([{ sceneId: 'arrival', choiceId: 'quiet' }], 'arrival', 0));
});

test('reread restores only the preceding choice prefix and cannot use forged history', () => {
  const engine = healing();
  let state = engine.advance(engine.choose(toChoice(engine), 'together'));
  state = engine.advance(state);
  const old = structuredClone(state), reread = engine.reread(state, { sceneId: 'arrival', line: 1 });
  assert.equal(reread.decisions.length, 0);
  assert.equal(reread.stats.honesty, 0);
  assert.equal(engine.choose(reread, 'quiet').stats.honesty, 0);
  assert.deepEqual(state, old);
  state.history.push({ sceneId: 'end-letter', line: 0 });
  assert.throws(() => engine.reread(state, { sceneId: 'end-letter', line: 0 }));
});

test('conditional chat/call text and noSprite survive replay; meetings show the native character', () => {
  const engine = netlove();
  const honest = engine.choose(toChoice(engine), 'honest');
  const reserve = engine.choose(toChoice(engine), 'reserve');
  assert.notEqual(engine.getScene(honest).lines[0].text, engine.getScene(reserve).lines[0].text);
  assert.equal(engine.getScene(honest).lines[0].medium, 'call');
  assert.equal(netlovePresentationAt(engine.getScene(honest), 0).character, undefined);
  const meeting = engine.advance(honest);
  assert.equal(netlovePresentationAt(engine.getScene(meeting), 0).character, 'tinghe');
  const reread = engine.reread(meeting, { sceneId: 'call', line: 0 });
  assert.equal(engine.getScene(reread).lines[0].text, engine.getScene(honest).lines[0].text);
});

test('presentation reconstructs prior expressions, excludes remote speakers and delays CG unlock', () => {
  const scene = { id: 'c2-home-plan', character: 'lin', cg: 'event', cgFrom: 2, lines: [
    { speaker: '林见夏', text: 'a', expression: 'smile' }, { speaker: '陈知遥', text: 'remote', expression: 'hurt' }, { speaker: '旁白', text: 'c' }
  ] };
  assert.deepEqual(healingPresentationAt(scene, 2), { character: 'lin', expression: 'smile' });
  assert.equal(cgAt(scene, 1), undefined);
  assert.equal(cgAt(scene, 2), 'event');
  assert.equal(reachedCg(scene, [{ sceneId: scene.id, line: 1 }]), undefined);
  assert.equal(reachedCg(scene, [], 2), 'event');
});

test('duplicate IDs, unknown effects and broken target references fail at authoring time', () => {
  const base = { game: 'fixture', storyVersion: 'v1', entry: 'a', stats: { trust: 0 } };
  const a = { id: 'a', lines: [{ speaker: 'n', text: 'a' }], ending: 'done' };
  assert.throws(() => new NarrativeEngine({ ...base, scenes: [a, a] }));
  assert.throws(() => new NarrativeEngine({ ...base, scenes: [{ ...a, ending: undefined, next: 'missing' }] }));
  assert.throws(() => new NarrativeEngine({ ...base, scenes: [{ ...a, ending: undefined, choices: [{ id: 'x', text: 'x', next: 'a', effect: { unknown: 1 } }] }] }));
});

test('history search preserves repeated records and only searches supplied read entries', () => {
  const a = { speaker: '甲', text: 'ＡＢＣ 学校', id: 'read' }, b = { speaker: '乙', text: '学校' };
  const entries = [a, b, a];
  assert.deepEqual(filterHistory(entries, 'abc 学校'), [a, a]);
  assert.equal(filterHistory(entries, '学校', '甲')[0], a);
  assert.deepEqual(filterHistory(entries, '未来剧情'), []);
});

test('hidden UI, background tabs and panels gate all automatic reading', () => {
  const active = { visible: true, panelOpen: false, interfaceHidden: false, manualPause: false };
  assert.equal(canAutoAdvance(active, true, false, false), true);
  for (const patch of [{ visible: false }, { panelOpen: true }, { interfaceHidden: true }, { manualPause: true }]) assert.equal(canRead({ ...active, ...patch }), false);
  for (const [finished, blocked, choice] of [[false, false, false], [true, true, false], [true, false, true]]) assert.equal(canAutoAdvance(active, finished, blocked, choice), false);
  const visits = new ReadingVisit();
  assert.notEqual(visits.enter('same/0'), visits.enter('same/0'));
});

test('old preferences get independent voice defaults and malformed values stay finite', () => {
  const prefs = decodePreferences({ volume: -1, voiceVolume: Infinity, textSpeed: 999, music: 'yes' });
  assert.equal(prefs.volume, 0); assert.equal(prefs.voiceVolume, .8); assert.equal(prefs.textSpeed, 80); assert.equal(prefs.music, true);
});
