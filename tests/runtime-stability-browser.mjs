import { listenBrowserServer } from '../tools/browser-server.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await listenBrowserServer(server);
const checks = [], errors = []; let browser;
const passed = message => { checks.push(message); console.log('PASS', message); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');

  const failure = await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); globalThis.vnDemo.dispose();
    const root = document.getElementById('game'), nativeSet = window.setTimeout, nativeClear = window.clearTimeout, live = new Set();
    window.setTimeout = (callback, delay, ...args) => { const id = nativeSet(() => { live.delete(id); callback(...args); }, delay); live.add(id); return id; };
    window.clearTimeout = id => { live.delete(id); nativeClear(id); };
    let threw = false;
    try { mountGame(root, { schema: 1, game: 'invalid-font', version: 'v1', title: 'invalid', type: 'narrative', font: 'missing', assets: [],
      scenes: [{ id: 'start', lines: [{ id: 'line', speaker: '旁白', text: '启动失败后不应留下计时器' }], ending: 'done' }] }, { audio: false, storage: null }); }
    catch { threw = true; }
    finally { window.setTimeout = nativeSet; window.clearTimeout = nativeClear; }
    return { threw, timers: live.size, elements: root.childElementCount };
  });
  assert.deepEqual(failure, { threw: true, timers: 0, elements: 0 });
  passed('Failed mount releases the session timer and leaves no partial renderer');

  const legacy = await page.evaluate(async () => {
    const { createProject, DOMRenderer } = await import('./lib/index.js');
    const root = document.getElementById('game'), project = { schema: 1, game: 'direct-renderer', version: 'v1', title: 'direct', type: 'narrative', assets: [],
      settings: { textDelayMs: 0 }, scenes: [{ id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '第一段' }, { id: 'two', speaker: '旁白', text: '第二段' }], ending: 'done' }] };
    const { session, assets } = createProject(project, new URL('./', location.href));
    const renderer = new DOMRenderer(root, session, assets, { storage: localStorage });
    renderer.element.querySelector('[data-control=save]').click(); session.next();
    renderer.element.querySelector('[data-control=load]').click();
    const result = { line: session.getSnapshot().frame.lineId, oldSlot: !!localStorage.getItem('vn-engine:direct-renderer:save:1'), quickHidden: renderer.element.querySelector('[data-control=quick-save]').hidden };
    renderer.dispose(); session.dispose(); return result;
  });
  assert.deepEqual(legacy, { line: 'one', oldSlot: true, quickHidden: true });
  passed('Direct DOMRenderer callers retain the legacy single-slot save API');

  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); const root = document.getElementById('game');
    globalThis.optimizedGame = mountGame(root, { schema: 1, game: 'chat-stability', version: 'v1', title: '聊天稳定性', type: 'narrative', assets: [],
      settings: { textDelayMs: 0, voiceEnabled: false, music: false }, scenes: [{ id: 'chat', noSprite: true, lines: [
        { id: 'old-one', speaker: '甲', text: '第一条已读消息。'.repeat(80), medium: 'chat' },
        { id: 'old-two', speaker: '乙', text: '第二条已读消息。'.repeat(80), medium: 'chat' },
        { id: 'typing', speaker: '甲', text: '这是正在逐字显示的新消息。'.repeat(20), medium: 'chat' }
      ], ending: 'done' }] }, { audio: false, storage: null });
    optimizedGame.session.next(); optimizedGame.session.configure({ textDelayMs: 5 }); optimizedGame.session.next();
    globalThis.originalBubble = root.querySelector('.vn-current'); globalThis.originalSpan = originalBubble.querySelector('span');
  });
  await page.waitForFunction(() => optimizedGame.session.getView().text.length >= 8);
  await page.locator('.vn-chat').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => optimizedGame.session.getView().text.length >= 30);
  assert.equal(await page.evaluate(() => originalBubble === document.querySelector('.vn-current') && originalSpan === originalBubble.querySelector('span')), true);
  assert.equal(await page.locator('.vn-chat').evaluate(element => element.scrollTop), 0);
  passed('Typing reuses message nodes and preserves the reader scroll position');

  await page.evaluate(async () => {
    optimizedGame.dispose(); const { mountGame } = await import('./lib/index.js');
    globalThis.optimizedGame = mountGame(document.getElementById('game'), { schema: 1, game: 'animation-stability', version: 'v1', title: '演出暂停', type: 'narrative', assets: [],
      settings: { textDelayMs: 0, voiceEnabled: false, music: false }, stage: { scenes: { start: { effect: { type: 'fade', durationMs: 2000 } } } },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '演出与面板同步暂停。' }], ending: 'done' }] }, { audio: false, storage: null });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const paused = await page.locator('.vn-effect').evaluate(async element => {
    const animation = element.getAnimations()[0]; await animation.ready; const before = animation.currentTime;
    await new Promise(resolve => setTimeout(resolve, 45)); return { state: animation.playState, before, after: animation.currentTime };
  });
  assert.equal(paused.state, 'paused'); assert.equal(paused.before, paused.after);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.locator('.vn-effect').evaluate(element => element.getAnimations()[0].playState), 'running');
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('checkbox', { name: '减少动态效果', exact: true }).check();
  assert.equal(await page.locator('.vn-effect').evaluate(element => element.getAnimations().length), 0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  passed('Scene effects pause with panels, resume once and cancel immediately for reduced motion');

  await page.evaluate(async () => {
    optimizedGame.dispose(); const { mountGame } = await import('./lib/index.js');
    globalThis.optimizedGame = mountGame(document.getElementById('game'), { schema: 1, game: 'hold-stability', version: 'v1', title: '句尾停顿', type: 'narrative', assets: [],
      settings: { textDelayMs: 100, voiceEnabled: false, music: false }, stage: { lines: { one: { pauseMs: 1000 } } },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '显示全文后仍需等待剧情停顿。' }], ending: 'done' }] }, { audio: false, storage: null });
  });
  await page.getByRole('button', { name: '显示全文', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '显示全文', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => optimizedGame.session.getView().ready), false);
  await page.evaluate(() => optimizedGame.dispose());
  passed('Revealing text updates controls even when an authored hold is still pending');
  assert.deepEqual(errors, []);
  await writeFile(out + '/stability-browser-check.json', JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), browser: await browser.version(), checks, result: 'passed' }, null, 2) + '\n');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
