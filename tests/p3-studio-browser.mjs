import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { createDemoServer } from '../tools/serve.mjs';
import { listenBrowserServer } from '../tools/browser-server.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/p3-studio';
await mkdir(output, { recursive: true });
const source = await readFile('examples/dsl/stage.vn.txt', 'utf8');
const project = JSON.parse(await readFile('examples/runtime/stage.json', 'utf8'));
const server = await createDemoServer(); await listenBrowserServer(server);
const errors = [], checks = []; let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  await page.locator('#auto-preview').uncheck();
  await page.locator('#sample').selectOption('stage'); await page.locator('[data-command=sample]').click();
  await page.waitForFunction(game => document.querySelector('[aria-label="作品 ID"]').value === game, project.game);
  await page.locator('[data-tab=assets]').click();
  await page.locator('#asset-directory').setInputFiles(resolve('examples/runtime'));
  await page.waitForFunction(() => document.querySelector('#asset-state').textContent.startsWith('已绑定 '));
  const preview = page.frameLocator('#preview'), input = page.getByLabel('文本 DSL 内容', { exact: true });
  const exported = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
    return JSON.parse(await readFile(await download.path(), 'utf8'));
  };
  const compile = async text => { await input.fill(text); await page.locator('[data-dsl-command=compile]').click(); };
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };
  await page.locator('[data-tab=text-script]').click();
  const candidate = source.replace('背景、立绘和声音来自同一份演出文本。', '候选演出文本，尚未改变当前工程。');
  await check('Studio compiles cue candidates with current assets, previews real images and applies one undoable transaction', async () => {
    await compile(candidate);
    await preview.getByText('候选演出文本，尚未改变当前工程。', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const doc = document.getElementById('preview').contentDocument;
      return doc.querySelector('.vn-background')?.naturalWidth > 0 && doc.querySelector('.vn-portrait')?.naturalWidth > 0;
    });
    assert.deepEqual((await exported()).program, project.program);
    await page.locator('[data-dsl-command=apply]').click();
    const applied = await exported(); assert.match(applied.program.blocks[0].lines[0].text, /候选演出/);
    assert.equal(applied.program.blocks[0].lines[0].cue.voice, 'greeting');
    for (const key of Object.keys(project).filter(key => key !== 'program')) assert.deepEqual(applied[key], project[key]);
    assert.equal(applied.sourceMap, undefined); assert.equal(applied.program.sourceMap, undefined); assert.equal(applied.source, undefined);
    await page.locator('[data-command=undo]').click(); assert.deepEqual((await exported()).program, project.program);
  });
  await check('Missing and wrong-kind asset diagnostics select the exact current DSL cue and preserve JSON', async () => {
    for (const [text, code, selected] of [
      [source.replace('voice greeting', 'voice missing-voice'), 'DSL_ASSET_MISSING', 'cue line hello voice missing-voice'],
      [source.replace('background classroom', 'background bgm'), 'DSL_ASSET_KIND', 'cue block start background bgm']
    ]) {
      await compile(text); assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
      const diagnostic = page.locator('[data-dsl-diagnostic]').filter({ hasText: code }); await diagnostic.first().click();
      assert.equal(await input.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), selected);
      assert.deepEqual((await exported()).program, project.program);
    }
    await compile(source.replace('voice greeting', 'voice "<img src=x onerror=globalThis.p3Injected=true>"'));
    assert.equal(await page.locator('.dsl-diagnostics img').count(), 0); assert.equal(await page.evaluate(() => globalThis.p3Injected), undefined);
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
  });
  await check('A changed resource catalog invalidates an already compiled candidate and undo rechecks it', async () => {
    await compile(source); assert.equal(await page.locator('[data-dsl-command=apply]').isEnabled(), true);
    await page.locator('[data-tab=assets]').click();
    const card = page.locator('.asset-card').filter({ has: page.getByRole('heading', { name: 'greeting', exact: true }) });
    await card.getByRole('button', { name: '移除资源条目', exact: true }).click();
    await page.locator('[data-tab=text-script]').click();
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.match(await page.locator('.dsl-diagnostics').innerText(), /DSL_ASSET_MISSING/);
    await page.locator('[data-command=undo]').click();
    assert.equal(await page.locator('[data-dsl-command=apply]').isEnabled(), true);
    assert.deepEqual((await exported()).program, project.program);
    await compile(source.replace('game "vn-stage-dsl"', 'game "different"'));
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.match(await page.locator('[data-dsl-status]').innerText(), /不匹配/);
    assert.match(await page.locator('.dsl-diagnostics').innerText(), /DSL_PROJECT_IDENTITY/);
  });
  await compile(source.replace('voice greeting', 'voice missing-voice'));
  await page.screenshot({ path: output + '/resource-diagnostic-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + '/resource-diagnostic-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'PASS', checks, errors, viewport: [1360, 390], syntheticAssets: true, physicalAudioListening: false }, null, 2) + '\n');
} catch (error) {
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'FAIL', checks, errors, failure: error.stack }, null, 2) + '\n'); throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
