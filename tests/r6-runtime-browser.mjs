import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/r6-runtime';
await mkdir(output, { recursive: true });
const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const checks = [], failures = [], errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  const host = page.locator('#game > .vn-engine'), modal = host.locator(':scope > .vn-modal');
  const mount = async (titleScreen = false, audio = false) => page.evaluate(async ({ titleScreen, audio }) => {
    window.vnDemo?.dispose(); window.r6Game?.dispose(); window.r6RestoreCreate?.(); document.getElementById('r6-outside')?.remove();
    const { mountGame } = await import('./lib/index.js');
    window.r6Audio = []; const create = document.createElement;
    document.createElement = function (...args) {
      const player = create.apply(this, args);
      if (args[0] === 'audio') {
        const record = { player, plays: 0, ended: 0, errors: 0 }, play = player.play;
        player.play = function (...values) { record.plays++; return play.apply(this, values); };
        player.addEventListener('ended', () => record.ended++); player.addEventListener('error', () => record.errors++);
        r6Audio.push(record);
      }
      return player;
    };
    window.r6RestoreCreate = () => { document.createElement = create; };
    const project = { schema: 1, game: 'r6-lifecycle', version: 'v1', title: 'R6 lifecycle regression', titleScreen, type: 'narrative',
      assets: [{ id: 'cue', kind: 'audio', src: 'assets/music-test.wav' }], settings: { textDelayMs: 0, voiceEnabled: false, music: false },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '鼠标隐藏界面后仍可使用 H 恢复并继续。' },
        { id: 'two', speaker: '旁白', text: '恢复按钮之后，Enter 仍然推进阅读。' }, { id: 'choice', speaker: '旁白', text: '数字键选择。' }],
        choices: [{ id: 'yes', text: '完成', next: 'end' }] }, { id: 'end', lines: [{ id: 'ending', speaker: '旁白', text: '完成。' }], ending: 'done' }],
      stage: { lines: { one: { sound: 'cue' }, two: { sound: 'cue' } } } };
    window.r6Game = mountGame(document.getElementById('game'), project, { storage: null, audio });
  }, { titleScreen, audio });
  const check = async (name, run) => {
    try { await run(); checks.push(name); console.log('PASS', name); }
    catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, error.message); await page.screenshot({ path: `${output}/failure-${failures.length}.png` }); }
  };
  const audioPlaying = async count => page.waitForFunction(count => r6Audio.length === count && !r6Audio.at(-1).player.paused && r6Audio.at(-1).player.currentTime > .05, count, { timeout: 5000 });

  await check('Mouse hide and restore preserve H, Enter and numeric-choice reading', async () => {
    await mount();
    await host.locator('[data-control=hide]').click();
    assert.equal(await host.evaluate(node => document.activeElement === node), true);
    await page.keyboard.press('h'); assert.equal(await page.evaluate(() => r6Game.session.getView().hidden), false);
    await page.keyboard.press('Enter'); assert.equal(await host.getAttribute('data-line'), 'two');
    await host.locator('[data-control=hide]').click(); await host.locator('.vn-restore').click();
    assert.equal(await host.evaluate(node => document.activeElement === node), true);
    await page.keyboard.press('h'); assert.equal(await page.evaluate(() => r6Game.session.getView().hidden), true);
    await page.keyboard.press('h'); await page.keyboard.press('Enter'); assert.equal(await host.getAttribute('data-line'), 'choice');
    await page.keyboard.press('1'); assert.equal(await host.getAttribute('data-scene'), 'end');
    await page.screenshot({ path: output + '/keyboard-after-restore.png' });
  });

  await check('Programmatic visibility changes preserve external focus and modal search input', async () => {
    await mount();
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'r6-outside'; input.setAttribute('aria-label', 'outside player'); document.body.append(input); input.focus();
      r6Game.session.hide(true); r6Game.session.hide(false);
    });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'r6-outside');
    await page.keyboard.type('h1'); assert.equal(await page.locator('#r6-outside').inputValue(), 'h1'); assert.equal(await host.getAttribute('data-line'), 'one');
    await host.locator('[data-control=history]').click(); const search = modal.getByLabel('搜索已读记录');
    await search.focus(); await page.evaluate(() => { r6Game.session.hide(true); r6Game.session.hide(false); });
    assert.equal(await search.evaluate(node => document.activeElement === node), true);
    await page.keyboard.type('h1'); assert.equal(await search.inputValue(), 'h1'); assert.equal(await host.getAttribute('data-line'), 'one');
    await page.keyboard.press('Escape');
  });

  await check('Title and new-game confirmation defer first SE until visible, resume it and never revive ended, disabled or failed audio', async () => {
    await mount(true, true);
    await modal.locator('[data-control=title-new]').click(); assert.equal(await page.evaluate(() => r6Audio.length), 0);
    await modal.getByRole('button', { name: '确认开始新游戏', exact: true }).click(); await audioPlaying(1);
    assert.equal(await page.evaluate(() => r6Audio[0].player instanceof HTMLAudioElement && r6Audio[0].plays === 1), true);
    await host.locator('[data-control=settings]').click();
    const stopped = await page.evaluate(() => ({ paused: r6Audio[0].player.paused, time: r6Audio[0].player.currentTime })); assert.equal(stopped.paused, true);
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
    await page.waitForFunction(time => r6Audio.length === 1 && !r6Audio[0].player.paused && r6Audio[0].player.currentTime > time + .05, stopped.time, { timeout: 5000 });
    await page.evaluate(() => { r6Audio[0].player.currentTime = Math.max(0, r6Audio[0].player.duration - .03); });
    await page.waitForFunction(() => r6Audio[0].ended === 1);
    const endedPlays = await page.evaluate(() => r6Audio[0].plays);
    await host.locator('[data-control=settings]').click(); await modal.getByRole('button', { name: '关闭', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => [r6Audio.length, r6Audio[0].plays]), [1, endedPlays]);
    await host.locator('[data-control=restart]').click(); assert.equal(await page.evaluate(() => r6Audio.length), 1);
    await modal.getByRole('button', { name: '确认开始新游戏', exact: true }).click(); await audioPlaying(2);
    await host.locator('[data-control=settings]').click();
    await modal.getByLabel('动作音效', { exact: true }).uncheck(); await modal.getByLabel('动作音效', { exact: true }).check();
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.evaluate(() => r6Audio.length === 2 && r6Audio[1].player.paused && r6Audio[1].plays === 1), true);
    await page.evaluate(() => r6Game.session.restart()); await audioPlaying(3);
    await page.evaluate(() => { r6Audio[2].player.src = 'assets/r6-missing-audio.wav'; r6Audio[2].player.load(); });
    await page.waitForFunction(() => r6Audio[2].errors === 1);
    await host.locator('[data-control=settings]').click(); await modal.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.evaluate(() => r6Audio.length === 3 && r6Audio[2].plays === 1 && r6Audio[2].player.paused), true);
    await page.screenshot({ path: output + '/title-first-effect.png' });
  });

  await check('Visit changes stop old audio; restore, reread, rollback and disposal cannot replay consumed effects', async () => {
    await mount(false, true); await host.locator('[data-control=sound]').click(); await audioPlaying(1);
    await page.evaluate(() => { window.r6FirstSave = r6Game.session.save(); });
    await host.locator('[data-control=next]').click(); await audioPlaying(2);
    assert.equal(await page.evaluate(() => r6Audio[0].player.paused), true);
    await page.evaluate(() => { r6Game.session.restore(r6FirstSave); r6Game.session.hide(true); r6Game.session.hide(false); });
    assert.equal(await page.evaluate(() => r6Audio.length === 2 && r6Audio[1].player.paused), true);
    assert.equal(await page.evaluate(() => r6Game.session.reread(r6Game.session.history()[0].id)), true);
    assert.equal(await page.evaluate(() => r6Audio.length), 2);
    await page.evaluate(() => r6Game.session.next()); await audioPlaying(3);
    assert.equal(await page.evaluate(() => r6Game.session.rollback()), true);
    await page.evaluate(() => { r6Game.session.pause('panel', true); r6Game.session.pause('panel', false); });
    assert.equal(await page.evaluate(() => r6Audio.length === 3 && r6Audio[2].player.paused), true);
    await page.evaluate(() => { r6Game.dispose(); r6Game.unlockAudio(); }); assert.equal(await page.evaluate(() => r6Audio.length), 3);
    await mount(true, true); await modal.locator('[data-control=title-settings]').click();
    assert.equal(await page.evaluate(() => r6Audio.length), 0);
    await page.evaluate(() => { r6Game.dispose(); r6Game.unlockAudio(); }); assert.equal(await page.evaluate(() => r6Audio.length), 0);
  });
  await page.evaluate(() => { window.r6Game?.dispose(); window.r6RestoreCreate?.(); });
  await writeFile(output + '/r6-runtime-browser.json', JSON.stringify({ status: failures.length || errors.length ? 'FAIL' : 'PASS',
    browser: await browser.version(), mode: 'headless', checks, failures, errors }, null, 2) + '\n');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
