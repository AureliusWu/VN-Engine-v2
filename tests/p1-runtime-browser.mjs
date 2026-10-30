import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/p1-runtime';
await mkdir(output, { recursive: true });
const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const checks = [], errors = []; let browser;
const svg = label => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#173d45"/><text x="32" y="80" fill="white">${label}</text></svg>`;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  const mount = async (options = {}) => page.evaluate(async options => {
    globalThis.vnDemo?.dispose(); globalThis.p1Game?.dispose();
    const api = await import('./lib/index.js'), game = 'p1-resource-browser';
    const assets = ['a', 'b', 'c', 'slow', 'fresh'].map(id => ({ id, kind: 'background', src: `assets/p1-${id}.svg` }));
    const lines = options.retry ? ['a', 'a', 'b'] : ['a', 'b', 'c'];
    const project = { schema: 1, game, version: '1', title: 'P1 有界资源计划', type: 'script', assets, settings: { textDelayMs: 0 },
      program: { schema: 1, game, version: '1', entry: 'start', variables: {}, blocks: options.branch ? [
        { id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '选择分支', cue: { background: 'a' } }], exit: { type: 'choice', choices: [{ id: 'old', text: '旧分支', next: 'old' }, { id: 'new', text: '新分支', next: 'new' }] } },
        { id: 'old', lines: [{ id: 'old-line', speaker: '旁白', text: '过期资源', cue: { background: 'slow' } }], exit: { type: 'end', ending: 'old' } },
        { id: 'new', lines: [{ id: 'new-line', speaker: '旁白', text: '当前资源', cue: { background: 'fresh' } }], exit: { type: 'end', ending: 'new' } }
      ] : [{ id: 'start', lines: lines.map((asset, i) => ({ id: 'line-' + i, speaker: '旁白', text: '资源窗口 ' + i, cue: { background: asset } })), exit: { type: 'end', ending: 'done' } }] } };
    globalThis.p1Game = api.mountGame(document.getElementById('game'), project, { storage: null, prefetch: options.enabled ? {
      maxConcurrent: 1, maxQueued: 8, maxTransferBytes: options.cap ?? 4096, maxBytes: 8192,
      plan: { maxDepth: 2, maxVisits: options.visits ?? 1, maxAssets: 8 }
    } : false });
  }, options);
  const snapshot = () => page.evaluate(() => p1Game.resourceSnapshot());
  const imageReady = () => page.waitForFunction(() => document.querySelector('.vn-background')?.naturalWidth > 0 && !document.querySelector('.vn-background').hidden);
  const count = { a: 0, b: 0, c: 0, slow: 0, fresh: 0 };
  await page.route('**/assets/p1-*.svg', route => {
    const id = /p1-(\w+)\.svg/.exec(route.request().url())[1]; count[id]++;
    return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: svg(id) });
  });
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };

  await check('Default disabled: plans are read-only and do not fetch candidates or unlock audio', async () => {
    await mount(); await imageReady(); const before = count.b;
    const plan = await snapshot(); assert.equal(plan.enabled, false); assert.equal(plan.cache, null);
    assert.ok(plan.plan.candidates.some(item => item.assetId === 'b')); assert.ok(plan.plan.active.some(item => item.assetId === 'a'));
    await page.waitForTimeout(100); assert.equal(count.b, before); assert.equal(await page.evaluate(() => p1Game.audioActive), false);
  });
  await check('Prefetched encoded bytes are reused by the real renderer, pinned and bounded', async () => {
    const before = count.b; await mount({ enabled: true });
    await page.waitForFunction(() => p1Game.resourceSnapshot().cache.ready === 1);
    assert.equal(count.b, before + 1); const save = await page.evaluate(() => p1Game.session.save());
    await page.evaluate(() => p1Game.session.next()); await imageReady();
    assert.equal(await page.locator('.vn-background').getAttribute('src').then(value => value.startsWith('blob:')), true);
    assert.equal(count.b, before + 1); const state = await snapshot();
    assert.ok(state.cache.resources.find(item => item.assetId === 'b')?.pinned);
    assert.ok(state.cache.bytes + state.cache.reservedBytes <= 8192);
    assert.equal(await page.evaluate(() => p1Game.audioActive), false);
    await page.evaluate(save => p1Game.session.restore(save), save); assert.deepEqual(await page.evaluate(() => p1Game.session.save()), save);
    await page.screenshot({ path: output + '/prefetched-player.png', fullPage: true });
  });
  await check('Changing branch cancels delayed stale candidates and keeps the destination visible', async () => {
    let release, started;
    const requested = new Promise(resolve => { started = resolve; });
    await page.route('**/assets/p1-slow.svg', async route => { started(); await new Promise(resolve => { release = resolve; }); await route.fulfill({ contentType: 'image/svg+xml', body: svg('slow') }).catch(() => {}); });
    await mount({ enabled: true, branch: true, visits: 8 }); await requested;
    await page.evaluate(() => p1Game.session.act('new')); await imageReady(); release();
    await page.waitForFunction(() => p1Game.resourceSnapshot().cache.loading === 0);
    const state = await snapshot(); assert.ok(state.cache.cancelled >= 1); assert.ok(!state.cache.resources.some(item => item.assetId === 'slow'));
    assert.equal(await page.evaluate(() => p1Game.session.getView().frame.sceneId), 'new');
    await page.unroute('**/assets/p1-slow.svg');
  });
  await check('Failures retry on a new visit, never on settings or typing notifications', async () => {
    let calls = 0;
    await page.route('**/assets/p1-b.svg', route => { calls++; return route.fulfill({ status: calls === 1 ? 503 : 200, contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: calls === 1 ? 'temporary' : svg('b') }); });
    await mount({ enabled: true, retry: true, visits: 4 }); await page.waitForFunction(() => p1Game.resourceSnapshot().cache.failed === 1);
    await page.evaluate(() => { for (let i = 0; i < 8; i++) p1Game.session.configure({ opacity: .5 + i * .01 }); });
    assert.equal(calls, 1); await page.evaluate(() => p1Game.session.next());
    await page.waitForFunction(() => p1Game.resourceSnapshot().cache.ready === 1); assert.equal(calls, 2);
    await page.evaluate(() => p1Game.session.next()); await imageReady(); assert.equal(calls, 2);
    await page.unroute('**/assets/p1-b.svg');
  });
  await check('Oversized speculation is rejected while normal foreground loading still works', async () => {
    const requests = [];
    await page.route('**/assets/p1-b.svg', route => { requests.push(route.request().resourceType()); return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: svg('b') + '<!--' + 'x'.repeat(1024) + '-->' }); });
    await mount({ enabled: true, cap: 256 }); await page.waitForFunction(() => p1Game.resourceSnapshot().cache.failed === 1);
    assert.equal((await snapshot()).cache.bytes, 0); await page.evaluate(() => p1Game.session.next()); await imageReady();
    await page.waitForFunction(() => document.querySelector('.vn-background').src.includes('p1-b.svg'));
    // Existing renderer probes an image before assigning the visible element. no-store
    // may require both requests; only the single speculative fetch is budgeted here.
    assert.equal(requests.filter(type => type === 'fetch').length, 1);
    assert.ok(requests.filter(type => type === 'image').length >= 1);
    assert.ok(!(await page.locator('.vn-background').getAttribute('src')).startsWith('blob:'));
    await page.unroute('**/assets/p1-b.svg');
  });
  await check('Hidden mount cancels speculation and disposal releases cached bytes and URLs', async () => {
    await mount({ enabled: true }); await page.waitForFunction(() => p1Game.resourceSnapshot().cache.ready === 1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: true } })));
    assert.equal((await snapshot()).cache.paused, true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: false } })));
    assert.equal((await snapshot()).cache.paused, false);
    await page.evaluate(() => p1Game.dispose()); const state = (await snapshot()).cache;
    assert.equal(state.disposed, true); assert.equal(state.bytes, 0); assert.equal(state.ready, 0);
  });
  assert.deepEqual(errors, []); await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'PASS', checks, errors, count, browser: await browser.version() }, null, 2) + '\n');
} catch (error) {
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'FAIL', checks, errors, failure: error.stack }, null, 2) + '\n'); throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
