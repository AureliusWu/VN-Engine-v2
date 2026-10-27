import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'no-preference' });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); vnDemo.dispose();
    window.kvProject = { schema: 1, game: 'kv-fixture', version: 'v1', title: 'Key Visual fixture', type: 'narrative', settings: { textDelayMs: 0 },
      assets: [{ id: 'brand', kind: 'ui', src: 'assets/letter.svg' }],
      stage: { lines: { first: { keyVisual: { asset: 'brand', scope: 'banner', sceneType: 'story', durationMs: 650 } } } },
      scenes: [{ id: 'start', lines: [{ id: 'first', speaker: 'N', text: 'readable dialogue' }, { id: 'second', speaker: 'N', text: 'next line' }], ending: 'done' }] };
    window.kvGame = mountGame(document.getElementById('game'), kvProject, { baseURL: new URL('./', location.href), storage: null, audio: false });
  });
  const wrapper = page.locator('#game .vn-key-visual'); await wrapper.locator('img').waitFor({ state: 'visible' });
  assert.equal(await wrapper.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  assert.ok((await wrapper.boundingBox()).y + (await wrapper.boundingBox()).height <= (await page.locator('#game .vn-stage').boundingBox()).y);
  await page.evaluate(() => kvGame.session.hide(true)); await page.waitForTimeout(750); assert.equal(await wrapper.isHidden(), true);
  await page.evaluate(() => kvGame.session.hide(false)); await wrapper.waitFor({ state: 'visible' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: true } })));
  await page.waitForTimeout(750); await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: false } })));
  await wrapper.waitFor({ state: 'visible' }); await wrapper.waitFor({ state: 'hidden', timeout: 2000 });
  await page.evaluate(() => kvGame.session.restart()); await wrapper.waitFor({ state: 'visible' });
  await page.evaluate(() => { window.kvSave = kvGame.session.save(); kvGame.session.next(); }); await wrapper.waitFor({ state: 'hidden' });
  await page.evaluate(() => kvGame.session.restore(kvSave)); assert.equal(await wrapper.isHidden(), true);
  await page.evaluate(() => { kvGame.session.restart(); kvGame.session.setSkip(true); }); assert.equal(await wrapper.isHidden(), true);
  await page.evaluate(() => { kvGame.session.setSkip(false); kvGame.session.restart(); kvGame.session.configure({ reducedMotion: true }); }); assert.equal(await wrapper.isHidden(), true);
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); kvGame.dispose();
    kvProject.stage.lines.first.keyVisual = { asset: 'brand', scope: 'fullscreen', sceneType: 'interstitial', durationMs: 10000 };
    kvGame = mountGame(document.getElementById('game'), kvProject, { baseURL: new URL('./', location.href), storage: null, audio: false });
  });
  await wrapper.locator('img').waitFor({ state: 'visible' });
  await page.locator('#game [data-control=next]').click(); assert.equal(await wrapper.isHidden(), true);
  assert.match(await page.locator('#game .vn-text').innerText(), /next line/);
  await page.evaluate(() => kvGame.dispose()); assert.equal(await page.locator('#game .vn-key-visual').count(), 0);

  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  await page.locator('#sample').selectOption('campus'); await page.locator('[data-command=sample]').click();
  await page.locator('[data-tab=source]').click();
  const source = page.locator('#source'), project = JSON.parse(await source.inputValue()); project.assets.push({ id: 'brand', kind: 'ui', src: 'assets/letter.svg' });
  await source.fill(JSON.stringify(project)); await page.locator('[data-command=apply-source]').click(); await page.locator('[data-tab=story]').click();
  const section = page.locator('#inspector > details').filter({ hasText: '正式图层与时间线' }); await section.evaluate(node => { node.open = true; });
  await section.getByLabel('装饰视觉资源', { exact: true }).selectOption('brand');
  await section.getByLabel('装饰视觉时长 ms', { exact: true }).fill('10000'); await section.getByLabel('装饰视觉时长 ms', { exact: true }).blur();
  await page.frameLocator('#preview').locator('.vn-key-visual').waitFor({ state: 'visible' });
  await section.getByLabel('装饰视觉范围', { exact: true }).selectOption('fullscreen'); assert.equal(await page.locator('[data-command=export]').isDisabled(), true);
  await section.getByLabel('装饰视觉场景类型', { exact: true }).selectOption('transition'); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
  const output = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(Object.values(output.stage.scenes).find(cue => cue.keyVisual)?.keyVisual.sceneType, 'transition');
  assert.deepEqual(errors, []); console.log('PASS Key Visual has safe scope, bounded paused lifetime, exit/restore/skip cleanup and validated Studio authoring');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
