import { listenBrowserServer } from '../tools/browser-server.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await listenBrowserServer(server);
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(() => vnDemo.dispose());
  const mount = async ({ path = 'assets/test-video.webm', muted = true, reduced = false, loop = false, store = false } = {}) => page.evaluate(async ({ path, muted, reduced, loop, store }) => {
    const { mountGame } = await import('./lib/index.js'); globalThis.videoGame?.dispose();
    const project = { schema: 1, game: 'video-fixture', version: 'v1', title: 'Video fixture', type: 'narrative', settings: { textDelayMs: 0, reducedMotion: reduced },
      assets: [{ id: 'clip', kind: 'video', src: path }, { id: 'fallback', kind: 'cg', src: 'assets/letter.svg' }],
      stage: { lines: { one: { video: { asset: 'clip', fallback: { asset: 'fallback', kind: 'cg' }, muted, loop } } } },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: 'Narrator', text: 'video start' }, { id: 'two', speaker: 'Narrator', text: 'story continues' }], ending: 'done' }] };
    globalThis.videoGame = mountGame(document.getElementById('game'), project, { audio: false, storage: store ? localStorage : null });
  }, { path, muted, reduced, loop, store });
  await mount();
  const video = page.locator('.vn-video'), fallback = page.locator('.vn-video-fallback');
  await video.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('.vn-video').currentTime > .1);
  assert.equal(await video.evaluate(node => node.muted), true);
  await page.evaluate(() => videoGame.session.configure({ volume: .7 })); assert.equal(await video.evaluate(node => node.volume), .7);
  await page.evaluate(() => videoGame.session.hide(true)); const pausedAt = await video.evaluate(node => node.currentTime);
  await page.waitForTimeout(180); assert.ok(Math.abs((await video.evaluate(node => node.currentTime)) - pausedAt) < .06);
  await page.evaluate(() => videoGame.session.hide(false));
  await page.waitForFunction(time => document.querySelector('.vn-video').currentTime > time + .1, pausedAt);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: true } })));
  assert.equal(await video.evaluate(node => node.paused), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: false } })));
  await video.waitFor({ state: 'hidden', timeout: 7000 }); assert.equal(await fallback.isHidden(), true);
  assert.equal(await video.getAttribute('src'), null);
  await mount({ loop: true }); await page.waitForFunction(() => document.querySelector('.vn-video').currentTime > .1);
  await page.waitForTimeout(2300); assert.equal(await video.isVisible(), true); assert.equal(await video.evaluate(node => node.loop && !node.ended), true);
  await mount({ path: 'assets/missing-video.webm', store: true }); await fallback.waitFor({ state: 'visible' });
  assert.match(await page.locator('.vn-status').innerText(), /视频暂时无法播放/);
  assert.deepEqual(await page.evaluate(() => videoGame.meta.read().value.cg_unlocked), ['fallback']);
  await page.locator('.vn-actions [data-control=next]').click(); assert.equal(await page.evaluate(() => videoGame.session.getSnapshot().frame.lineId), 'two');
  assert.equal(await fallback.isHidden(), true);
  await page.route('**/assets/bad-video.webm', route => route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from('invalid media bytes') }));
  await mount({ path: 'assets/bad-video.webm' }); await fallback.waitFor({ state: 'visible' });
  await page.unroute('**/assets/bad-video.webm');
  await mount({ reduced: true }); await fallback.waitFor({ state: 'visible' }); assert.equal(await video.isHidden(), true);
  await mount(); await page.evaluate(() => { const save = videoGame.session.save(); videoGame.session.restore(save); });
  await fallback.waitFor({ state: 'visible' }); assert.equal(await video.isHidden(), true);
  const skipped = await page.evaluate(() => { videoGame.session.restart(); const accepted = videoGame.session.setSkip(true); return { accepted, asset: document.querySelector('.vn-video-fallback').dataset.asset }; });
  assert.deepEqual(skipped, { accepted: true, asset: 'fallback' });
  await mount(); await page.waitForFunction(() => document.querySelector('.vn-video').currentTime > .05);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fallback.waitFor({ state: 'visible' });
  await mount(); await fallback.waitFor({ state: 'visible' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { window.originalVideoPlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); });
  await mount({ muted: false }); await fallback.waitFor({ state: 'visible' }); assert.equal(await video.isHidden(), true);
  await page.evaluate(() => { HTMLMediaElement.prototype.play = () => new Promise((resolve, reject) => { window.rejectOldPlay = reject; }); });
  await mount(); await page.evaluate(() => { videoGame.session.next(); rejectOldPlay(new Error('late failure')); });
  await page.waitForTimeout(100); assert.equal(await fallback.isHidden(), true);
  assert.doesNotMatch(await page.locator('.vn-status').innerText(), /视频暂时无法播放/);
  await page.evaluate(() => { HTMLMediaElement.prototype.play = originalVideoPlay; videoGame.dispose(); });
  assert.equal(await page.locator('.vn-engine').count(), 0); assert.deepEqual(errors, []);
  console.log('PASS Real video playback, pause, end, failure fallback, skip, reduced motion and stale rejection cleanup');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
