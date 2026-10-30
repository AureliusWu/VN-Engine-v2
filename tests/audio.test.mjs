import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneLoop, RecordedVoice, voiceBlocksAuto, voiceFor } from '../dist/index.js';
import { tick } from './helpers.mjs';

function loopSetup() {
  const sources = [];
  const context = { state: 'running', currentTime: 0, decodes: 0,
    decodeAudioData: async () => { context.decodes++; return { length: 441000, numberOfChannels: 2 }; },
    createBufferSource() { const source = { starts: 0, stops: 0, connect: node => node, disconnect() {}, start() { source.starts++; }, stop() { source.stops++; } }; sources.push(source); return source; },
    createGain: () => ({ connect: node => node, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} } })
  };
  return { context, sources, loop: new SceneLoop(context, {}) };
}
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });

test('scene changes cancel downloads and cannot start late obsolete responses', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const requests = [];
  globalThis.fetch = (_url, options) => new Promise(resolve => requests.push({ signal: options.signal, resolve }));
  const { loop, context, sources } = loopSetup(); t.after(() => loop.dispose());
  loop.select('/old.ogg'); loop.select('/new.ogg');
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(response()); await tick(); assert.equal(context.decodes, 0);
  requests[1].resolve(response()); await tick(); assert.equal(sources.length, 1);
  loop.select(undefined); assert.equal(sources[0].stops, 1);
});

test('decoded music is bounded by track count and the combined PCM byte budget', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  let downloads = 0; globalThis.fetch = async () => { downloads++; return response(); };
  const { loop, context } = loopSetup(); t.after(() => loop.dispose());
  for (const url of ['/a', '/b', '/c', '/b']) { loop.select(url); await tick(); }
  assert.equal(downloads, 3);
  loop.select('/a'); await tick(); assert.equal(downloads, 4);
  context.decodeAudioData = async () => ({ length: 5 * 1024 * 1024, numberOfChannels: 1 });
  for (const url of ['/large-a', '/large-b', '/large-a']) { loop.select(url); await tick(); }
  assert.equal(downloads, 7);
});

test('stable track identities reuse decoded bytes across temporary URL changes without restarting current playback', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const downloads = []; globalThis.fetch = async url => { downloads.push(url); return response(); };
  const { loop, context, sources } = loopSetup(); t.after(() => loop.dispose());
  loop.select('blob:a-first', undefined, '/music/a.wav'); await tick();
  loop.select('blob:a-renewed', undefined, '/music/a.wav'); await tick();
  assert.equal(sources.length, 1); assert.equal(sources[0].stops, 0);
  assert.equal(context.decodes, 1); assert.deepEqual(downloads, ['blob:a-first']);
  loop.select('blob:b-first', undefined, '/music/b.wav'); await tick();
  loop.select('blob:a-returned', undefined, '/music/a.wav'); await tick();
  assert.equal(context.decodes, 2); assert.equal(sources.length, 3);
  assert.deepEqual(downloads, ['blob:a-first', 'blob:b-first']);
  loop.select('blob:c', undefined, '/music/c.wav'); await tick();
  loop.select('blob:b-returned', undefined, '/music/b.wav'); await tick();
  assert.equal(context.decodes, 4); // The original two-track LRU still evicts B after A then C.
  context.decodeAudioData = async () => { context.decodes++; return { length: 5 * 1024 * 1024, numberOfChannels: 1 }; };
  for (const [url, identity] of [['blob:large-a', '/large-a'], ['blob:large-b', '/large-b'], ['blob:large-a-return', '/large-a']]) {
    loop.select(url, undefined, identity); await tick();
  }
  assert.equal(downloads.length, 7); // Two 20 MiB entries still exceed the unchanged 32 MiB budget.
});

test('pending requests merge by stable track identity while real selection changes cancel stale downloads', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, signal: options.signal, resolve }));
  const { loop, context, sources } = loopSetup(); t.after(() => loop.dispose());
  loop.select('blob:pending-a', undefined, '/music/a.wav');
  loop.select('blob:renewed-a', undefined, '/music/a.wav');
  assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve(response()); await tick();
  assert.equal(context.decodes, 1); assert.equal(sources.length, 1);
  loop.select('blob:shared-transport', undefined, '/music/b.wav');
  loop.select('blob:shared-transport', undefined, '/music/c.wav');
  assert.equal(requests.length, 3); assert.equal(requests[1].signal.aborted, true);
  requests[1].resolve(response()); await tick(); assert.equal(context.decodes, 1);
  requests[2].resolve(response()); await tick(); assert.equal(context.decodes, 2); assert.equal(sources.length, 2);
});

test('cancelled decode cannot populate a new scene and dispose prevents retries', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  let downloads = 0; globalThis.fetch = async () => { downloads++; return response(); };
  const { loop, context, sources } = loopSetup();
  let finish; context.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  loop.select('/old'); await tick();
  const oldFinish = finish; loop.select('/new'); await tick();
  oldFinish({ length: 1, numberOfChannels: 1 }); await tick(); assert.equal(sources.length, 0);
  finish({ length: 1, numberOfChannels: 1 }); await tick(); assert.equal(sources.length, 1);
  loop.dispose(); loop.select('/old'); await tick(); assert.equal(downloads, 2);
});

test('missing tracks never block the story and can be retried', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  globalThis.fetch = async () => ({ ok: false });
  const { loop, sources } = loopSetup(); t.after(() => loop.dispose());
  loop.select('/missing'); await tick(); assert.equal(sources.length, 0);
  globalThis.fetch = async () => response(); await loop.ensure(); assert.equal(sources.length, 1);
  loop.select('/missing'); await tick(); assert.equal(sources.length, 1);
});

const clip = { id: 'v1', lineId: 'line-1', speaker: '甲', text: '声音', src: '/v1.ogg' };
function voiceSetup() {
  const players = [];
  const voice = new RecordedVoice(() => {
    const player = { volume: 0, preload: '', paused: true, onended: null, onerror: null,
      async play() { player.paused = false; }, pause() { player.paused = true; }, removeAttribute() {}, load() {} };
    players.push(player); return player;
  });
  voice.configure(true, .6, true, true, false);
  return { voice, players };
}

test('voice plays once per visit, waits for completion, and preserves manual pauses', async () => {
  const { voice, players } = voiceSetup(); voice.enter(clip, 'visit-1');
  assert.equal(voiceBlocksAuto(voice.getState()), true); await tick();
  assert.equal(voice.getState().status, 'playing'); assert.equal(players[0].volume, .6);
  voice.enter(clip, 'visit-1'); assert.equal(players.length, 1);
  voice.pause(); voice.configure(true, .6, true, false, false); voice.configure(true, .6, true, true, false); await tick();
  assert.equal(voice.getState().userPaused, true);
  assert.equal(voice.getState().status, 'paused');
  voice.resume(); await tick(); players[0].onended();
  assert.equal(voice.getState().status, 'ended'); assert.equal(voiceBlocksAuto(voice.getState()), false); voice.stop();
});

test('a late play promise cannot take over a new line, and browser blocks recover', async () => {
  const { voice, players } = voiceSetup(); voice.enter(clip, '1'); await tick();
  let finish; players[0].play = () => new Promise(resolve => { finish = resolve; });
  voice.pause(); voice.resume();
  voice.enter({ ...clip, id: 'v2' }, '2'); await tick(); finish(); await tick();
  assert.equal(players[0].paused, true); assert.equal(voice.getState().clip.id, 'v2');
  players[1].play = async () => { throw new DOMException('gesture', 'NotAllowedError'); };
  voice.pause(); voice.resume(); await tick(); assert.equal(voice.getState().status, 'blocked');
  players[1].play = async () => {}; voice.unlock(); await tick(); assert.equal(voice.getState().status, 'playing');
  players[1].onerror(); assert.equal(voiceBlocksAuto(voice.getState()), false); voice.stop();
});

test('history replay stops on panel close and hidden lines wait for visibility', async () => {
  const { voice, players } = voiceSetup(); voice.configure(true, 1, false, true, true); voice.replay(clip, true); await tick();
  assert.equal(voice.getState().status, 'playing');
  voice.configure(true, 1, true, true, false); assert.equal(voice.getState().status, 'idle'); assert.equal(players[0].paused, true);
  voice.configure(true, 1, true, false, false); voice.enter(clip, 'hidden'); await tick(); assert.equal(players[1].paused, true);
  voice.configure(true, 1, true, true, false); await tick(); assert.equal(voice.getState().status, 'playing'); voice.stop();
});

test('recordings bind exact variants by stable ID or legacy coordinates, rejecting ambiguity', () => {
  const variant = { ...clip, id: 'v2', text: '变体' };
  assert.equal(voiceFor([clip, variant], { id: 'line-1', speaker: '甲', text: '变体' }).id, 'v2');
  assert.equal(voiceFor([clip], { id: 'other', speaker: '甲', text: '声音' }), undefined);
  assert.equal(voiceFor([clip, clip], { id: 'line-1', speaker: '甲', text: '声音' }), undefined);
  const legacy = { ...clip, sceneId: 'scene', lineIndex: 2 };
  assert.equal(voiceFor([legacy], { speaker: '甲', text: '声音' }, { sceneId: 'scene', line: 2 }), legacy);
});
