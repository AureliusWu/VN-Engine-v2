import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname, join } from 'node:path';
import { chromium } from 'playwright';
import { compileTextScript, checkTextScriptProject } from '../dist/script/text.js';
import { packageGame } from '../tools/package-game.mjs';
import { packageStudio } from '../tools/package-studio.mjs';
import { listenBrowserServer } from '../tools/browser-server.mjs';

const output = resolve(process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results', 'p4-package');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'run-')), errors = [], requests = [], workers = [], checks = [];
const project = JSON.parse(await readFile('examples/runtime/stage.json', 'utf8')), script = await readFile('examples/dsl/stage.vn.txt', 'utf8');
const forbidden = name => /(?:^|\/)(?:editor|agent)\/|script\/text(?:\/|\.js)|text-compile-(?:task|worker)|\.vn\.txt$|source[-_]?map/i.test(name);
const scope = { actualModuleWorker: true, generatedStudio: true, nestedDeployment: true, offlineNewPage: true,
  localFileInputs: 'automated project and resource-directory inputs; no manual system-dialog claim', physicalDevice: 'UNVERIFIED', physicalListening: 'UNVERIFIED' };
let browser, server;
try {
  const roots = { player: join(run, 'player'), studio: join(run, 'studio') };
  await packageGame('examples/runtime/stage.json', roots.player); await packageStudio(roots.studio);
  const playerManifest = JSON.parse(await readFile(join(roots.player, 'build-manifest.json'), 'utf8'));
  const studioManifest = JSON.parse(await readFile(join(roots.studio, 'studio-manifest.json'), 'utf8'));
  assert.ok(!playerManifest.files.some(file => forbidden(file.name)));
  for (const name of ['editor/text-compile-task.mjs', 'editor/text-compile-worker.mjs', 'lib/script/text.js', 'lib/script/text/project.js'])
    assert.ok(studioManifest.files.some(file => file.name === name), name + ' missing from Studio');
  checks.push('Studio includes the worker/task/compiler/context modules; the player excludes all author modules');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname; requests.push(pathname);
      const match = /^\/nested\/(player|studio)\/(.*)$/.exec(pathname);
      if (!match) { response.writeHead(404).end(); return; }
      const root = roots[match[1]], suffix = decodeURIComponent(match[2]);
      const file = resolve(root, suffix + (!suffix || suffix.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json',
        '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json' })[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await listenBrowserServer(server);
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    page.on('worker', worker => workers.push(worker.url()));
  });
  const base = `http://127.0.0.1:${server.address().port}/nested/`;
  const author = async (page, label) => {
    await page.goto(base + 'studio/editor/'); await page.waitForSelector('body[data-editor-ready=true]');
    await page.locator('#open-file').setInputFiles(resolve('examples/runtime/stage.json'));
    await page.waitForFunction(game => document.querySelector('[aria-label="作品 ID"]').value === game, project.game);
    await page.locator('[data-tab=assets]').click(); await page.locator('#asset-directory').setInputFiles(resolve('examples/runtime'));
    await page.waitForFunction(() => document.querySelector('#asset-state').textContent.startsWith('已绑定 '));
    await page.locator('[data-tab=text-script]').click();
    const text = 'P4 ' + label + '：独立 Studio 后台编译。';
    const edited = script.replace('背景、立绘和声音来自同一份演出文本。', text);
    await page.getByLabel('文本 DSL 内容', { exact: true }).fill(edited);
    await page.locator('[data-dsl-command=compile]').click();
    await page.waitForFunction(() => document.querySelector('#text-script-list').dataset.dslState === 'success');
    assert.equal(await page.locator('#text-script-list').getAttribute('aria-busy'), 'false');
    await page.frameLocator('#preview').locator('.vn-text').filter({ hasText: text }).waitFor();
    await page.locator('[data-dsl-command=apply]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported.program, checkTextScriptProject(compileTextScript(edited), project).program);
    assert.deepEqual(exported.assets, project.assets); assert.equal(exported.game, project.game);
    assert.ok(!Object.hasOwn(exported, 'sourceMap'));
    await page.screenshot({ path: join(output, label + '-studio.png'), fullPage: true });
  };
  const online = await context.newPage(); await author(online, 'online');
  await online.waitForFunction(() => document.body.dataset.studioOffline === 'ready');
  const cached = await online.evaluate(async () => {
    const paths = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys())
      if (new URL(request.url).pathname.startsWith('/nested/studio/')) paths.push(new URL(request.url).pathname);
    return paths;
  });
  assert.ok(cached.includes('/nested/studio/editor/text-compile-worker.mjs'));
  assert.ok(cached.includes('/nested/studio/editor/text-compile-task.mjs'));
  assert.ok(cached.includes('/nested/studio/lib/script/text/project.js'));
  checks.push('Generated nested Studio performs an actual module-worker compile, candidate preview, explicit apply and export');
  await context.setOffline(true);
  const offline = await context.newPage(); await author(offline, 'offline');
  assert.equal(workers.filter(url => url.endsWith('/nested/studio/editor/text-compile-worker.mjs')).length, 2);
  assert.ok(workers.every(url => new URL(url).pathname.startsWith('/nested/studio/editor/')));
  checks.push('A new offline Studio page repeats the real worker compile/apply/export using cached modules and newly bound local assets');
  const sw = await readFile(join(roots.player, 'sw.js'), 'utf8');
  assert.ok(!/text-compile-(?:worker|task)|script\/text(?:\/|\.js)/.test(sw));
  assert.ok(!requests.filter(path => path.startsWith('/nested/player/')).some(forbidden)); assert.deepEqual(errors, []);
  await writeFile(join(output, 'REPORT.json'), JSON.stringify({ status: 'PASS', checks, scope, run, workers, errors,
    playerFiles: playerManifest.files.length, studioFiles: studioManifest.files.length, workerAndTaskCached: true,
    authorModulesPackagedInPlayer: false, browser: await browser.version() }, null, 2) + '\n');
  console.log('PASS P4 generated Studio: nested real module workers, offline new page compile/apply/export, player author-code exclusion');
} catch (error) {
  await writeFile(join(output, 'REPORT.json'), JSON.stringify({ status: 'FAIL', checks, scope, run, workers, errors, failure: error.stack }, null, 2) + '\n');
  throw error;
} finally { await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); }
