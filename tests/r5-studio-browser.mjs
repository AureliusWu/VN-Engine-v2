import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';
import { newProject } from '../dist/editor/index.js';

const server = await createDemoServer();
await listenBrowserServer(server);
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [], errors = [];
const output = 'test-results/r5-studio';
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/editor/');
  await page.waitForSelector('body[data-editor-ready=true]');
  const title = page.getByLabel('作品名称', { exact: true });
  async function keyboardSave() {
    const event = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  }
  await title.fill('R5 focused save');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  let saved = await keyboardSave();
  assert.equal(saved.project.title, 'R5 focused save');
  assert.equal(await title.evaluate(input => input === document.activeElement), true);
  await title.fill('R5 second focused save');
  saved = await keyboardSave();
  assert.equal(saved.project.title, 'R5 second focused save');
  await page.screenshot({ path: output + '/focused-save.png', fullPage: true });
  checks.push('Focused Ctrl+S commits the current field and supports continued editing without losing focus');
  console.log('PASS', checks.at(-1));

  await title.fill('R5 pending field draft');
  await page.waitForFunction(() => JSON.stringify(JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1')).pendingFields).includes('R5 pending field draft'));
  await page.reload();
  await page.waitForSelector('body[data-editor-ready=true]');
  await page.locator('[data-command=restore-draft]').click();
  assert.equal(await title.inputValue(), 'R5 pending field draft');
  await title.focus();
  saved = await keyboardSave();
  assert.equal(saved.project.title, 'R5 pending field draft');
  checks.push('A reload restores uncommitted input from the local draft');
  console.log('PASS', checks.at(-1));

  const id = page.getByLabel('节点 ID', { exact: true });
  await id.fill('end');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
  assert.equal(await id.inputValue(), 'end');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  await page.screenshot({ path: output + '/rejected-edit.png', fullPage: true });
  await id.fill('r5-start');
  saved = await keyboardSave();
  assert.equal(saved.project.program.blocks[0].id, 'r5-start');
  checks.push('Rejected field commits preserve input and dirty state, then allow correction and save');
  console.log('PASS', checks.at(-1));

  await id.fill('end'); await id.blur();
  page.removeAllListeners('dialog'); page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-command=new]').click();
  assert.equal(await id.inputValue(), 'end');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-command=new]').click();
  assert.equal(await id.inputValue(), 'start');
  page.on('dialog', dialog => dialog.accept());
  checks.push('An invalid pending field survives a cancelled replacement and can be explicitly discarded by confirming new');
  console.log('PASS', checks.at(-1));

  const variablesSection = page.locator('details[data-inspector-section="variables-json"]');
  await variablesSection.locator('summary').click();
  const variables = page.getByLabel('变量声明', { exact: true }), originalVariables = await variables.inputValue();
  await variables.fill('{'); await variables.blur();
  await id.fill('renamed'); await id.blur();
  assert.equal(await variables.inputValue(), '{');
  assert.equal(await id.inputValue(), 'renamed');
  await page.keyboard.press('Control+s');
  assert.equal(await variables.inputValue(), '{');
  await variables.fill(originalVariables); await variables.blur();
  saved = await keyboardSave();
  assert.equal(saved.project.program.blocks[0].id, 'renamed');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
  checks.push('An invalid variables JSON cannot be stranded by a node rename and remains repairable and saveable');
  console.log('PASS', checks.at(-1));

  let release, started;
  await page.route('**/samples/campus.json', async route => {
    started?.();
    await new Promise(resolve => { release = resolve; });
    await route.continue().catch(() => {});
  });
  const beginSample = async () => {
    const waiting = new Promise(resolve => { started = resolve; });
    await page.locator('#sample').selectOption('campus');
    await page.locator('[data-command=sample]').click();
    let timer;
    try { await Promise.race([waiting, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Sample request did not start')), 10000); })]); }
    finally { clearTimeout(timer); }
  };
  await beginSample();
  await title.fill('R5 edited during open');
  release();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('取消打开'));
  assert.equal(await title.inputValue(), 'R5 edited during open');
  checks.push('Editing during a pending sample read prevents the late sample from replacing the project');

  await title.blur();
  await beginSample();
  await page.locator('#sample').selectOption('netlove');
  await page.locator('[data-command=sample]').click();
  await page.waitForFunction(() => document.body.dataset.projectType === 'narrative');
  const newerTitle = await title.inputValue();
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/samples/campus.json'));
  release();
  await (await lateResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await title.inputValue(), newerTitle);
  assert.equal(await page.locator('body').getAttribute('data-project-type'), 'narrative');
  checks.push('A later open wins even when an earlier sample response arrives last');
  console.log('PASS', checks.at(-1));

  await page.evaluate(() => {
    const original = File.prototype.text;
    window.pendingR5Files = new Map();
    File.prototype.text = function () {
      if (this.name.startsWith('held-')) return new Promise(resolve => pendingR5Files.set(this.name, async () => resolve(await original.call(this))));
      return original.call(this);
    };
  });
  const fileProject = newProject('script'); fileProject.title = 'R5 slow file';
  const upload = (name, project) => page.locator('#open-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await upload('held-first.json', fileProject);
  await page.waitForFunction(() => pendingR5Files.has('held-first.json'));
  const second = { ...fileProject, title: 'R5 newer file' };
  await upload('second.json', second);
  await page.waitForFunction(() => document.querySelector('#project-name').textContent === 'R5 newer file');
  await page.evaluate(() => pendingR5Files.get('held-first.json')());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await title.inputValue(), 'R5 newer file');
  await upload('held-edit.json', fileProject);
  await page.waitForFunction(() => pendingR5Files.has('held-edit.json'));
  await title.fill('R5 edited during file read');
  await page.evaluate(() => pendingR5Files.get('held-edit.json')());
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('取消打开'));
  assert.equal(await title.inputValue(), 'R5 edited during file read');
  checks.push('Slow file reads obey later-open priority and preserve edits made while reading');
  console.log('PASS', checks.at(-1));

  // A controlled WebView bridge isolates asynchronous save/open semantics from native UI testing.
  const native = await browser.newPage();
  native.on('pageerror', error => errors.push(error.message));
  native.on('dialog', dialog => dialog.accept());
  await native.addInitScript(() => {
    let listener;
    window.r5NativeRequests = [];
    window.r5NativeReply = (message, result) => listener({ data: { id: message.id, ok: true, result } });
    window.chrome ??= {};
    window.chrome.webview = { addEventListener: (_type, callback) => { listener = callback; }, postMessage: message => r5NativeRequests.push(message) };
  });
  await native.goto(base + '/editor/');
  await native.waitForSelector('body[data-editor-ready=true]');
  assert.equal(await native.evaluate(() => {
    document.querySelector('[data-tab=production]').click();
    document.querySelector('[data-production-view=theme]')?.click();
    const ready = !!document.querySelector('[aria-label="主题预设"]');
    document.querySelector('[data-tab=story]').click();
    return ready;
  }), true);
  checks.push('With no pending input, chained panel actions remain synchronous for the native smoke workflow');
  const nativeTitle = native.getByLabel('作品名称', { exact: true });
  await nativeTitle.fill('R5 native snapshot');
  await native.keyboard.press('Control+s');
  await native.waitForFunction(() => r5NativeRequests.some(request => request.command === 'save-workspace'));
  await nativeTitle.fill('R5 edited while saving');
  await native.evaluate(() => { const request = r5NativeRequests.find(request => request.command === 'save-workspace'); r5NativeReply(request, {}); });
  await native.waitForFunction(() => document.querySelector('#status').textContent.includes('后续更改尚未保存'));
  assert.equal(await native.locator('body').getAttribute('data-dirty'), 'true');
  assert.equal(await nativeTitle.inputValue(), 'R5 edited while saving');
  await nativeTitle.blur();
  await native.locator('[data-command=open]').click();
  await native.waitForFunction(() => r5NativeRequests.some(request => request.command === 'open-project'));
  await nativeTitle.fill('R5 edited while opening');
  await native.evaluate(project => { const request = r5NativeRequests.find(request => request.command === 'open-project'); r5NativeReply(request, { content: JSON.stringify(project) }); }, fileProject);
  await native.waitForFunction(() => document.querySelector('#status').textContent.includes('取消打开'));
  assert.equal(await nativeTitle.inputValue(), 'R5 edited while opening');
  checks.push('Controlled native bridge keeps later edits dirty after a saved snapshot and rejects a stale open');
  console.log('PASS', checks.at(-1));
  assert.deepEqual(errors, []);
  await writeFile(output + '/r5-studio-browser.json', JSON.stringify({ status: 'PASS', checks, browser: await browser.version() }, null, 2) + '\n');
  console.log('PASS R5 Studio focused saves, pending drafts, rejected edits and asynchronous open isolation');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
