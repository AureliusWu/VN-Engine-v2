import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NarrativeEngine, NarrativeDriver, RuntimeSession, ScriptEngine, ScriptDriver, createRainRuntime,
  InvestigationDriver, AssetCatalog, localAssetPath, runtimeSettings } from '../dist/index.js';
import { readJSON, circuit } from './helpers.mjs';

class FakeClock {
  time = 0; serial = 0; tasks = new Map(); all = [];
  now = () => this.time;
  set = (callback, delay) => { const id = ++this.serial; const task = { callback, due: this.time + delay, id }; this.tasks.set(id, task); this.all.push(task); return id; };
  clear = id => this.tasks.delete(id);
  advance(ms) {
    const until = this.time + ms;
    for (let budget = 0; budget < 10000; budget++) {
      const task = [...this.tasks.values()].sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!task || task.due > until) { this.time = until; return; }
      this.time = task.due; this.tasks.delete(task.id); task.callback();
    }
    throw new Error('Timer did not settle');
  }
}
function narrative(options = {}) {
  const engine = new NarrativeEngine({ game: 'runtime-test', storyVersion: 'v1', entry: 'a', stats: { trust: 0 }, scenes: [
    { id: 'a', lines: [{ id: 'a1', speaker: '甲', text: 'A👩‍🚀B' }, { id: 'a2', speaker: '甲', text: '第二段' }], choices: [
      { id: 'yes', text: '选择', next: 'b', effect: { trust: 1 } }, { id: 'no', text: '保留', next: 'b' }
    ] }, { id: 'b', lines: [{ id: 'b1', speaker: '旁白', text: '结局' }], ending: 'done' }
  ] });
  const driver = new NarrativeDriver(engine, { lines: options.cues }), clock = new FakeClock();
  return { driver, clock, session: new RuntimeSession(driver, { clock, settings: { textDelayMs: 10, autoDelayMs: 20, skipDelayMs: 10, ...options.settings } }) };
}

test('own scheduler types graphemes and the first input reveals instead of advancing', () => {
  const { session, clock } = narrative();
  clock.advance(20); assert.equal(session.getSnapshot().text, 'A👩‍🚀');
  assert.equal(session.next(), true); assert.equal(session.getSnapshot().frame.lineId, 'a1'); assert.equal(session.getSnapshot().text, 'A👩‍🚀B');
  session.next(); assert.equal(session.getSnapshot().frame.lineId, 'a2'); assert.equal(session.act('yes'), false);
  session.next(); assert.equal(session.act('yes'), true); assert.equal(session.getSnapshot().frame.lineId, 'b1'); session.dispose();
});

test('background, panel and hidden UI pause typing with no catch-up or late callback', () => {
  const { session, clock } = narrative(); clock.advance(10);
  session.pause('background', true); const before = session.getSnapshot(); const stale = clock.all.at(-1);
  clock.advance(1000); stale.callback(); assert.equal(session.getSnapshot().text, before.text);
  session.pause('panel', true); session.pause('background', false); clock.advance(100); assert.equal(session.getSnapshot().text, before.text);
  session.pause('panel', false); clock.advance(10); assert.equal(session.getSnapshot().text, 'A👩‍🚀');
  session.hide(true); assert.equal(session.next(), false); clock.advance(100); assert.equal(session.getSnapshot().text, 'A👩‍🚀');
  session.hide(false); clock.advance(10); assert.equal(session.getSnapshot().complete, true); session.dispose();
});

test('auto waits for authored pause and voice, preserving remaining delay across a panel', () => {
  const { session, clock } = narrative({ cues: { a1: { pauseMs: 40 } }, settings: { textDelayMs: 0 } });
  session.setAuto(true); session.setVoiceBlocked(true); clock.advance(20); assert.equal(session.getSnapshot().ready, false);
  session.pause('panel', true); clock.advance(500); session.pause('panel', false); clock.advance(19); assert.equal(session.getSnapshot().ready, false);
  clock.advance(1); assert.equal(session.getSnapshot().ready, true); clock.advance(100); assert.equal(session.getSnapshot().frame.lineId, 'a1');
  session.setVoiceBlocked(false); clock.advance(10); session.pause('panel', true); clock.advance(100); session.pause('panel', false);
  clock.advance(9); assert.equal(session.getSnapshot().frame.lineId, 'a1'); clock.advance(1); assert.equal(session.getSnapshot().frame.lineId, 'a2');
  clock.advance(100); assert.equal(session.getSnapshot().frame.actions.length, 2); assert.equal(session.getSnapshot().frame.lineId, 'a2'); session.dispose();
});

test('read-skip never skips new prose or selects a choice, and visits change on same-line restore', () => {
  const { session, clock } = narrative({ settings: { textDelayMs: 0 } });
  assert.equal(session.setSkip(true), false); session.next(); session.restart();
  assert.equal(session.setSkip(true), true); clock.advance(10); assert.equal(session.getSnapshot().frame.lineId, 'a2'); assert.equal(session.getSnapshot().skipping, false);
  const saved = session.save(), visit = session.getSnapshot().visit;
  session.restore(saved); assert.ok(session.getSnapshot().visit > visit); assert.equal(session.getSnapshot().reason, 'restore'); assert.equal(session.getSnapshot().auto, false); session.dispose();
});

test('restore is atomic, reread drops future choices, and disposing clears all timers', () => {
  const { session, clock } = narrative({ settings: { textDelayMs: 0 } }); session.next(); session.act('yes');
  const before = session.getSnapshot().frame;
  assert.throws(() => session.restore({ schema: 999 })); assert.deepEqual(session.getSnapshot().frame, before);
  assert.equal(session.reread('a/1'), true); assert.equal(session.getSnapshot().frame.lineId, 'a2');
  const save = session.save(); assert.deepEqual(save.state.decisions, []);
  session.setAuto(true); session.dispose(); for (const task of clock.all) task.callback(); assert.equal(clock.tasks.size, 0);
  assert.equal(session.next(), false); assert.throws(() => session.save());
});

test('script VM executes Rain choices, response lines and state branches without another engine', () => {
  const story = readJSON('examples/renpy/story.json'); const engine = createRainRuntime(story, { game: 'rain-self', version: 'v1' });
  let state = engine.initial(); state = engine.choose(state, 'trust_choice');
  assert.equal(engine.block(state).lines[state.line].id, 'response_line'); assert.equal(state.variables.trust, 1);
  const ids = [];
  for (let index = 0; index < 20; index++) {
    const block = engine.block(state); ids.push(block.lines[state.line].id);
    if (block.exit.type === 'end') break; state = engine.advance(state);
  }
  assert.deepEqual(ids, ['response_line', 'trusted_line', 'end_trust_line']);
  assert.equal(engine.block(state).exit.ending, 'trust'); assert.deepEqual(engine.decode(JSON.stringify(engine.encode(state))), engine.replay(state.decisions, state.blockId, state.line));
});

function scriptFixture() {
  return { schema: 1, game: 'vm', version: 'v1', entry: 'start', variables: { known: { initial: false }, trust: { initial: 0, min: 0, max: 2 } }, blocks: [
    { id: 'start', cue: { background: 'room' }, lines: [{ id: 'l1', speaker: '甲', text: '选择', cue: { portrait: 'person' } }], exit: { type: 'choice', choices: [{ id: 'confirm', text: '确认', next: 'middle', effects: [{ op: 'set', key: 'known', value: true }, { op: 'add', key: 'trust', value: 1 }] }] } },
    { id: 'middle', lines: [{ id: 'l2', speaker: '甲', text: '再次确认' }], exit: { type: 'choice', choices: [{ id: 'confirm-again', text: '确认', next: 'route', effects: [{ op: 'set', key: 'known', value: true }] }] } },
    { id: 'route', lines: [], cue: { music: 'theme' }, exit: { type: 'branch', routes: [{ when: { known: true, trust: { gte: 1 } }, next: 'done' }, { next: 'other' }] } },
    { id: 'done', lines: [{ id: 'l3', speaker: '旁白', text: '完成' }], exit: { type: 'end', ending: 'done' } },
    { id: 'other', lines: [{ id: 'l4', speaker: '旁白', text: '另一结局' }], exit: { type: 'end', ending: 'other' } }
  ] };
}

test('VM boolean assignment is idempotent and persistent staging survives hidden routing and save replay', () => {
  const engine = new ScriptEngine(scriptFixture()); let state = engine.initial(); state = engine.choose(state, 'confirm'); state = engine.choose(state, 'confirm-again');
  assert.equal(state.variables.known, true); assert.equal(state.variables.trust, 1); assert.deepEqual(state.stage, { background: 'room', portrait: 'person', music: 'theme' });
  const saved = engine.encode(state); saved.state.variables = { known: false, trust: 999 }; saved.state.stage = { background: 'forged' }; saved.state.history = [];
  const restored = engine.decode(JSON.stringify(saved)); assert.equal(restored.variables.known, true); assert.deepEqual(restored.stage, state.stage);
  const driver = new ScriptDriver(engine); driver.restore(saved); assert.equal(driver.frame().ending, 'done'); assert.equal(driver.reread('0:l1'), true); assert.equal(driver.frame().lineId, 'l1');
});

test('VM rejects duplicate lines, unknown operators, bad effects, empty fallback and routing cycles', () => {
  for (const mutate of [
    data => { data.blocks[1].lines[0].id = 'l1'; },
    data => { data.blocks[2].exit.routes[0].when.trust = { execute: 'anything' }; },
    data => { data.blocks[0].exit.choices[0].effects[0] = { op: 'add', key: 'known', value: 1 }; },
    data => { data.blocks[2].exit.routes.at(-1).when = { known: false }; },
    data => { data.entry = 'route'; data.blocks[2].exit.routes[1].next = 'route'; }
  ]) { const fixture = scriptFixture(); mutate(fixture); assert.throws(() => new ScriptEngine(fixture)); }
});

test('VM saves reject other games, impossible positions and incorrect choice order', () => {
  const engine = new ScriptEngine(scriptFixture()), saved = engine.encode(engine.initial());
  assert.throws(() => engine.decode(JSON.stringify({ ...saved, game: 'other' })));
  assert.throws(() => engine.decode(JSON.stringify({ ...saved, state: { ...saved.state, blockId: 'done' } })));
  assert.throws(() => engine.replay([{ blockId: 'middle', choiceId: 'confirm-again' }], 'done', 0));
});

test('own investigation driver restores by legal action journal, rejecting fabricated chapter progress', () => {
  const engine = circuit(), driver = new InvestigationDriver('own-circuit', 'v1', engine);
  assert.equal(driver.supportsSkip, false); assert.equal(driver.act('reason'), false);
  for (const action of ['inspect-a', 'return', 'inspect-b', 'return', 'reason', 'right', '@chapter:chapter-two']) assert.equal(driver.act(action), true, action);
  const save = driver.save(), restored = new InvestigationDriver('own-circuit', 'v1', engine); restored.restore(save);
  assert.deepEqual(restored.frame(), driver.frame()); assert.equal(restored.reread('any'), false);
  const invalid = { ...save, journal: [{ type: 'chapter', id: 'chapter-two' }] }; assert.throws(() => restored.restore(invalid));
  assert.deepEqual(restored.frame(), driver.frame());
});

test('asset catalog resolves per-game bases and rejects external, encoded and escaping paths', () => {
  const catalog = new AssetCatalog([{ id: 'room', kind: 'background', src: 'assets/room.svg' }], 'https://example.test/game-one/');
  assert.equal(catalog.url('room', 'background'), 'https://example.test/game-one/assets/room.svg');
  assert.throws(() => catalog.url('room', 'audio'));
  for (const path of ['https://other.test/a', '//other.test/a', '../a', 'a/../b', '/root/a', 'a%2fb', 'a\\b', 'a?token=x', 'a#hash', 'a\u0000b']) assert.equal(localAssetPath(path), false, path);
  assert.throws(() => new AssetCatalog([{ id: 'room', kind: 'background', src: '../escape' }], 'https://example.test/game/'));
});

test('runtime setting imports clamp finite values and keep voice preferences independent', () => {
  const value = runtimeSettings({ textDelayMs: -1, autoDelayMs: Infinity, voiceVolume: 3, volume: .1, opacity: 0 });
  assert.equal(value.textDelayMs, 0); assert.equal(value.autoDelayMs, 1800); assert.equal(value.voiceVolume, 1); assert.equal(value.volume, .1); assert.equal(value.opacity, .25);
  assert.equal(value.masterVolume, 1); assert.equal(value.bgmVolume, .1); assert.equal(value.ambienceVolume, .1); assert.equal(value.seVolume, .1); assert.equal(value.videoVolume, .1);
  const mixer = runtimeSettings({ masterVolume: Infinity, volume: .2, seVolume: 5, bgmVolume: -.5 });
  assert.equal(mixer.masterVolume, 1); assert.equal(mixer.seVolume, 1); assert.equal(mixer.bgmVolume, 0); assert.equal(mixer.videoVolume, .2);
});
