import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/v1-render';
await mkdir(output, { recursive: true });
const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const checks = [], failures = [], errors = [], releases = new Set();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 }, serviceWorkers: 'block', reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  const mount = async ({ effect, reducedMotion = false, images = false, first = 'recover', second = first, typing = false } = {}) => page.evaluate(async values => {
    window.vnDemo?.dispose(); window.v1RenderGame?.dispose(); const { mountGame } = await import('./lib/index.js');
    const assets = values.images ? [
      { id: 'recover', kind: 'background', src: 'assets/v1-recover.svg' },
      { id: 'slow', kind: 'background', src: 'assets/v1-slow.svg' },
      { id: 'fresh', kind: 'background', src: 'assets/v1-fresh.svg' }
    ] : [];
    const one = { ...(values.effect ? { effect: { type: values.effect, durationMs: 2000 } } : {}), ...(values.images ? { background: values.first } : {}) };
    const two = values.images ? { background: values.second } : {};
    window.v1RenderGame = mountGame(document.getElementById('game'), { schema: 1, game: 'v1-render-regression', version: 'v1',
      title: 'v1.0 render lifecycle', type: 'narrative', assets, settings: { textDelayMs: values.typing ? 10 : 0, reducedMotion: values.reducedMotion },
      stage: { lines: { one, two, three: two } }, scenes: [{ id: 'start', lines: [
        { id: 'one', speaker: '旁白', text: '图片失败后，打字刷新不应产生请求风暴。'.repeat(8) },
        { id: 'two', speaker: '旁白', text: '进入下一次真实访问后可以重新载入画面。' },
        { id: 'three', speaker: '旁白', text: '已载入的同一资源继续复用。' }
      ], ending: 'done' }] }, { audio: false, storage: null });
  }, { effect, reducedMotion, images, first, second, typing });
  const check = async (name, run) => {
    try { await run(); checks.push(name); console.log('PASS', name); }
    catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, error.message); await page.screenshot({ path: `${output}/failure-${failures.length}.png` }); }
  };
  const animationState = () => page.evaluate(() => {
    const stage = document.querySelector('.vn-stage'), effect = document.querySelector('.vn-effect');
    return { animations: [...stage.getAnimations(), ...effect.getAnimations()].map(animation => animation.playState), background: effect.style.background };
  });
  const effectsStopped = () => page.waitForFunction(() => document.querySelector('.vn-stage').getAnimations().length === 0
    && document.querySelector('.vn-effect').getAnimations().length === 0 && document.querySelector('.vn-effect').style.background === 'transparent', null, { timeout: 3000 });

  await check('Initial OS reduced-motion preference suppresses real flash, fade and shake WAAPI effects', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const effect of ['flash', 'fade', 'shake']) {
      await mount({ effect }); assert.deepEqual(await animationState(), { animations: [], background: 'transparent' });
    }
  });

  await check('Changing OS reduced motion cancels running or panel-paused effects and clears their overlay', async () => {
    for (const effect of ['flash', 'fade', 'shake']) {
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await mount({ effect });
      assert.equal((await animationState()).animations.length, 1);
      if (effect === 'fade') await page.evaluate(() => v1RenderGame.session.pause('panel', true));
      await page.emulateMedia({ reducedMotion: 'reduce' }); await effectsStopped();
      await page.evaluate(() => v1RenderGame.session.pause('panel', false)); await effectsStopped();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.deepEqual(await animationState(), { animations: [], background: 'transparent' });
    }
  });

  await check('Normal effects still pause and resume; player and OS motion preferences combine without replaying a consumed effect', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await mount({ effect: 'fade' });
    await page.evaluate(() => v1RenderGame.session.pause('panel', true));
    const paused = await page.locator('.vn-effect').evaluate(async node => {
      const animation = node.getAnimations()[0]; await animation.ready; const before = animation.currentTime;
      await new Promise(resolve => setTimeout(resolve, 40)); return { before, after: animation.currentTime, state: animation.playState };
    });
    assert.equal(paused.state, 'paused'); assert.equal(paused.before, paused.after);
    await page.evaluate(() => v1RenderGame.session.pause('panel', false)); assert.deepEqual((await animationState()).animations, ['running']);
    await page.evaluate(() => v1RenderGame.session.configure({ reducedMotion: true })); await effectsStopped();
    await page.evaluate(() => v1RenderGame.session.configure({ reducedMotion: false })); await effectsStopped();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => v1RenderGame.session.restart()); await effectsStopped();
    await page.evaluate(() => v1RenderGame.session.configure({ reducedMotion: true })); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => v1RenderGame.session.restart()); await effectsStopped();
    await page.evaluate(() => { v1RenderGame.session.configure({ reducedMotion: false }); v1RenderGame.session.restart(); });
    assert.equal((await animationState()).animations.length, 1);
  });

  await check('A failed image retries on a new visit, never on typing or settings ticks, and a successful image stays cached', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' }); let requests = 0;
    const bytes = await readFile('examples/runtime/assets/bedroom.svg');
    await page.route('**/assets/v1-recover.svg', async route => {
      requests++; await route.fulfill({ status: requests === 1 ? 503 : 200, contentType: 'image/svg+xml', body: requests === 1 ? 'temporary image failure' : bytes });
    });
    try {
      await mount({ images: true, typing: true });
      await page.waitForFunction(() => document.querySelector('.vn-status').textContent.includes('画面资源未能载入'), null, { timeout: 3000 });
      await page.waitForFunction(() => v1RenderGame.session.getView().text.length >= 8);
      await page.evaluate(() => { for (let i = 0; i < 8; i++) v1RenderGame.session.configure({ opacity: .4 + i * .04 }); });
      assert.equal(requests, 1); assert.equal(await page.locator('.vn-background').isHidden(), true);
      await page.evaluate(() => { v1RenderGame.session.configure({ textDelayMs: 0 }); v1RenderGame.session.next(); });
      await page.waitForFunction(() => !document.querySelector('.vn-background').hidden && document.querySelector('.vn-background').naturalWidth > 0, null, { timeout: 3000 });
      assert.ok(requests >= 2); const loadedRequests = requests;
      await page.evaluate(() => v1RenderGame.session.next());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(requests, loadedRequests); assert.equal(await page.locator('.vn-background').isVisible(), true);
      await page.screenshot({ path: output + '/image-recovered.png', fullPage: true });
    } finally { await page.unroute('**/assets/v1-recover.svg'); }
  });

  await check('Late image success cannot replace a newer visit or resurrect a disposed renderer', async () => {
    const fresh = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="teal"/></svg>');
    const stale = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>');
    let started, release, finished;
    await page.route('**/assets/v1-fresh.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: fresh }));
    await page.route('**/assets/v1-slow.svg', async route => {
      started?.(); await new Promise(resolve => { release = resolve; releases.add(resolve); });
      try { await route.fulfill({ contentType: 'image/svg+xml', body: stale }); } catch { /* A cancelled probe is expected. */ }
      finally { releases.delete(release); finished?.(); }
    });
    const startHeld = async () => {
      const began = new Promise(resolve => { started = resolve; }); const done = new Promise(resolve => { finished = resolve; });
      await mount({ images: true, first: 'slow', second: 'fresh' }); await began; return { done, release };
    };
    try {
      let held = await startHeld(); await page.evaluate(() => v1RenderGame.session.next());
      await page.waitForFunction(() => document.querySelector('.vn-background').naturalWidth === 64);
      held.release(); await held.done; await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.deepEqual(await page.locator('.vn-background').evaluate(node => [node.dataset.asset, node.naturalWidth]), ['fresh', 64]);
      held = await startHeld(); await page.evaluate(() => v1RenderGame.dispose()); held.release(); await held.done;
      await page.evaluate(() => new Promise(requestAnimationFrame)); assert.equal(await page.locator('.vn-engine').count(), 0);
    } finally { for (const resolve of releases) resolve(); await page.unroute('**/assets/v1-slow.svg'); await page.unroute('**/assets/v1-fresh.svg'); }
  });

  await page.evaluate(() => window.v1RenderGame?.dispose());
  await writeFile(output + '/v1-render-browser.json', JSON.stringify({ status: failures.length || errors.length ? 'FAIL' : 'PASS', browser: await browser.version(),
    mode: 'headless', osMotionPreference: 'browser emulation, not a user OS settings change', checks, failures, errors }, null, 2) + '\n');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
} finally { for (const resolve of releases) resolve(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
