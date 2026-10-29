import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { createDemoServer } from '../tools/serve.mjs';
import { packageStudio } from '../tools/package-studio.mjs';
import { EditorModel, newProject } from '../dist/editor/index.js';
import { ENGINE_VERSION, runRouteSuite } from '../dist/index.js';

const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
const checks = [], errors = [], passed = label => { checks.push(label); console.log('PASS', label); }; let browser, standalone;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  assert.equal(await page.locator('#version').innerText(), ENGINE_VERSION);
  await page.evaluate(() => localStorage.setItem('vn-engine:workbench-player:v2:save:manual-1', 'ORIGINAL_PLAYER_SAVE'));
  const command = name => page.locator(`[data-command=${name}]`).click(), tab = name => page.locator(`[data-tab=${name}]`).click(), preview = page.frameLocator('#preview');
  const edit = async (label, value) => { await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).blur(); };
  const upload = async project => { await page.locator('#open-file').setInputFiles({ name: 'workbench.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) }); await page.waitForFunction(title => document.querySelector('#project-name').textContent === title, project.title); };
  const download = async action => { const [file] = await Promise.all([page.waitForEvent('download'), command(action)]); return JSON.parse(await readFile(await file.path(), 'utf8')); };
  const refresh = async () => { const old = await page.getAttribute('body', 'data-preview-revision'); await command('preview'); await page.waitForFunction(revision => document.body.dataset.previewRevision !== revision && document.querySelector('#preview-state').textContent.includes('当前工程'), old); };
  const runRoutes = async () => { await tab('routes'); await page.locator('[data-route-command=run]').click(); await page.waitForFunction(() => ['PASS', 'FAIL', 'UNVERIFIED'].includes(document.body.dataset.routeStatus)); assert.equal(await page.getAttribute('body', 'data-route-status'), 'PASS'); };

  const script = newProject('script'); script.title = 'v0.4 变量工作台'; script.settings = { textDelayMs: 0 }; script.program.variables.trust.metadata = '保留作者字段';
  script.routeTests = { schema: 1, cases: [{ id: 'authored', steps: [{ type: 'action', id: 'yes' }], expect: { ending: '完成', variables: { trust: 3, flag: true } } }] };
  await upload(script); await tab('structure'); await edit('变量 trust ID', 'affinity');
  await page.getByLabel('变量 affinity 类型', { exact: true }).selectOption('boolean'); assert.match(await page.locator('#status').innerText(), /不能直接改变类型/);
  assert.equal(await page.getByLabel('变量 affinity 类型', { exact: true }).inputValue(), 'boolean');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  await page.getByLabel('变量 affinity 类型', { exact: true }).selectOption('number');
  await edit('变量 affinity 最大值', '-1'); assert.match(await page.locator('#status').innerText(), /边界/); assert.equal(await page.getByLabel('变量 affinity 最大值', { exact: true }).inputValue(), '-1');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  await edit('变量 affinity 最大值', '20');
  assert.equal(await page.getByRole('button', { name: '删除变量 affinity', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '添加布尔变量', exact: true }).click(); await edit('变量 variable-1 ID', 'flag');
  await page.getByRole('button', { name: '添加数值变量', exact: true }).click(); await page.getByRole('button', { name: '删除变量 variable-1', exact: true }).click(); await command('undo');
  assert.equal(await page.locator('[data-variable-id=variable-1]').count(), 1); await command('redo');
  await page.getByRole('button', { name: '定位 affinity 引用 1', exact: true }).click();
  await page.getByLabel('选择 1 效果 1 运算', { exact: true }).selectOption('set'); await edit('选择 1 效果 1 值', '3');
  await page.getByRole('button', { name: '选择 1 添加效果', exact: true }).click(); await page.getByLabel('选择 1 效果 2 变量', { exact: true }).selectOption('flag');
  assert.equal(await page.getByLabel('选择 1 效果 2 运算', { exact: true }).locator('option').count(), 1); await page.getByLabel('选择 1 效果 2 值', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: '选择 1 添加效果', exact: true }).click(); await edit('选择 1 效果 3 值', '2');
  await page.getByRole('button', { name: '选择 1 效果 3 上移', exact: true }).click(); await page.getByRole('button', { name: '选择 1 效果 2 上移', exact: true }).click();
  const authored = await download('export'); assert.deepEqual(authored.program.blocks[0].exit.choices[0].effects.map(e => [e.op, e.key, e.value]), [['add', 'affinity', 2], ['set', 'affinity', 3], ['set', 'flag', true]]);
  assert.equal(authored.program.variables.affinity.metadata, '保留作者字段'); assert.equal(runRouteSuite(authored).status, 'PASS');
  await refresh(); await preview.locator('[data-action=yes]').click(); await preview.locator('.vn-text').filter({ hasText: '这里等待你的故事' }).waitFor(); await runRoutes();
  passed('Variable catalog rename, typed ordered effects and bounded input produce a real passing runtime/Worker route without JSON authoring');
  await tab('story'); await page.getByRole('button', { name: '编辑节点 start', exact: true }).click();
  await edit('选择 1 效果 2 值', ''); assert.match(await page.locator('#status').innerText(), /有限数值/); assert.equal(await page.getByLabel('选择 1 效果 2 值', { exact: true }).inputValue(), '');
  for (const action of ['export', 'save']) {
    const invalidDownload = page.waitForEvent('download', { timeout: 300 }).then(() => true, error => { if (error.name === 'TimeoutError') return false; throw error; });
    await command(action); assert.equal(await invalidDownload, false, 'Invalid pending effect input must block ' + action);
    assert.match(await page.locator('#status').innerText(), /有限数值/);
    assert.equal(await page.getByLabel('选择 1 效果 2 值', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  }
  await edit('选择 1 效果 2 值', '3');
  assert.deepEqual(await download('export'), authored);
  const workspace = await download('save'); assert.equal(workspace.format, 'vn-engine-editor'); assert.deepEqual(new EditorModel(workspace).getView().project, authored);
  await tab('structure'); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: out + '/workbench-variables.png', fullPage: true });
  await page.reload(); await page.waitForSelector('body[data-editor-ready=true]'); await command('restore-draft'); await tab('structure');
  assert.equal(await page.getByLabel('变量 affinity 最大值', { exact: true }).inputValue(), '20'); assert.equal(await page.locator('[data-variable-id=flag]').count(), 1);
  passed('Invalid effect input blocks export/save until corrected; workspace and draft restoration preserve exact variables, effects and metadata');

  const investigation = newProject('investigation'); investigation.title = 'v0.4 多章工作台'; investigation.settings = { textDelayMs: 0 };
  const first = ['read', 'back', 'reason'].map(id => ({ type: 'action', id })); investigation.routeTests = { schema: 1, cases: [
    { id: 'one', steps: first, expect: { ending: 'chapter-1:complete' } },
    { id: 'two', steps: [...first, { type: 'action', id: '@chapter:chapter-2' }, { type: 'next' }], expect: { ending: 'chapter-2:complete', lineId: 'chapter-2/end' } }
  ] };
  await upload(investigation); await tab('structure'); await page.getByRole('button', { name: '添加章节', exact: true }).click();
  await edit('章节 chapter-2 标题', '终章'); await edit('章节 chapter-2 ID', 'final');
  const beforeMove = await download('export'); assert.equal(beforeMove.routeTests.cases[1].steps[3].id, '@chapter:final'); assert.equal(runRouteSuite(beforeMove).status, 'PASS');
  assert.equal(await page.getByRole('button', { name: '删除章节 final', exact: true }).isDisabled(), true);
  await page.getByLabel('章节 final 入口', { exact: true }).selectOption('end'); assert.equal(await page.locator('[data-command=export]').isDisabled(), true); await command('undo');
  await page.getByRole('button', { name: '章节 final 上移', exact: true }).click(); const reordered = await download('export');
  assert.deepEqual(reordered.chapters.map(c => [c.id, c.order]), [['final', 0], ['chapter-1', 1]]); assert.notEqual(runRouteSuite(reordered).status, 'PASS');
  await refresh(); await preview.locator('.vn-text').filter({ hasText: '新章节的开场' }).waitFor(); await command('undo'); assert.deepEqual(await download('export'), beforeMove);
  await page.getByRole('button', { name: '添加章节', exact: true }).click(); await page.getByRole('button', { name: '删除章节 chapter-2', exact: true }).click();
  await command('undo'); assert.equal(await page.locator('[data-chapter-id=chapter-2]').count(), 1); await command('redo');
  await page.getByRole('button', { name: '编辑 final 入口', exact: true }).click(); assert.equal(await page.getByLabel('节点 ID', { exact: true }).inputValue(), 'start');
  await refresh(); for (const id of ['read', 'back', 'reason', '@chapter:final']) await preview.locator(`[data-action="${id}"]`).click();
  await preview.locator('.vn-text').filter({ hasText: '新章节的开场' }).waitFor(); await preview.locator('[data-control=next]').click(); await preview.locator('.vn-text').filter({ hasText: '本章结束' }).waitFor();
  await runRoutes(); assert.equal(await page.evaluate(() => localStorage.getItem('vn-engine:workbench-player:v2:save:manual-1')), 'ORIGINAL_PLAYER_SAVE');
  passed('Chapter creation, rename, entry validation, reorder/undo and deletion protection preserve actual cross-chapter play and regression cases');
  await tab('structure'); await page.screenshot({ path: out + '/workbench-chapters.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: out + '/workbench-mobile.png', fullPage: true });
  const replayProject = structuredClone(beforeMove); replayProject.title = '回看身份保护'; replayProject.collections = { endings: [{ id: 'chapter-1:complete', replay: { invalid: true } }] };
  await upload(replayProject); await tab('structure'); assert.equal(await page.getByLabel('章节 final ID', { exact: true }).isDisabled(), true); assert.equal(await page.getByRole('button', { name: '章节 final 上移', exact: true }).isDisabled(), true);
  passed('390px workbench has no page overflow and replay-bearing chapter identity/order controls are explicitly protected');
  await context.close();

  const folder = await mkdtemp(join(tmpdir(), 'vn-040-studio-')), build = await packageStudio(join(folder, 'studio'));
  const manifest = JSON.parse(await readFile(join(build.output, 'studio-manifest.json'), 'utf8')); assert.equal(manifest.engine, ENGINE_VERSION);
  for (const path of ['editor/structure.mjs', 'lib/editor/catalogs.js']) assert.ok(manifest.files.some(file => file.name === path));
  standalone = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/workbench\//, ''), path = resolve(build.output, name.endsWith('/') ? name + 'index.html' : name);
      if (!path.startsWith(build.output + sep)) throw Error(); const bytes = await readFile(path);
      response.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[extname(path)] ?? 'application/octet-stream' }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  }); await new Promise(r => standalone.listen(0, '127.0.0.1', r));
  const packaged = await browser.newPage(); packaged.on('pageerror', error => errors.push(error.message));
  await packaged.goto(`http://127.0.0.1:${standalone.address().port}/workbench/editor/`); await packaged.waitForSelector('body[data-editor-ready=true]'); await packaged.locator('[data-tab=structure]').click();
  assert.equal(await packaged.locator('#version').innerText(), ENGINE_VERSION); await packaged.getByLabel('变量 trust ID', { exact: true }).fill('renamed'); await packaged.getByLabel('变量 trust ID', { exact: true }).blur();
  await packaged.getByLabel('变量 renamed ID', { exact: true }).waitFor(); assert.equal(await packaged.locator('#diagnostic-count').innerText(), '通过'); await packaged.close();
  passed('Versioned standalone Studio contains the new modules and executes the workbench from a nested deployment');
  assert.deepEqual(errors, []); await writeFile(out + '/workbench-browser-check.json', JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), engine: ENGINE_VERSION, browser: await browser.version(), result: 'passed', checks }, null, 2) + '\n');
} finally { await browser?.close(); if (standalone) await new Promise(r => standalone.close(r)); await new Promise(r => server.close(r)); }
