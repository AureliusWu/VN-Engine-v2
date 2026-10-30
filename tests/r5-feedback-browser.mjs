import { listenBrowserServer } from '../tools/browser-server.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';

const out = (process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results') + '/r5-feedback'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await listenBrowserServer(server);
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
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1')));
  const reloadDraft = async () => { await page.reload(); await page.waitForSelector('body[data-editor-ready=true]'); await command('restore-draft'); await feedback(); };
  await page.evaluate(() => { for (const name of ['save:auto', 'meta', 'read']) localStorage.setItem('vn-engine:r5-feedback:' + name, 'sentinel'); });
  await feedback(); await field('反馈 ID', 'r5-note'); await field('反馈意见', 'R5 unrecorded issue draft');
  assert.equal(await page.locator('body').getAttribute('data-dirty'), 'true');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.productionDraft?.feedback?.comment === 'R5 unrecorded issue draft');
  await reloadDraft();
  assert.equal(await panel.getByLabel('反馈 ID', { exact: true }).inputValue(), 'r5-note');
  assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), 'R5 unrecorded issue draft');
  await panel.getByRole('button', { name: '记录问题', exact: true }).click(); await panel.locator('[data-feedback-id=r5-note]').waitFor();
  assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), '');
  checks.push('Blurred unrecorded feedback remains dirty, survives reload and records as an independent review');

  await field('修复或重开说明 r5-note', 'R5 unrecorded repair note'); await field('复验声明 r5-note', 'R5 unrecorded verification evidence');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.productionDraft?.notes?.some(note => note.note === 'R5 unrecorded repair note'));
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
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.productionDraft?.feedback?.comment === 'R5 local author draft must not reach a game');
  const old = await draft(); await command('new'); await feedback();
  assert.equal(await panel.locator('[data-feedback-id]').count(), 0); assert.equal(await panel.getByLabel('反馈意见', { exact: true }).inputValue(), '');
  await downloaded(() => command('save'));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vn-engine-studio:draft:v1'))?.productionDraft?.feedback?.comment === '');
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
  assert.deepEqual(errors, []);
  await writeFile(out + '/r5-feedback-browser.json', JSON.stringify({ status: 'PASS', checks, browser: await browser.version(), mode: 'headless', syntheticFeedback: true }, null, 2) + '\n');
  for (const check of checks) console.log('PASS', check);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
