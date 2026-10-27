import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'), { newProject } = await import('./lib/editor/index.js'); vnDemo.dispose();
    const project = newProject('script'); project.game = 'mini-game-fixture'; project.settings = { textDelayMs: 0 };
    const next = project.program.blocks[1].id; project.program.blocks[0].exit.choices = [{ id: 'yes', text: 'success', next }, { id: 'no', text: 'failure', next }];
    project.program.blocks[0].cue = { miniGame: { id: 'switches', kind: 'switches', initial: [false, false], target: [true, true], maxMoves: 3,
      results: { success: 'yes', failure: 'no', abort: 'no', skip: 'yes' } } };
    for (const key of Object.keys(localStorage)) if (key.startsWith('vn-engine:' + project.game + ':')) localStorage.removeItem(key);
    window.puzzleGame = mountGame(document.getElementById('game'), project, { audio: false });
  });
  const host = page.locator('#game > .vn-engine'); assert.equal(await host.locator('[data-action]').count(), 0);
  await host.locator('[data-control=mini-game-start]').click(); await host.locator('[data-input="0"]').click();
  const savedAuto = await page.evaluate(() => JSON.parse(localStorage.getItem(puzzleGame.persistence.contract.keyFor('auto'))).payload.vnMiniGame.state.journal);
  assert.deepEqual(savedAuto, [0]);
  await host.locator('[data-control=quick-save]').click(); await host.locator('[data-input="0"]').click(); await host.locator('[data-control=quick-load]').click();
  assert.equal(await host.locator('[data-input="0"]').getAttribute('aria-pressed'), 'true');
  const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true }); await page.screenshot({ path: out + '/minigame-runtime.png' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: true } })));
  assert.equal(await host.locator('[data-input="1"]').isDisabled(), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: false } })));
  await host.locator('[data-input="1"]').click(); assert.match(await host.locator('.vn-minigame').innerText(), /成功/);
  await host.locator('[data-control=mini-game-continue]').click();
  assert.equal(await page.evaluate(() => puzzleGame.session.save().state.decisions[0].choiceId), 'yes');
  await host.locator('[data-control=rollback]').click(); assert.match(await host.locator('.vn-minigame').innerText(), /成功/);
  await host.locator('[data-control=restart]').click(); await host.locator('[data-control=mini-game-start]').click(); await host.locator('[data-control=mini-game-abort]').click();
  await host.locator('[data-control=mini-game-continue]').click(); assert.equal(await page.evaluate(() => puzzleGame.session.save().state.decisions[0].choiceId), 'no');
  await host.locator('[data-control=restart]').click(); await host.locator('[data-control=mini-game-start]').click(); await host.locator('[data-control=mini-game-skip]').click();
  await host.locator('[data-control=mini-game-continue]').click(); assert.equal(await page.evaluate(() => puzzleGame.session.save().state.decisions[0].choiceId), 'yes');

  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  const section = page.locator('#inspector > details').filter({ hasText: '正式图层与时间线' }); await section.evaluate(node => { node.open = true; });
  await section.getByRole('button', { name: '配置小游戏', exact: true }).click();
  await section.getByLabel('小游戏最多操作数', { exact: true }).fill('0'); await section.getByLabel('小游戏最多操作数', { exact: true }).blur();
  assert.equal(await page.locator('[data-command=export]').isDisabled(), true);
  await page.locator('[data-command=undo]').click(); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  const preview = page.frameLocator('#preview'); await preview.locator('[data-control=mini-game-start]').click();
  for (const index of [0, 1, 2]) await preview.locator(`[data-input="${index}"]`).click();
  await preview.locator('[data-control=mini-game-continue]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
  const output = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(output.program.blocks[0].cue.miniGame.kind, 'switches');
  await section.getByLabel('小游戏最多操作数', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '/studio-minigame.png' });
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []); console.log('PASS Mini-game plays in runtime and Studio, saves mid-game, restores, pauses, rolls back and maps skip/abort/success into story decisions');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
