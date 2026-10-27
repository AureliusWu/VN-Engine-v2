import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { createServer } from 'node:http';
import { createDemoServer } from '../tools/serve.mjs';
import { newProject } from '../dist/editor/index.js';
import { packageStudio } from '../tools/package-studio.mjs';

const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
const errors = [], checks = [], passed = text => { checks.push(text); console.log('PASS', text); }; let browser, standalone;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/editor/'); await page.waitForSelector('body[data-editor-ready=true]');
  const preview = page.frameLocator('#preview'), command = name => page.locator(`[data-command=${name}]`).click();
  const waitPreview = async text => { await preview.locator('.vn-text').filter({ hasText: text }).waitFor(); };
  const template = async kind => { await page.locator('#template').selectOption(kind); await command('new'); await page.waitForFunction(kind => document.body.dataset.projectType === (['vn', 'chat'].includes(kind) ? 'narrative' : kind), kind); };
  await waitPreview('选择将改变变量'); await page.getByLabel('台词 1 正文', { exact: true }).fill('从编辑器写入自己的故事。'); await page.getByLabel('台词 1 正文', { exact: true }).blur(); await waitPreview('从编辑器写入自己的故事');
  assert.equal(await page.locator('#diagnostic-count').innerText(), '通过');
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: out + '/studio-desktop.png', fullPage: true });
  passed('Visual script properties refresh the actual self-developed runtime preview');

  const node = page.getByRole('button', { name: '编辑节点 start', exact: true }), box = await node.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 25); await page.mouse.down(); await page.mouse.move(box.x + 145, box.y + 85, { steps: 5 }); await page.mouse.up();
  const moved = await page.getByRole('button', { name: '编辑节点 start', exact: true }).evaluate(n => parseInt(n.style.top)); assert.ok(moved > 38);
  await command('undo'); assert.equal(await page.getByRole('button', { name: '编辑节点 start', exact: true }).evaluate(n => parseInt(n.style.top)), 38); await command('redo');
  await page.getByRole('button', { name: '编辑节点 end', exact: true }).click(); await page.getByLabel('节点 ID', { exact: true }).fill('final'); await page.getByLabel('节点 ID', { exact: true }).blur();
  await page.getByRole('button', { name: '编辑节点 start', exact: true }).click(); assert.equal(await page.getByLabel('选择 1 目标', { exact: true }).inputValue(), 'final');
  const [exported] = await Promise.all([page.waitForEvent('download'), command('export')]); const project = JSON.parse(await readFile(await exported.path(), 'utf8')); assert.equal(project.type, 'script'); assert.equal(project.format, undefined); assert.equal(project.program.blocks[0].exit.choices[0].next, 'final');
  const [saved] = await Promise.all([page.waitForEvent('download'), command('save')]); const document = JSON.parse(await readFile(await saved.path(), 'utf8')); assert.equal(document.format, 'vn-engine-editor'); assert.ok(Object.keys(document.positions).length); assert.equal(document.project.type, 'script');
  passed('Node dragging/undo and safe rename preserve branches; workspace and runtime exports keep distinct formats');

  await page.locator('[data-tab=source]').click(); const source = page.locator('#source'), before = await source.inputValue();
  await source.fill('{broken'); await command('apply-source'); assert.match(await page.locator('#status').innerText(), /JSON|position|Expected|property/i); await waitPreview('从编辑器写入自己的故事');
  const broken = JSON.parse(before); broken.program.blocks[0].exit.choices[0].next = 'absent'; await source.fill(JSON.stringify(broken)); await command('apply-source');
  assert.equal(await page.locator('[data-command=export]').isDisabled(), true); assert.match(await page.locator('#diagnostics').innerText(), /目标不存在/);
  await command('undo'); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  passed('Invalid JSON preserves the previous document; broken branches block export and can be undone');

  await template('chat'); await preview.locator('.vn-chat').waitFor(); await page.screenshot({ path: out + '/studio-chat.png', fullPage: true });
  await template('investigation'); await preview.locator('.vn-actions [data-action=read]').click(); await preview.locator('.vn-document').waitFor();
  await preview.locator('.vn-actions [data-action=back]').click(); await preview.locator('.vn-actions [data-action=reason]').click();
  assert.equal(await page.locator('#diagnostic-count').innerText(), '通过'); assert.equal(await page.locator('.node').count(), 3);
  passed('Chat and inventory-based investigation use separate editor graphs and their real runtime interactions');

  await page.locator('#sample').selectOption('campus'); await command('sample'); await preview.locator('.vn-portrait').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('preview').contentDocument.querySelector('.vn-portrait')?.naturalWidth > 0);
  assert.equal(await page.locator('[data-command=export]').isEnabled(), true); assert.match(await page.locator('#diagnostics').innerText(), /动态结局/);
  await page.screenshot({ path: out + '/studio-campus.png', fullPage: true });
  passed('Existing independent engine samples load with their local resource manifest and own presentation');

  const sceneMedia = page.locator('#inspector > details').filter({ hasText: '画面与声音绑定' });
  await sceneMedia.evaluate(node => { node.open = true; });
  await sceneMedia.getByLabel('视频', { exact: true }).selectOption('test-video');
  await sceneMedia.evaluate(node => { node.open = true; });
  const fallback = sceneMedia.getByLabel('视频回退画面', { exact: true });
  const fallbackValue = await fallback.locator('option').nth(1).getAttribute('value'); await fallback.selectOption(fallbackValue);
  await preview.locator('.vn-video').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('preview').contentDocument.querySelector('.vn-video')?.currentTime > .05);
  const [videoExport] = await Promise.all([page.waitForEvent('download'), command('export')]);
  const withVideo = JSON.parse(await readFile(await videoExport.path(), 'utf8'));
  assert.equal(Object.values(withVideo.stage.scenes).some(cue => cue.video?.asset === 'test-video' && cue.video?.fallback?.asset), true);
  passed('Editor authors a video and fallback and previews real playback before export');

  const folder = await mkdtemp(join(tmpdir(), 'vn-editor-assets-')); await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'assets', 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#278"/></svg>');
  const custom = newProject('script'); custom.assets = [{ id: 'picture', kind: 'background', src: 'assets/picture.svg' }]; custom.defaults = { background: 'picture' };
  await page.locator('#open-file').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(custom)) });
  await page.locator('#asset-directory').setInputFiles(folder);
  await page.waitForFunction(() => document.getElementById('preview').contentDocument.querySelector('.vn-background')?.naturalWidth > 0);
  assert.equal(await page.locator('#diagnostic-count').innerText(), '通过');
  await page.getByLabel('台词 1 正文', { exact: true }).fill('目录绑定后的独立故事。'); await page.getByLabel('台词 1 正文', { exact: true }).blur(); await waitPreview('目录绑定后的独立故事');
  passed('Browser directory selection maps real local image bytes into preview without changing relative project paths');

  await page.locator('[data-tab=source]').click(); const pending = JSON.parse(await source.inputValue()); pending.title = '尚未应用的草稿'; await source.fill(JSON.stringify(pending));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.source?.includes('尚未应用的草稿'));
  await page.reload(); await page.waitForSelector('body[data-editor-ready=true]'); await command('restore-draft');
  assert.match(await source.inputValue(), /尚未应用的草稿/); await command('apply-source'); assert.equal(await page.locator('#project-name').innerText(), '尚未应用的草稿');
  passed('Draft recovery preserves both the applied document and unapplied JSON across a page reload');

  await template('vn'); await page.getByLabel('台词 1 正文', { exact: true }).fill('<img src=x onerror="window.editorInjected=1">正文'); await page.getByLabel('台词 1 正文', { exact: true }).blur(); await waitPreview('<img');
  assert.equal(await preview.locator('.vn-text img').count(), 0); assert.equal(await page.evaluate(() => window.editorInjected), undefined);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: out + '/studio-mobile.png', fullPage: true });
  passed('Authored markup stays inert and the editor remains usable at 390px without page overflow');
  await context.close();

  const root = await mkdtemp(join(tmpdir(), 'vn-studio-bundle-')); const build = await packageStudio(join(root, 'studio'));
  standalone = createServer(async (request, response) => {
    try { const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, ''), path = resolve(build.output, name.endsWith('/') ? name + 'index.html' : name); if (!path.startsWith(build.output + sep)) throw Error();
      const bytes = await readFile(path), type = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(path)] ?? 'application/octet-stream'; response.writeHead(200, { 'Content-Type': type }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  }); await new Promise(r => standalone.listen(0, '127.0.0.1', r));
  const packaged = await browser.newPage(), requests = []; packaged.on('pageerror', e => errors.push(e.message)); packaged.on('request', r => requests.push(r.url()));
  await packaged.goto(`http://127.0.0.1:${standalone.address().port}/editor/`); await packaged.waitForSelector('body[data-preview-revision]'); assert.equal(await packaged.locator('#diagnostic-count').innerText(), '通过');
  assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${standalone.address().port}/`))); await packaged.close();
  passed('The packaged Studio starts editor and preview using only its bundled files');
  assert.deepEqual(errors, []);
  await writeFile(out + '/editor-browser-check.json', JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), browser: await browser.version(), result: 'passed', checks }, null, 2) + '\n');
} finally { await browser?.close(); if (standalone) await new Promise(r => standalone.close(r)); await new Promise(r => server.close(r)); }
