import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname, join } from 'node:path';
import { chromium } from 'playwright';
import { compileTextScript, checkTextScriptProject } from '../dist/script/text.js';
import { packageGame } from '../tools/package-game.mjs';
import { packageStudio } from '../tools/package-studio.mjs';
import { listenBrowserServer } from '../tools/browser-server.mjs';

const output = resolve(process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results', 'p3-package');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'run-')), checks = [], errors = [], requests = [], observations = [];
const forbiddenPlayer = name => /(?:^|\/)script\/text(?:\/|\.js)|\.vn\.txt$|source[-_]?map|browser-server|compiled-modules/i.test(name);
const scope = { automatedChromium: true, generatedPackages: true, nestedDeployment: true, offlineNewPages: true,
  studioFileInputs: 'automated real project and directory inputs', physicalDevice: 'UNVERIFIED', physicalListening: 'UNVERIFIED',
  manualSystemDialogs: 'UNVERIFIED', formalContentAcceptance: 'not assessed; technical sample assets remain DRAFT' };
let server, browser;
try {
  const script = await readFile('examples/dsl/stage.vn.txt', 'utf8');
  const project = JSON.parse(await readFile('examples/runtime/stage.json', 'utf8'));
  const compilation = checkTextScriptProject(compileTextScript(script, { fileName: 'stage.vn.txt' }), project);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));
  assert.deepEqual(compilation.program, project.program);
  assert.equal(compilation.sourceMap.filter(item => item.kind === 'cue').length, 17);
  const playerRoot = join(run, 'player'), studioRoot = join(run, 'studio');
  await packageGame('examples/runtime/stage.json', playerRoot); await packageStudio(studioRoot);
  const playerManifest = JSON.parse(await readFile(join(playerRoot, 'build-manifest.json'), 'utf8'));
  const studioManifest = JSON.parse(await readFile(join(studioRoot, 'studio-manifest.json'), 'utf8'));
  assert.ok(!playerManifest.files.some(item => forbiddenPlayer(item.name)));
  assert.ok(studioManifest.files.some(item => item.name === 'lib/script/text.js'));
  assert.ok(studioManifest.files.some(item => item.name === 'lib/script/text/project.js'));
  const packagedProject = JSON.parse(await readFile(join(playerRoot, 'project.json'), 'utf8'));
  assert.deepEqual(packagedProject, project);
  assert.ok(!Object.hasOwn(packagedProject, 'sourceMap'));
  checks.push('Stage DSL compiles to the packaged canonical IR; compiler/context/map stay outside the player');
  const roots = { player: playerRoot, studio: studioRoot };
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname; requests.push(pathname);
      const match = /^\/nested\/(player|studio)\/(.*)$/.exec(pathname);
      if (!match) { response.writeHead(404).end(); return; }
      const root = roots[match[1]], suffix = decodeURIComponent(match[2]);
      const file = resolve(root, suffix + (!suffix || suffix.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
        '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.webm': 'video/webm',
        '.webmanifest': 'application/manifest+json' })[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await listenBrowserServer(server);
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
  });
  await context.addInitScript(() => {
    const metrics = globalThis.p3PackageAudio = { starts: 0, stops: 0, playing: 0 };
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function(...args) {
      const result = start.apply(this, args); metrics.starts++; metrics.playing++;
      this.addEventListener('ended', () => { metrics.playing--; }, { once: true }); return result;
    };
    AudioBufferSourceNode.prototype.stop = function(...args) { const result = stop.apply(this, args); metrics.stops++; return result; };
  });
  const base = `http://127.0.0.1:${server.address().port}/nested/`;
  const loadedImage = (page, selector, asset) => page.waitForFunction(({ selector, asset }) => {
    const image = document.querySelector(selector);
    return image?.dataset.asset === asset && image.naturalWidth > 0 && !image.hidden;
  }, { selector, asset });
  const play = async (branch, label) => {
    const page = await context.newPage(); await page.goto(base + 'player/');
    await page.locator('.vn-text').filter({ hasText: '背景、立绘和声音来自同一份演出文本。' }).waitFor();
    await loadedImage(page, '.vn-background', 'classroom'); await loadedImage(page, '.vn-portrait', 'student');
    await page.getByRole('button', { name: '启用声音', exact: true }).click();
    await page.waitForFunction(() => p3PackageAudio.starts >= 2 && p3PackageAudio.playing >= 2);
    await page.locator('.vn-actions [data-control=next]').click();
    await page.getByRole('button', { name: branch === 'good' ? '继续演出' : '安静离开', exact: true }).click();
    const finalText = branch === 'good' ? '插图出现，音乐停止，演出完成。' : '画面保留，人物和音乐清除。';
    await page.locator('.vn-text').filter({ hasText: finalText }).waitFor();
    await loadedImage(page, '.vn-background', branch === 'good' ? 'bedroom' : 'classroom');
    if (branch === 'good') await loadedImage(page, '.vn-cg', 'letter');
    else assert.equal(await page.locator('.vn-cg').isHidden(), true);
    assert.equal(await page.locator('.vn-portrait').isHidden(), true);
    await page.waitForFunction(() => p3PackageAudio.stops >= 2 && p3PackageAudio.playing === 0);
    assert.equal(await page.locator('#error').innerText(), '');
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已下载，可离线游玩');
    const audio = await page.evaluate(() => ({ ...p3PackageAudio }));
    observations.push({ workflow: label, branch, background: branch === 'good' ? 'bedroom' : 'classroom', portraitCleared: true,
      cg: branch === 'good' ? 'letter' : null, audio, soundScope: 'real WebAudio source lifecycle; no subjective listening verdict' });
    await page.screenshot({ path: join(output, label + '.png'), fullPage: true });
    return page;
  };
  const onlinePlayer = await play('good', 'online-player-good');
  const playerCached = await onlinePlayer.evaluate(async () => {
    const urls = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys())
      if (new URL(request.url).pathname.startsWith('/nested/player/')) urls.push(new URL(request.url).pathname);
    return urls;
  });
  assert.ok(playerCached.some(name => name.endsWith('/lib/runtime/session.js')));
  assert.ok(playerCached.some(name => name.endsWith('/assets/music-test.wav')));
  assert.ok(!playerCached.some(forbiddenPlayer));
  checks.push('Generated player reaches good with actual images and stopped BGM/ambience; offline cache excludes author code');
  const author = async (page, label) => {
    await page.goto(base + 'studio/editor/'); await page.waitForSelector('body[data-editor-ready=true]');
    await page.locator('#open-file').setInputFiles(resolve('examples/runtime/stage.json'));
    await page.waitForFunction(game => document.querySelector('[aria-label="作品 ID"]').value === game, project.game);
    await page.locator('[data-tab=assets]').click();
    await page.locator('#asset-directory').setInputFiles(resolve('examples/runtime'));
    await page.waitForFunction(() => document.querySelector('#asset-state').textContent.startsWith('已绑定 '));
    await page.locator('[data-tab=text-script]').click();
    const text = `${label}：演出文本编译到真实预览。`;
    const edited = script.replace('背景、立绘和声音来自同一份演出文本。', text); assert.notEqual(edited, script);
    await page.getByLabel('文本 DSL 内容', { exact: true }).fill(edited.replace('cue line hello voice greeting', 'cue line hello voice missing-voice'));
    await page.locator('[data-dsl-command=compile]').click();
    await page.waitForSelector('#text-script-list[data-dsl-state=invalid]');
    assert.equal(await page.locator('[data-dsl-command=apply]').isDisabled(), true);
    assert.match(await page.locator('[data-dsl-diagnostic]').allTextContents().then(values => values.join('\n')), /DSL_ASSET_MISSING/);
    await page.getByLabel('文本 DSL 内容', { exact: true }).fill(edited);
    await page.locator('[data-dsl-command=compile]').click();
    await page.waitForFunction(() => !document.querySelector('[data-dsl-command=apply]').disabled);
    await page.frameLocator('#preview').locator('.vn-text').filter({ hasText: text }).waitFor();
    const preview = page.frames().find(frame => /\/editor\/preview\.html$/.test(frame.url()));
    await preview.waitForFunction(() => document.querySelector('.vn-background')?.naturalWidth > 0 && document.querySelector('.vn-portrait')?.naturalWidth > 0);
    await page.locator('[data-dsl-command=apply]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-command=export]').click()]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported.program, checkTextScriptProject(compileTextScript(edited), project).program);
    assert.deepEqual(exported.assets, project.assets); assert.ok(!Object.hasOwn(exported, 'sourceMap'));
    await page.screenshot({ path: join(output, label + '.png'), fullPage: true });
    observations.push({ workflow: label, projectOpenedByFileInput: true, assetDirectoryBoundByFileInput: true,
      missingVoiceRejected: true, authoredText: text, candidatePreview: true, explicitApplyAndExport: true, assetsPreserved: true });
  };
  const studio = await context.newPage(); await author(studio, 'online-studio');
  await studio.waitForFunction(() => document.body.dataset.studioOffline === 'ready');
  const studioCached = await studio.evaluate(async () => {
    const urls = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys())
      if (new URL(request.url).pathname.startsWith('/nested/studio/')) urls.push(new URL(request.url).pathname);
    return urls;
  });
  assert.ok(studioCached.some(name => name.endsWith('/lib/script/text/project.js')));
  checks.push('Packaged Studio opens a real project, binds local assets, rejects a missing voice, previews/applies/exports authored cues');
  await context.setOffline(true);
  const offlineGood = await play('good', 'offline-player-good'); await offlineGood.close({ runBeforeUnload: false });
  const offlineNeutral = await play('neutral', 'offline-player-neutral'); await offlineNeutral.close({ runBeforeUnload: false });
  checks.push('New offline player pages execute both branches with correct images and media clearing');
  const offlineStudio = await context.newPage(); await author(offlineStudio, 'offline-studio');
  checks.push('A new offline Studio page compiles, context-checks, previews, applies and exports through real author controls');
  assert.ok(!requests.filter(name => name.startsWith('/nested/player/')).some(forbiddenPlayer));
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'REPORT.json'), JSON.stringify({ status: 'PASS', checks, scope, observations, run,
    playerFiles: playerManifest.files.length, studioFiles: studioManifest.files.length, playerCachedFiles: playerCached.length,
    compilerPackagedInPlayer: false, contextHelperPackagedInPlayer: false, sourceMapPackagedInPlayer: false,
    studioContextHelperCached: true, errors, browser: await browser.version() }, null, 2) + '\n');
  console.log('PASS P3 stage DSL generated player/Studio: both offline branches, real media clearing, author context checks and package boundaries');
} catch (error) {
  await writeFile(join(output, 'REPORT.json'), JSON.stringify({ status: 'FAIL', checks, scope, observations, errors, run, failure: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}
