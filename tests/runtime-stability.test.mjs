import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NarrativeEngine, NarrativeDriver, RuntimeSession, MediaDirector, AssetCatalog } from '../dist/index.js';
import { tick } from './helpers.mjs';

function fixture({ settings = {}, clock, context, createAudio, beforeMedia } = {}) {
  const engine = new NarrativeEngine({ game: 'stability', storyVersion: 'v1', entry: 'one', stats: {}, scenes: [
    { id: 'one', lines: [{ id: 'first', speaker: '甲', text: '第一段' }, { id: 'second', speaker: '甲', text: '第二段' }], ending: 'done' }
  ] });
  const driver = new NarrativeDriver(engine, { lines: { first: { voice: 'voice', sound: 'cue' }, second: { voice: 'voice-next' } } });
  const session = new RuntimeSession(driver, { clock, settings: { textDelayMs: 0, music: false, ...settings } });
  const assets = new AssetCatalog(['voice', 'voice-next', 'cue'].map(id => ({ id, kind: 'audio', src: id + '.wav' })), 'https://example.test/game/');
  const players = [], errors = [];
  const graph = context ?? { state: 'running', destination: {}, createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }), async suspend() { this.state = 'suspended'; }, async resume() { this.state = 'running'; } };
  const factory = src => {
    const player = { src, paused: true, volume: 0, onended: null, onerror: null, plays: 0,
      async play() { this.plays++; this.paused = false; }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    players.push(player); return player;
  };
  beforeMedia?.(session);
  const media = new MediaDirector(session, assets, { context: graph, createAudio: createAudio ?? factory, onError: message => errors.push(message) });
  return { session, assets, media, graph, players, errors, dispose() { media.dispose(); session.dispose(); } };
}

test('turning voice off and back on restores the same paragraph recording', async t => {
  const env = fixture({ settings: { voiceEnabled: false } }); t.after(() => env.dispose());
  assert.equal(env.players.filter(player => player.src.endsWith('/voice.wav')).length, 0);
  env.session.configure({ voiceEnabled: true }); await tick();
  const player = env.players.find(player => player.src.endsWith('/voice.wav'));
  assert.ok(player, 'same-visit voice must be created after re-enabling'); assert.equal(player.paused, false);
  env.session.configure({ voiceEnabled: false }); assert.equal(player.paused, true);
  env.session.configure({ voiceEnabled: true }); await tick();
  assert.equal(env.players.filter(player => player.src.endsWith('/voice.wav')).length, 2);
});

test('late audio suspension reconciles a panel that has already closed', async t => {
  let finishSuspend, resumes = 0;
  const context = { state: 'running', destination: {}, createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    suspend() { return new Promise(resolve => { finishSuspend = () => { context.state = 'suspended'; resolve(); }; }); },
    async resume() { resumes++; this.state = 'running'; } };
  const env = fixture({ context }); t.after(() => env.dispose()); await env.media.unlock();
  env.session.pause('panel', true); env.session.pause('panel', false);
  finishSuspend(); await tick();
  assert.equal(context.state, 'running', 'a late suspend must not leave a visible reader silent'); assert.equal(resumes, 1);
});

test('sound effects follow live volume and stop immediately when disabled', async t => {
  const env = fixture({ settings: { voiceEnabled: false } }); t.after(() => env.dispose()); await tick();
  const effect = env.players.find(player => player.src.endsWith('/cue.wav')); assert.ok(effect);
  env.session.configure({ volume: .7 }); assert.equal(effect.volume, .7);
  env.session.configure({ soundEffects: false }); assert.equal(effect.paused, true);
});

test('audio factory failure keeps the session usable without an auto-play lock', () => {
  let env;
  assert.doesNotThrow(() => { env = fixture({ createAudio() { throw new Error('media unavailable'); } }); });
  try { assert.equal(env.session.getSnapshot().voiceBlocked, false); assert.equal(env.session.next(), true); assert.ok(env.errors.length > 0); }
  finally { env.dispose(); }
});

test('a reentrant visit change supersedes audio setup before the old play promise settles', t => {
  let advanced = false;
  const env = fixture({ beforeMedia: session => session.subscribe(() => {
    const state = session.getSnapshot(); if (!advanced && state.voiceBlocked) { advanced = true; session.next(); }
  }) }); t.after(() => env.dispose());
  assert.equal(env.session.getSnapshot().frame.lineId, 'second');
  assert.ok(env.players.some(player => player.src.endsWith('/voice-next.wav')), 'the latest visit must be consumed immediately');
});

test('asset metadata and deployment base remain isolated from caller mutations', () => {
  const asset = { id: 'font', kind: 'font', src: 'font.woff2', license: { name: 'OFL', src: 'OFL.txt' } };
  const catalog = new AssetCatalog([asset], 'https://example.test/game/');
  asset.license.src = 'changed-input';
  catalog.get('font').license.src = 'changed-output';
  catalog.list()[0].license.src = 'changed-list';
  catalog.baseURL.pathname = '/other/';
  assert.equal(catalog.get('font').license.src, 'OFL.txt'); assert.equal(catalog.url('font'), 'https://example.test/game/font.woff2');
});

test('immutable views are cached while public snapshots remain detached mutable copies', t => {
  const env = fixture(); t.after(() => env.dispose());
  const first = env.session.getView(); assert.equal(env.session.getView(), first);
  assert.throws(() => { first.frame.text = 'changed'; }, TypeError);
  assert.throws(() => first.frame.actions.push({ id: 'forged' }), TypeError);
  assert.throws(() => { first.settings.opacity = 0; }, TypeError);
  const copy = env.session.getSnapshot(); copy.frame.text = 'changed'; copy.settings.opacity = 0;
  assert.equal(env.session.getView(), first); assert.equal(env.session.getSnapshot().frame.text, '第一段');
  env.session.configure({ opacity: first.settings.opacity }); assert.equal(env.session.getView(), first);
  env.session.next(); assert.notEqual(env.session.getView().frame, first.frame); assert.equal(first.frame.text, '第一段');
});

test('typing publishes new text views while sharing the same protected frame', t => {
  let serial = 0; const tasks = new Map();
  const clock = { now: () => 0, set(callback) { const id = ++serial; tasks.set(id, callback); return id; }, clear: id => tasks.delete(id) };
  const env = fixture({ clock, settings: { textDelayMs: 10, voiceEnabled: false, soundEffects: false } }); t.after(() => env.dispose());
  const initial = env.session.getView(); assert.equal(initial.text, '');
  const [id, run] = tasks.entries().next().value; tasks.delete(id); run();
  const typed = env.session.getView(); assert.notEqual(typed, initial); assert.equal(typed.frame, initial.frame); assert.equal(typed.text, '第');
  assert.equal(initial.text, ''); assert.equal(env.session.getSnapshot().text, '第');
});

test('a non-transitioning audio context reports failure without a retry loop', async t => {
  let attempts = 0;
  const context = { state: 'suspended', destination: {}, createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    async resume() { attempts++; }, async suspend() {} };
  const env = fixture({ context }); t.after(() => env.dispose());
  await env.media.unlock(); await tick(); assert.equal(attempts, 1); assert.ok(env.errors.length > 0);
});
