import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname, join } from 'node:path';
import { chromium } from 'playwright';
import { packageRepositoryFixture, runPackageFixture } from './package-repository-fixture.mjs';

const output = resolve(process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results', 'package-modules-browser');
await mkdir(output, { recursive: true });
const fixture = await packageRepositoryFixture();
await runPackageFixture(fixture, `
  import { mkdir, writeFile } from 'node:fs/promises';
  import { packageGame } from './tools/package-game.mjs';
  import { packageStudio } from './tools/package-studio.mjs';
  await mkdir('dist/retired', { recursive: true });
  await writeFile('dist/retired/unowned.js', 'throw Error("obsolete module");');
  await writeFile('dist/private-notes.txt', 'author-only notes');
  const game = 'package-module-offline';
  const project = { schema: 1, game, version: '1', title: '当前源码模块离线包', type: 'script', assets: [], settings: { textDelayMs: 0 },
    program: { schema: 1, game, version: '1', entry: 'start', variables: {}, blocks: [
      { id: 'start', lines: [{ id: 'one', speaker: '旁白', text: '独立包开场' }], exit: { type: 'choice', choices: [{ id: 'go', text: '进入结局', next: 'end' }] } },
      { id: 'end', lines: [{ id: 'done', speaker: '旁白', text: '独立包完成' }], exit: { type: 'end', ending: 'done' } }
    ] } };
  await writeFile('project.json', JSON.stringify(project));
  await packageGame('project.json', '../player'); await packageStudio('../studio');
`);
const errors = [], requests = [], roots = { player: resolve(fixture.run, 'player'), studio: resolve(fixture.run, 'studio') };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname; requests.push(pathname);
    const match = /^\/nested\/(player|studio)\/(.*)$/.exec(pathname);
    if (!match) { response.writeHead(404).end(); return; }
    const root = roots[match[1]], suffix = decodeURIComponent(match[2]);
    const file = resolve(root, suffix + (!suffix || suffix.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webm': 'video/webm' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await listenBrowserServer(server);
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext(), base = `http://127.0.0.1:${server.address().port}/nested/`;
  context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept()); });
  const player = await context.newPage();
  await player.goto(base + 'player/'); await player.getByRole('button', { name: '进入结局', exact: true }).click();
  await player.getByText('独立包完成', { exact: true }).waitFor();
  await player.waitForFunction(() => document.querySelector('#status').textContent === '已下载，可离线游玩');
  const studio = await context.newPage(); await studio.goto(base + 'studio/editor/');
  await studio.waitForSelector('body[data-editor-ready=true]');
  await studio.getByLabel('台词 1 正文', { exact: true }).fill('源码清单打包预览');
  await studio.getByLabel('台词 1 正文', { exact: true }).blur();
  await studio.frameLocator('#preview').locator('.vn-text').filter({ hasText: '源码清单打包预览' }).waitFor();
  await studio.waitForFunction(() => document.body.dataset.studioOffline === 'ready');
  for (const [kind, manifestName] of [['player', 'build-manifest.json'], ['studio', 'studio-manifest.json']]) {
    const manifest = JSON.parse(await readFile(join(roots[kind], manifestName), 'utf8'));
    assert.ok(!manifest.files.some(file => /retired|private-notes/.test(file.name)));
    const cached = await studio.evaluate(async prefix => {
      const urls = [];
      for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) if (request.url.includes(prefix)) urls.push(request.url);
      return urls;
    }, '/nested/' + kind + '/');
    assert.ok(cached.some(url => url.endsWith('/lib/runtime/session.js')));
    assert.ok(!cached.some(url => /retired|private-notes/.test(url)));
  }
  await context.setOffline(true);
  const reopenedPlayer = await context.newPage(); await reopenedPlayer.goto(base + 'player/');
  await reopenedPlayer.getByRole('button', { name: '进入结局', exact: true }).click();
  await reopenedPlayer.getByText('独立包完成', { exact: true }).waitFor();
  const reopenedStudio = await context.newPage(); await reopenedStudio.goto(base + 'studio/editor/');
  await reopenedStudio.waitForSelector('body[data-editor-ready=true]');
  await reopenedStudio.locator('#template').selectOption('chat'); await reopenedStudio.locator('[data-command=new]').click();
  await reopenedStudio.frameLocator('#preview').locator('.vn-chat').waitFor();
  assert.ok(!requests.some(url => /retired|private-notes/.test(url))); assert.deepEqual(errors, []);
  await reopenedStudio.screenshot({ path: output + '/offline-studio.png', fullPage: true });
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'PASS', nestedDeployment: true, playerEndingOnlineAndOffline: true,
    studioEditPreviewOnline: true, studioChatAuthoringOfflineNewPage: true, orphansExcludedFromPackageAndCache: true, errors, browser: await browser.version(), fixture: fixture.run }, null, 2) + '\n');
  console.log('PASS source-listed player and Studio: dirty dist excluded, nested deployment, real workflows and offline new pages');
} catch (error) {
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'FAIL', errors, failure: error.stack, fixture: fixture.run }, null, 2) + '\n');
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
