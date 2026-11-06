import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const out = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/r5-feedback'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await listenBrowserServer(server);
const draftId = page => page.locator('body').getAttribute('data-draft-id');
const localSlot = (page, id) => page.evaluate(id => localStorage.getItem('vn-engine-studio:draft:v2:' + (id ?? document.body.dataset.draftId)), id);
const draftChoice = page => page.locator('#draft-choice');
const draftCommand = (page, id) => page.locator(`[data-command=${id}]`).click();
const waitRestored = page => page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('草稿已恢复'));
let browser; const checks = [], errors = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  const panel = page.locator('#production-list'), command = id => page.locator(`[data-command=${id}]`).click();
  const field = async (label, value) => { const input = panel.getByLabel(label, { exact: true }); await input.fill(value); await input.blur(); };
  const feedback = async () => { await page.locator('[data-tab=production]').click(); await panel.getByRole('button', { name: '问题与反馈', exact: true }).click(); };
  const downloaded = async click => { const event = page.waitForEvent('download'); await click(); return JSON.parse(await readFile(await (await event).path(), 'utf8')); };
  const draft = async () => JSON.parse(await localSlot(page));
  const reloadDraft = async () => {
    const id = await draftId(page);
    await page.reload();
    await page.waitForSelector('body[data-editor-ready=true]');
    await draftChoice(page).selectOption(id);
    await command('restore-draft');
    await waitRestored(page);
    await feedback();
  };
  await page.evaluate(() => { for (const name of ['save:auto', 'meta', 'read']) localStorage.setItem('vn-engine:r5-feedback:' + name, 'sentinel'); });
  await feedback(); await field('反馈 ID', 'r5-note'); await field('反馈意见', 'R5 unrecorded issue draft');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v2:' + document.body.dataset.draftId))?.productionDraft?.feedback?.comment === 'R5 unrecorded issue draft');
  await reloadDraft();
  assert.equal(await panel.getByLabel('反馈 ID', { exact: true }).inputValue(), 'r5-note');
  assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), 'R5 unrecorded issue draft');
  await panel.getByRole('button', { name: '记录问题', exact: true }).click(); await panel.locator('[data-feedback-id=r5-note]').waitFor();
  assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), '');
  checks.push('Blurred unrecorded feedback remains dirty, survives reload and records as an independent review');

  await field('修复或重开说明 r5-note', 'R5 unrecorded repair note'); await field('复验声明 r5-note', 'R5 unrecorded verification evidence');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v2:' + document.body.dataset.draftId))?.productionDraft?.notes?.some(note => note.note === 'R5 unrecorded repair note'));
  await reloadDraft();
  assert.equal(await panel.getByLabel('修复或重开说明 r5-note', { exact: true }).inputValue(), 'R5 unrecorded repair note');
  assert.equal(await panel.getByLabel('复验声明 r5-note', { exact: true }).inputValue(), 'R5 unrecorded verification evidence');
  await panel.getByRole('button', { name: '记录修复 r5-note', exact: true }).click();
  await panel.locator('[data-feedback-id=r5-note]').getByText('已修复待复验 · 当前版本', { exact: true }).waitFor();
  const review = await downloaded(() => panel.getByRole('button', { name: '保存审阅文档', exact: true }).click());
  assert.equal(review.items[0].events.at(-1).note, 'R5 unrecorded repair note');
  assert.equal(review.items[0].events.at(-1).evidence, 'R5 unrecorded verification evidence');
  assert.equal(await panel.getByLabel('修复或重开说明 r5-note', { exact: true }).inputValue(), 'R5 unrecorded repair note');
  assert.equal(await panel.getByLabel('复验声明 r5-note', { exact: true }).inputValue(), 'R5 unrecorded verification evidence');
  await downloaded(() => command('save')); assert.equal(await page.locator('body').getAttribute('data-dirty'), 'false');
  checks.push('Unrecorded repair and evidence survive reload and become clean, retained form values after recording and separate review saving');

  await field('反馈意见', 'R5 local author draft must not reach a game');
  const runtime = await downloaded(() => command('export'));
  assert.equal(JSON.stringify(runtime).includes('R5 local author draft must not reach a game'), false);
  for (const key of ['productionDraft', 'feedbackDraft', 'notes', 'authorReview', 'items']) assert.equal(runtime[key], undefined);
  assert.deepEqual(await page.evaluate(() => ['save:auto', 'meta', 'read'].map(name => localStorage.getItem('vn-engine:r5-feedback:' + name))), ['sentinel', 'sentinel', 'sentinel']);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v2:' + document.body.dataset.draftId))?.productionDraft?.feedback?.comment === 'R5 local author draft must not reach a game');
  const old = await draft(); await command('new'); await feedback();
  assert.equal(await panel.locator('[data-feedback-id]').count(), 0); assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), '');
  await downloaded(() => command('save'));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v2:' + document.body.dataset.draftId))?.productionDraft?.feedback?.comment === '');
  assert.equal((await draft()).productionDraft.notes.length, 0);
  checks.push('Replacing the workspace resets review forms; runtime exports and player storage exclude all local author draft data');

  const filtering = await page.evaluate(async old => {
    const { readReviewDraft } = await import('./review-draft.mjs');
    const project = old.document.project, review = old.authorReview;
    const forged = structuredClone(old.productionDraft); forged.feedback.extra = 'drop'; forged.feedback.category = 'execute'; forged.feedback.target = 'unknown';
    forged.notes = [{ id: 'missing', note: 'drop', evidence: 'drop' }, ...(forged.notes ?? [])];
    const same = readReviewDraft(forged, project, review, [JSON.stringify({ kind: 'project', id: project.game })]);
    const foreign = readReviewDraft(forged, { ...project, game: 'other-workspace' }, review, []);
    return { keys: Object.keys(same.feedback).sort(), category: same.feedback.category, target: same.feedback.target, noteIds: [...same.notes.keys()], foreignComment: foreign.feedback.comment };
  }, old);
  assert.deepEqual(filtering.keys, ['actor', 'category', 'comment', 'id', 'target']); assert.equal(filtering.category, 'text');
  assert.equal(filtering.target, ''); assert.deepEqual(filtering.noteIds, ['r5-note']); assert.equal(filtering.foreignComment, '');
  checks.push('Draft restoration whitelists strings and categories, rejects unknown targets and note IDs, and isolates workspace identity');

  await panel.locator('[data-production-view=tasks]').click();
  await panel.getByRole('button', { name: '添加剧情任务', exact: true }).click();
  await field('task ID story-1', '');
  assert.equal(await panel.getByLabel('task ID story-1', { exact: true }).getAttribute('aria-invalid'), 'true');
  const [recovery] = await Promise.all([page.waitForEvent('download'), command('export-recovery')]);
  const bytes = await readFile(await recovery.path());
  const snapshot = JSON.parse(bytes);
  assert.equal(snapshot.editorTab, 'production');
  assert.equal(snapshot.productionView, 'tasks');
  assert.deepEqual(snapshot.pendingFields, [{ key: '[["production-list","","tasks"],"task ID story-1",0]', baseline: 'story-1', value: '' }]);

  const recipient = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  recipient.on('pageerror', error => errors.push(error.message));
  recipient.on('dialog', dialog => dialog.accept());
  await recipient.goto(`http://127.0.0.1:${server.address().port}/editor/`);
  await recipient.waitForSelector('body[data-editor-ready=true]');
  const recipientPanel = recipient.locator('#production-list');
  await recipient.locator('[data-tab=production]').click();
  await recipientPanel.locator('[data-production-view=tasks]').click();
  const kindFilter = recipientPanel.getByLabel('任务种类', { exact: true });
  await kindFilter.selectOption('art');
  assert.equal(await kindFilter.inputValue(), 'art');
  const [chooser] = await Promise.all([
    recipient.waitForEvent('filechooser'), recipient.locator('[data-command=import-recovery]').click(),
  ]);
  await chooser.setFiles({ name: recovery.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  await recipient.waitForFunction(() => document.querySelector('#status').textContent.includes('恢复文件已打开'));
  assert.equal(await recipientPanel.locator('[data-production-view=tasks]').getAttribute('aria-pressed'), 'true');
  assert.equal(await kindFilter.inputValue(), '');
  assert.doesNotMatch(await recipient.locator('#status').textContent(), /无法定位/);
  const restoredTaskId = recipientPanel.getByLabel('task ID story-1', { exact: true });
  assert.equal(await restoredTaskId.inputValue(), '');
  await restoredTaskId.fill('story-resumed');
  await restoredTaskId.blur();
  const [saved] = await Promise.all([
    recipient.waitForEvent('download'), recipient.locator('[data-command=save]').click(),
  ]);
  assert.equal(JSON.parse(await readFile(await saved.path(), 'utf8')).project.production.tasks[0].id, 'story-resumed');
  await recipient.close();
  checks.push('Portable recovery resets the recipient task filter and preserves the pending field through correction and save');

  const studioURL = page.url();
  const openStudio = async workspace => {
    workspace.on('pageerror', error => errors.push(error.message));
    workspace.on('dialog', dialog => dialog.accept());
    await workspace.goto(studioURL);
    await workspace.waitForSelector('body[data-editor-ready=true]');
  };
  const autosaveTitle = async (workspace, title) => {
    const input = workspace.getByLabel('作品名称', { exact: true });
    await input.fill(title);
    await input.blur();
    await workspace.waitForFunction(expected => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v2:' + document.body.dataset.draftId))?.document.project.title === expected, title);
  };
  await field('task ID story-1', 'story-1');
  await autosaveTitle(page, 'Imported workspace B');
  const [portable] = await Promise.all([page.waitForEvent('download'), command('export-recovery')]);
  const portableFile = { name: portable.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(await portable.path()) };
  const retainedPage = await browser.newPage();
  await openStudio(retainedPage);
  await autosaveTitle(retainedPage, 'Retained local draft A');
  const retainedId = await draftId(retainedPage);
  const [picker] = await Promise.all([
    retainedPage.waitForEvent('filechooser'), retainedPage.locator('[data-command=import-recovery]').click(),
  ]);
  await picker.setFiles(portableFile);
  await retainedPage.waitForFunction(() => document.querySelector('#status').textContent.startsWith('恢复文件已打开'));
  assert.equal(await retainedPage.locator('#project-name').innerText(), 'Imported workspace B');
  const retainedBytes = await localSlot(retainedPage, retainedId);
  assert.equal(JSON.parse(retainedBytes).document.project.title, 'Retained local draft A');
  const restoreLocal = retainedPage.locator('[data-command=restore-draft]');
  assert.equal(await restoreLocal.isVisible(), true);

  await retainedPage.clock.install();
  const taskKind = retainedPage.getByLabel('任务种类', { exact: true });
  await taskKind.selectOption('art');
  assert.equal(await taskKind.inputValue(), 'art');
  await retainedPage.locator('[data-production-view=assets]').click();
  const assetSearch = retainedPage.getByLabel('素材搜索', { exact: true });
  await assetSearch.fill('filter only');
  await assetSearch.blur();
  assert.equal(await assetSearch.inputValue(), 'filter only');
  await retainedPage.clock.runFor(400);
  assert.equal(await localSlot(retainedPage, retainedId), retainedBytes);
  assert.equal(await localSlot(retainedPage), null);
  await draftChoice(retainedPage).selectOption(retainedId);
  await restoreLocal.click();
  await waitRestored(retainedPage);
  assert.equal(await retainedPage.locator('#project-name').innerText(), 'Retained local draft A');
  assert.equal(await localSlot(retainedPage, retainedId), retainedBytes);
  await retainedPage.close({ runBeforeUnload: false });
  checks.push('Production filters preserve the retained local draft and it can be recovered without reloading');

  const history = await browser.newContext({ acceptDownloads: true });
  const firstTab = await history.newPage(), secondTab = await history.newPage();
  await openStudio(firstTab);
  await openStudio(secondTab);
  const line = workspace => workspace.getByLabel('台词 1 正文', { exact: true });
  const autosaveLine = async (workspace, text) => {
    await line(workspace).click();
    await line(workspace).fill(text);
    await line(workspace).blur();
    await workspace.waitForFunction(expected => {
      const raw = localStorage.getItem('vn-engine-studio:draft:v2:' + document.body.dataset.draftId);
      return JSON.parse(raw)?.document.project.program.blocks[0].lines[0].text === expected;
    }, text);
  };
  const sharedTitle = 'Same project title in both tabs';
  await autosaveTitle(firstTab, sharedTitle);
  await autosaveTitle(secondTab, sharedTitle);
  await autosaveLine(firstTab, 'First workspace dialogue');
  await autosaveLine(secondTab, 'Second workspace dialogue');
  const firstId = await draftId(firstTab), secondId = await draftId(secondTab);
  assert.notEqual(firstId, secondId);
  const secondRaw = await localSlot(secondTab);
  const beforeUnload = firstTab.waitForEvent('close');
  await firstTab.close({ runBeforeUnload: true });
  await beforeUnload;
  assert.equal(await localSlot(secondTab), secondRaw);
  const firstRaw = await localSlot(secondTab, firstId);
  const firstProject = JSON.parse(firstRaw).document.project;
  const secondProject = JSON.parse(secondRaw).document.project;
  assert.deepEqual([firstProject.title, firstProject.game, firstProject.version], [secondProject.title, secondProject.game, secondProject.version]);
  assert.equal(firstProject.program.blocks[0].lines[0].text, 'First workspace dialogue');

  const fork = await history.newPage(), peerFork = await history.newPage();
  await openStudio(fork);
  await openStudio(peerFork);
  await draftChoice(fork).selectOption(firstId);
  const [archived] = await Promise.all([fork.waitForEvent('download'), draftCommand(fork, 'export-draft')]);
  assert.match(archived.suggestedFilename(), /\.vnrecover$/);
  const archivedCopy = JSON.parse(await readFile(await archived.path(), 'utf8'));
  assert.deepEqual(archivedCopy.document.project, firstProject);
  assert.equal(archivedCopy.baseURL, undefined);
  await draftCommand(fork, 'restore-draft');
  await waitRestored(fork);
  await draftChoice(peerFork).selectOption(firstId);
  await draftCommand(peerFork, 'restore-draft');
  await waitRestored(peerFork);
  for (const workspace of [fork, peerFork]) {
    assert.equal(await line(workspace).inputValue(), 'First workspace dialogue');
    assert.equal(await localSlot(workspace), null);
  }
  assert.equal(await localSlot(fork, firstId), firstRaw);
  await autosaveLine(fork, 'Edited first fork');
  await autosaveLine(peerFork, 'Edited second fork');
  const forkId = await draftId(fork), peerForkId = await draftId(peerFork);
  const forkRaw = await localSlot(fork), peerForkRaw = await localSlot(peerFork);
  assert.equal(new Set([firstId, secondId, forkId, peerForkId]).size, 4);
  assert.equal(await localSlot(fork, firstId), firstRaw);
  assert.equal(await localSlot(fork, secondId), secondRaw);
  assert.equal(await localSlot(fork, peerForkId), peerForkRaw);

  const manager = await history.newPage();
  await openStudio(manager);
  await draftChoice(manager).selectOption(secondId);
  await draftChoice(fork).selectOption(secondId);
  manager.removeAllListeners('dialog');
  manager.once('dialog', dialog => dialog.dismiss());
  await draftCommand(manager, 'discard-draft');
  assert.equal(await localSlot(manager, secondId), secondRaw);
  let confirmedTarget;
  manager.once('dialog', dialog => { confirmedTarget = dialog.message(); return dialog.accept(); });
  await draftCommand(manager, 'discard-draft');
  await manager.waitForFunction(() => document.querySelector('#status').textContent.includes('已删除所选本地草稿'));
  assert.ok(confirmedTarget.includes(sharedTitle));
  assert.equal(await localSlot(manager, secondId), null);
  await draftChoice(fork).locator(`option[value="${secondId}"]`).waitFor({ state: 'detached' });
  assert.equal(await draftChoice(fork).inputValue(), '');
  for (const action of ['restore-draft', 'export-draft', 'discard-draft']) {
    assert.equal(await fork.locator(`[data-command=${action}]`).isDisabled(), true);
  }
  for (const [id, raw] of [[firstId, firstRaw], [forkId, forkRaw], [peerForkId, peerForkRaw]]) {
    assert.equal(await localSlot(manager, id), raw);
  }
  await draftChoice(fork).selectOption(firstId);
  assert.equal(await fork.locator('[data-command=discard-draft]').isEnabled(), true);
  await history.close();
  checks.push('Draft history isolates same-project tabs, forks restored drafts, exports the selection and deletes only after confirmation');

  const legacyPage = await browser.newPage({ acceptDownloads: true });
  await openStudio(legacyPage);
  const legacyFilter = { key: '[["production-list","","tasks"],"任务搜索",0]', baseline: '', value: 'old filter' };
  const legacySnapshot = { ...snapshot, pendingFields: [legacyFilter, ...snapshot.pendingFields] };
  const legacyBytes = JSON.stringify(legacySnapshot);
  await legacyPage.evaluate(value => localStorage.setItem('vn-engine-studio:draft:v1', value), legacyBytes);
  await legacyPage.reload();
  await legacyPage.waitForSelector('body[data-editor-ready=true]');
  await draftChoice(legacyPage).selectOption('legacy');
  await legacyPage.locator('[data-command=restore-draft]').click();
  await waitRestored(legacyPage);
  assert.equal(await legacyPage.getByLabel('任务搜索', { exact: true }).inputValue(), '');
  const legacyTaskId = legacyPage.getByLabel('task ID story-1', { exact: true });
  assert.equal(await legacyTaskId.inputValue(), '');
  assert.equal(await localSlot(legacyPage), null);
  await legacyTaskId.fill('story-from-legacy');
  await legacyTaskId.blur();
  const [legacySaved] = await Promise.all([
    legacyPage.waitForEvent('download'), legacyPage.locator('[data-command=save]').click(),
  ]);
  assert.equal(JSON.parse(await readFile(await legacySaved.path(), 'utf8')).project.production.tasks[0].id, 'story-from-legacy');
  assert.deepEqual(JSON.parse(await localSlot(legacyPage)).pendingFields, []);
  assert.equal(await legacyPage.evaluate(() => localStorage.getItem('vn-engine-studio:draft:v1')), legacyBytes);
  await legacyPage.close({ runBeforeUnload: false });
  checks.push('Legacy production filter drafts are dropped while real pending author fields remain editable and saveable');

  assert.deepEqual(errors, []);
  await writeFile(out + '/r5-feedback-browser.json', JSON.stringify({ status: 'PASS', checks, browser: await browser.version(), mode: 'headless', syntheticFeedback: true }, null, 2) + '\n');
  for (const check of checks) console.log('PASS', check);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
