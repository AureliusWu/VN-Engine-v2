import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog, NarrativeEngine, NarrativeDriver, RuntimeSession, MediaDirector } from '../dist/index.js';
import { tick } from './helpers.mjs';

function setup(options = {}) {
  const engine = new NarrativeEngine({ game: 'media-runtime', storyVersion: 'v1', entry: 'a', stats: {}, scenes: [
    { id: 'a', lines: [{ id: 'a1', speaker: '甲', text: '播放测试' }, { id: 'a2', speaker: '甲', text: '另一段' }], ending: 'done' }
  ] });
  const driver = new NarrativeDriver(engine, { lines: { a1: { voice: 'voice', sound: 'cue' }, a2: { sound: 'cue' } } });
  const session = new RuntimeSession(driver, { settings: { textDelayMs: 0, ...options.settings }, initialPause: options.initialPause });
  const assets = new AssetCatalog([{ id: 'voice', kind: 'audio', src: 'voice.wav' }, { id: 'cue', kind: 'audio', src: 'cue.wav' }], 'https://example.test/game/');
  const players = [], errors = [];
  const gains = [];
  const context = { state: 'running', destination: {}, resumes: 0, suspends: 0, createGain: () => {
    const node = { gain: { value: 1 }, connect() {}, disconnect() { this.disconnected = true; } }; gains.push(node); return node;
  },
    async resume() { this.resumes++; this.state = 'running'; }, async suspend() { this.suspends++; this.state = 'suspended'; } };
  const media = new MediaDirector(session, assets, { context, onError: message => errors.push(message), createAudio: src => {
    const player = { src, volume: 0, preload: '', paused: true, ended: false, currentTime: 0, plays: 0, onended: null, onerror: null,
      play() { this.plays++; this.paused = false; return options.play?.(this) ?? Promise.resolve(); }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    players.push(player); return player;
  } });
  return { session, media, context, players, gains, errors };
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

test('unfinished sound effects resume at the same position after nested panel, background and hidden pauses', async t => {
  const { session, media, players } = setup(); t.after(() => { media.dispose(); session.dispose(); });
  await media.unlock(); await tick();
  const effect = players.find(player => player.src.endsWith('cue.wav')); effect.currentTime = .45;
  session.pause('panel', true); session.pause('background', true);
  assert.equal(effect.paused, true); assert.equal(effect.plays, 1);
  session.pause('panel', false); await tick(); assert.equal(effect.paused, true);
  session.pause('background', false); await tick();
  assert.equal(effect.paused, false); assert.equal(effect.currentTime, .45); assert.equal(effect.plays, 2);
  session.configure({ seVolume: .4 }); session.configure({ opacity: .6 }); await tick(); assert.equal(effect.plays, 2);
  session.hide(true); assert.equal(effect.paused, true); session.hide(false); await tick();
  assert.equal(effect.paused, false); assert.equal(effect.currentTime, .45); assert.equal(effect.plays, 3);
  assert.equal(players.filter(player => player.src.endsWith('cue.wav')).length, 1);
});

test('ended, disabled, restored and disposed sound effects cannot restart after a pause', async t => {
  const env = setup(); t.after(() => { env.media.dispose(); env.session.dispose(); });
  await env.media.unlock(); await tick();
  const effect = env.players.find(player => player.src.endsWith('cue.wav'));
  env.session.pause('panel', true); effect.ended = true;
  env.session.pause('panel', false); await tick(); assert.equal(effect.plays, 1); assert.equal(effect.paused, true);
  env.session.next(); await tick(); const next = env.players.filter(player => player.src.endsWith('cue.wav')).at(-1);
  env.session.pause('panel', true); env.session.configure({ soundEffects: false }); env.session.configure({ soundEffects: true });
  env.session.pause('panel', false); await tick(); assert.equal(next.plays, 1); assert.equal(next.paused, true);
  env.session.restore(env.session.save()); env.session.pause('panel', true); env.session.pause('panel', false); await tick();
  assert.equal(env.players.filter(player => player.src.endsWith('cue.wav')).length, 2);
  env.media.dispose(); env.session.hide(true); env.session.hide(false); await env.media.unlock(); assert.equal(next.plays, 1);
});

test('a late rejected effect resume cannot stop or report an error for a newer visit', async t => {
  let rejectResume;
  const env = setup({ play: player => player.src.endsWith('cue.wav') && player.plays === 2
    ? new Promise((resolve, reject) => { rejectResume = reject; }) : Promise.resolve() });
  t.after(() => { env.media.dispose(); env.session.dispose(); }); await env.media.unlock(); await tick();
  const first = env.players.find(player => player.src.endsWith('cue.wav'));
  env.session.pause('panel', true); env.session.pause('panel', false);
  assert.equal(typeof rejectResume, 'function'); env.session.next();
  const current = env.players.filter(player => player.src.endsWith('cue.wav')).at(-1);
  rejectResume(new Error('old resume failed')); await tick();
  assert.equal(first.paused, true); assert.equal(current.paused, false); assert.equal(current.plays, 1); assert.deepEqual(env.errors, []);
});

test('a late successful effect resume stays paused and current resume failures remain recoverable', async t => {
  let finishResume;
  const env = setup({ play: player => player.src.endsWith('cue.wav') && player.plays === 2
    ? new Promise(resolve => { finishResume = () => { player.paused = false; resolve(); }; }) : Promise.resolve() });
  t.after(() => { env.media.dispose(); env.session.dispose(); }); await env.media.unlock(); await tick();
  const effect = env.players.find(player => player.src.endsWith('cue.wav'));
  env.session.pause('panel', true); env.session.pause('panel', false); env.session.hide(true);
  assert.equal(typeof finishResume, 'function'); finishResume(); await tick(); assert.equal(effect.paused, true);
  env.session.hide(false); await tick(); assert.equal(effect.paused, false); assert.equal(effect.plays, 3);
  env.session.pause('panel', true); effect.play = () => Promise.reject(new Error('cannot resume'));
  env.session.pause('panel', false); await tick(); assert.equal(effect.paused, true); assert.equal(env.errors.length, 1);
  assert.equal(env.session.next(), true); assert.equal(env.players.filter(player => player.src.endsWith('cue.wav')).length, 2);
});

test('a first-visit effect waits for title and panel pauses, then starts once and resumes the same player', async t => {
  const env = setup({ initialPause: 'title', settings: { voiceEnabled: false } });
  t.after(() => { env.media.dispose(); env.session.dispose(); });
  const effects = () => env.players.filter(player => player.src.endsWith('cue.wav'));
  await env.media.unlock(); assert.equal(effects().length, 0);
  env.session.restart(); env.session.pause('panel', true); env.session.pause('title', false);
  await tick(); assert.equal(effects().length, 0);
  env.session.pause('panel', false); await tick();
  assert.equal(effects().length, 1); const effect = effects()[0]; assert.equal(effect.plays, 1);
  effect.currentTime = .35; env.session.configure({ opacity: .6 }); env.session.configure({ seVolume: .4 });
  assert.equal(effect.plays, 1);
  env.session.pause('panel', true); env.session.pause('panel', false); await tick();
  assert.equal(effects().length, 1); assert.equal(effect.plays, 2); assert.equal(effect.currentTime, .35);
  effect.ended = true; effect.onended(); env.session.pause('panel', true); env.session.pause('panel', false); await tick();
  assert.equal(effects().length, 1); assert.equal(effect.plays, 2);
});

test('pending effects are cancelled by disable, restore, reread and disposal before playback', async t => {
  for (const boundary of ['disabled', 'restore', 'reread', 'dispose']) await t.test(boundary, async () => {
    const env = setup({ initialPause: 'title', settings: { voiceEnabled: false } });
    try {
      if (boundary === 'disabled') { env.session.configure({ soundEffects: false }); env.session.configure({ soundEffects: true }); }
      if (boundary === 'restore') env.session.restore(env.session.save());
      if (boundary === 'reread') assert.equal(env.session.reread(env.session.history()[0].id), true);
      if (boundary === 'dispose') env.media.dispose();
      env.session.pause('title', false); await env.media.unlock(); await tick();
      assert.equal(env.players.filter(player => player.src.endsWith('cue.wav')).length, 0);
    } finally { env.media.dispose(); env.session.dispose(); }
  });
});

test('only the latest pending visit can start and rollback does not replay its effect', async t => {
  const env = setup({ initialPause: 'title', settings: { voiceEnabled: false } });
  t.after(() => { env.media.dispose(); env.session.dispose(); });
  env.session.restart(); env.session.restart(); env.session.pause('title', false); await tick();
  const effects = () => env.players.filter(player => player.src.endsWith('cue.wav'));
  assert.equal(effects().length, 1);
  env.session.next(); await tick(); assert.equal(effects().length, 2); assert.equal(effects()[0].paused, true);
  assert.equal(env.session.rollback(), true); env.session.pause('panel', true); env.session.pause('panel', false); await tick();
  assert.equal(effects().length, 2); assert.equal(effects()[1].paused, true);
});

test('a failed deferred effect is consumed and cannot be recreated by later settings or pauses', async t => {
  const env = setup({ initialPause: 'title', settings: { voiceEnabled: false }, play: () => Promise.reject(new Error('decode failed')) });
  t.after(() => { env.media.dispose(); env.session.dispose(); });
  env.session.pause('title', false); await tick();
  assert.equal(env.players.length, 1); assert.equal(env.players[0].plays, 1); assert.equal(env.errors.length, 1);
  env.session.pause('panel', true); env.session.configure({ seVolume: .5 }); env.session.pause('panel', false);
  env.session.configure({ soundEffects: false }); env.session.configure({ soundEffects: true }); await tick();
  assert.equal(env.players.length, 1); assert.equal(env.players[0].plays, 1); assert.equal(env.errors.length, 1);
});
