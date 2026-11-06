import { listenBrowserServer } from '../tools/browser-server.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';
import { newProject } from '../dist/editor/model.js';
import { installPreviewReplyGate } from './preview-reply-fixture.mjs';

const server = await createDemoServer(); await listenBrowserServer(server);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  const gate = await installPreviewReplyGate(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  await page.locator('#sample').selectOption('campus'); await page.locator('[data-command=sample]').click();
  const preview = page.frameLocator('#preview'); await preview.locator('.vn-portrait').waitFor({ state: 'visible' });
  await page.locator('#auto-preview').uncheck();
  const revision = async () => Number(await page.locator('body').getAttribute('data-preview-revision'));
  const waitRevision = prior => page.waitForFunction(prior => Number(document.body.dataset.previewRevision) > prior, prior);
  const refresh = async () => { const prior = await revision(); await page.locator('[data-command=preview]').click(); await waitRevision(prior); };
  await page.locator('[data-tab=collections]').click(); const panel = page.locator('#collection-list');
  await panel.getByRole('button', { name: '添加CG', exact: true }).click();
  await panel.getByLabel('CG 1 标题', { exact: true }).fill('测试回忆'); await panel.getByLabel('CG 1 标题', { exact: true }).blur();
  await refresh();
  await preview.locator('.vn-engine[data-ready=true]').waitFor({ state: 'visible' });
  await preview.locator('[data-control=next]').click();
  await panel.getByRole('button', { name: '使用当前预览作为回看起点', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="CG 1 回看数据"]').value.includes('storyVersion'));
  const captured = JSON.parse(await panel.getByLabel('CG 1 回看数据', { exact: true }).inputValue());
  assert.equal(captured.state.line, 1);
  await panel.getByRole('button', { name: '添加结局', exact: true }).click();
  await panel.getByLabel('结局 1 真结局', { exact: true }).selectOption('true');
  await panel.getByRole('button', { name: '启用真路线规则', exact: true }).click();
  const ending = await panel.getByLabel('结局 1 ID', { exact: true }).inputValue();
  await panel.getByLabel('需要看过的结局 ID', { exact: true }).fill(ending); await panel.getByLabel('需要看过的结局 ID', { exact: true }).blur();
  await panel.getByLabel('CG 1 回看数据', { exact: true }).fill('{"invalid":true}'); await panel.getByLabel('CG 1 回看数据', { exact: true }).blur();
  assert.equal(await page.locator('[data-command=export]').isDisabled(), true);
  assert.match(await page.locator('#diagnostics').innerText(), /回看起点/);
  await page.locator('[data-command=undo]').click(); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
  const project = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(project.collections.cgs[0].title, '测试回忆'); assert.equal(project.collections.cgs[0].replay.state.line, 1);
  assert.equal(project.collections.endings[0].trueEnding, true); assert.deepEqual(project.collections.trueRoute.endings, [ending]);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
  await page.screenshot({ path: out + '/studio-collections.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const script = newProject('script');
  script.title = 'Replay capture fixture';
  script.settings = { textDelayMs: 0 };
  script.collections = { endings: [{ id: '完成' }] };
  await page.locator('#open-file').setInputFiles({ name: 'replay-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(script)) });
  await page.waitForFunction(() => document.getElementById('project-name').textContent === 'Replay capture fixture');
  await refresh();
  const openCollections = () => page.locator('[data-tab=collections]').click();
  const capture = () => panel.getByRole('button', { name: '使用当前预览作为回看起点', exact: true }).click();
  const replayData = panel.getByLabel('结局 1 回看数据', { exact: true });
  const expectDifferentSource = async () => {
    await capture();
    await page.waitForFunction(() => /当前工程.*从头试玩|从头试玩.*当前工程/.test(document.getElementById('status').textContent), null, { timeout: 4000 });
    assert.equal(await replayData.inputValue(), '');
  };
  await page.locator('[data-tab=text-script]').click();
  const source = ['vn-script 1', `game "${script.game}"`, `version "${script.version}"`, 'entry start',
    'block start', 'line intro "N" "Candidate introduction"', 'choice candidate "Candidate choice" -> finish',
    'block finish', 'line outro "N" "Candidate ending"', 'end 完成', ''].join('\n');
  await page.locator('[data-dsl-source]').fill(source);
  const prior = await revision();
  await page.locator('[data-dsl-command=compile]').click(); await waitRevision(prior);
  await preview.locator('[data-action=candidate]').click();
  await openCollections(); await expectDifferentSource();

  await refresh(); await preview.locator('[data-action=yes]').click();
  const changed = structuredClone(script);
  changed.title = 'Same identity, different route';
  changed.program.blocks[0].exit.choices[0].id = 'new-choice';
  await page.locator('[data-tab=source]').click();
  await page.locator('#source').fill(JSON.stringify(changed));
  await page.locator('[data-command=apply-source]').click();
  await openCollections(); await expectDifferentSource();

  await refresh();
  await preview.locator('[data-action=new-choice]').click();
  await gate.hold('captured-replay'); await capture();
  const oldPreview = await gate.wait();
  await refresh(); await gate.release(oldPreview);
  assert.ok(await revision() > oldPreview.revision);
  assert.equal(await replayData.inputValue(), '', 'Refreshing the same source must cancel a pending capture');

  await gate.hold('captured-replay'); await capture();
  const first = await gate.wait();
  await page.waitForFunction(() => /未响应|超时/.test(document.getElementById('status').textContent), null, { timeout: 7500 });
  await preview.locator('[data-action=new-choice]').click();
  await capture(); const second = await gate.wait(2);
  assert.equal(first.revision, second.revision);
  assert.equal(first.saved.state.blockId, 'start'); assert.equal(second.saved.state.blockId, 'end');
  await gate.release(first);
  assert.equal(await replayData.inputValue(), '', 'Timed-out reply must not fill the newer request at the same revision');
  assert.equal(typeof first.requestId, 'string'); assert.notEqual(first.requestId, second.requestId);
  await gate.release(second);
  await page.waitForFunction(() => document.querySelector('[aria-label="结局 1 回看数据"]').value.length > 0);
  const current = JSON.parse(await replayData.inputValue());
  assert.deepEqual(current.state.decisions, [{ blockId: 'start', choiceId: 'new-choice' }]);
  assert.deepEqual(errors, []);
  console.log('PASS Studio collections captures only the current project, rejects late replies, diagnoses invalid saves, exports policy and supports undo');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
