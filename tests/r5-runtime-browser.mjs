import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const out = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/r5-runtime'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const checks = [], failures = [], errors = []; let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  const check = async (name, run) => {
    try { await run(); checks.push(name); console.log('PASS', name); }
    catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, error.message); }
  };
  const mount = async (kind = 'narrative') => page.evaluate(async kind => {
    window.r5Game?.dispose(); window.vnDemo?.dispose();
    const { mountGame } = await import('./lib/index.js');
    let project;
    if (kind === 'mini') {
      const { newProject } = await import('./lib/editor/index.js'); project = newProject('script');
      const next = project.program.blocks[1].id;
      project.program.blocks[0].exit.choices = [{ id: 'yes', text: 'success', next }, { id: 'no', text: 'failure', next }];
      project.program.blocks[0].cue = { miniGame: { id: 'r5-switches', kind: 'switches', initial: [false, false], target: [true, true], maxMoves: 8,
        results: { success: 'yes', failure: 'no', abort: 'no', skip: 'yes' } } };
      project.settings = { textDelayMs: 0 };
    } else {
      project = { schema: 1, game: 'r5-focus', version: 'v1', title: 'R5 focus regression', type: 'narrative', assets: [],
        settings: { textDelayMs: 100, music: false, voiceEnabled: false }, scenes: [
          { id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '第一段文字用来验证点击显示全文后的键盘操作。' },
            { id: 'two', speaker: '旁白', text: '第二段仍然可以使用键盘显示全文并继续。' },
            { id: 'choice', speaker: '旁白', text: '请选择一条路线。' }], choices: [{ id: 'yes', text: '继续', next: 'end' }] },
          { id: 'end', lines: [{ id: 'ending', speaker: '旁白', text: '结束。' }], ending: 'done' }
        ] };
    }
    project.game = 'r5-' + kind; project.titleScreen = false;
    window.r5Game = mountGame(document.getElementById('game'), project, { audio: false, storage: null });
  }, kind);

  await check('Mouse reveal and next retain keyboard reading, numeric choices and ending focus', async () => {
    await mount(); const host = page.locator('#game > .vn-engine');
    await host.locator('[data-control=next]').click();
    assert.equal(await host.evaluate(node => node.contains(document.activeElement)), true);
    await page.keyboard.press('Enter'); assert.equal(await host.getAttribute('data-line'), 'two');
    await page.keyboard.press('Space'); await page.keyboard.press('Enter'); assert.equal(await host.getAttribute('data-line'), 'choice');
    await page.keyboard.press('Enter'); await page.keyboard.press('1'); assert.equal(await host.getAttribute('data-scene'), 'end');
    await page.keyboard.press('Enter');
    assert.equal(await host.evaluate(node => document.activeElement === node), true);
    await page.screenshot({ path: out + '/r5-runtime-keyboard.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: out + '/r5-runtime-keyboard-390.png', fullPage: true });
    await page.setViewportSize({ width: 1100, height: 1000 });
  });

  await check('Mini-game rebuild keeps the same enabled switch and uses a safe fallback for completed controls', async () => {
    await mount('mini'); const host = page.locator('#game > .vn-engine');
    await host.locator('[data-control=mini-game-start]').click(); await host.locator('[data-input="0"]').click();
    assert.equal(await host.locator('[data-input="0"]').evaluate(node => document.activeElement === node), true);
    await page.keyboard.press('Space'); assert.equal(await host.locator('[data-input="0"]').getAttribute('aria-pressed'), 'false');
    await host.locator('[data-input="0"]').click(); await host.locator('[data-input="1"]').click();
    assert.equal(await host.locator('[data-input="1"]').isDisabled(), true);
    assert.equal(await host.evaluate(node => node.contains(document.activeElement) && !document.activeElement.disabled), true);
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => r5Game.session.save().state.decisions[0]?.choiceId), 'yes');
  });

  await check('Typing and externally triggered action rebuilds preserve focus outside the player', async () => {
    await mount();
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'r5-outside'; input.setAttribute('aria-label', 'outside player'); document.body.append(input); input.focus();
      r5Game.session.configure({ textDelayMs: 1 });
    });
    await page.waitForFunction(() => r5Game.session.getView().complete);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'r5-outside');
    await page.evaluate(() => r5Game.session.next()); assert.equal(await page.evaluate(() => document.activeElement.id), 'r5-outside');
    await page.evaluate(() => document.getElementById('r5-outside').remove());
  });

  await check('Real HTML sound resumes the same currentTime after closing settings without recreating the cue', async () => {
    await page.evaluate(async () => {
      r5Game.dispose(); const { mountGame } = await import('./lib/index.js');
      window.r5Audio = []; const nativeCreate = document.createElement;
      window.r5RestoreCreate = () => { document.createElement = nativeCreate; };
      document.createElement = function(...args) { const element = nativeCreate.apply(this, args); if (args[0] === 'audio') r5Audio.push(element); return element; };
      window.r5Game = mountGame(document.getElementById('game'), { schema: 1, game: 'r5-sound', version: 'v1', title: 'R5 sound regression', type: 'narrative',
        assets: [{ id: 'long-cue', kind: 'audio', src: 'assets/music-test.wav' }], settings: { textDelayMs: 0, voiceEnabled: false, music: false },
        scenes: [{ id: 'start', lines: [{ id: 'sound', speaker: '旁白', text: '打开设置后，未结束音效应从暂停位置继续。' }], ending: 'done' }],
        stage: { lines: { sound: { sound: 'long-cue' } } } }, { storage: null });
    });
    try {
      const host = page.locator('#game > .vn-engine'); await host.locator('[data-control=sound]').click();
      await page.waitForFunction(() => r5Audio.length === 1 && r5Audio[0].currentTime > .1);
      await host.locator('[data-control=settings]').click();
      const paused = await page.evaluate(() => ({ paused: r5Audio[0].paused, time: r5Audio[0].currentTime })); assert.equal(paused.paused, true);
      await host.getByRole('button', { name: '关闭', exact: true }).click();
      await page.waitForFunction(time => !r5Audio[0].paused && r5Audio[0].currentTime > time + .08, paused.time, { timeout: 2000 });
      assert.equal(await page.evaluate(() => r5Audio.length), 1);
    } finally { await page.evaluate(() => { r5Game.dispose(); r5RestoreCreate(); }); }
  });
  assert.deepEqual(errors, []);
  await writeFile(out + '/r5-runtime-browser.json', JSON.stringify({ status: failures.length || errors.length ? 'FAIL' : 'PASS', browser: await browser.version(), mode: 'headless',
    checks, failures, errors, screenshots: ['r5-runtime-keyboard.png', 'r5-runtime-keyboard-390.png'] }, null, 2));
  assert.deepEqual(failures, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
