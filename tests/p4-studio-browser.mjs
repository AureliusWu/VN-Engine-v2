import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';
import { listenBrowserServer } from '../tools/browser-server.mjs';

const output = resolve(process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results', 'p4-studio');
await mkdir(output, { recursive: true });
const originalProject = JSON.parse(await readFile('examples/runtime/stage.json', 'utf8'));
const originalScript = await readFile('examples/dsl/stage.vn.txt', 'utf8');
const edited = label => originalScript.replace('背景、立绘和声音来自同一份演出文本。', label);
const checks = [], errors = [], scope = { controlledLifecycle: 'Only the DSL Worker is wrapped; hold/pass execute the real parser, then callbacks may be deliberately delivered after termination.',
  errorAndTimeout: 'Explicit simulated worker error/hang; only the 10000 ms task timer is shortened to 40 ms.',
  realLargeWorker: 'Separate unwrapped browser context, 7000 cues; functional verification, not a replacement performance sample.',
  deviceAndListening: 'UNVERIFIED' };
let browser;
const server = await createDemoServer(); await listenBrowserServer(server);
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    const NativeWorker = Worker, nativeTimer = setTimeout;
    const control = globalThis.p4Workers = { mode: 'pass', shortenTimeout: false, workers: [], held: [], forcedCallbacks: 0,
      release(index) { const item = this.held[index]; if (!item) throw Error('Missing held worker callback'); this.forcedCallbacks++; item.callback?.({ data: item.data }); } };
    globalThis.Worker = class {
      constructor(url, options) {
        if (!new URL(String(url), location.href).pathname.endsWith('/editor/text-compile-worker.mjs')) return new NativeWorker(url, options);
        this.mode = control.mode; this.native = new NativeWorker(url, options); this.terminated = false; this.sent = [];
        control.workers.push(this);
        this.native.onmessage = event => {
          const callback = this.onmessage;
          if (this.mode === 'hold') control.held.push({ callback, data: event.data });
          else callback?.({ data: event.data });
        };
        this.native.onerror = event => { event.preventDefault(); this.onerror?.(event); };
      }
      postMessage(message) {
        this.sent.push(message);
        if (this.mode === 'hang') return;
        if (this.mode === 'error') { nativeTimer(() => this.onerror?.({ message: 'Controlled DSL worker error', preventDefault() {} }), 0); return; }
        this.native.postMessage(message);
      }
      terminate() { this.terminated = true; this.native.terminate(); }
    };
    globalThis.setTimeout = (callback, delay, ...args) => nativeTimer(callback, control.shortenTimeout && delay === 10000 ? 40 : delay, ...args);
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  const url = `http://127.0.0.1:${server.address().port}/editor/`;
  await page.goto(url); await page.waitForSelector('body[data-editor-ready=true]');
  const state = value => page.waitForFunction(value => document.querySelector('#text-script-list').dataset.dslState === value, value);
  const mode = (value, timeout = false) => page.evaluate(({ value, timeout }) => { p4Workers.mode = value; p4Workers.shortenTimeout = timeout; }, { value, timeout });
  const count = () => page.evaluate(() => p4Workers.workers.length);
  const heldCount = () => page.evaluate(() => p4Workers.held.length);
  const waitHeld = count => page.waitForFunction(count => p4Workers.held.length >= count, count);
  const release = index => page.evaluate(index => p4Workers.release(index), index);
  const exportProject = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
    return JSON.parse(await readFile(await download.path(), 'utf8'));
  };
  const load = async () => {
    await mode('pass');
    await page.locator('#open-file').setInputFiles({ name: 'stage.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(originalProject)) });
    await page.waitForFunction(game => document.querySelector('[aria-label="作品 ID"]').value === game, originalProject.game);
    await page.locator('[data-tab=assets]').click(); await page.locator('#asset-directory').setInputFiles(resolve('examples/runtime'));
    await page.waitForFunction(() => document.querySelector('#asset-state').textContent.startsWith('已绑定 '));
    await page.locator('#auto-preview').uncheck(); await page.locator('[data-tab=text-script]').click();
  };
  const fill = text => page.getByLabel('文本 DSL 内容', { exact: true }).fill(text);
  const compile = () => page.locator('[data-dsl-command=compile]').click();
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };
  await check('A running real compilation can be cancelled; a deliberately late callback cannot revive it; retry applies in one undo', async () => {
    await load(); const before = await exportProject(), held = await heldCount(); await mode('hold'); await fill(edited('P4 可取消的候选'));
    await compile(); await state('running'); await waitHeld(held + 1);
    assert.equal(await page.locator('#text-script-list').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    await page.locator('[data-dsl-command=cancel]').click(); await state('cancelled');
    assert.equal(await page.locator('#text-script-list').getAttribute('aria-busy'), 'false');
    await release(held); await page.waitForTimeout(30); await state('cancelled');
    assert.deepEqual((await exportProject()).program, before.program);
    await mode('pass'); await compile(); await state('success');
    await page.frameLocator('#preview').locator('.vn-text').filter({ hasText: 'P4 可取消的候选' }).waitFor();
    assert.deepEqual((await exportProject()).program, before.program);
    await page.locator('[data-dsl-command=apply]').click();
    assert.equal((await exportProject()).program.blocks[0].lines[0].text, 'P4 可取消的候选');
    await page.locator('[data-command=undo]').click(); const restored = await exportProject();
    assert.deepEqual(restored.program, before.program); assert.deepEqual(restored.assets, before.assets);
  });
  await check('Text edits cancel held work and the prior result never selects or applies the new text', async () => {
    await load(); const held = await heldCount(); await mode('hold'); await fill(edited('P4 old input')); await compile(); await waitHeld(held + 1);
    await fill(edited('P4 latest input')); await state('stale'); await release(held); await page.waitForTimeout(30);
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.match(await page.getByLabel('文本 DSL 内容', { exact: true }).inputValue(), /P4 latest input/);
    await mode('pass'); await compile(); await state('success');
    await page.frameLocator('#preview').locator('.vn-text').filter({ hasText: 'P4 latest input' }).waitFor();
  });
  await check('JSON workspace replacement and New Project both reject held results from the prior workspace', async () => {
    for (const replacement of ['json', 'new']) {
      await load(); const held = await heldCount(); await mode('hold'); await fill(edited('P4 obsolete workspace')); await compile(); await waitHeld(held + 1);
      if (replacement === 'json') {
        const next = structuredClone(originalProject); next.game = 'p4-json-replacement'; next.program.game = next.game;
        await page.locator('[data-tab=source]').click(); await page.getByLabel('工程 JSON 内容', { exact: true }).fill(JSON.stringify(next));
        await page.locator('[data-command=apply-source]').click();
        await page.waitForFunction(() => document.querySelector('[aria-label="作品 ID"]').value === 'p4-json-replacement');
      } else { await page.locator('#template').selectOption('script'); await page.locator('[data-command=new]').click(); }
      const before = await exportProject(); await release(held); await page.waitForTimeout(30);
      assert.deepEqual(await exportProject(), before);
      if (replacement === 'json') {
        // Applying project JSON preserves the author's DSL draft and checks it against
        // the new identity; New Project is the separate workspace-reset operation.
        await waitHeld(held + 2); await release(held + 1); await state('invalid');
        assert.match(await page.getByLabel('文本 DSL 内容', { exact: true }).inputValue(), /P4 obsolete workspace/);
        assert.match((await page.locator('[data-dsl-diagnostic]').allTextContents()).join('\n'), /DSL_PROJECT_IDENTITY/);
      } else {
        assert.equal(await page.getByLabel('文本 DSL 内容', { exact: true }).inputValue(), ''); await state('idle');
      }
      assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    }
  });
  await check('Resource identity/kind changes replace a held job and automatically recheck without candidate preview; title edits reuse the result', async () => {
    await load(); const held = await heldCount(); await mode('hold'); await fill(edited('P4 resource candidate')); await compile(); await waitHeld(held + 1);
    const revision = await page.getAttribute('body', 'data-preview-revision');
    await page.locator('[data-tab=assets]').click();
    const voice = page.locator('.asset-card').filter({ has: page.locator('h3').filter({ hasText: /^greeting$/ }) });
    await voice.getByLabel('资源类型', { exact: true }).selectOption('background'); await waitHeld(held + 2);
    await release(held); await page.waitForTimeout(30); await state('running');
    await release(held + 1); await state('invalid');
    assert.match((await page.locator('[data-dsl-diagnostic]').allTextContents()).join('\n'), /DSL_ASSET_KIND/);
    await mode('pass'); await voice.getByLabel('资源类型', { exact: true }).selectOption('audio'); await state('success');
    assert.equal(await page.getAttribute('body', 'data-preview-revision'), revision);
    const workers = await count(); await page.getByLabel('作品名称', { exact: true }).fill('P4 irrelevant title');
    await page.getByLabel('作品名称', { exact: true }).blur(); await page.waitForTimeout(80);
    assert.equal(await count(), workers); await state('success');
  });
  await check('Explicit worker-error and shortened-timeout simulations preserve data and allow a real retry', async () => {
    for (const failure of ['error', 'hang']) {
      await load(); await fill(edited('P4 retry ' + failure)); const before = await exportProject();
      await mode(failure, failure === 'hang'); await compile(); await state('error');
      assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
      assert.deepEqual((await exportProject()).program, before.program);
      await mode('pass'); await compile(); await state('success');
      await page.frameLocator('#preview').locator('.vn-text').filter({ hasText: 'P4 retry ' + failure }).waitFor();
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-tab=text-script]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'studio-mobile.png'), fullPage: true });
  });
  const controlled = await page.evaluate(() => ({ workers: p4Workers.workers.length, terminated: p4Workers.workers.filter(worker => worker.terminated).length,
    heldCallbacks: p4Workers.held.length, forcedCallbacks: p4Workers.forcedCallbacks }));
  assert.equal(controlled.workers, controlled.terminated);
  const realContext = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const realPage = await realContext.newPage(), realWorkers = [];
  realPage.on('pageerror', error => errors.push(error.message)); realPage.on('dialog', dialog => dialog.accept());
  realPage.on('worker', worker => realWorkers.push(worker.url()));
  await check('An unwrapped real worker compiles 7000 cues while the main thread keeps serving heartbeats', async () => {
    await realPage.goto(url); await realPage.waitForSelector('body[data-editor-ready=true]');
    const project = { ...originalProject, game: 'large-author', version: '1', assets: [{ id: 'room', kind: 'background', src: 'assets/classroom.svg' }],
      program: { schema: 1, game: 'large-author', version: '1', entry: 'start', variables: {}, blocks: [{ id: 'start', lines: [{ id: 'seed', speaker: 'N', text: 'Seed' }], exit: { type: 'end', ending: 'done' } }] } };
    delete project.font; delete project.routeTests;
    await realPage.locator('#open-file').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await realPage.waitForFunction(() => document.querySelector('[aria-label="作品 ID"]').value === 'large-author');
    await realPage.locator('[data-tab=assets]').click(); await realPage.locator('#asset-directory').setInputFiles(resolve('examples/runtime'));
    await realPage.waitForFunction(() => document.querySelector('#asset-state').textContent.startsWith('已绑定 '));
    await realPage.locator('[data-tab=text-script]').click();
    const text = 'vn-script 1\ngame "large-author"\nversion "1"\nentry start\nblock start\n'
      + Array.from({ length: 7000 }, (_, i) => `line l${i} "旁白" "${'界'.repeat(40)}"\n`).join('') + 'end done\n'
      + Array.from({ length: 7000 }, (_, i) => `cue line l${i} background room\n`).join('');
    await realPage.evaluate(text => { const input = document.querySelector('[data-dsl-source]'); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
      globalThis.p4Heartbeats = 0; globalThis.p4Pulse = setInterval(() => {
        if (document.querySelector('#text-script-list').dataset.dslState === 'running') p4Heartbeats++;
      }, 10); }, text);
    await realPage.locator('[data-dsl-command=compile]').click();
    await realPage.waitForFunction(() => document.querySelector('#text-script-list').dataset.dslState === 'success');
    assert.ok(await realPage.evaluate(() => { clearInterval(p4Pulse); return p4Heartbeats; }) > 1);
    assert.equal(realWorkers.filter(url => url.endsWith('/editor/text-compile-worker.mjs')).length, 1);
    assert.equal(await realPage.locator('[data-dsl-command=apply]').isEnabled(), true);
  });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'REPORT.json'), JSON.stringify({ status: 'PASS', checks, scope, controlled, realWorkers, errors, browser: await browser.version() }, null, 2) + '\n');
} catch (error) {
  await writeFile(join(output, 'REPORT.json'), JSON.stringify({ status: 'FAIL', checks, scope, errors, failure: error.stack }, null, 2) + '\n');
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
