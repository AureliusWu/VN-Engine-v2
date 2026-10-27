import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDemoServer } from '../tools/serve.mjs';
import { newProject } from '../dist/editor/index.js';
import { runRouteSuite } from '../dist/index.js';

const out = process.env.VN_ENGINE_TEST_OUTPUT ?? 'test-results'; await mkdir(out, { recursive: true });
const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const checks = [], errors = [], passed = label => { checks.push(label); console.log('PASS', label); }; let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`); await page.waitForSelector('body[data-editor-ready=true]');
  await page.evaluate(() => localStorage.setItem('vn-engine:authoring-player:v2:save:manual-1', 'PLAYER_BYTES'));
  const preview = page.frameLocator('#preview'), command = name => page.locator(`[data-command=${name}]`).click();
  const upload = async project => {
    await page.locator('#open-file').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(title => document.querySelector('#project-name').textContent === title, project.title);
  };
  const edit = async (label, value) => { await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).blur(); };
  const exportProject = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), command('export')]); return JSON.parse(await readFile(await download.path(), 'utf8'));
  };
  const refreshPreview = async () => {
    const revision = await page.getAttribute('body', 'data-preview-revision'); await command('preview');
    await page.waitForFunction(old => document.body.dataset.previewRevision !== old && document.querySelector('#preview-state').textContent.includes('当前工程'), revision);
  };
  const project = newProject('script'); project.title = '条件作者测试'; project.settings = { textDelayMs: 0 };
  project.program.variables.found = { initial: false };
  project.program.blocks[0].exit = { type: 'choice', choices: [
    { id: 'yes', text: '核对线索', next: 'gate', effects: [{ op: 'set', key: 'trust', value: 2 }, { op: 'set', key: 'found', value: true }] },
    { id: 'no', text: '暂不核对', next: 'gate' }
  ] };
  project.program.blocks[1].id = 'good'; project.program.blocks[1].lines[0].text = '条件满足，核对完成。'; project.program.blocks[1].exit.ending = 'good';
  project.program.blocks.push({ id: 'bad', lines: [{ id: 'bad-1', speaker: '作者', text: '条件不足，稍后再试。' }], exit: { type: 'end', ending: 'bad' } });
  project.program.blocks.push({ id: 'gate', lines: [], exit: { type: 'branch', routes: [{ next: 'bad' }] } });
  project.routeTests = { schema: 1, cases: ['yes', 'no'].map(id => ({ id, steps: [{ type: 'action', id }], expect: { ending: id === 'yes' ? 'good' : 'bad' } })) };
  await upload(project); await page.getByRole('button', { name: '编辑节点 gate', exact: true }).click();
  await page.getByRole('button', { name: '添加条件路由', exact: true }).click();
  await page.getByLabel('路由 1 目标', { exact: true }).selectOption('good');
  await page.getByLabel('路由 1 条件 1 运算', { exact: true }).selectOption('gte'); await edit('路由 1 条件 1 值', '1');
  await page.getByRole('button', { name: '路由 1 添加条件', exact: true }).click();
  await page.getByLabel('路由 1 条件 2 变量', { exact: true }).selectOption('found');
  assert.equal(await page.getByLabel('路由 1 条件 2 运算', { exact: true }).locator('option').count(), 1);
  await page.getByLabel('路由 1 条件 2 值', { exact: true }).selectOption('true');
  assert.equal(await page.getByRole('button', { name: '路由 1 下移', exact: true }).isDisabled(), true);
  const authored = await exportProject();
  assert.deepEqual(authored.program.blocks.find(block => block.id === 'gate').exit.routes, [{ next: 'good', when: { trust: { gte: 1 }, found: { eq: true } } }, { next: 'bad' }]);
  const report = runRouteSuite(authored); assert.equal(report.status, 'PASS'); assert.ok(report.restoreChecks >= 4);
  await refreshPreview(); await preview.locator('[data-action=yes]').click(); await preview.locator('.vn-text').filter({ hasText: '条件满足' }).waitFor();
  passed('Actual controls author numeric AND boolean routing, preserve final fallback and execute both route/save-restore cases');

  await page.getByRole('button', { name: '添加条件路由', exact: true }).click();
  await page.getByRole('button', { name: '路由 2 上移', exact: true }).click();
  assert.equal(await page.getByLabel('路由 1 目标', { exact: true }).inputValue(), 'bad');
  assert.equal(await page.locator('[data-author-route]').last().innerText().then(text => text.includes('最后兜底')), true);
  await command('undo'); await command('undo'); assert.equal(await page.locator('[data-author-route]').count(), 2);
  await edit('路由 1 条件 1 值', ' '); assert.match(await page.locator('#status').innerText(), /有限数值/);
  assert.deepEqual((await exportProject()).program.blocks.find(block => block.id === 'gate').exit.routes, authored.program.blocks.find(block => block.id === 'gate').exit.routes);
  passed('Route ordering is undoable, fallback stays last and invalid numeric input preserves authored bytes');
  await page.screenshot({ path: out + '/studio-conditions.png', fullPage: true });

  const investigation = newProject('investigation'); investigation.title = '证据作者测试'; investigation.settings = { textDelayMs: 0 };
  investigation.chapters[0].evidence.note.recordings = [{ clipId: 'recording', label: '原有声音记录' }];
  investigation.routeTests = { schema: 1, cases: [{ id: 'complete', steps: ['read', 'back', 'reason'].map(id => ({ type: 'action', id })), expect: { lineId: 'chapter-1/end', ending: 'chapter-1:complete', evidence: ['note'] } }] };
  await upload(investigation);
  const catalog = page.locator('#inspector > details').filter({ has: page.locator('summary').filter({ hasText: /^本章证据目录$/ }) });
  await catalog.evaluate(node => { node.open = true; });
  assert.equal(await page.getByRole('button', { name: '删除证据 note', exact: true }).isDisabled(), true);
  await edit('证据 note ID', 'clue'); assert.equal(await catalog.evaluate(node => node.open), true);
  assert.equal(await page.getByLabel('动作 1 收集证据', { exact: true }).inputValue(), 'clue');
  assert.equal(await page.getByLabel('动作 1 持有时隐藏', { exact: true }).inputValue(), 'clue');
  assert.equal(await page.getByLabel('动作 2 所需证据 clue', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('本章完成所需证据 clue', { exact: true }).isChecked(), true);
  const renamed = await exportProject(); assert.deepEqual(renamed.routeTests.cases[0].expect.evidence, ['clue']); assert.equal(runRouteSuite(renamed).status, 'PASS');
  assert.equal(renamed.chapters[0].evidence.clue.recordings[0].clipId, 'recording');
  await refreshPreview(); await preview.locator('[data-action=read]').click(); await preview.locator('[data-action=back]').click();
  assert.equal(await preview.locator('[data-action=read]').count(), 0); await preview.locator('[data-action=reason]').click();
  await preview.locator('.vn-text').filter({ hasText: '记录已核对' }).waitFor();
  passed('Evidence rename updates collections, hiding, completion constraints and route assertions; real investigation still completes');

  await page.getByRole('button', { name: '添加证据', exact: true }).click();
  await edit('证据 evidence-1 内容', '<img src=x onerror="window.injected=1">证据原文');
  assert.equal(await catalog.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.getByRole('button', { name: '删除证据 evidence-1', exact: true }).click(); await command('undo');
  assert.equal(await page.getByLabel('证据 evidence-1 内容', { exact: true }).inputValue(), '<img src=x onerror="window.injected=1">证据原文');
  await command('redo'); assert.equal(await page.locator('[data-evidence-entry=evidence-1]').count(), 0);
  await page.getByLabel('节点所需证据 clue', { exact: true }).check(); await page.getByLabel('节点排除证据 clue', { exact: true }).check();
  assert.equal(await page.locator('[data-command=export]').isDisabled(), true); assert.match(await page.locator('#diagnostics').innerText(), /同时要求和排除/);
  await command('undo'); await command('undo'); assert.equal(await page.locator('[data-command=export]').isEnabled(), true);
  await page.getByLabel('动作 1 清空证据', { exact: true }).selectOption('true');
  assert.equal(await page.locator('[data-command=export]').isDisabled(), true); assert.match(await page.locator('#diagnostics').innerText(), /不能同时清空和收集/); await command('undo');
  await page.getByRole('button', { name: '添加调查动作', exact: true }).click();
  await page.getByLabel('动作 3 清空证据', { exact: true }).selectOption('true');
  const resetProject = await exportProject(), resetAction = resetProject.chapters[0].nodes.room.actions[2];
  assert.equal(resetAction.resetEvidence, true);
  resetProject.routeTests.cases.push({ id: 'reset', steps: ['read', 'back', resetAction.id, 'read', 'back', 'reason'].map(id => ({ type: 'action', id })), expect: { ending: 'chapter-1:complete', evidence: ['clue'] } });
  assert.equal(runRouteSuite(resetProject).status, 'PASS'); await command('undo'); await command('undo');
  assert.equal(await page.evaluate(() => localStorage.getItem('vn-engine:authoring-player:v2:save:manual-1')), 'PLAYER_BYTES');
  passed('Evidence checklist conflicts block export; additions, deletion and reset undo cleanly without touching player saves');
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: out + '/studio-evidence.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: out + '/studio-evidence-mobile.png', fullPage: true });
  passed('Evidence authoring fits a 390px viewport and retains inert authored text');
  assert.deepEqual(errors, []);
  await writeFile(out + '/authoring-browser-check.json', JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), browser: await browser.version(), result: 'passed', checks }, null, 2) + '\n');
  await context.close();
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
