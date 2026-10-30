import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/resource-audio';
await mkdir(output, { recursive: true });
const server = await createDemoServer(); await listenBrowserServer(server);
const checks = [], errors = [], runs = []; let browser;
const wav = await readFile(new URL('../examples/runtime/assets/music-test.wav', import.meta.url));
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/resource-audio-*.wav', route => route.fulfill({ contentType: 'audio/wav', headers: { 'Cache-Control': 'no-store' }, body: wav }));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(() => {
    globalThis.vnDemo?.dispose();
    globalThis.resourceAudioMetrics = { decodes: 0, starts: 0, stops: 0, urls: new Set(), contexts: new Set() };
    const decode = AudioContext.prototype.decodeAudioData, createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.decodeAudioData = function(...args) {
      resourceAudioMetrics.contexts.add(this); resourceAudioMetrics.decodes++; return decode.apply(this, args);
    };
    AudioContext.prototype.createBufferSource = function(...args) {
      const source = createSource.apply(this, args), start = source.start, stop = source.stop;
      source.start = function(...values) { resourceAudioMetrics.starts++; return start.apply(this, values); };
      source.stop = function(...values) { resourceAudioMetrics.stops++; return stop.apply(this, values); };
      return source;
    };
    const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
    URL.createObjectURL = function(...args) { const url = createURL.apply(this, args); resourceAudioMetrics.urls.add(url); return url; };
    URL.revokeObjectURL = function(url) { resourceAudioMetrics.urls.delete(url); return revokeURL.call(this, url); };
  });
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };
  for (const enabled of [false, true]) await check(`${enabled ? 'Prefetched' : 'Original URL'} BGM and ambience reuse decoded A after A → B → A`, async () => {
    const before = await page.evaluate(() => ({ decodes: resourceAudioMetrics.decodes, starts: resourceAudioMetrics.starts }));
    await page.evaluate(async enabled => {
      const { mountGame } = await import('./lib/index.js'), game = 'resource-audio-browser';
      const project = { schema: 1, game, version: '1', title: '音乐缓存复用', type: 'script', settings: { textDelayMs: 0 },
        assets: ['music-a', 'music-b', 'ambience-a', 'ambience-b'].map(id => ({ id, kind: 'audio', src: `assets/resource-audio-${id}.wav` })),
        program: { schema: 1, game, version: '1', entry: 'start', variables: {}, blocks: [{ id: 'start',
          lines: [null, 'a', 'b', 'a'].map((track, i) => ({ id: 'line-' + i, speaker: '旁白', text: '音乐窗口 ' + i,
            cue: { music: track ? 'music-' + track : null, ambience: track ? 'ambience-' + track : null } })), exit: { type: 'end', ending: 'done' } }] } };
      globalThis.resourceAudioGame = mountGame(document.getElementById('game'), project, { storage: null,
        prefetch: enabled ? { maxConcurrent: 2, maxQueued: 8, maxTransferBytes: 65536, maxBytes: 1048576, plan: { maxVisits: 8, maxAssets: 16 } } : false });
    }, enabled);
    if (enabled) await page.waitForFunction(() => resourceAudioGame.resourceSnapshot().cache.ready === 4);
    await page.getByRole('button', { name: '启用声音', exact: true }).click();
    const phases = [], run = { enabled, phases }; runs.push(run);
    for (let step = 1; step <= 3; step++) {
      await page.evaluate(() => resourceAudioGame.session.next());
      await page.waitForFunction(expected => resourceAudioMetrics.starts >= expected, before.starts + step * 2);
      phases.push(await page.evaluate(before => ({ decodes: resourceAudioMetrics.decodes - before.decodes, starts: resourceAudioMetrics.starts - before.starts,
        musicURL: resourceAudioGame.assets.url(resourceAudioGame.session.getView().frame.stage.music),
        ambienceURL: resourceAudioGame.assets.url(resourceAudioGame.session.getView().frame.stage.ambience),
        activeURLs: [...resourceAudioMetrics.urls], cache: resourceAudioGame.resourceSnapshot().cache }), before));
    }
    assert.deepEqual(phases.map(item => item.decodes), [2, 4, 4]);
    assert.deepEqual(phases.map(item => item.starts), [2, 4, 6]);
    if (enabled) {
      assert.ok(phases[0].musicURL.startsWith('blob:')); assert.ok(phases[0].ambienceURL.startsWith('blob:'));
      assert.notEqual(phases[0].musicURL, phases[2].musicURL); assert.notEqual(phases[0].ambienceURL, phases[2].ambienceURL);
      assert.ok(!phases[1].activeURLs.includes(phases[0].musicURL)); assert.ok(!phases[1].activeURLs.includes(phases[0].ambienceURL));
      assert.ok(phases.every(item => item.cache.ready === 4 && item.cache.bytes === wav.byteLength * 4));
    }
    await page.evaluate(() => resourceAudioGame.dispose());
    await page.waitForFunction(() => [...resourceAudioMetrics.contexts].every(context => context.state === 'closed'));
    assert.equal(await page.evaluate(() => resourceAudioMetrics.urls.size), 0);
    if (enabled) { const cache = await page.evaluate(() => resourceAudioGame.resourceSnapshot().cache); assert.equal(cache.ready, 0); assert.equal(cache.bytes, 0); assert.equal(cache.disposed, true); }
  });
  await check('A refreshed temporary URL for the same stable track preserves the current real source', async () => {
    const result = await page.evaluate(async () => {
      const { SceneLoop } = await import('./lib/index.js');
      const bytes = await (await fetch('assets/resource-audio-music-a.wav')).arrayBuffer();
      const first = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), second = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const context = new AudioContext(), bus = context.createGain(); bus.connect(context.destination); await context.resume();
      const loop = new SceneLoop(context, bus);
      try {
        loop.select(first, undefined, 'stable-music-a'); await loop.ensure();
        const before = { decodes: resourceAudioMetrics.decodes, starts: resourceAudioMetrics.starts, stops: resourceAudioMetrics.stops };
        URL.revokeObjectURL(first); loop.select(second, undefined, 'stable-music-a'); await loop.ensure();
        return { before, after: { decodes: resourceAudioMetrics.decodes, starts: resourceAudioMetrics.starts, stops: resourceAudioMetrics.stops } };
      } finally { loop.dispose(); bus.disconnect(); URL.revokeObjectURL(first); URL.revokeObjectURL(second); await context.close(); }
    });
    runs.push({ sameIdentity: result }); assert.deepEqual(result.after, result.before);
    assert.equal(await page.evaluate(() => resourceAudioMetrics.urls.size), 0);
  });
  assert.deepEqual(errors, []);
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'PASS', checks, runs, errors, browser: await browser.version() }, null, 2) + '\n');
} catch (error) {
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'FAIL', checks, runs, errors, failure: error.stack }, null, 2) + '\n'); throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
