import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog, NarrativeEngine, NarrativeDriver, RuntimeSession, MediaDirector } from '../dist/index.js';
import { tick } from './helpers.mjs';

function setup() {
  const engine = new NarrativeEngine({ game: 'media-runtime', storyVersion: 'v1', entry: 'a', stats: {}, scenes: [
    { id: 'a', lines: [{ id: 'a1', speaker: '甲', text: '播放测试' }, { id: 'a2', speaker: '甲', text: '另一段' }], ending: 'done' }
  ] });
  const driver = new NarrativeDriver(engine, { lines: { a1: { voice: 'voice', sound: 'cue' }, a2: { sound: 'cue' } } });
  const session = new RuntimeSession(driver, { settings: { textDelayMs: 0 } });
  const assets = new AssetCatalog([{ id: 'voice', kind: 'audio', src: 'voice.wav' }, { id: 'cue', kind: 'audio', src: 'cue.wav' }], 'https://example.test/game/');
  const players = [];
  const gains = [];
  const context = { state: 'running', destination: {}, resumes: 0, suspends: 0, createGain: () => {
    const node = { gain: { value: 1 }, connect() {}, disconnect() { this.disconnected = true; } }; gains.push(node); return node;
  },
    async resume() { this.resumes++; this.state = 'running'; }, async suspend() { this.suspends++; this.state = 'suspended'; } };
  const media = new MediaDirector(session, assets, { context, createAudio: src => {
    const player = { src, volume: 0, preload: '', paused: true, plays: 0, onended: null, onerror: null,
      async play() { this.plays++; this.paused = false; }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    players.push(player); return player;
  } });
  return { session, media, context, players, gains };
}

test('media director binds a visit once and stale UI ticks never repeat an effect', async () => {
  const { session, media, players } = setup(); await tick();
  assert.equal(players.filter(player => player.src.endsWith('cue.wav')).length, 1);
  session.configure({ opacity: .6 }); session.configure({ textDelayMs: 15 }); await tick();
  assert.equal(players.filter(player => player.src.endsWith('cue.wav')).length, 1);
  session.next(); await tick(); assert.equal(players.filter(player => player.src.endsWith('cue.wav')).length, 2);
  assert.equal(session.rollback(), true); await tick();
  assert.equal(players.filter(player => player.src.endsWith('cue.wav')).length, 2);
  assert.equal(players.filter(player => player.src.endsWith('voice.wav')).length, 2);
  const save = session.save(); session.restore(save); await tick();
  assert.equal(players.filter(player => player.src.endsWith('cue.wav')).length, 2);
  media.dispose(); session.dispose();
});

test('media restores playback after a panel, respects background pause and clears auto blocks at end', async () => {
  const { session, media, context, players } = setup(); await media.unlock(); await tick();
  assert.equal(session.getSnapshot().voiceBlocked, true);
  const voice = players.find(player => player.src.endsWith('voice.wav'));
  session.pause('panel', true); assert.equal(voice.paused, true); assert.equal(context.state, 'suspended');
  session.pause('panel', false); await tick(); assert.equal(context.state, 'running'); assert.equal(voice.paused, false);
  session.pause('background', true); await tick(); assert.equal(voice.paused, true);
  session.pause('background', false); await tick(); voice.onended(); assert.equal(session.getSnapshot().voiceBlocked, false);
  media.dispose(); session.dispose();
});

test('media disposal releases players and subscriptions and cannot resurrect a stopped voice', async () => {
  const { session, media, players } = setup(); await tick(); media.dispose();
  assert.equal(players.every(player => player.paused), true); assert.equal(session.getSnapshot().voiceBlocked, false);
  const count = players.length; session.configure({ volume: .5 }); await media.unlock(); await tick(); assert.equal(players.length, count); session.dispose();
});

test('master and independent channels adjust current players without repeating cues or voice', async () => {
  const { session, media, players, gains } = setup(); await tick();
  const count = players.length, plays = players.map(player => player.plays);
  session.configure({ masterVolume: .5, bgmVolume: .2, ambienceVolume: .3, seVolume: .4, voiceVolume: .6 });
  assert.deepEqual(gains.map(node => node.gain.value), [.5, .2, .3]);
  assert.equal(players.find(player => player.src.endsWith('voice.wav')).volume, .3);
  assert.equal(players.find(player => player.src.endsWith('cue.wav')).volume, .2);
  assert.equal(players.length, count); assert.deepEqual(players.map(player => player.plays), plays);
  session.configure({ music: false }); assert.equal(gains[1].gain.value, 0); assert.equal(gains[2].gain.value, .3);
  session.configure({ ambience: false }); assert.equal(gains[2].gain.value, 0);
  session.configure({ ambience: true }); assert.equal(gains[2].gain.value, .3);
  session.configure({ masterVolume: 0 }); assert.equal(gains[0].gain.value, 0); assert.ok(players.every(player => player.volume === 0));
  session.configure({ volume: .7 }); assert.equal(session.getView().settings.bgmVolume, .7); assert.equal(session.getView().settings.videoVolume, .7);
  assert.equal(session.getView().settings.voiceVolume, .6); assert.equal(session.getView().settings.masterVolume, 0);
  assert.equal(players.length, count); media.dispose(); assert.ok(gains.every(node => node.disconnected)); session.dispose();
});
