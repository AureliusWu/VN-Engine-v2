import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';
import { listenBrowserServer } from '../tools/browser-server.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/p3-runtime';
await mkdir(output, { recursive: true });
const source = await readFile(new URL('../examples/dsl/stage.vn.txt', import.meta.url), 'utf8');
const project = JSON.parse(await readFile(new URL('../examples/runtime/stage.json', import.meta.url), 'utf8'));
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const server = await createDemoServer(); await listenBrowserServer(server);
const checks = [], results = [], errors = []; let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block', reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(() => {
    globalThis.vnDemo?.dispose();
    globalThis.p3Audio = { decodes: 0, starts: 0, stops: 0, contexts: new Set(), players: [] };
    const decode = AudioContext.prototype.decodeAudioData, createSource = AudioContext.prototype.createBufferSource, play = HTMLMediaElement.prototype.play;
    AudioContext.prototype.decodeAudioData = function(...args) { p3Audio.contexts.add(this); p3Audio.decodes++; return decode.apply(this, args); };
    AudioContext.prototype.createBufferSource = function(...args) {
      const node = createSource.apply(this, args), start = node.start, stop = node.stop;
      node.start = function(...values) { p3Audio.starts++; return start.apply(this, values); };
      node.stop = function(...values) { p3Audio.stops++; return stop.apply(this, values); };
      return node;
    };
    HTMLMediaElement.prototype.play = function(...args) {
      if (this.tagName === 'AUDIO') {
        let entry = p3Audio.players.find(item => item.player === this);
        if (!entry) {
          entry = { player: this, src: this.src, attempts: 0, events: [] }; p3Audio.players.push(entry);
          for (const type of ['playing', 'pause', 'ended', 'error']) this.addEventListener(type, () => entry.events.push({ type, currentTime: this.currentTime }));
        }
        entry.attempts++;
      }
      return play.apply(this, args);
    };
    globalThis.p3Storage = () => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]));
    localStorage.setItem('vn-engine:vn-stage-dsl:v2:manual-1', 'preexisting original manual slot');
    localStorage.setItem('vn-engine:vn-stage-dsl:v2:auto', 'preexisting original auto slot');
    localStorage.setItem('vn-stage-dsl:original:persistent', 'preexisting native persistent bytes');
    globalThis.p3StorageBefore = p3Storage();
  });
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };
  const mount = async (options = {}) => page.evaluate(async ({ source, project, options }) => {
    globalThis.p3Game?.dispose();
    const api = await import('./lib/index.js'), text = await import('./lib/script/text.js');
    const compiled = text.compileTextScript(source, { fileName: 'examples/dsl/stage.vn.txt' });
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const checked = text.checkTextScriptProject(compiled, project);
    if (!checked.ok) throw Error(JSON.stringify(checked.diagnostics));
    const mounted = { ...project, program: checked.program, settings: { ...project.settings, ...(options.typing ? { textDelayMs: 1000 } : {}) } };
    const sourceText = JSON.stringify(mounted, null, 2) + '\n';
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceText))), value => value.toString(16).padStart(2, '0')).join('');
    const collector = new api.RuntimeEvidence({ sessionId: 'p3-runtime-browser', sourceSha256: sha, maxEvents: 1024, maxBytes: 262144 });
    globalThis.p3Fixture = { api, project: mounted, checked, collector, sourceSha256: sha,
      audioBefore: { decodes: p3Audio.decodes, starts: p3Audio.starts, playerCount: p3Audio.players.length } };
    globalThis.p3Game = api.mountGame(document.getElementById('game'), mounted, { storage: null, evidence: collector });
    if (options.paused) { p3Game.session.pause('p3-panel', true); p3Game.session.pause('p3-background', true); }
    return { program: checked.program, cueCount: checked.sourceMap.filter(item => item.kind === 'cue').length, context: checked.projectContext, engineVersion: api.ENGINE_VERSION };
  }, { source, project, options });
  const proof = () => page.evaluate(() => ({ report: p3Fixture.api.createRuntimeEvidenceReport(p3Fixture.project, p3Fixture.collector.snapshot(), p3Fixture.sourceSha256,
    { runtime: true, media: p3Game.audioActive, audioDevice: false }),
    audio: { decodes: p3Audio.decodes - p3Fixture.audioBefore.decodes, starts: p3Audio.starts - p3Fixture.audioBefore.starts,
      contexts: [...p3Audio.contexts].map(context => context.state),
      players: p3Audio.players.slice(p3Fixture.audioBefore.playerCount).map(item => ({ src: item.src, attempts: item.attempts, events: item.events,
        paused: item.player.paused, currentTime: item.player.currentTime, ended: item.player.ended, error: item.player.error?.code ?? null })) },
    view: { lineId: p3Game.session.getView().frame.lineId, visit: p3Game.session.getView().visit, reason: p3Game.session.getView().reason },
    storage: p3Storage() }));
  const imageReady = (selector, asset) => page.waitForFunction(({ selector, asset }) => {
    const image = document.querySelector(selector); return image?.dataset.asset === asset && image.naturalWidth > 0 && !image.hidden;
  }, { selector, asset });
  const unchangedStorage = async () => assert.equal(await page.evaluate(() => JSON.stringify(p3Storage()) === JSON.stringify(p3StorageBefore)), true);

  await check('Compiled 17-cue sample retains exact IR, visible assets and the authored hold across nested pause scopes', async () => {
    const checked = await mount({ paused: true }); assert.deepEqual(checked.program, project.program); assert.equal(checked.cueCount, 17); assert.equal(checked.context.checked, true);
    await imageReady('.vn-background', 'classroom'); await imageReady('.vn-portrait', 'student');
    await page.waitForTimeout(180);
    const paused = await page.evaluate(() => ({ next: p3Game.session.next(), ready: p3Game.session.getView().ready, reasons: p3Game.session.getView().pauseReasons }));
    assert.equal(paused.next, false); assert.equal(paused.ready, false); assert.deepEqual(paused.reasons.sort(), ['p3-background', 'p3-panel']);
    await page.evaluate(() => p3Game.session.pause('p3-panel', false)); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => p3Game.session.getView().ready), false);
    assert.equal(await page.evaluate(() => { p3Game.session.pause('p3-background', false); return p3Game.session.next(); }), false);
    await page.waitForFunction(() => p3Game.session.getView().ready);
    assert.equal(await page.evaluate(() => p3Game.session.getView().frame.lineId), 'hello');
    assert.equal(await page.evaluate(() => p3Game.audioActive), false);
    const evidence = await proof(); results.push({ case: 'compile-hold-images', checked, ...evidence });
    assert.ok(evidence.report.events.some(item => item.effect === 'stage.effect' && item.phase === 'started'));
    await unchangedStorage(); await page.screenshot({ path: output + '/compiled-stage.png', fullPage: true });
  });

  await check('Real BGM, ambience, voice and SE start in Chromium; nested pauses freeze typing and resume the same voice', async () => {
    await mount({ paused: true, typing: true }); await page.getByRole('button', { name: '启用声音', exact: true }).click();
    await page.evaluate(() => { p3Game.session.pause('p3-panel', false); p3Game.session.pause('p3-background', false); });
    await page.waitForFunction(() => ['stage.music', 'stage.ambience', 'stage.voice', 'stage.sound'].every(effect => p3Fixture.collector.snapshot().events.some(item => item.effect === effect && item.phase === 'started')), null, { timeout: 15000 });
    const paused = await page.evaluate(() => {
      const voice = p3Audio.players.slice(p3Fixture.audioBefore.playerCount).find(item => item.src.endsWith('/voice-test.wav'));
      p3Game.session.pause('p3-panel', true); p3Game.session.pause('p3-background', true);
      return { time: voice.player.currentTime, text: p3Game.session.getView().text, full: p3Game.session.getView().frame.text, count: p3Audio.players.length };
    });
    await page.waitForFunction(() => [...p3Audio.contexts].every(context => context.state !== 'running'));
    await page.waitForTimeout(150);
    const frozen = await page.evaluate(() => {
      const voice = p3Audio.players.slice(p3Fixture.audioBefore.playerCount).find(item => item.src.endsWith('/voice-test.wav'));
      return { time: voice.player.currentTime, paused: voice.player.paused, text: p3Game.session.getView().text, next: p3Game.session.next() };
    });
    assert.ok(paused.text.length < paused.full.length); assert.equal(frozen.text, paused.text); assert.equal(frozen.paused, true); assert.equal(frozen.next, false);
    assert.ok(Math.abs(frozen.time - paused.time) < .03);
    await page.screenshot({ path: output + '/paused-media.png', fullPage: true });
    await page.evaluate(() => p3Game.session.pause('p3-panel', false));
    assert.equal(await page.evaluate(() => p3Game.session.getView().paused), true);
    await page.evaluate(() => p3Game.session.pause('p3-background', false));
    await page.waitForFunction(() => [...p3Audio.contexts].some(context => context.state === 'running'));
    const reveal = await page.evaluate(() => { const before = p3Game.session.getView().visit; const accepted = p3Game.session.next(); return { accepted, before, after: p3Game.session.getView().visit, lineId: p3Game.session.getView().frame.lineId }; });
    assert.equal(reveal.accepted, true); assert.equal(reveal.before, reveal.after); assert.equal(reveal.lineId, 'hello');
    await page.waitForFunction(() => ['stage.voice', 'stage.sound'].every(effect => p3Fixture.collector.snapshot().events.some(item => item.effect === effect && item.phase === 'settled')), null, { timeout: 15000 });
    const evidence = await proof(); results.push({ case: 'real-audio-pause', paused, frozen, reveal, ...evidence });
    assert.equal(evidence.audio.decodes, 2); assert.equal(evidence.audio.starts, 2);
    assert.equal(evidence.audio.players.filter(item => item.src.endsWith('/voice-test.wav')).length, 1);
    assert.equal(evidence.audio.players.filter(item => item.src.endsWith('/cue.wav')).length, 1);
    assert.ok(evidence.audio.players.every(item => item.events.some(event => event.type === 'playing') && item.error === null));
    assert.ok(evidence.report.events.some(item => item.effect === 'stage.voice' && item.phase === 'paused'));
    assert.ok(evidence.report.events.some(item => item.effect === 'stage.voice' && item.phase === 'started' && item.attempt >= 2));
    assert.equal(evidence.report.events.some(item => item.type === 'effect' && ['failed', 'blocked'].includes(item.phase)), false);
    await unchangedStorage();
  });

  await check('Both routes clear durable cues; save, restore and rollback reconstruct state without replaying SE or past effects', async () => {
    await mount(); await page.getByRole('button', { name: '启用声音', exact: true }).click();
    await page.waitForFunction(() => p3Game.session.getView().ready && ['stage.voice', 'stage.sound'].every(effect => p3Fixture.collector.snapshot().events.some(item => item.effect === effect && item.phase === 'settled')), null, { timeout: 15000 });
    const initial = await page.evaluate(() => p3Game.session.save());
    await page.getByRole('button', { name: '下一段', exact: true }).click();
    assert.equal(await page.evaluate(() => p3Game.session.getView().frame.lineId), 'question');
    await page.getByRole('button', { name: '继续演出', exact: true }).click();
    await imageReady('.vn-background', 'bedroom'); await imageReady('.vn-cg', 'letter');
    const good = await page.evaluate(() => ({ stage: p3Game.session.getView().frame.stage, ending: p3Game.session.getView().frame.ending,
      save: p3Game.session.save(), variables: new p3Fixture.api.ScriptEngine(p3Fixture.checked.program).decode(JSON.stringify(p3Game.session.save())).variables }));
    assert.equal(good.ending, 'good'); assert.equal(good.variables.trust, 1); assert.equal(good.stage.portrait, null); assert.equal(good.stage.music, null); assert.equal(good.stage.ambience, null);
    await page.waitForFunction(() => p3Fixture.collector.snapshot().events.some(item => item.effect === 'stage.effect' && item.lineId === 'done' && item.phase === 'settled'));
    await page.screenshot({ path: output + '/good-route.png', fullPage: true });
    const originalEffects = await page.evaluate(() => p3Fixture.collector.snapshot().events.filter(item => ['stage.sound', 'stage.effect'].includes(item.effect) && item.phase === 'started').length);
    assert.equal(await page.evaluate(() => p3Game.session.rollback(2)), true);
    assert.deepEqual(await page.evaluate(() => p3Game.session.save()), initial);
    await imageReady('.vn-background', 'classroom'); await imageReady('.vn-portrait', 'student');
    await page.waitForFunction(() => p3Game.session.getView().ready);
    await page.getByRole('button', { name: '下一段', exact: true }).click(); await page.getByRole('button', { name: '安静离开', exact: true }).click();
    const quiet = await page.evaluate(() => ({ stage: p3Game.session.getView().frame.stage, ending: p3Game.session.getView().frame.ending, save: p3Game.session.save() }));
    assert.equal(quiet.ending, 'neutral'); assert.equal(quiet.stage.background, 'classroom'); assert.equal(quiet.stage.portrait, null); assert.equal(quiet.stage.music, null); assert.equal(quiet.stage.ambience, null);
    assert.equal(await page.locator('.vn-portrait').isHidden(), true);
    await page.screenshot({ path: output + '/neutral-route.png', fullPage: true });
    await page.evaluate(saved => p3Game.session.restore(saved), initial);
    assert.deepEqual(await page.evaluate(() => p3Game.session.save()), initial);
    const evidence = await proof(); results.push({ case: 'routes-reconstruction', good, quiet, ...evidence });
    const effects = evidence.report.events;
    assert.equal(effects.filter(item => ['stage.sound', 'stage.effect'].includes(item.effect) && item.phase === 'started').length, originalEffects);
    for (const reason of ['rollback', 'restore']) for (const effect of ['stage.sound', 'stage.effect'])
      assert.ok(effects.some(item => item.reason === reason && item.effect === effect && item.phase === 'suppressed'), `${effect} suppressed on ${reason}`);
    assert.equal(evidence.audio.players.filter(item => item.src.endsWith('/cue.wav')).length, 1);
    await page.evaluate(saved => p3Game.session.restore(saved), quiet.save);
    assert.deepEqual(await page.evaluate(() => p3Game.session.save()), quiet.save);
    await page.evaluate(() => { p3Game.persistence.saveManual(1); p3Game.persistence.quickSave(); p3Game.readProgress.flush(); });
    await unchangedStorage();
  });

  await check('Disposal closes actual audio graphs, clears audio sources and preserves preexisting local storage', async () => {
    await page.evaluate(() => p3Game.dispose());
    await page.waitForFunction(() => [...p3Audio.contexts].every(context => context.state === 'closed'));
    const cleanup = await page.evaluate(() => ({ contexts: [...p3Audio.contexts].map(context => context.state),
      players: p3Audio.players.map(item => ({ paused: item.player.paused, source: item.player.getAttribute('src'), error: item.player.error?.code ?? null })),
      disposed: p3Fixture.collector.snapshot().events.some(item => item.type === 'lifecycle' && item.reason === 'dispose') }));
    assert.ok(cleanup.contexts.length >= 2); assert.ok(cleanup.players.every(item => item.paused && item.source === null && item.error === null)); assert.equal(cleanup.disposed, true);
    results.push({ case: 'cleanup', ...cleanup }); await unchangedStorage();
  });
  assert.deepEqual(errors, []);
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'PASS', browser: await browser.version(), checks, results, errors, sourceSha256,
    scope: { actualChromium: true, actualAudioContext: true, actualHTMLAudio: true, mockedMedia: false, physicalListening: false, nativeWindowsInput: false, playerStorage: null } }, null, 2) + '\n');
} catch (error) {
  if (page) { await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {}); const diagnostic = await proofForFailure(page); results.push({ case: 'failure-state', diagnostic }); }
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'FAIL', checks, results, errors, sourceSha256, failure: error.stack }, null, 2) + '\n'); throw error;
} finally { await page?.evaluate(() => globalThis.p3Game?.dispose()).catch(() => {}); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

async function proofForFailure(page) {
  return page.evaluate(() => ({ events: globalThis.p3Fixture?.collector.snapshot().events, view: globalThis.p3Game?.session.getSnapshot(),
    audio: globalThis.p3Audio ? { decodes: p3Audio.decodes, starts: p3Audio.starts, players: p3Audio.players.map(item => ({ src: item.src, events: item.events, paused: item.player.paused, currentTime: item.player.currentTime })) } : null })).catch(error => ({ readError: error.message }));
}
