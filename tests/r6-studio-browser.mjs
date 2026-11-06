import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDemoServer } from '../tools/serve.mjs';
import { newProject } from '../dist/editor/index.js';

const output = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/r6-studio';
await mkdir(output, { recursive: true });
const server = await createDemoServer();
await listenBrowserServer(server);
let browser;
const checks = [], errors = [], confirmations = [];
let confirmReplacement = false;

async function holdDraftDebounce(page) {
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window), held = new Map();
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 350) return schedule(callback, delay, ...args);
      const id = schedule(() => {}, 60_000);
      held.set(id, () => callback(...args));
      return id;
    };
    window.clearTimeout = id => { held.delete(id); cancel(id); };
    window.draftTimerGate = {
      count: () => held.size,
      release() {
        const pending = [...held];
        for (const [id, callback] of pending) {
          held.delete(id);
          cancel(id);
          callback();
        }
        return pending.length;
      }
    };
  });
}

try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') {
      confirmations.push(dialog.message());
      await (confirmReplacement ? dialog.accept() : dialog.dismiss());
    } else await dialog.accept();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`);
  await page.waitForSelector('body[data-editor-ready=true]');
  const source = page.getByLabel('工程 JSON 内容', { exact: true });
  const sourceTab = () => page.getByRole('button', { name: '工程 JSON', exact: true }).click();
  const storyTab = () => page.getByRole('button', { name: '场景与分支', exact: true }).click();
  const command = name => page.locator(`[data-command=${name}]`).click();
  const passed = text => { checks.push(text); console.log('PASS', text); };
  const waitDraft = value => page.waitForFunction(value =>
    JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.source === value, value);
  const downloaded = async name => {
    const event = page.waitForEvent('download'); await command(name);
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };

  await sourceTab();
  const initial = JSON.parse(await source.inputValue());
  const edited = { ...initial, title: 'R6 applied JSON project' };
  const raw = '\n' + JSON.stringify(edited, null, 4) + '\n\n';
  await source.fill(raw); await waitDraft(raw);
  await sourceTab(); await sourceTab();
  assert.equal(await source.inputValue(), raw);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  assert.deepEqual(confirmations, []);
  await source.press('Control+Home');
  await page.screenshot({ path: output + '/json-same-tab.png', fullPage: true });
  passed('Repeated active JSON tabs preserve valid unapplied raw text and its dirty state without confirmation');

  const invalid = '{ "R6 invalid and unapplied JSON":\n';
  await source.fill(invalid); await sourceTab();
  assert.equal(await source.inputValue(), invalid);
  assert.deepEqual(confirmations, []);
  await waitDraft(invalid);
  await page.reload(); await page.waitForSelector('body[data-editor-ready=true]');
  confirmReplacement = true; await command('restore-draft'); confirmReplacement = false;
  assert.equal(await source.inputValue(), invalid);
  await sourceTab();
  assert.equal(await source.inputValue(), invalid);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  passed('Invalid unapplied JSON survives active-tab clicks, local draft reload and restoration');

  await source.fill(raw); await command('apply-source');
  assert.equal(await page.locator('#project-name').innerText(), edited.title);
  assert.deepEqual(await downloaded('export'), edited);
  const workspace = await downloaded('save');
  assert.deepEqual(workspace.project, edited);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
  await sourceTab();
  assert.equal(await source.inputValue(), raw);
  assert.deepEqual(confirmations, []);
  passed('Applying valid JSON exports and saves the exact applied project while active-tab clicks retain raw formatting');

  const discarded = JSON.stringify({ ...edited, title: 'R6 explicitly discarded JSON' }, null, 2);
  await source.fill(discarded); await waitDraft(discarded);
  await storyTab();
  assert.equal(await page.locator('#source-panel').isVisible(), true);
  assert.equal(await source.inputValue(), discarded);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  assert.equal(confirmations.length, 1);
  passed('Cancelling departure from JSON preserves the active panel, unapplied text and dirty state');

  // A clean workspace does not save on beforeunload, and pagehide cancels debounce timers.
  // Freeze the draft debounce so only synchronous persistence can pass this check.
  await page.evaluate(() => {
    const schedule = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => delay === 350 ? 0 : schedule(callback, delay, ...args);
  });
  confirmReplacement = true; await storyTab(); confirmReplacement = false;
  assert.equal(await page.locator('#story-panel').isVisible(), true);
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
  assert.equal(await page.locator('#save-state').innerText(), '已保存');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1')).source), undefined);
  assert.equal(confirmations.length, 2);
  passed('Confirmed departure synchronously discards unapplied text from the draft and refreshes saved state before reload');

  await page.reload(); await page.waitForSelector('body[data-editor-ready=true]');
  confirmReplacement = true; await command('restore-draft'); confirmReplacement = false;
  await sourceTab();
  assert.deepEqual(JSON.parse(await source.inputValue()), edited);
  assert.equal((await source.inputValue()).includes('R6 explicitly discarded JSON'), false);
  assert.deepEqual(await downloaded('export'), edited);
  passed('Restoring the post-discard draft cannot resurrect explicitly discarded JSON or change the applied project');

  const openDraftWorkspace = async () => {
    const workspace = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    workspace.on('pageerror', error => errors.push(error.message));
    workspace.on('dialog', dialog => dialog.accept());
    await workspace.goto(`http://127.0.0.1:${server.address().port}/editor/`);
    await workspace.waitForSelector('body[data-editor-ready=true]');
    await workspace.locator('#auto-preview').uncheck();
    return workspace;
  };
  const draftOf = workspace => workspace.evaluate(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1')));
  const replacement = await openDraftWorkspace();
  await holdDraftDebounce(replacement);
  const title = replacement.getByLabel('作品名称', { exact: true });
  await title.fill('Draft A first edit'); await title.blur();
  assert.equal(await replacement.evaluate(() => draftTimerGate.release()), 1);
  assert.equal((await draftOf(replacement)).document.project.title, 'Draft A first edit');
  await title.fill('Draft A latest edit'); await title.blur();
  assert.equal(await replacement.evaluate(() => draftTimerGate.count()), 1);
  assert.equal((await draftOf(replacement)).document.project.title, 'Draft A first edit');
  await replacement.locator('#template').selectOption('vn');
  await replacement.locator('[data-command=new]').click();
  assert.equal(await replacement.locator('body').getAttribute('data-project-type'), 'narrative');
  assert.equal(await replacement.locator('body').getAttribute('data-dirty'), 'false');
  const savedBeforeRelease = await draftOf(replacement);
  assert.equal(savedBeforeRelease.document.project.title, 'Draft A latest edit');
  assert.equal(savedBeforeRelease.document.project.type, 'script');
  await replacement.evaluate(() => draftTimerGate.release());
  assert.deepEqual(await draftOf(replacement), savedBeforeRelease);
  await replacement.locator('[data-tab=source]').click();
  await replacement.locator('[data-command=apply-source]').click();
  assert.deepEqual(await draftOf(replacement), savedBeforeRelease);
  await replacement.reload();
  await replacement.locator('[data-command=restore-draft]').click();
  assert.equal(await replacement.locator('#project-name').innerText(), 'Draft A latest edit');
  assert.equal(await replacement.locator('body').getAttribute('data-project-type'), 'script');
  await replacement.close({ runBeforeUnload: false });
  passed('Accepting a workspace replacement preserves the latest outgoing draft and cannot write the clean replacement through an old timer');

  const formatOnly = await openDraftWorkspace();
  await formatOnly.locator('[data-tab=source]').click();
  const formatSource = formatOnly.getByLabel('工程 JSON 内容', { exact: true });
  const canonical = await formatSource.inputValue();
  const formatted = '\n' + JSON.stringify(JSON.parse(canonical), null, 4) + '\n\n';
  assert.equal(await formatOnly.locator('body').getAttribute('data-dirty'), 'false');
  await formatSource.fill(formatted);
  await formatOnly.waitForFunction(formatted => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.source === formatted, formatted);
  await holdDraftDebounce(formatOnly);
  await formatOnly.locator('[data-command=apply-source]').click();
  assert.equal(await formatOnly.locator('body').getAttribute('data-dirty'), 'false');
  assert.equal(await formatOnly.locator('#save-state').innerText(), '已保存');
  assert.equal(await formatOnly.locator('[data-command=undo]').isDisabled(), true);
  assert.equal(await formatSource.inputValue(), formatted);
  const appliedDraft = await draftOf(formatOnly);
  assert.equal(appliedDraft.source, undefined);
  assert.deepEqual(appliedDraft.document.project, JSON.parse(canonical));
  await formatOnly.reload();
  await formatOnly.locator('[data-command=restore-draft]').click();
  await formatOnly.locator('[data-tab=source]').click();
  assert.equal(await formatSource.inputValue(), canonical);
  await formatOnly.close({ runBeforeUnload: false });
  passed('Applying formatting-only JSON immediately clears the dirty state and prevents a persisted raw draft from reappearing');

  const fileInput = (name, buffer) => ({ name, mimeType: 'application/json', buffer });
  const downloadFrom = async (workspace, selector) => {
    const [file] = await Promise.all([workspace.waitForEvent('download'), workspace.locator(selector).click()]);
    return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
  };
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const original = await openDraftWorkspace();
  const project = newProject('script');
  project.title = 'Portable recovery raw project';
  project.assets = [{ id: 'classroom', kind: 'background', src: 'assets/classroom.svg' }];
  project.program.blocks[0].cue = { background: 'classroom' };
  project.settings = { textDelayMs: 0 };
  const originalBytes = Buffer.from('\r\n' + JSON.stringify(project) + '\r\n\r\n');
  await original.locator('#open-file').setInputFiles(fileInput('recovery-source.json', originalBytes));
  await original.waitForFunction(title => document.querySelector('#project-name').textContent === title, project.title);
  await original.locator('.node').first().press('Alt+ArrowRight');
  await original.locator('[data-tab=assets]').click();
  await original.locator('#asset-directory').setInputFiles('examples/runtime');
  await original.waitForFunction(() => document.querySelector('#asset-state').textContent.includes('已绑定'));
  const priorRevision = Number(await original.locator('body').getAttribute('data-preview-revision'));
  await original.locator('[data-command=preview]').click();
  await original.waitForFunction(prior => Number(document.body.dataset.previewRevision) > prior, priorRevision);
  await original.locator('[data-tab=evidence]').click();
  await original.locator('[data-evidence-command=capture]').click();
  await original.waitForSelector('body[data-evidence-binding=current]');
  const evidence = await downloadFrom(original, '[data-evidence-command=download]');
  assert.equal(JSON.parse(evidence.bytes).sourceSha256, sha256(originalBytes));
  const dslDraft = 'vn-script 1\n# unfinished recovery draft\n';
  await original.locator('[data-tab=text-script]').click();
  await original.locator('[data-dsl-source]').fill(dslDraft);
  await original.locator('[data-tab=source]').click();
  const pendingSource = '{ "unfinished recovery JSON":\n';
  await original.locator('#source').fill(pendingSource);
  await original.waitForFunction(pending => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.source === pending, pendingSource);
  const recovery = await downloadFrom(original, '[data-command=export-recovery]');
  assert.match(recovery.name, /\.vnrecover$/);
  const portable = JSON.parse(recovery.bytes), position = portable.positions['["start"]'];
  assert.equal(portable.format, 'vn-engine-recovery');
  assert.equal(portable.document, undefined);
  assert.equal(portable.sourceText, originalBytes.toString('utf8'));
  assert.deepEqual(position, { x: 56, y: 38 });
  assert.equal(portable.source, pendingSource);
  assert.equal(portable.textScriptDraft, dslDraft);
  assert.equal(portable.baseURL, undefined);

  const recovered = await openDraftWorkspace();
  const [chooser] = await Promise.all([recovered.waitForEvent('filechooser'), recovered.locator('[data-command=import-recovery]').click()]);
  await chooser.setFiles(fileInput(recovery.name, recovery.bytes));
  await recovered.waitForFunction(() => document.querySelector('#status').textContent.includes('恢复文件已打开'));
  assert.equal((await draftOf(recovered)).sourceText, originalBytes.toString('utf8'));
  assert.equal(await recovered.locator('#project-name').innerText(), project.title);
  assert.match(await recovered.locator('#asset-state').innerText(), /未绑定/);
  assert.equal(await recovered.locator('#source').inputValue(), pendingSource);
  assert.equal(await recovered.locator('.node').first().evaluate(node => node.style.left), position.x + 'px');
  await recovered.locator('[data-tab=text-script]').click();
  assert.equal(await recovered.locator('[data-dsl-source]').inputValue(), dslDraft);
  const runtime = await downloadFrom(recovered, '[data-command=export]');
  assert.ok(runtime.bytes.equals(originalBytes));
  await recovered.locator('[data-tab=evidence]').click();
  await recovered.locator('#evidence-list input[type=file]').setInputFiles(fileInput(evidence.name, evidence.bytes));
  await recovered.waitForSelector('body[data-evidence-binding=current]');
  passed('Portable recovery restores original runtime bytes, layout and draft inputs in a fresh Chromium context without restoring resource access');

  const legacy = { schema: 1, document: { format: 'vn-engine-editor', schema: 1, project, positions: {} }, source: pendingSource };
  for (const [bytes, expectedError] of [
    [Buffer.from('{broken'), 'JSON'],
    [Buffer.from(JSON.stringify(legacy)), '格式'],
    [Buffer.from(JSON.stringify({ ...portable, baseURL: 'https://forged.invalid/' })), '资源基址']
  ]) {
    await recovered.locator('#recovery-file').setInputFiles(fileInput('invalid.vnrecover', bytes));
    await recovered.waitForFunction(expected => {
      const status = document.querySelector('#status');
      return status.classList.contains('error') && status.textContent.includes(expected);
    }, expectedError);
    assert.equal(await recovered.locator('#project-name').innerText(), project.title);
    assert.equal(await recovered.locator('.node').first().evaluate(node => node.style.left), position.x + 'px');
    assert.equal(await recovered.locator('body').getAttribute('data-evidence-binding'), 'current');
    await recovered.locator('#recovery-file').evaluate(input => { input.value = ''; });
  }
  await recovered.close({ runBeforeUnload: false });
  passed('Invalid and untagged portable recovery files preserve the current workspace and source-bound evidence');

  await original.reload();
  await original.locator('[data-command=restore-draft]').click();
  await original.waitForFunction(() => document.querySelector('#status').textContent.includes('草稿已恢复'));
  assert.equal(await original.locator('#source').inputValue(), pendingSource);
  await original.locator('[data-tab=story]').click();
  assert.ok((await downloadFrom(original, '[data-command=export]')).bytes.equals(originalBytes));
  await original.close({ runBeforeUnload: false });
  const legacyPage = await openDraftWorkspace();
  await legacyPage.evaluate(legacy => localStorage.setItem('vn-engine-studio:draft:v1', JSON.stringify(legacy)), legacy);
  await legacyPage.reload();
  await legacyPage.locator('[data-command=restore-draft]').click();
  await legacyPage.waitForFunction(() => document.querySelector('#status').textContent.includes('草稿已恢复'));
  assert.equal(await legacyPage.locator('#project-name').innerText(), project.title);
  assert.equal(await legacyPage.locator('#source').inputValue(), pendingSource);
  await legacyPage.close({ runBeforeUnload: false });
  passed('Local recovery preserves raw source across reload and still reads untagged legacy drafts');

  const portableBytes = (project, extra = {}) => Buffer.from(JSON.stringify({ format: 'vn-engine-recovery', schema: 1,
    document: { format: 'vn-engine-editor', schema: 1, project, positions: {} }, ...extra }));
  const openPortable = async (workspace, bytes) => {
    const [file] = await Promise.all([workspace.waitForEvent('filechooser'), workspace.locator('[data-command=import-recovery]').click()]);
    await file.setFiles(fileInput('workspace.vnrecover', bytes));
  };
  const waitRecovered = workspace => workspace.waitForFunction(() => document.querySelector('#status').textContent.startsWith('恢复文件已打开'));

  const guarded = await openDraftWorkspace();
  await guarded.locator('#open-file').setInputFiles(fileInput('bound-source.json', originalBytes));
  await guarded.waitForFunction(title => document.querySelector('#project-name').textContent === title, project.title);
  await guarded.locator('#asset-directory').setInputFiles('examples/runtime');
  await guarded.locator('[data-command=preview]').click();
  await guarded.waitForFunction(() => {
    const image = document.querySelector('#preview').contentDocument.querySelector('.vn-background');
    return image?.src.startsWith('blob:') && image.naturalWidth > 0;
  });
  const mountedState = () => guarded.evaluate(() => {
    const iframe = document.querySelector('#preview').contentDocument;
    const image = iframe.querySelector('.vn-background');
    return { revision: document.body.dataset.previewRevision, title: document.querySelector('#project-name').textContent,
      binding: document.querySelector('#asset-state').textContent, line: iframe.querySelector('.vn-text').textContent,
      image: image.src, width: image.naturalWidth };
  });
  const beforeMalformed = await mountedState();
  const badEncoding = portableBytes({ ...newProject('script'), title: 'UTF8 sentinel X' });
  const marker = badEncoding.indexOf('UTF8 sentinel X') + 'UTF8 sentinel '.length;
  assert.equal(badEncoding[marker], 'X'.charCodeAt(0));
  badEncoding[marker] = 0x80;
  const badAssets = portableBytes({ ...newProject('script'), title: 'Invalid recovery asset', assets: [null] });
  const badTimeline = (field, entry) => {
    const project = { ...newProject('script'), title: `Invalid recovery ${field}` };
    project.program.blocks[0].cue = { timeline: { durationMs: 250, [field]: [entry] } };
    return portableBytes(project, { productionDraft: { schema: 1, game: project.game, storyVersion: project.version,
      feedback: { target: '' }, notes: [] } });
  };
  for (const [bytes, message] of [[badEncoding, 'UTF-8'], [badAssets, 'assets'],
    [badTimeline('camera', null), 'timeline.camera'], [badTimeline('animations', 'invalid'), 'timeline.animations']]) {
    await openPortable(guarded, bytes);
    await guarded.waitForFunction(expected => {
      const status = document.querySelector('#status');
      return status.classList.contains('error') && status.textContent.includes(expected);
    }, message, { timeout: 5000 });
    assert.deepEqual(await mountedState(), beforeMalformed);
    assert.ok((await downloadFrom(guarded, '[data-command=export]')).bytes.equals(originalBytes));
  }
  passed('Recovery rejects malformed UTF-8, assets and timeline entries without changing the mounted workspace');

  const unicodeProject = { ...newProject('script'), title: '合法替换字符 � 与中文' };
  const unicodeSource = '\r\n' + JSON.stringify(unicodeProject) + '\r\n';
  const unicodeWire = JSON.stringify({ format: 'vn-engine-recovery', schema: 1, sourceText: unicodeSource, positions: {} });
  await openPortable(guarded, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(unicodeWire)]));
  await waitRecovered(guarded);
  assert.equal(await guarded.locator('#project-name').innerText(), unicodeProject.title);
  assert.ok((await downloadFrom(guarded, '[data-command=export]')).bytes.equals(Buffer.from(unicodeSource)));
  await guarded.close({ runBeforeUnload: false });
  passed('Recovery accepts a UTF-8 BOM and preserves a legitimate replacement character and raw source bytes');

  const rainPage = await openDraftWorkspace();
  const rain = { schema: 1, type: 'rain', game: 'repairable-rain', version: '1', title: 'Repairable Rain', assets: [],
    settings: { textDelayMs: 0 }, story: { schema_version: 1, entry: 'start', initial_state: {}, state_definitions: {},
      nodes: [{ id: 'start', lines: [{ id: 'opening', speaker: 'unknown-speaker', text: '修复后的 Rain 台词。' }], ending: 'done' }] } };
  const emptyFeedback = { schema: 1, game: rain.game, storyVersion: rain.version, reviewGame: rain.game, reviewVersion: rain.version,
    feedback: { id: '', category: 'text', target: '', comment: '', actor: '作者（自报）' }, notes: [] };
  await openPortable(rainPage, portableBytes(rain, { productionDraft: emptyFeedback, editorTab: 'source' }));
  await waitRecovered(rainPage);
  assert.match(await rainPage.locator('#diagnostics').innerText(), /Unknown Rain speaker/);
  assert.equal(await rainPage.locator('[data-command=export]').isDisabled(), true);
  const rainSource = rainPage.locator('#source'), repairedRain = JSON.parse(await rainSource.inputValue());
  repairedRain.story.nodes[0].lines[0].speaker = 'n';
  await rainSource.fill(JSON.stringify(repairedRain));
  await rainPage.locator('[data-command=apply-source]').click();
  assert.equal(await rainPage.locator('[data-command=export]').isEnabled(), true);
  await rainPage.locator('[data-command=preview]').click();
  await rainPage.frameLocator('#preview').getByText('修复后的 Rain 台词。', { exact: true }).waitFor();
  await rainPage.close({ runBeforeUnload: false });
  passed('Recovery opens a repairable Rain project with an empty feedback draft');

  const incoming = newProject('script');
  incoming.game = incoming.program.game = 'portable-draft-b'; incoming.title = 'Portable workspace B';
  const incomingFile = portableBytes(incoming);
  for (const hasExistingDraft of [false, true]) {
    const slotPage = await openDraftWorkspace();
    await holdDraftDebounce(slotPage);
    const slotTitle = slotPage.getByLabel('作品名称', { exact: true });
    if (hasExistingDraft) {
      await slotTitle.fill('Older local draft A'); await slotTitle.blur();
      assert.equal(await slotPage.evaluate(() => draftTimerGate.release()), 1);
      assert.equal((await draftOf(slotPage)).document.project.title, 'Older local draft A');
    } else assert.equal(await draftOf(slotPage), null);
    await slotTitle.fill('Latest outgoing local draft A'); await slotTitle.blur();
    assert.equal(await slotPage.evaluate(() => draftTimerGate.count()), 1);
    assert.equal((await draftOf(slotPage))?.document.project.title, hasExistingDraft ? 'Older local draft A' : undefined);
    await openPortable(slotPage, incomingFile); await waitRecovered(slotPage);
    assert.equal(await slotPage.locator('#project-name').innerText(), incoming.title);
    const savedA = await draftOf(slotPage);
    assert.equal(savedA.document.project.title, 'Latest outgoing local draft A');
    await slotPage.evaluate(() => draftTimerGate.release());
    assert.deepEqual(await draftOf(slotPage), savedA);
    await slotPage.reload(); await slotPage.waitForSelector('body[data-editor-ready=true]');
    assert.deepEqual(await draftOf(slotPage), savedA);
    await slotPage.locator('[data-command=restore-draft]').click();
    await slotPage.waitForFunction(() => document.querySelector('#status').textContent.startsWith('草稿已恢复'));
    assert.equal(await slotPage.locator('#project-name').innerText(), 'Latest outgoing local draft A');
    await openPortable(slotPage, incomingFile); await waitRecovered(slotPage);
    await slotTitle.fill('Genuine later edit to B'); await slotTitle.blur();
    await slotPage.waitForFunction(() => {
      const draft = JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'));
      return draft?.document.project.game === 'portable-draft-b' && draft.document.project.title === 'Genuine later edit to B';
    });
    await slotPage.close({ runBeforeUnload: false });
  }
  passed('Portable recovery preserves outgoing local drafts through reload and saves later edits to the imported project');

  const discardPage = await openDraftWorkspace();
  await holdDraftDebounce(discardPage);
  const discardTitle = discardPage.getByLabel('作品名称', { exact: true });
  await discardTitle.fill('Outgoing draft to preserve'); await discardTitle.blur();
  const unappliedPortableJSON = '{ "unapplied portable draft":';
  await openPortable(discardPage, portableBytes(incoming, { source: unappliedPortableJSON }));
  await waitRecovered(discardPage);
  const retained = await draftOf(discardPage);
  assert.equal(retained.document.project.title, 'Outgoing draft to preserve');
  assert.equal(await discardPage.locator('#source').inputValue(), unappliedPortableJSON);
  await discardPage.locator('[data-tab=story]').click();
  await discardPage.locator('[data-tab=source]').click();
  assert.equal(JSON.parse(await discardPage.locator('#source').inputValue()).title, incoming.title);
  assert.deepEqual(await draftOf(discardPage), retained);
  await discardPage.close({ runBeforeUnload: false });
  passed('Discarding imported unapplied JSON preserves the outgoing local draft');

  const quotaPage = await openDraftWorkspace();
  await holdDraftDebounce(quotaPage);
  const quotaTitle = quotaPage.getByLabel('作品名称', { exact: true });
  await quotaTitle.fill('Earlier persisted quota fixture'); await quotaTitle.blur();
  assert.equal(await quotaPage.evaluate(() => draftTimerGate.release()), 1);
  const quotaSlot = await draftOf(quotaPage);
  await quotaPage.evaluate(() => {
    const write = Storage.prototype.setItem;
    window.restoreDraftStorage = () => { Storage.prototype.setItem = write; };
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'vn-engine-studio:draft:v1') throw new DOMException('Fixture quota', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await quotaTitle.fill('Latest unsaved quota fixture'); await quotaTitle.blur();
  for (const replace of [
    () => quotaPage.locator('[data-command=new]').click(),
    () => quotaPage.locator('[data-command=sample]').click(),
    async () => {
      const [file] = await Promise.all([quotaPage.waitForEvent('filechooser'), quotaPage.locator('[data-command=open]').click()]);
      await file.setFiles(fileInput('workspace.json', Buffer.from(JSON.stringify(incoming))));
    }
  ]) {
    await quotaPage.evaluate(() => { document.querySelector('#status').textContent = ''; });
    await replace();
    await quotaPage.waitForFunction(() => document.querySelector('#status').textContent.includes('当前工程的草稿未能保存，已取消切换'));
    assert.equal(await quotaTitle.inputValue(), 'Latest unsaved quota fixture');
    assert.equal(await quotaPage.locator('body').getAttribute('data-dirty'), 'true');
    assert.deepEqual(await draftOf(quotaPage), quotaSlot);
  }
  await quotaPage.evaluate(() => restoreDraftStorage());
  await quotaPage.locator('[data-command=new]').click();
  assert.equal(await quotaPage.locator('#status').textContent(), '工程已打开');
  assert.equal((await draftOf(quotaPage)).document.project.title, 'Latest unsaved quota fixture');
  await quotaPage.close({ runBeforeUnload: false });
  passed('Studio blocks new, sample and file replacement when the outgoing draft cannot be written');

  assert.deepEqual(errors, []);
  await writeFile(output + '/r6-studio-browser.json', JSON.stringify({ status: 'PASS', checks,
    browser: await browser.version(), mode: 'headless', syntheticProject: true }, null, 2) + '\n');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
