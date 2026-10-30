import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/v1-player';
await mkdir(output, { recursive: true });
const server = await createDemoServer(); await listenBrowserServer(server);
const checks = [], failures = [], errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  const host = page.locator('#game > .vn-engine'), modal = host.locator(':scope > .vn-modal');
  const mount = () => page.evaluate(async () => {
    window.vnDemo?.dispose(); window.v1Player?.dispose(); document.getElementById('v1-outside')?.remove();
    const { mountGame } = await import('./lib/index.js');
    window.v1SlotBytes = new Map(); window.v1DenyReads = false;
    const storage = { getItem(key) { if (v1DenyReads) throw Error('Controlled storage failure'); return v1SlotBytes.get(key) ?? null; },
      setItem(key, value) { v1SlotBytes.set(key, value); }, removeItem(key) { v1SlotBytes.delete(key); } };
    window.v1Player = mountGame(document.getElementById('game'), { schema: 1, game: 'v1-player-safety', version: 'v1', title: 'Player save safety',
      type: 'narrative', assets: [], settings: { textDelayMs: 0 }, scenes: [{ id: 'start', lines: [
        { id: 'one', speaker: 'N', text: 'First saved paragraph.' }, { id: 'two', speaker: 'N', text: 'Current reading paragraph.' }], ending: 'done' }] }, { audio: false, storage });
    v1Player.persistence.saveManual(1); v1Player.session.next(); v1Player.persistence.saveManual(2);
  });
  const check = async (name, run) => {
    try { await run(); checks.push(name); console.log('PASS', name); }
    catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, error.message); await page.screenshot({ path: `${output}/failure-${failures.length}.png`, fullPage: true }); }
  };
  const raw = slot => page.evaluate(slot => v1SlotBytes.get(v1Player.persistence.contract.keyFor(slot)), slot);

  await check('Cancelling overwrite restores the same slot focus, keeps bytes and supports Enter then Escape', async () => {
    await mount(); const originals = [await raw('manual-1'), await raw('manual-2')];
    for (const index of [1, 2]) {
      await host.locator('[data-control=save]').click();
      assert.equal(await modal.getByRole('button', { name: '关闭', exact: true }).evaluate(node => node === document.activeElement), true, 'initial list rendering must keep Close focused');
      await modal.getByRole('button', { name: `保存到槽位 ${index}`, exact: true }).click();
      assert.equal(await modal.getByRole('button', { name: '取消覆盖', exact: true }).evaluate(node => node === document.activeElement), true, 'overwrite confirmation defaults to Cancel');
      await modal.getByRole('button', { name: '取消覆盖', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => ({ inModal: !!document.activeElement.closest('.vn-modal'), slot: document.activeElement.closest('[data-slot]')?.dataset.slot })), { inModal: true, slot: String(index) });
      if (index === 2) await page.screenshot({ path: output + '/overwrite-cancel-focus.png', fullPage: true });
      await page.keyboard.press('Enter'); assert.equal(await modal.getByRole('button', { name: `确认覆盖槽位 ${index}`, exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('.vn-save-confirm') && !document.activeElement.disabled), true, 'opening overwrite confirmation must keep keyboard focus on an enabled confirmation control');
      assert.equal(await modal.getByRole('button', { name: '取消覆盖', exact: true }).evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape'); assert.equal(await modal.isVisible(), false);
      assert.equal(await page.evaluate(() => v1Player.session.getView().paused), false);
    }
    assert.deepEqual([await raw('manual-1'), await raw('manual-2')], originals);
    await page.screenshot({ path: output + '/overwrite-cancel-keyboard.png', fullPage: true });
  });

  await check('A misplaced manual envelope cannot be quick-loaded or enabled in another manual slot', async () => {
    await mount(); const first = await raw('manual-1');
    await page.evaluate(first => {
      for (const slot of ['quick', 'manual-3']) v1SlotBytes.set(v1Player.persistence.contract.keyFor(slot), first);
    }, first);
    await host.focus(); await page.keyboard.press('F9');
    assert.equal(await host.getAttribute('data-line'), 'two'); assert.match(await host.locator('.vn-status').innerText(), /无法读取/);
    assert.equal(await raw('quick'), first);
    await host.locator('[data-control=load]').click();
    assert.equal(await modal.getByRole('button', { name: '读取槽位 3', exact: true }).isDisabled(), true);
    assert.match(await modal.locator('[data-slot="3"]').innerText(), /损坏|不兼容/);
    assert.equal(await raw('manual-3'), first); await page.keyboard.press('Escape');
  });

  await check('Valid manual and quick slots still restore the actual reading position', async () => {
    await mount(); await host.locator('[data-control=load]').click();
    await modal.getByRole('button', { name: '读取槽位 1', exact: true }).click();
    assert.equal(await host.getAttribute('data-line'), 'one'); assert.equal(await modal.isVisible(), false);
    await host.locator('[data-control=quick-save]').click(); await host.locator('[data-control=next]').click();
    assert.equal(await host.getAttribute('data-line'), 'two'); await host.focus(); await page.keyboard.press('F9');
    assert.equal(await host.getAttribute('data-line'), 'one');
  });

  await check('A storage failure during cancellation retains focus on an enabled panel control and preserves saved bytes', async () => {
    await mount(); const first = await raw('manual-1'); await host.locator('[data-control=save]').click();
    await modal.getByRole('button', { name: '保存到槽位 1', exact: true }).click();
    await page.evaluate(() => { v1DenyReads = true; });
    await modal.getByRole('button', { name: '取消覆盖', exact: true }).click();
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.vn-modal') && !document.activeElement.disabled), true);
    assert.equal(await modal.getByRole('button', { name: '关闭', exact: true }).evaluate(node => node === document.activeElement), true, 'an unavailable slot must fall back to Close');
    assert.equal(await raw('manual-1'), first); await page.keyboard.press('Escape'); assert.equal(await modal.isVisible(), false);
    await page.evaluate(() => { v1DenyReads = false; });
  });

  await check('A programmatic cancellation never steals focus from an external input', async () => {
    await mount(); await host.locator('[data-control=save]').click();
    await modal.getByRole('button', { name: '保存到槽位 1', exact: true }).click();
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'v1-outside'; document.body.append(input); input.focus();
      [...document.querySelectorAll('.vn-save-confirm button')].find(button => button.textContent === '取消覆盖').click();
    });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'v1-outside');
    await page.keyboard.type('h1'); assert.equal(await page.locator('#v1-outside').inputValue(), 'h1');
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await page.evaluate(() => v1Player.dispose());
  await writeFile(output + '/v1-player-browser.json', JSON.stringify({ status: failures.length || errors.length ? 'FAIL' : 'PASS', browser: await browser.version(), checks, failures, errors }, null, 2) + '\n');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
