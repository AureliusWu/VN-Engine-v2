import { listenBrowserServer } from '../tools/browser-server.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await listenBrowserServer(server);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); vnDemo.dispose();
    const project = { schema: 1, game: 'backup-fixture', version: 'v1', title: 'Backup fixture', type: 'narrative', assets: [], settings: { textDelayMs: 0 },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: 'N', text: 'First saved paragraph' }, { id: 'two', speaker: 'N', text: 'Second saved paragraph' }], ending: 'done' }] };
    for (const key of Object.keys(localStorage)) if (key.startsWith('vn-engine:backup-fixture:')) localStorage.removeItem(key);
    window.backupGame = mountGame(document.getElementById('game'), project, { audio: false });
    project.scenes[0].id = 'source-edited-after-mount'; // Validation remains bound to the active project snapshot.
    backupGame.persistence.saveManual(1); backupGame.persistence.quickSave(); backupGame.session.next(); backupGame.persistence.saveManual(2);
    window.backupRecords = () => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('vn-engine:backup-fixture:')).sort().map(key => [key, localStorage.getItem(key)]));
  });
  const host = page.locator('#game > .vn-engine'), modal = host.locator(':scope > .vn-modal');
  await host.locator('[data-control=settings]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), modal.getByRole('button', { name: '备份所有存档', exact: true }).click()]);
  const raw = await readFile(await download.path(), 'utf8'); assert.equal(download.suggestedFilename(), 'backup-fixture-slots.json');
  assert.deepEqual(JSON.parse(raw).slots.map(item => item.slot), ['manual-1', 'manual-2', 'quick', 'auto']);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => { backupGame.persistence.saveManual(1); backupGame.persistence.quickSave(); });
  const before = await page.evaluate(() => ({ records: backupRecords(), state: backupGame.session.save().state, visit: backupGame.session.getView().visit }));
  const select = async text => {
    await host.locator('[data-control=settings]').click();
    await modal.locator('[data-import=backup]').setInputFiles({ name: 'slots.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  };
  await select(raw); await modal.getByRole('button', { name: '确认恢复这些槽位', exact: true }).waitFor();
  assert.match(await modal.innerText(), /4 个槽位/); assert.deepEqual(await page.evaluate(() => backupRecords()), before.records);
  await modal.getByRole('button', { name: '取消恢复', exact: true }).click(); await modal.getByRole('button', { name: '关闭', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => backupRecords()), before.records);
  await select(raw); await modal.getByRole('button', { name: '确认恢复这些槽位', exact: true }).click();
  assert.match(await host.locator('.vn-status').innerText(), /已恢复 4 个存档/);
  assert.deepEqual(await page.evaluate(() => backupGame.session.save().state), before.state);
  assert.equal(await page.evaluate(() => backupGame.session.getView().visit), before.visit);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(backupGame.persistence.contract.keyFor('manual-1'))).payload.state.line), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem(backupGame.meta.key)), before.records['vn-engine:backup-fixture:v2:meta']);
  await host.locator('[data-control=load]').click(); await modal.locator('[data-slot="1"] button').click();
  assert.equal(await page.evaluate(() => backupGame.session.getView().frame.lineId), 'one');

  const bad = JSON.parse(raw); bad.slots.at(-1).payload.state.sceneId = 'forged';
  const safe = await page.evaluate(() => ({ records: backupRecords(), state: backupGame.session.save().state }));
  await select(JSON.stringify(bad)); await page.waitForFunction(() => document.querySelector('.vn-panel-status').textContent.includes('备份无法恢复'));
  assert.deepEqual(await page.evaluate(() => ({ records: backupRecords(), state: backupGame.session.save().state })), safe);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();

  await select(raw); await modal.getByRole('button', { name: '确认恢复这些槽位', exact: true }).waitFor();
  const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: out + '/save-backup-preview-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => localStorage.setItem(backupGame.persistence.contract.keyFor('quick'), '{newer writer}'));
  const conflict = await page.evaluate(() => backupRecords());
  await modal.getByRole('button', { name: '确认恢复这些槽位', exact: true }).click();
  assert.match(await modal.locator('.vn-panel-status').innerText(), /预览后发生变化/); assert.deepEqual(await page.evaluate(() => backupRecords()), conflict);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();

  await page.evaluate(() => {
    window.originalFileText = File.prototype.text;
    File.prototype.text = () => new Promise(resolve => { window.resolveLateBackup = resolve; });
  });
  await select(raw); await page.waitForFunction(() => typeof resolveLateBackup === 'function');
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(raw => { resolveLateBackup(raw); File.prototype.text = originalFileText; }, raw);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await modal.isHidden(), true); assert.deepEqual(await page.evaluate(() => backupRecords()), conflict);
  await host.locator('[data-control=settings]').click();
  await page.evaluate(() => {
    window.backupReads = {};
    File.prototype.text = function() { return new Promise(resolve => { backupReads[this.name] = resolve; }); };
  });
  for (const name of ['earlier.json', 'latest.json']) await modal.locator('[data-import=backup]').setInputFiles({name, mimeType:'application/json', buffer:Buffer.from(raw)});
  await page.evaluate(raw => backupReads['earlier.json'](raw), raw);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await modal.getByRole('button', {name:'确认恢复这些槽位',exact:true}).count(), 0);
  await page.evaluate(raw => { backupReads['latest.json'](raw); File.prototype.text = originalFileText; }, raw);
  await modal.getByRole('button', {name:'确认恢复这些槽位',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(() => backupRecords()), conflict);
  await page.evaluate(() => backupGame.dispose()); assert.deepEqual(errors, []);
  console.log('PASS Multi-slot backup downloads, previews, cancels, validates routes, restores without moving the reader, rejects conflicts and ignores a closed panel’s late file read');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
