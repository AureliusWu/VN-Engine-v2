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
  const settled = () => page.waitForSelector('#text-script-list[data-dsl-state=success],#text-script-list[data-dsl-state=invalid]');
  const compile = async text => { await input.fill(text); await page.locator('[data-dsl-command=compile]').click(); await settled(); };
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };
  await check('A valid DSL compile reports blocked candidate playback and retries with the real asset directory', async () => {
    const originalLine = project.program.blocks[0].lines[0].text, nextLine = '修复目录后才开始候选演出。';
    const candidate = source.replace(originalLine, nextLine);
    const prior = await page.locator('body').getAttribute('data-preview-revision');
    await page.locator('[data-command=preview]').click();
    await page.waitForFunction(prior => Number(document.body.dataset.previewRevision) > Number(prior), prior);
    await preview.getByText(originalLine, { exact: true }).waitFor();
    const revision = await page.locator('body').getAttribute('data-preview-revision');
    await page.locator('[data-tab=assets]').click();
    await page.locator('#asset-directory').setInputFiles(resolve('examples/dsl'));
    await page.locator('#diagnostics').getByText(/资源目录缺少文件/).first().waitFor();
    await page.locator('[data-tab=text-script]').click();
    await compile(candidate);
    assert.equal(await page.locator('#text-script-list').getAttribute('data-dsl-state'), 'success');
    assert.equal(await page.locator('[data-dsl-command=apply]').isEnabled(), true);
    assert.match(await page.locator('#preview-state').innerText(), /先修复工程错误/);
    assert.equal(await page.locator('body').getAttribute('data-preview-revision'), revision);
    assert.equal(await preview.locator('.vn-text').innerText(), originalLine);
    assert.match(await page.locator('[data-dsl-status]').innerText(), /未启动/);

    await page.locator('[data-tab=source]').click();
    assert.deepEqual(JSON.parse(await page.locator('#source').inputValue()), project);
    await page.locator('[data-tab=assets]').click();
    await page.locator('#asset-directory').setInputFiles(resolve('examples/runtime'));
    await page.locator('[data-tab=text-script]').click();
    await page.locator('[data-dsl-command=compile]').click(); await settled();
    assert.match(await page.locator('[data-dsl-status]').innerText(), /已请求候选试玩/);
    await preview.getByText(nextLine, { exact: true }).waitFor();
    await page.waitForFunction(revision => Number(document.body.dataset.previewRevision) > Number(revision), revision);
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('.vn-background')?.naturalWidth > 0);
    assert.deepEqual(await exported(), project);
  });
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
    await settled();
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.match(await page.locator('.dsl-diagnostics').innerText(), /DSL_ASSET_MISSING/);
    await page.locator('[data-command=undo]').click();
    await settled();
    assert.equal(await page.locator('[data-dsl-command=apply]').isEnabled(), true);
    assert.deepEqual((await exported()).program, project.program);
    await compile(source.replace('game "vn-stage-dsl"', 'game "different"'));
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.match(await page.locator('[data-dsl-status]').innerText(), /不匹配/);
    assert.match(await page.locator('.dsl-diagnostics').innerText(), /DSL_PROJECT_IDENTITY/);
  });

  await check('Studio saves and reopens editable DSL source independently of runtime JSON and applies it with undo and redo', async () => {
    const savedFile = async (workspace, command) => {
      const [download] = await Promise.all([workspace.waitForEvent('download'), workspace.locator(`[data-command=${command}]`).click()]);
      return { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(await download.path()) };
    };
    const newWorkspace = async () => {
      const workspace = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
      workspace.on('pageerror', error => errors.push(error.message));
      workspace.on('dialog', dialog => dialog.accept());
      await workspace.goto(page.url());
      await workspace.waitForSelector('body[data-editor-ready=true]');
      return workspace;
    };
    const openFile = async (workspace, command, file, status) => {
      const [picker] = await Promise.all([workspace.waitForEvent('filechooser'), workspace.locator(`[data-command=${command}]`).click()]);
      await picker.setFiles(file);
      await workspace.waitForFunction(status => document.querySelector('#status').textContent.startsWith(status), status);
    };
    const originalLine = project.program.blocks[0].lines[0].text;
    const baselineText = '# 保留注释及其末尾空格  \n\n' + source.replace(/\r\n?/g, '\n');
    await compile(baselineText);
    await page.locator('[data-dsl-command=apply]').click();
    assert.deepEqual(await exported(), project);
    assert.equal(JSON.parse((await savedFile(page, 'save')).buffer).textScriptSource, baselineText);

    const pendingText = baselineText.replace(originalLine, '未应用的 DSL 源文，保存时保留。');
    await input.fill(pendingText);
    const recovery = await savedFile(page, 'export-recovery');
    const recoveryRecord = JSON.parse(recovery.buffer);
    assert.equal(recoveryRecord.document.textScriptSource, baselineText);
    assert.equal(recoveryRecord.textScriptDraft, pendingText);
    assert.deepEqual(recoveryRecord.document.project, project);

    const workspace = await savedFile(page, 'save');
    const saved = JSON.parse(workspace.buffer);
    assert.equal(saved.textScriptSource, pendingText);
    assert.deepEqual(saved.project, project);
    await page.waitForSelector('body[data-dirty=false]');
    assert.equal(JSON.parse((await savedFile(page, 'export-recovery')).buffer).textScriptDraft, undefined);

    const reopened = await newWorkspace();
    await openFile(reopened, 'open', workspace, '工程已打开');
    await reopened.locator('[data-tab=text-script]').click();
    const reopenedInput = reopened.getByLabel('文本 DSL 内容', { exact: true });
    assert.equal(await reopenedInput.inputValue(), pendingText);
    assert.equal(await reopened.locator('body').getAttribute('data-dirty'), 'false');
    assert.equal(await reopened.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.deepEqual(JSON.parse((await savedFile(reopened, 'export')).buffer), project);

    await reopened.locator('[data-tab=source]').click();
    const runtimeEditor = reopened.locator('#source');
    const manual = JSON.parse(await runtimeEditor.inputValue());
    manual.program.blocks[0].lines[0].text = '直接编辑运行剧本。';
    await runtimeEditor.fill(JSON.stringify(manual));
    await reopened.locator('[data-command=apply-source]').click();
    assert.equal(JSON.parse((await savedFile(reopened, 'save')).buffer).textScriptSource, pendingText);
    await reopened.locator('[data-tab=text-script]').click();
    assert.equal(await reopenedInput.inputValue(), pendingText);

    const appliedText = pendingText.replace('未应用的 DSL 源文，保存时保留。', '已显式应用的 DSL 台词。');
    await reopenedInput.fill(appliedText);
    await reopened.locator('[data-dsl-command=compile]').click();
    await reopened.waitForSelector('#text-script-list[data-dsl-state=success]');
    await reopened.locator('[data-dsl-command=apply]').click();
    await reopened.locator('[data-command=undo]').click();
    assert.equal(await reopenedInput.inputValue(), pendingText);
    assert.deepEqual(JSON.parse((await savedFile(reopened, 'export')).buffer), manual);
    await reopened.locator('[data-command=redo]').click();
    assert.equal(await reopenedInput.inputValue(), appliedText);
    const applied = JSON.parse((await savedFile(reopened, 'save')).buffer);
    assert.equal(applied.textScriptSource, appliedText);
    assert.equal(applied.project.program.blocks[0].lines[0].text, '已显式应用的 DSL 台词。');

    const crlfText = appliedText.replaceAll('\n', '\r\n');
    const crlfFile = { ...workspace, buffer: Buffer.from(JSON.stringify({ ...applied, textScriptSource: crlfText })) };
    await openFile(reopened, 'open', crlfFile, '工程已打开');
    await reopened.locator('[data-tab=text-script]').click();
    assert.equal(await reopenedInput.inputValue(), appliedText);
    await reopened.locator('[data-dsl-command=compile]').click();
    await reopened.waitForSelector('#text-script-list[data-dsl-state=success]');
    await reopened.locator('[data-dsl-command=apply]').click();
    assert.equal(JSON.parse((await savedFile(reopened, 'save')).buffer).textScriptSource, crlfText);
    await reopened.close({ runBeforeUnload: false });

    const recovered = await newWorkspace();
    await openFile(recovered, 'import-recovery', recovery, '恢复文件已打开');
    assert.equal(await recovered.getByLabel('文本 DSL 内容', { exact: true }).inputValue(), pendingText);
    const restored = JSON.parse((await savedFile(recovered, 'export-recovery')).buffer);
    assert.equal(restored.document.textScriptSource, baselineText);
    assert.equal(restored.textScriptDraft, pendingText);
    await recovered.close({ runBeforeUnload: false });
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
