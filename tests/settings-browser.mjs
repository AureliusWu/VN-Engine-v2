import { chromium } from 'playwright';
import assert from 'node:assert/strict';
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
  assert.deepEqual(errors, []); console.log('PASS Legacy sound settings migrate, independent channels persist, master and video gains compose');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
