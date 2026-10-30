import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';
import { newProject, readAuthorReview } from '../dist/editor/index.js';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/v1-studio';
await mkdir(output, { recursive: true });
const server = await createDemoServer();
await listenBrowserServer(server);
const base = `http://127.0.0.1:${server.address().port}/editor/`;
const checks = [], failures = [], errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  async function workspace(native = false) {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    if (native) await page.addInitScript(() => {
      let listener; window.v1Requests = [];
      window.v1Reply = (request, result, error) => listener({ data: { id: request.id, ok: !error, result, error } });
      window.chrome ??= {};
      window.chrome.webview = { addEventListener: (_name, callback) => { listener = callback; }, postMessage: request => v1Requests.push(request) };
    });
    await page.goto(base); await page.waitForSelector('body[data-editor-ready=true]');
    const panel = page.locator('#production-list');
    const feedback = async () => { await page.locator('[data-tab=production]').click(); await panel.getByRole('button', { name: '问题与反馈', exact: true }).click(); };
    const button = name => panel.getByRole('button', { name, exact: true }).click();
    const field = async (label, value) => { await panel.getByLabel(label, { exact: true }).fill(value); await panel.getByLabel(label, { exact: true }).blur(); };
    const issue = async id => { await field('反馈 ID', id); await field('反馈意见', 'Synthetic asynchronous issue ' + id); await button('记录问题'); await panel.locator(`[data-feedback-id=${id}]`).waitFor(); };
    const requests = command => page.evaluate(command => v1Requests.filter(request => request.command === command), command);
    const reply = (request, result, error) => page.evaluate(({ request, result, error }) => v1Reply(request, result, error), { request, result, error });
    const ids = () => panel.locator('[data-feedback-id]').evaluateAll(nodes => nodes.map(node => node.dataset.feedbackId));
    const review = async () => {
      if (native) {
        await button('保存审阅文档'); const request = (await requests('save-author-review')).at(-1);
        await reply(request, {}); return JSON.parse(request.content);
      }
      const event = page.waitForEvent('download'); await button('保存审阅文档');
      return JSON.parse(await readFile(await (await event).path(), 'utf8'));
    };
    await feedback();
    return { page, panel, feedback, button, field, issue, requests, reply, ids, review };
  }
  const blank = marker => ({ ...readAuthorReview(null, newProject('script')), extension: { selected: marker } });
  async function heldFiles(page) {
    await page.evaluate(() => {
      const read = File.prototype.text; window.v1HeldFiles = new Map();
      File.prototype.text = function () {
        const value = read.call(this);
        return this.name.startsWith('held-') ? new Promise((resolve, reject) => v1HeldFiles.set(this.name, () => value.then(resolve, reject))) : value;
      };
    });
  }
  const upload = (panel, name, value) => panel.locator('[data-review-file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  const release = (page, name) => page.evaluate(name => v1HeldFiles.get(name)(), name);
  async function check(name, run) {
    try { await run(); checks.push(name); console.log('PASS', name); }
    catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, error.message); }
  }

  await check('Review file reads obey later-selection priority and ignore stale invalid documents', async () => {
    const w = await workspace(); const { page, panel } = w;
    try {
      await heldFiles(page); await upload(panel, 'held-first.json', blank('first'));
      await page.waitForFunction(() => v1HeldFiles.has('held-first.json'));
      await upload(panel, 'second.json', blank('second'));
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('审阅文档已打开'));
      await release(page, 'held-first.json'); await page.waitForTimeout(50);
      assert.equal((await w.review()).extension.selected, 'second');
      await upload(panel, 'held-invalid.json', { invalid: true });
      await page.waitForFunction(() => v1HeldFiles.has('held-invalid.json'));
      await upload(panel, 'third.json', blank('third'));
      await release(page, 'held-invalid.json'); await page.waitForTimeout(50);
      assert.equal((await w.review()).extension.selected, 'third');
      assert.equal(await page.locator('#status').evaluate(node => node.classList.contains('error')), false);
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('A slow review file cannot replace newer recorded or still-focused feedback', async () => {
    const w = await workspace(); const { page, panel } = w;
    try {
      await w.issue('first'); const prior = await w.review(); await heldFiles(page);
      await upload(panel, 'held-edit.json', prior); await page.waitForFunction(() => v1HeldFiles.has('held-edit.json'));
      await w.issue('second'); await release(page, 'held-edit.json'); await page.waitForTimeout(50);
      assert.deepEqual(await w.ids(), ['first', 'second']);
      await upload(panel, 'held-focused.json', prior); await page.waitForFunction(() => v1HeldFiles.has('held-focused.json'));
      await panel.getByLabel('反馈意见', { exact: true }).fill('Uncommitted focused feedback survives the late file');
      await release(page, 'held-focused.json'); await page.waitForTimeout(50);
      assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), 'Uncommitted focused feedback survives the late file');
      assert.deepEqual(await w.ids(), ['first', 'second']); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('Native review opens ignore later edits, replacement workspaces and obsolete failures', async () => {
    const w = await workspace(true); const { page } = w;
    try {
      await w.issue('first'); const prior = await w.review();
      await w.button('打开审阅文档'); const first = (await w.requests('open-author-review')).at(-1);
      await w.issue('second'); await w.reply(first, { content: JSON.stringify(prior) }); await page.waitForTimeout(50);
      assert.deepEqual(await w.ids(), ['first', 'second']);
      await w.button('打开审阅文档'); const old = (await w.requests('open-author-review')).at(-1);
      await page.locator('[data-command=new]').click(); await w.feedback();
      await w.reply(old, { content: JSON.stringify(prior) }); await page.waitForTimeout(50); assert.deepEqual(await w.ids(), []);
      await w.button('打开审阅文档'); const failed = (await w.requests('open-author-review')).at(-1);
      await page.locator('[data-command=new]').click(); const status = await page.locator('#status').innerText();
      await w.reply(failed, undefined, 'Obsolete native review read failure'); await page.waitForTimeout(50);
      assert.equal(await page.locator('#status').innerText(), status);
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('Native review cancellation and current failures preserve the document and allow a valid retry', async () => {
    const w = await workspace(true); const { page } = w;
    try {
      await w.issue('first'); await w.button('打开审阅文档');
      await w.reply((await w.requests('open-author-review')).at(-1), { cancelled: true }); assert.deepEqual(await w.ids(), ['first']);
      await w.button('打开审阅文档'); await w.reply((await w.requests('open-author-review')).at(-1), undefined, 'Current native review read failure');
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Current native review read failure'));
      assert.deepEqual(await w.ids(), ['first']);
      await w.button('打开审阅文档'); await w.reply((await w.requests('open-author-review')).at(-1), { content: JSON.stringify(blank('retry')) });
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('审阅文档已打开'));
      assert.equal((await w.review()).extension.selected, 'retry');
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('A completed native review save marks only its captured snapshot and leaves later feedback dirty', async () => {
    const w = await workspace(true); const { page } = w;
    try {
      await w.issue('first'); await w.button('保存审阅文档'); const request = (await w.requests('save-author-review')).at(-1);
      await w.issue('second'); await w.reply(request, {});
      assert.deepEqual(JSON.parse(request.content).items.map(item => item.id), ['first']);
      assert.deepEqual(await w.ids(), ['first', 'second']); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
      assert.match(await page.locator('#status').innerText(), /快照|后续|尚未保存/);
      await page.screenshot({ path: output + '/review-save-snapshot.png', fullPage: true });
      await w.review(); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('Out-of-order native save acknowledgements cannot change a newer save or an opened review baseline', async () => {
    const w = await workspace(true); const { page } = w;
    try {
      await w.issue('first'); await w.button('保存审阅文档'); const first = (await w.requests('save-author-review')).at(-1);
      await w.issue('second'); await w.button('保存审阅文档'); const second = (await w.requests('save-author-review')).at(-1);
      await w.reply(second, {}); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
      await w.reply(first, {}); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
      await w.button('保存审阅文档'); const old = (await w.requests('save-author-review')).at(-1);
      await w.button('打开审阅文档'); await w.reply((await w.requests('open-author-review')).at(-1), { content: JSON.stringify(blank('new-document')) });
      await w.issue('third'); const status = await page.locator('#status').innerText();
      await w.reply(old, {}); await page.waitForTimeout(50);
      assert.deepEqual(await w.ids(), ['third']); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
      assert.equal(await page.locator('#status').innerText(), status);
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('Native asset binding is scoped to later requests, workspace identity and pending edits', async () => {
    const w = await workspace(true); const { page } = w;
    const bind = async () => { await page.locator('[data-tab=assets]').click(); await page.locator('[data-command=bind-assets]').click(); return (await w.requests('bind-assets')).at(-1); };
    try {
      const first = await bind(); await page.locator('[data-command=new]').click();
      await w.reply(first, { baseURL: 'https://example.test/stale/', files: ['old.png'] }); await page.waitForTimeout(50);
      assert.match(await page.locator('#asset-state').innerText(), /未绑定/);
      const editing = await bind(); await page.getByLabel('作品名称', { exact: true }).fill('Focused edit during directory binding');
      await w.reply(editing, { baseURL: 'https://example.test/stale/', files: ['old.png'] }); await page.waitForTimeout(50);
      assert.match(await page.locator('#asset-state').innerText(), /未绑定/);
      assert.equal(await page.getByLabel('作品名称', { exact: true }).inputValue(), 'Focused edit during directory binding');
      await page.getByLabel('作品名称', { exact: true }).blur();
      const earlier = await bind(), later = await bind();
      await w.reply(later, { baseURL: 'https://example.test/current/', files: ['one.png', 'two.png'] });
      await w.reply(earlier, { baseURL: 'https://example.test/stale/', files: ['old.png'] }); await page.waitForTimeout(50);
      assert.match(await page.locator('#asset-state').innerText(), /2 个/);
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  await check('Asset binding cancellation and stale errors retain the existing resource directory', async () => {
    const w = await workspace(true); const { page } = w;
    const bind = async () => { await page.locator('[data-tab=assets]').click(); await page.locator('[data-command=bind-assets]').click(); return (await w.requests('bind-assets')).at(-1); };
    try {
      await w.reply(await bind(), { baseURL: 'https://example.test/current/', files: ['one.png', 'two.png'] });
      const prior = await page.locator('#asset-state').innerText(); await w.reply(await bind(), { cancelled: true });
      assert.equal(await page.locator('#asset-state').innerText(), prior);
      const failed = await bind(); await page.locator('[data-command=new]').click(); const status = await page.locator('#status').innerText();
      await w.reply(failed, undefined, 'Obsolete resource directory failure'); await page.waitForTimeout(50);
      assert.equal(await page.locator('#status').innerText(), status); assert.match(await page.locator('#asset-state').innerText(), /未绑定/);
    } finally { await page.close({ runBeforeUnload: false }); }
  });

  assert.deepEqual(errors, []);
  await writeFile(output + '/v1-studio-browser.json', JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', browser: await browser.version(), checks, failures, errors,
    controlledNativeBridge: true, actualNativeExecution: false }, null, 2) + '\n');
  assert.deepEqual(failures, []);
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
