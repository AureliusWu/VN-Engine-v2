import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { compileTextScript } from '../dist/script/text.js';
import { packageGame } from '../tools/package-game.mjs';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/p1-package';
await mkdir(output, { recursive: true });
const run = await mkdtemp(output + '/run-');
const compiled = compileTextScript(await readFile('examples/dsl/branch.vn.txt', 'utf8'));
assert.equal(compiled.ok, true);
const project = { schema: 1, game: compiled.program.game, version: compiled.program.version, title: 'P1 compiled JSON player', type: 'script', assets: [], settings: { textDelayMs: 0 }, program: compiled.program };
await writeFile(run + '/project.json', JSON.stringify(project, null, 2) + '\n');
await packageGame(run + '/project.json', run + '/player');
const root = resolve(run + '/player'), requests = [], errors = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    requests.push(pathname); if (!pathname.startsWith('/nested/game/')) { response.writeHead(404).end(); return; }
    const file = resolve(root, decodeURIComponent(pathname.slice('/nested/game/'.length)) || 'index.html');
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext(), url = `http://127.0.0.1:${server.address().port}/nested/game/`;
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.getByRole('button', { name: '继续 / Continue', exact: true }).click();
  await page.getByText('第一行：完成。', { exact: false }).first().waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => document.querySelector('#status').textContent === '已下载，可离线游玩');
  const manifest = JSON.parse(await readFile(root + '/build-manifest.json', 'utf8'));
  assert.ok(!manifest.files.some(file => /script\/text(?:\/|\.js)/.test(file.name)));
  assert.ok(!requests.some(path => /script\/text/.test(path)));
  await context.setOffline(true);
  const reopened = await context.newPage(); reopened.on('pageerror', error => errors.push(error.message));
  await reopened.goto(url); await reopened.getByRole('button', { name: '离开 / Leave', exact: true }).click();
  await reopened.getByText('暂时停在这里。', { exact: false }).first().waitFor();
  assert.deepEqual(errors, []);
  await reopened.screenshot({ path: output + '/offline-dsl-player.png', fullPage: true });
  await writeFile(output + '/REPORT.json', JSON.stringify({ status: 'PASS', nestedDeployment: true, offlineNewPage: true, branches: ['good', 'neutral'], parserPackaged: false, files: manifest.files.length, errors }, null, 2) + '\n');
  console.log('PASS P1 compiled JSON player: both branches, nested deployment, offline new page, no text compiler');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
