import { listenBrowserServer } from '../tools/browser-server.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await listenBrowserServer(server);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'no-preference' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); vnDemo.dispose();
    const project = { schema: 1, game: 'rollback-fixture', version: 'v1', title: 'Rollback fixture', type: 'script', settings: { textDelayMs: 0 },
      assets: [{ id: 'hero', kind: 'portrait', src: 'assets/student.svg' }, { id: 'memory', kind: 'cg', src: 'assets/letter.svg' }],
      program: { schema: 1, game: 'rollback-fixture', version: 'v1', entry: 'start', variables: { trust: { initial: 0 } }, blocks: [
        { id: 'start', lines: [{ id: 'one', speaker: 'N', text: 'choose a route', cue: { layers: { 'character-front': { asset: 'hero', kind: 'portrait' } }, timeline: { durationMs: 10000, animations: [{ id: 'move', layer: 'character-front', to: { x: 60 }, durationMs: 10000 }] } } }],
          exit: { type: 'choice', choices: [{ id: 'yes', text: 'yes', next: 'end', effects: [{ op: 'add', key: 'trust', value: 2 }] }] } },
        { id: 'end', lines: [{ id: 'two', speaker: 'N', text: 'ending', cue: { cg: 'memory' } }], exit: { type: 'end', ending: 'done' } }
      ] } };
    for (const key of Object.keys(localStorage)) if (key.startsWith('vn-engine:' + project.game + ':')) localStorage.removeItem(key);
    window.rollbackGame = mountGame(document.getElementById('game'), project, { baseURL: new URL('./', location.href), audio: false });
  });
  const host = page.locator('#game > .vn-engine'); assert.equal(await host.locator('[data-control=rollback]').isDisabled(), true);
  await host.locator('[data-action=yes]').click(); await page.evaluate(() => { rollbackGame.persistence.saveManual(1); rollbackGame.persistence.quickSave(); });
  await page.evaluate(()=>rollbackGame.readProgress.flush());
  const records = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('vn-engine:rollback-fixture:')).map(key => [key, localStorage.getItem(key)])));
  await host.locator('[data-control=rollback]').click(); await host.locator('[data-action=yes]').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => rollbackGame.session.driver.engine.decode(JSON.stringify(rollbackGame.session.save())).variables.trust), 0);
  assert.deepEqual(await page.evaluate(() => rollbackGame.session.save().state.decisions), []);
  assert.equal(await host.locator('.vn-character-front').evaluate(node => node.style.transform), 'translate(60px, 0px) scale(1)');
  assert.equal(await host.locator('.vn-cg').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('vn-engine:rollback-fixture:')).map(key => [key, localStorage.getItem(key)]))), records);
  await host.locator('[data-action=yes]').click(); await host.focus(); await page.keyboard.press('Backspace');
  await host.locator('[data-action=yes]').waitFor({ state: 'visible' });
  await page.evaluate(() => rollbackGame.persistence.quickLoad()); assert.match(await host.locator('.vn-text').innerText(), /ending/);
  assert.equal(await host.locator('[data-control=rollback]').isDisabled(), true);
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  await page.getByLabel('允许回退', { exact: true }).selectOption('false');
  const preview = page.frameLocator('#preview'); await preview.locator('[data-control=rollback]').waitFor({ state: 'hidden' });
  await page.getByLabel('回退保留步数', { exact: true }).fill('0'); await page.getByLabel('回退保留步数', { exact: true }).blur();
  assert.equal(await page.locator('[data-command=export]').isDisabled(), true);
  await page.getByLabel('回退保留步数', { exact: true }).fill('2'); await page.getByLabel('回退保留步数', { exact: true }).blur();
  assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  await page.getByLabel('允许回退', { exact: true }).selectOption('true'); await preview.locator('[data-control=rollback]').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []); console.log('PASS Rollback restores choice state and final presentation without changing Save/Meta, supports Backspace and resets at load');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
