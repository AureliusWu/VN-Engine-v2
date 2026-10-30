import { listenBrowserServer } from '../tools/browser-server.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await listenBrowserServer(server);
const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  await page.locator('#sample').selectOption('campus'); await page.locator('[data-command=sample]').click();
  const preview = page.frameLocator('#preview'); await preview.locator('.vn-portrait').waitFor({ state: 'visible' });
  const section = page.locator('#inspector > details').filter({ hasText: '正式图层与时间线' });
  await section.evaluate(node => { node.open = true; });
  await section.getByLabel('图层 character-front', { exact: true }).selectOption(JSON.stringify({ asset: 'lin/neutral', kind: 'portrait' }));
  assert.equal(await section.evaluate(node => node.open), true);
  await section.getByRole('button', { name: '启用时间线', exact: true }).click();
  await section.getByRole('button', { name: '添加动画轨道', exact: true }).click();
  await section.getByLabel('轨道 1 图层', { exact: true }).selectOption('character-front');
  const change = async (label, value) => {
    const input = section.getByLabel(label, { exact: true }); await input.fill(value);
    const scrollTop = await page.locator('.inspector').evaluate(node => node.scrollTop); await input.blur();
    assert.equal(await page.locator('.inspector').evaluate(node => node.scrollTop), scrollTop, 'editing preserves the inspector scroll position');
  };
  await change('轨道 1 目标资源', 'lin/neutral'); await change('轨道 1 终点 X', '80'); await change('轨道 1 终点 缩放', '1.2');
  await section.getByRole('button', { name: '添加镜头关键帧', exact: true }).click();
  await section.getByRole('button', { name: '添加镜头关键帧', exact: true }).click();
  await change('镜头 2 X', '40'); await change('镜头 2 缩放', '1.1');
  await preview.locator('.vn-character-front').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('preview').contentDocument.querySelector('.vn-character-front')?.style.transform === 'translate(80px, 0px) scale(1.2)');
  await page.waitForFunction(() => document.getElementById('preview').contentDocument.querySelector('.vn-camera')?.style.transform === 'translate(40px, 0px) scale(1.1)');
  await page.evaluate(() => document.fonts.ready);
  await section.getByLabel('轨道 1 图层', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + '/studio-presentation.png' });
  await section.getByLabel('镜头 2 缩放', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + '/studio-camera.png' });
  await change('轨道 1 时长 ms', '2000'); assert.equal(await page.locator('[data-command=export]').isDisabled(), true);
  assert.match(await page.locator('#diagnostics').innerText(), /时间线/);
  await change('轨道 1 时长 ms', '500'); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  await page.locator('[data-command=undo]').click(); assert.equal(await page.locator('[data-command=export]').isDisabled(), true);
  await page.locator('[data-command=redo]').click(); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
  const project = JSON.parse(await readFile(await download.path(), 'utf8'));
  const authored = Object.values(project.stage.scenes).find(cue => cue.timeline?.animations?.[0]?.target === 'lin/neutral');
  assert.equal(authored.layers['character-front'].asset, 'lin/neutral'); assert.equal(authored.timeline.animations[0].to.x, 80);
  assert.equal(authored.timeline.camera[1].scale, 1.1);
  assert.deepEqual(errors, []);
  console.log('PASS Studio authors visual layers, animation tracks and camera keyframes with preview, diagnostics and undo/redo');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
