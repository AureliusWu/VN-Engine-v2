import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { createProject, mountGame } = await import('./lib/index.js'); vnDemo.dispose();
    const root = document.getElementById('game'), baseURL = new URL('./', location.href);
    for (const key of Object.keys(localStorage)) if (key.startsWith('vn-engine:collection-fixture:')) localStorage.removeItem(key);
    const project = { schema: 1, game: 'collection-fixture', version: 'v1', title: 'Collection fixture', type: 'narrative', settings: { textDelayMs: 0 },
      assets: [{ id: 'secret-cg', kind: 'cg', src: 'assets/letter.svg' }], stage: { lines: { finish: { layers: { cg: { asset: 'secret-cg', kind: 'cg' } } } } }, scenes: [
        { id: 'start', lines: [{ id: 'begin', speaker: '旁白', text: '回看起点' }], next: 'final' },
        { id: 'final', lines: [{ id: 'finish', speaker: '旁白', text: '回看终点' }], ending: 'complete' },
        { id: 'unused-bad', lines: [{ id: 'unused', speaker: '旁白', text: '失效回看测试的独立结局' }], ending: 'bad' }
      ] };
    const scratch = createProject(project, baseURL); const replay = scratch.session.save(); scratch.session.dispose();
    project.collections = { cgs: [{ id: 'secret-cg', title: '不应泄露的图片标题', replay }], endings: [
      { id: 'complete', title: '真实结局', trueEnding: true, replay }, { id: 'bad', title: '失效回看', replay: { invalid: true } }
    ], trueRoute: { endings: ['complete'], cgs: ['secret-cg'], minPlaythroughs: 1 } };
    globalThis.collectionGame = mountGame(root, project, { baseURL, audio: false });
  });
  const host = page.locator('#game > .vn-engine'), modal = host.locator(':scope > .vn-modal');
  await host.locator('[data-control=gallery]').click();
  assert.match(await modal.innerText(), /已解锁 0 \/ 1/);
  assert.equal(await modal.locator('img').count(), 0);
  assert.doesNotMatch(await modal.innerHTML(), /不应泄露的图片标题|secret-cg|letter\.svg/);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await host.locator('[data-control=endings]').click(); assert.doesNotMatch(await modal.innerText(), /真实结局|True Ending/);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await host.locator(':scope > .vn-stage [data-control=next]').click();
  assert.equal(await page.evaluate(() => collectionGame.session.getSnapshot().frame.ending), 'complete');
  assert.equal(await page.evaluate(() => collectionGame.meta.read().value.true_route_unlocked), true);
  await page.evaluate(() => { collectionGame.persistence.saveManual(1); collectionGame.persistence.quickSave(); });
  const before = await page.evaluate(() => ({ state: collectionGame.session.save().state, records: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('vn-engine:collection-fixture:')).sort().map(key => [key, localStorage.getItem(key)])) }));
  await host.locator('[data-control=gallery]').click(); assert.match(await modal.innerText(), /已解锁 1 \/ 1/);
  await modal.getByRole('button', { name: '查看 CG', exact: true }).click(); await modal.locator('.vn-gallery-image').waitFor({ state: 'visible' });
  await modal.getByRole('button', { name: '回看剧情', exact: true }).click();
  assert.match(await modal.locator('.vn-replay .vn-text').innerText(), /回看起点/);
  assert.equal(await modal.locator('.vn-replay [data-control=save]').isHidden(), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: true } })));
  assert.equal(await modal.locator('.vn-replay .vn-engine').getAttribute('data-paused'), 'true');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: false } })));
  await modal.locator('.vn-replay [data-control=next]').click(); assert.match(await modal.locator('.vn-replay .vn-text').innerText(), /回看终点/);
  await modal.getByRole('button', { name: '返回图鉴', exact: true }).click(); assert.match(await modal.innerText(), /已解锁 1 \/ 1/);
  const after = await page.evaluate(() => ({ state: collectionGame.session.save().state, records: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('vn-engine:collection-fixture:')).sort().map(key => [key, localStorage.getItem(key)])) }));
  assert.deepEqual(after, before);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await host.locator('[data-control=endings]').click(); assert.match(await modal.innerText(), /真实结局.*True Ending/s);
  await modal.getByRole('button', { name: '回看结局', exact: true }).click();
  assert.match(await modal.locator('.vn-replay .vn-text').innerText(), /回看起点/);
  await modal.locator('.vn-replay .vn-engine').focus(); await page.keyboard.press('Escape');
  assert.match(await modal.innerText(), /真实结局/); assert.equal(await modal.locator('.vn-replay').count(), 0);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => collectionGame.meta.markEndingSeen('bad'));
  await host.locator('[data-control=endings]').click();
  await modal.locator('.vn-collection-entry').filter({ hasText: '失效回看' }).getByRole('button', { name: '回看结局', exact: true }).click();
  assert.match(await modal.innerText(), /回看数据无效，当前进度未改变/);
  const investigation = await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); collectionGame.dispose();
    const project = await (await fetch('./circuit.json')).json(); project.game = 'collection-investigation-fixture'; project.settings = { textDelayMs: 0 };
    project.collections = { endings: [{ id: 'chapter-one:complete', title: '第一章完成' }], trueRoute: { endings: ['chapter-one:complete'] } };
    for (const key of Object.keys(localStorage)) if (key.startsWith('vn-engine:' + project.game + ':')) localStorage.removeItem(key);
    const mounted = mountGame(document.getElementById('game'), project, { baseURL: new URL('./', location.href), audio: false });
    for (const id of ['inspect-a', 'return', 'inspect-b', 'return', 'reason', 'right']) if (!mounted.session.act(id)) throw Error('Invalid investigation fixture action: ' + id);
    const state = mounted.meta.read(); mounted.dispose(); return state.value;
  });
  assert.ok(investigation.ending_seen.includes('chapter-one:complete')); assert.equal(investigation.true_route_unlocked, true);
  assert.equal(investigation.playthrough_count, 0);
  assert.deepEqual(errors, []);
  console.log('PASS Locked CG and endings hide content; unlocked gallery, isolated replay, return and invalid replay handling work');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
