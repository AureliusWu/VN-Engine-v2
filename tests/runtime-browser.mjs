import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { createDemoServer } from '../tools/serve.mjs';
import { packageGame } from '../tools/package-game.mjs';

const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const checks = [], errors = []; let browser, standalone;
const passed = value => { checks.push(value); console.log('PASS', value); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(() => {
    for (const game of ['vn-self-campus', 'vn-self-chat', 'vn-self-investigation', 'vn-self-rain']) localStorage.setItem(`vn-engine:${game}:settings`, JSON.stringify({ textDelayMs: 0, voiceEnabled: false, music: false }));
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto(base + '/engine/'); await page.waitForSelector('.vn-engine');
  const click = name => page.locator('.vn-engine').getByRole('button', { name, exact: true }).click();
  const choose = name => page.locator('.vn-actions').getByRole('button', { name, exact: true }).click();
  const saveSlot = async () => { await click('存档'); await page.getByRole('button', { name: '保存到槽位 1', exact: true }).click(); };
  const loadSlot = async () => { await click('读档'); await page.getByRole('button', { name: '读取槽位 1', exact: true }).click(); };
  const ready = () => page.waitForFunction(() => globalThis.vnDemo?.session.getSnapshot().ready);
  const select = async (name, game) => { await page.locator(`[data-project=${name}]`).click(); await page.waitForFunction(game => globalThis.vnDemo?.session.driver.game === game && !document.getElementById('error').textContent, game); await ready(); };
  await ready(); await page.locator('.vn-background').waitFor({ state: 'visible' }); await page.locator('.vn-portrait').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.vn-effect').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path: out + '/self-engine-desktop.png', fullPage: true });
  await page.locator('.vn-engine').focus(); await page.keyboard.press('Space'); await choose('共同完成'); await choose('下一段');
  assert.equal(await page.locator('.vn-cg').isHidden(), true); await choose('下一段'); await ready(); await page.locator('.vn-cg').waitFor({ state: 'visible' });
  await saveSlot(); const visit = await page.evaluate(() => vnDemo.session.getSnapshot().visit); await choose('继续章节'); await loadSlot(); await ready();
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.sceneId), 'end-together');
  assert.ok(await page.evaluate(() => vnDemo.session.getSnapshot().visit) > visit);
  assert.equal(await page.locator('.vn-effect').evaluate(element => element.getAnimations().length), 0);
  passed('Own renderer draws backgrounds/portraits/CG and same-line load suppresses one-shot effects');

  await page.evaluate(() => { const key = 'vn-engine:vn-self-campus:v2:save:manual-1'; const value = JSON.parse(localStorage.getItem(key)); value.savedAt = '2000-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)); });
  await click('存档');
  assert.equal(await page.locator('.vn-save-slot').count(), 6);
  await page.screenshot({ path: out + '/save-manager-desktop.png', fullPage: true });
  assert.match(await page.locator('.vn-save-slot').first().innerText(), /游戏版本.*存档版本.*场景.*段落/);
  const savedBefore = await page.evaluate(() => localStorage.getItem('vn-engine:vn-self-campus:v2:save:manual-1'));
  await page.getByRole('button', { name: '保存到槽位 1', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('vn-engine:vn-self-campus:v2:save:manual-1')), savedBefore);
  await page.getByRole('button', { name: '取消覆盖', exact: true }).click();
  await page.getByRole('button', { name: '保存到槽位 1', exact: true }).click();
  await page.getByRole('button', { name: '确认覆盖槽位 1', exact: true }).click();
  assert.notEqual(await page.evaluate(() => localStorage.getItem('vn-engine:vn-self-campus:v2:save:manual-1')), savedBefore);
  await click('存档');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('vn-engine:vn-self-campus:v2:save:manual-2', '{broken'));
  await click('读档'); assert.match(await page.locator('.vn-save-slot').nth(1).innerText(), /损坏/);
  assert.equal(await page.getByRole('button', { name: '读取槽位 2', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.vn-engine').focus(); await page.keyboard.press('F5');
  await choose('继续章节'); await page.locator('.vn-engine').focus(); await page.keyboard.press('F9');
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.sceneId), 'end-together');
  await page.evaluate(() => localStorage.setItem('vn-engine:vn-self-campus:save:1', JSON.stringify(vnDemo.session.save())));
  await choose('继续章节'); await click('读档'); await page.getByRole('button', { name: '读取旧单槽存档', exact: true }).click();
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.sceneId), 'end-together');
  assert.equal(await page.evaluate(() => localStorage.getItem('vn-engine:vn-self-campus:v2:save:manual-2')), '{broken');
  passed('Multi-slot metadata, overwrite confirmation, corrupt isolation, legacy saves and F5/F9 quick saves work in the real player');

  await click('历史'); const oldVisit = await page.evaluate(() => vnDemo.session.getSnapshot().visit);
  await page.getByLabel('搜索已读记录').fill('选择会改变'); await page.getByLabel('搜索已读记录').press('Space');
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().visit), oldVisit);
  await page.getByLabel('搜索已读记录').fill('选择会改变'); await page.locator('.vn-record').click(); await choose('暂时留白'); await choose('下一段'); await ready();
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.sceneId), 'end-quiet');
  await click('隐藏界面'); assert.equal(await page.locator('.vn-reading').isHidden(), true); const hiddenVisit = await page.evaluate(() => vnDemo.session.getSnapshot().visit);
  await page.locator('.vn-engine').focus(); await page.keyboard.press('Space'); assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().visit), hiddenVisit);
  await click('恢复界面'); passed('History filters, keyboard focus guard, reread and interface pause use the own session');

  await select('netlove', 'vn-self-chat'); assert.equal(await page.locator('.vn-chat').isVisible(), true); assert.equal(await page.locator('.vn-portrait').isHidden(), true);
  await choose('下一段'); await choose('说明真实情况'); await page.locator('.vn-call').waitFor({ state: 'visible' });
  assert.match(await page.locator('.vn-text').innerText(), /谢谢你/); assert.equal(await page.locator('.vn-portrait').isHidden(), true);
  await choose('下一段'); await page.locator('.vn-portrait').waitFor({ state: 'visible' }); await saveSlot();
  passed('Chat bubbles, conditional call prose and on-site portraits render as distinct modes');

  await select('circuit', 'vn-self-investigation'); assert.equal(await page.locator('.vn-actions [data-action=reason]').count(), 0);
  assert.equal(await page.locator('[data-control=skip]').isDisabled(), true);
  await page.locator('.vn-hotspots button').click(); await page.locator('.vn-document').waitFor({ state: 'visible' }); await choose('返回调查');
  await choose('查看照片'); await choose('返回调查'); await choose('开始推理'); await choose('直接下结论'); await choose('重新调查');
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.evidence.length), 0);
  for (const action of ['查看记录', '返回调查', '查看照片', '返回调查', '开始推理', '核对时间一致', '进入 调查样例 2']) await choose(action);
  await saveSlot(); await click('新游戏'); await loadSlot(); assert.match(await page.locator('.vn-scene-title').innerText(), /2/);
  passed('Hotspots, evidence documents, retry, chapter unlock and journal saves run in our investigation driver');

  await select('rain', 'vn-self-rain'); assert.match(await page.locator('.vn-text').innerText(), /自研解释器/);
  await choose('保留信任'); assert.match(await page.locator('.vn-text').innerText(), /选择回应/);
  await choose('下一段'); await choose('下一段'); await ready();
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.ending), 'trust');
  await saveSlot(); await click('新游戏'); await loadSlot(); assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.ending), 'trust');
  assert.equal(requests.some(url => /\.wasm|\.rpy|renpy\.js/i.test(url)), false);
  passed('Rain-form author data reaches its ending and reloads using only the own script VM');

  await select('campus', 'vn-self-campus'); await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.fonts.ready);
  await page.locator('.vn-effect').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await click('存档'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: out + '/save-manager-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: out + '/self-engine-mobile.png', fullPage: true });
  passed('Own renderer remains usable at 390px without horizontal overflow');
  await page.waitForFunction(() => document.getElementById('offline-state').textContent === '可离线游玩');
  await context.setOffline(true); await page.reload(); await ready(); await select('rain', 'vn-self-rain'); await loadSlot();
  assert.equal(await page.evaluate(() => vnDemo.session.getSnapshot().frame.ending), 'trust');
  passed('Four-mode own runtime reloads from a real offline service-worker cache');
  await context.close();

  const audioContext = await browser.newContext();
  await audioContext.addInitScript(() => localStorage.setItem('vn-engine:vn-self-campus:settings', JSON.stringify({ textDelayMs: 0, music: true, voiceEnabled: true, autoDelayMs: 20 })));
  const audioPage = await audioContext.newPage(); audioPage.on('pageerror', error => errors.push(error.message)); await audioPage.goto(base + '/engine/'); await audioPage.waitForSelector('.vn-engine');
  await audioPage.locator('[data-control=sound]').click(); await audioPage.waitForFunction(() => vnDemo.session.getSnapshot().voiceBlocked);
  await audioPage.locator('[data-control=auto]').click(); assert.equal(await audioPage.evaluate(() => vnDemo.session.getSnapshot().frame.line), 0);
  await audioPage.waitForFunction(() => vnDemo.session.getSnapshot().frame.line === 1);
  await audioContext.close(); passed('Real Web Audio/HTML audio playback releases auto only after the test voice finishes');

  const failedContext = await browser.newContext({ serviceWorkers: 'block' });
  await failedContext.addInitScript(() => localStorage.setItem('vn-engine:vn-self-campus:settings', JSON.stringify({ textDelayMs: 0, voiceEnabled: false, music: false })));
  const failedPage = await failedContext.newPage(); failedPage.on('pageerror', error => errors.push(error.message)); await failedPage.route('**/assets/student.svg', route => route.abort());
  await failedPage.goto(base + '/engine/'); await failedPage.waitForSelector('.vn-engine'); await failedPage.waitForFunction(() => document.querySelector('.vn-status').textContent.includes('画面资源未能载入'));
  await failedPage.locator('[data-control=next]').click(); await failedPage.locator('.vn-actions').getByRole('button', { name: '共同完成', exact: true }).click();
  assert.equal(await failedPage.evaluate(() => vnDemo.session.getSnapshot().frame.sceneId), 'resolve'); await failedContext.close();
  passed('A failed portrait download keeps dialogue and choices playable');

  const temp = await mkdtemp(join(tmpdir(), 'vn-standalone-browser-')); const build = await packageGame('examples/runtime/rain.json', join(temp, 'game'));
  standalone = createServer(async (request, response) => {
    try { const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); if (!pathname.startsWith('/play/')) throw new Error();
      const path = resolve(build.output, pathname.slice(6) || 'index.html'); if (!path.startsWith(build.output + sep)) throw new Error();
      const bytes = await readFile(path); const type = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' }[extname(path)] ?? 'text/plain'; response.writeHead(200, { 'Content-Type': type }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  }); await new Promise(resolve => standalone.listen(0, '127.0.0.1', resolve));
  const packagedContext = await browser.newContext(); await packagedContext.addInitScript(() => localStorage.setItem('vn-engine:vn-self-rain:settings', JSON.stringify({ textDelayMs: 0, voiceEnabled: false, music: false })));
  const packagedPage = await packagedContext.newPage(); packagedPage.on('pageerror', error => errors.push(error.message));
  await packagedPage.goto(`http://127.0.0.1:${standalone.address().port}/play/`); await packagedPage.waitForSelector('.vn-engine'); await packagedPage.locator('.vn-actions').getByRole('button', { name: '保留信任', exact: true }).click();
  await packagedPage.waitForFunction(() => document.querySelector('#status').textContent.includes('可离线游玩')); await packagedContext.setOffline(true); await packagedPage.reload();
  await packagedPage.waitForSelector('.vn-engine'); assert.match(await packagedPage.locator('.vn-text').innerText(), /自研解释器/); assert.equal(await packagedPage.locator('#error').innerText(), '');
  await packagedContext.close(); passed('Standalone output boots and truly reloads offline from a nested deployment directory');
  assert.deepEqual(errors, []);
  await writeFile(out + '/self-runtime-browser-check.json', JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), browser: await browser.version(), checks, result: 'passed' }, null, 2) + '\n');
} finally { await browser?.close(); if (standalone) await new Promise(resolve => standalone.close(resolve)); await new Promise(resolve => server.close(resolve)); }
