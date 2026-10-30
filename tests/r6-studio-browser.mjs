import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/r6-studio';
await mkdir(output, { recursive: true });
const server = await createDemoServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const checks = [], errors = [], confirmations = [];
let confirmReplacement = false;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') {
      confirmations.push(dialog.message());
      await (confirmReplacement ? dialog.accept() : dialog.dismiss());
    } else await dialog.accept();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`);
  await page.waitForSelector('body[data-editor-ready=true]');
  const source = page.getByLabel('工程 JSON 内容', { exact: true });
  const sourceTab = () => page.getByRole('button', { name: '工程 JSON', exact: true }).click();
  const storyTab = () => page.getByRole('button', { name: '场景与分支', exact: true }).click();
  const command = name => page.locator(`[data-command=${name}]`).click();
  const passed = text => { checks.push(text); console.log('PASS', text); };
  const waitDraft = value => page.waitForFunction(value =>
    JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.source === value, value);
  const downloaded = async name => {
    const event = page.waitForEvent('download'); await command(name);
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };

  await sourceTab();
  const initial = JSON.parse(await source.inputValue());
  const edited = { ...initial, title: 'R6 applied JSON project' };
  const raw = '\n' + JSON.stringify(edited, null, 4) + '\n\n';
  await source.fill(raw); await waitDraft(raw);
  await sourceTab(); await sourceTab();
  assert.equal(await source.inputValue(), raw);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  assert.deepEqual(confirmations, []);
  await source.press('Control+Home');
  await page.screenshot({ path: output + '/json-same-tab.png', fullPage: true });
  passed('Repeated active JSON tabs preserve valid unapplied raw text and its dirty state without confirmation');

  const invalid = '{ "R6 invalid and unapplied JSON":\n';
  await source.fill(invalid); await sourceTab();
  assert.equal(await source.inputValue(), invalid);
  assert.deepEqual(confirmations, []);
  await waitDraft(invalid);
  await page.reload(); await page.waitForSelector('body[data-editor-ready=true]');
  confirmReplacement = true; await command('restore-draft'); confirmReplacement = false;
  assert.equal(await source.inputValue(), invalid);
  await sourceTab();
  assert.equal(await source.inputValue(), invalid);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  passed('Invalid unapplied JSON survives active-tab clicks, local draft reload and restoration');

  await source.fill(raw); await command('apply-source');
  assert.equal(await page.locator('#project-name').innerText(), edited.title);
  assert.deepEqual(await downloaded('export'), edited);
  const workspace = await downloaded('save');
  assert.deepEqual(workspace.project, edited);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
  await sourceTab();
  assert.equal(await source.inputValue(), raw);
  assert.deepEqual(confirmations, []);
  passed('Applying valid JSON exports and saves the exact applied project while active-tab clicks retain raw formatting');

  const discarded = JSON.stringify({ ...edited, title: 'R6 explicitly discarded JSON' }, null, 2);
  await source.fill(discarded); await waitDraft(discarded);
  await storyTab();
  assert.equal(await page.locator('#source-panel').isVisible(), true);
  assert.equal(await source.inputValue(), discarded);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  assert.equal(confirmations.length, 1);
  passed('Cancelling departure from JSON preserves the active panel, unapplied text and dirty state');

  // A clean workspace does not save on beforeunload, and pagehide cancels debounce timers.
  // Freeze the draft debounce so only synchronous persistence can pass this check.
  await page.evaluate(() => {
    const schedule = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => delay === 350 ? 0 : schedule(callback, delay, ...args);
  });
  confirmReplacement = true; await storyTab(); confirmReplacement = false;
  assert.equal(await page.locator('#story-panel').isVisible(), true);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
  assert.equal(await page.locator('#save-state').innerText(), '已保存');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1')).source), undefined);
  assert.equal(confirmations.length, 2);
  passed('Confirmed departure synchronously discards unapplied text from the draft and refreshes saved state before reload');

  await page.reload(); await page.waitForSelector('body[data-editor-ready=true]');
  confirmReplacement = true; await command('restore-draft'); confirmReplacement = false;
  await sourceTab();
  assert.deepEqual(JSON.parse(await source.inputValue()), edited);
  assert.equal((await source.inputValue()).includes('R6 explicitly discarded JSON'), false);
  assert.deepEqual(await downloaded('export'), edited);
  passed('Restoring the post-discard draft cannot resurrect explicitly discarded JSON or change the applied project');

  assert.deepEqual(errors, []);
  await writeFile(output + '/r6-studio-browser.json', JSON.stringify({ status: 'PASS', checks,
    browser: await browser.version(), mode: 'headless', syntheticProject: true }, null, 2) + '\n');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
