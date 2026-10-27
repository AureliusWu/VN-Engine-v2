import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); vnDemo.dispose();
    localStorage.setItem('vn-engine:settings-fixture:settings', JSON.stringify({ volume: .4, voiceVolume: .65, music: false, textDelayMs: 0 }));
    window.settingsProject = { schema: 1, game: 'settings-fixture', version: 'v1', title: 'Settings fixture', type: 'narrative',
      assets: [{ id: 'clip', kind: 'video', src: 'assets/test-video.webm' }],
      stage: { lines: { one: { video: { asset: 'clip', muted: true, loop: true } } } },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: 'N', text: 'Independent reading and sound settings' }], ending: 'done' }] };
    window.remountSettings = () => { window.settingsGame?.dispose(); window.settingsGame = mountGame(document.getElementById('game'), settingsProject, { audio: false }); };
    remountSettings();
  });
  const host = page.locator('#game > .vn-engine');
  assert.deepEqual(await page.evaluate(() => {
    const s = settingsGame.session.getView().settings; return [s.masterVolume, s.bgmVolume, s.ambienceVolume, s.seVolume, s.videoVolume, s.voiceVolume, s.music, s.ambience];
  }), [1, .4, .4, .4, .4, .65, false, false]);
  await host.locator('[data-control=settings]').click();
  for (const [label, value] of [['总音量', '.5'], ['背景音乐音量', '.2'], ['环境音量', '.3'], ['音效音量', '.7'], ['语音音量', '.8'], ['视频音量', '.6']]) {
    await host.getByLabel(label, { exact: true }).evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  }
  await host.getByLabel('环境音播放', { exact: true }).check();
  await host.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await host.locator('.vn-video').evaluate(node => node.volume), .3);
  await page.evaluate(() => remountSettings());
  assert.deepEqual(await page.evaluate(() => {
    const s = settingsGame.session.getView().settings; return [s.masterVolume, s.bgmVolume, s.ambienceVolume, s.seVolume, s.videoVolume, s.voiceVolume, s.music, s.ambience];
  }), [.5, .2, .3, .7, .6, .8, false, true]);
  await page.evaluate(() => settingsGame.session.configure({ masterVolume: 0 }));
  assert.equal(await host.locator('.vn-video').evaluate(node => node.volume), 0);
  await host.locator('[data-control=settings]').click();
  const font = host.getByLabel('阅读字号', { exact: true }); await font.focus(); await page.keyboard.press('End');
  await host.getByLabel('高对比模式', { exact: true }).check();
  assert.equal(await host.evaluate(node => node.dataset.contrast), 'high');
  assert.equal(await host.locator(':scope > .vn-stage').evaluate(node => node.inert), true);
  const summary = host.locator('.vn-panel summary'); await summary.focus(); await page.keyboard.press('Tab');
  assert.equal(await host.getByRole('button', { name: '关闭', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Shift+Tab'); assert.equal(await summary.evaluate(node => node === document.activeElement), true);
  const before = await page.evaluate(() => settingsGame.session.getView().visit);
  await page.keyboard.press('Enter'); await page.keyboard.press('1'); assert.equal(await page.evaluate(() => settingsGame.session.getView().visit), before);
  await page.keyboard.press('Escape');
  assert.equal(await host.locator('[data-control=settings]').evaluate(node => node === document.activeElement), true);
  await page.evaluate(() => remountSettings());
  assert.equal(await page.evaluate(() => settingsGame.session.getView().settings.fontScale), 1.6);
  assert.equal(await page.evaluate(() => settingsGame.session.getView().settings.highContrast), true);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const mode of ['vn', 'chat', 'document']) {
    await page.evaluate(mode => {
      const line = settingsProject.scenes[0].lines[0]; line.text = '大字号阅读与键盘操作测试。'.repeat(50);
      if (mode === 'chat') line.medium = 'chat'; else delete line.medium;
      settingsProject.stage.lines.one = mode === 'document' ? { document: { title: '调查文书', lines: [line.text] } } : {};
      remountSettings();
    }, mode);
    const text = host.locator(mode === 'chat' ? '.vn-current' : mode === 'document' ? '.vn-document p' : '.vn-text');
    assert.ok(await text.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 22);
    const bounds = await host.locator('.vn-reading').evaluate(node => ({ height: node.clientHeight, scroll: node.scrollHeight, background: getComputedStyle(node).backgroundColor, within: node.scrollWidth <= node.clientWidth }));
    assert.equal(bounds.background, 'rgb(0, 0, 0)'); assert.equal(bounds.within, true);
    if (mode === 'vn') assert.ok(bounds.scroll > bounds.height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
  await host.locator('[data-control=settings]').click(); await font.scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '/settings-accessibility-mobile.png' });
  assert.deepEqual(errors, []); console.log('PASS Legacy sound settings migrate; independent channels, readable scale and contrast persist; modal focus traps exclude hidden controls');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
