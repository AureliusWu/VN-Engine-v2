import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditorModel, newProject, readDocument, diagnoseProject } from '../dist/editor/index.js';
import { createProject, AssetCatalog, validateProjectCompliance } from '../dist/index.js';
import { packageStudio } from '../tools/package-studio.mjs';
import { packageGame } from '../tools/package-game.mjs';

test('all four editor templates validate against their real engine and have playable exits', () => {
  for (const kind of ['vn', 'chat', 'script', 'investigation']) {
    const project = newProject(kind); assert.deepEqual(diagnoseProject(project), []);
    const { session } = createProject(project, 'https://test.invalid/', { settings: { textDelayMs: 0 } });
    try { assert.ok(session.getView().frame.text); assert.ok(session.getView().frame.actions.length); }
    finally { session.dispose(); }
  }
});
test('editor views and constructor inputs cannot mutate owned documents; save points survive undo/redo', () => {
  const input = newProject('script'), model = new EditorModel(input); input.title = 'external';
  assert.equal(model.getView().project.title, '未命名作品'); assert.strictEqual(model.getView(), model.getView());
  assert.throws(() => { model.getView().project.title = 'bad'; }, TypeError);
  model.set(['title'], '第一版'); assert.equal(model.dirty, true); model.markSaved();
  model.set(['title'], '第二版'); model.undo(); assert.equal(model.dirty, false); model.redo(); assert.equal(model.dirty, true);
  model.undo(); model.set(['version'], '2'); assert.equal(model.canRedo, false);
});
test('failed transactions and malformed source imports leave the complete previous document intact', () => {
  const model = new EditorModel(newProject('vn')); const before = model.serialize();
  assert.throws(() => model.transact(p => { p.title = 'changed'; throw Error('abort'); }));
  assert.throws(() => model.replaceProject('{broken')); assert.throws(() => model.set(['title'], undefined));
  assert.equal(model.serialize(), before); assert.equal(model.canUndo, false);
});
test('node rename preserves all inbound branches, the entry, stage plans and visual layout', () => {
  const model = new EditorModel(newProject('vn')); const start = model.graph().nodes[0];
  model.set(['stage', 'scenes', 'start'], { pauseMs: 10 }); model.move(start.key, { x: 20, y: 30 });
  const nextKey = model.rename(start.key, 'opening'); const p = model.getView().project;
  assert.equal(p.entry, 'opening'); assert.equal(p.stage.scenes.opening.pauseMs, 10); assert.equal(p.stage.scenes.start, undefined);
  assert.deepEqual(model.getView().positions[nextKey], { x: 20, y: 30 });
  const end = model.graph().nodes.find(n => n.id === 'end'); model.rename(end.key, 'final');
  assert.equal(model.getView().project.scenes[0].choices[0].next, 'final'); assert.deepEqual(model.diagnostics(), []);
});
test('script and inventory-aware investigation renames preserve their actual graph semantics', () => {
  for (const kind of ['script', 'investigation']) {
    const model = new EditorModel(newProject(kind)), node = model.graph().nodes[1], incoming = model.graph().edges.filter(e => e.to === node.key).length;
    const key = model.rename(node.key, 'renamed'); assert.equal(model.graph().edges.filter(e => e.to === key).length, incoming);
    assert.deepEqual(model.diagnostics(), []);
  }
});
test('deleting a node retains authored choices and reports their broken targets until undo', () => {
  const model = new EditorModel(newProject('script')); model.removeNode(model.graph().nodes[1].key);
  assert.equal(model.getView().project.program.blocks[0].exit.choices.length, 1);
  assert.ok(model.diagnostics().some(d => d.code === 'target')); model.undo(); assert.deepEqual(model.diagnostics(), []);
});
test('node additions use independent IDs and investigation loops remain legal', () => {
  const model = new EditorModel(newProject('investigation'));
  assert.deepEqual(model.diagnostics(), []); const key = model.addNode(); const second = model.addNode(); assert.notEqual(key, second);
  assert.ok(model.diagnostics().some(d => d.code === 'unreachable')); model.undo(); model.undo(); assert.deepEqual(model.diagnostics(), []);
});
test('asset diagnostics distinguish missing IDs, roles, files and font licences', () => {
  const project = newProject('script'); project.assets = [{ id: 'music', kind: 'audio', src: 'assets/music.wav' }, { id: 'font', kind: 'font', src: 'assets/font.woff2' }];
  project.defaults = { background: 'music' }; project.font = 'font';
  const codes = new Set(diagnoseProject(project, new Set()).map(d => d.code));
  for (const code of ['asset-binding', 'font-license', 'asset-file']) assert.ok(codes.has(code));
});
test('editor diagnoses invalid timelines in unvisited lines and keeps undoable repairs', () => {
  const project = newProject('script');
  project.program.blocks[1].lines[0].cue = { timeline: { durationMs: 100, animations: [{ id: 'enter', layer: 'character', to: { x: 10 }, durationMs: 200 }] } };
  const model = new EditorModel(project);
  assert.ok(model.diagnostics().some(item => item.code === 'timeline' && item.severity === 'error'));
  model.set(['program', 'blocks', 1, 'lines', 0, 'cue', 'timeline', 'animations', 0, 'durationMs'], 100);
  assert.equal(model.diagnostics().some(item => item.code === 'timeline'), false);
  model.undo(); assert.equal(model.diagnostics().some(item => item.code === 'timeline'), true);
  model.redo(); model.set(['program', 'blocks', 1, 'lines', 0, 'cue', 'timeline', 'animations', 0, 'target'], 'missing');
  assert.equal(model.diagnostics().some(item => item.code === 'timeline-target'), true);
});
test('editor import rejects dangerous keys and unsupported workspace schemas without executing source', () => {
  const model = new EditorModel(newProject('script')), json = model.serialize();
  assert.throws(() => readDocument(json.replace('"schema": 1', '"schema": 99')), /版本/);
  assert.throws(() => model.set(['__proto__', 'polluted'], true), /路径/); assert.equal({}.polluted, undefined);
  assert.throws(() => readDocument('{"__proto__":{"polluted":true}}'), /不安全/);
  assert.throws(() => readDocument(' '.repeat(8_000_001)), /8 MB/);
});

test('collection replay diagnostics validate the real driver save and allow undoable repair', () => {
  const project = newProject('script'); project.collections = { endings: [{ id: 'complete', replay: { invalid: true } }] };
  const ending = project.program.blocks.find(block => block.exit.type === 'end').exit.ending;
  project.collections.endings[0].id = ending;
  const model = new EditorModel(project); assert.ok(model.diagnostics().some(item => item.code === 'collection-replay'));
  assert.throws(() => validateProjectCompliance(project), /Invalid collection replay/);
  const { session } = createProject(project, 'https://example.invalid/');
  model.set(['collections', 'endings', 0, 'replay'], session.save()); session.dispose();
  assert.equal(model.diagnostics().some(item => item.code === 'collection-replay'), false);
  assert.doesNotThrow(() => validateProjectCompliance(JSON.parse(model.serialize(true))));
  model.undo(); assert.equal(model.diagnostics().some(item => item.code === 'collection-replay'), true);
});
test('history is bounded, command inputs cannot escape, and same-value changes keep redo', () => {
  const model = new EditorModel(newProject('script'), 2); let escaped;
  model.transact(p => { p.title = 'one'; escaped = p; }); escaped.title = 'outside'; assert.equal(model.getView().project.title, 'one');
  model.set(['title'], 'two'); model.set(['title'], 'three'); model.undo(); model.undo(); assert.equal(model.getView().project.title, 'one'); assert.equal(model.canUndo, false);
  model.set(['title'], 'one'); assert.equal(model.canRedo, true);
});
test('injected preview asset URLs support blob files but never script or data execution schemes', () => {
  const assets = [{ id: 'image', kind: 'background', src: 'assets/image.svg' }];
  const catalog = new AssetCatalog(assets, 'https://test.invalid/', () => 'blob:https://test.invalid/id'); assert.equal(catalog.url('image'), 'blob:https://test.invalid/id');
  for (const url of ['javascript:alert(1)', 'data:text/html,hi']) assert.throws(() => new AssetCatalog(assets, 'https://test.invalid/', () => url), /Unsupported/);
});
test('Studio builds are complete local bundles and exported editor projects build into real games', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-studio-')); const result = await packageStudio(join(root, 'studio'));
  const manifest = JSON.parse(await readFile(join(result.output, 'studio-manifest.json'), 'utf8'));
  for (const name of ['editor/index.html', 'editor/presentation.mjs', 'editor/preview.mjs', 'editor/studio-font.woff2', 'editor/OFL.txt', 'lib/editor/index.js', 'lib/script/engine.js', 'samples/campus.json']) assert.ok(manifest.files.some(f => f.name === name));
  await assert.rejects(packageStudio(result.output), /preserved/);
  const { writeFile } = await import('node:fs/promises');
  for (const kind of ['vn', 'chat', 'script', 'investigation']) { const model = new EditorModel(newProject(kind)); const source = join(root, kind + '.json'); await writeFile(source, model.serialize(true)); const build = await packageGame(source, join(root, kind)); assert.ok((await readdir(build.output)).includes('project.json')); }
});
