import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results';
await mkdir(out, { recursive: true });
const server = await createDemoServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [], errors = [];
const passed = name => { checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const stage = async pattern => page.waitForFunction(([source, flags]) => new RegExp(source, flags).test(document.getElementById('stage')?.innerText ?? ''), [pattern.source, pattern.flags]);
  await page.goto(baseURL);
  await stage(/这是从校园视觉小说/);
  await click('下一段'); await click('共同完成'); await click('下一段');
  assert.equal(await page.locator('#state').innerText().then(text => text.includes('page-together')), false);
  await click('下一段'); assert.match(await page.locator('#state').innerText(), /page-together/);
  await click('存档'); await click('新游戏'); await click('读档'); await stage(/插图已经触发/);
  passed('Healing branch, paragraph CG cue and exact-position save/load');

  await click('历史记录'); await page.getByLabel('搜索已读记录').fill('选择会改变');
  assert.equal(await page.locator('.record').count(), 1);
  await page.locator('.record').click(); await click('暂时留白'); await click('下一段'); await stage(/暂时留白/);
  await click('隐藏界面'); assert.equal(await page.getByRole('button', { name: '继续章节', exact: true }).count(), 0);
  await click('恢复界面'); await stage(/暂时留白/);
  passed('History search/reread resets future decisions; hidden interface keeps position');

  await click('聊天叙事'); await click('读档'); assert.match(await page.locator('#message').innerText(), /还没有存档/);
  await click('下一段'); await click('说明真实情况'); await stage(/谢谢你在聊天里/);
  assert.match(await page.locator('#state').innerText(), /在场角色\s*无/);
  await click('下一段'); await stage(/线下见面/); assert.match(await page.locator('#state').innerText(), /tinghe/);
  await click('存档'); await page.screenshot({ path: `${out}/demo-desktop.png`, fullPage: true });
  passed('NetLove independent save namespace, conditional call text and meeting presentation');

  await click('调查与推理'); assert.equal(await page.getByRole('button', { name: '开始推理', exact: true }).count(), 0);
  async function investigate() { await click('查看记录'); await click('返回调查'); await click('查看照片'); await click('返回调查'); await click('开始推理'); }
  await investigate(); await click('直接下结论'); await stage(/推理失败/);
  assert.equal(await page.getByRole('button', { name: '进入 调查样例 2', exact: true }).count(), 0);
  await click('重新调查'); await investigate(); await click('核对时间一致'); await click('进入 调查样例 2');
  assert.match(await page.locator('#state').innerText(), /chapter-two/);
  await click('存档'); await click('新游戏'); await click('读档'); assert.match(await page.locator('#state').innerText(), /chapter-two/);
  passed('Circuit investigation, evidence gates, failed ending/retry and sequential chapter unlock');

  await click('Ren’Py 适配'); await stage(/python -m adapters.renpy/); assert.equal(await page.locator('#save').isDisabled(), true);
  passed('Native RenPy adapter is kept separate from the browser runtime');
  await click('聊天叙事'); await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/demo-mobile.png`, fullPage: true });
  passed('390px mobile layout without horizontal overflow');

  await page.waitForFunction(() => document.getElementById('offline-state')?.textContent === '可离线运行');
  await context.setOffline(true); await page.reload(); await stage(/匿名聊天|校园视觉小说/);
  await click('调查与推理'); await stage(/调查两份资料/);
  await click('聊天叙事'); await click('读档'); await stage(/线下见面/);
  passed('Actual offline reload, cached mode switching and persisted save restore');
  assert.deepEqual(errors, []);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.equal(keys.some(key => /^(moist-healing|netlove|circuit)[-:]/.test(key)), false);
  passed('No uncaught browser exceptions or writes into the original game save keys');
  const report = { schema: 1, checkedAt: new Date().toISOString(), browser: await browser.version(), checks, result: 'passed' };
  await writeFile(`${out}/browser-check.json`, JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
