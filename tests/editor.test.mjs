import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditorModel, newProject, readDocument, diagnoseProject } from '../dist/editor/index.js';
import { createProject, AssetCatalog, creativeDiagnostics, validateProjectCompliance } from '../dist/index.js';
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
test('graph diagnostics keep chapter entries and same-named nodes separate through loops and parallel edges', () => {
  const project = newProject('investigation');
  const first = project.chapters[0], second = structuredClone(first);
  second.id = 'chapter-2';
  second.order = 1;
  second.nodes.room.actions = [{ id: 'leave', label: 'Leave directly', next: 'end' }];
  project.chapters.push(second);
  first.nodes.room.actions.push(
    { id: 'again', label: 'Parallel path to the note', next: 'note' },
    { id: 'missing', label: 'First missing target', next: 'missing' }
  );
  first.nodes.isolated = { ...structuredClone(first.nodes.end),
    actions: [{ id: 'missing', label: 'Second missing target', next: 'also-missing' }] };

  const model = new EditorModel(project);
  const structural = model.diagnostics().filter(item => ['duplicate', 'target', 'unreachable'].includes(item.code));
  assert.deepEqual(structural, [
    { severity: 'error', code: 'target', node: '["chapter-1","room"]', message: '连线目标不存在：First missing target' },
    { severity: 'error', code: 'target', node: '["chapter-1","isolated"]', message: '连线目标不存在：Second missing target' },
    { severity: 'warning', code: 'unreachable', node: '["chapter-1","isolated"]', message: '没有从入口连到此节点：isolated' },
    { severity: 'warning', code: 'unreachable', node: '["chapter-2","note"]', message: '没有从入口连到此节点：note' }
  ]);
});
test('dynamic adapter routing preserves explicit broken edges without adding unreachable warnings', () => {
  const project = newProject('vn');
  project.adapter = 'netlove';
  project.scenes[0].resolve = true;
  project.scenes[0].choices[0].next = 'missing';
  const structural = diagnoseProject(project).filter(item => ['target', 'dynamic-routing', 'unreachable'].includes(item.code));
  assert.deepEqual(structural.map(({ severity, code, node }) => [severity, code, node]), [
    ['error', 'target', '["start"]'], ['warning', 'dynamic-routing', undefined]
  ]);
});

function creativeIssuePaths(project) {
  return new EditorModel(project).diagnostics().filter(item => item.code.startsWith('CREATIVE_'))
    .map(({ code, path }) => [code, path]);
}

test('production targets keep chapter identity, node ambiguity and line existence separate', () => {
  const project = newProject('investigation');
  const first = project.chapters[0], second = structuredClone(first);
  first.id = 'a';
  first.nodes['b/c'] = structuredClone(first.nodes.note);
  second.id = 'a/b';
  second.order = 1;
  second.nodes.c = structuredClone(second.nodes.note);
  project.chapters.push(second, { ...first, order: 2, nodes: { room: first.nodes.room } });
  project.production = { schema: 1, beats: [{ id: 'opening', summary: 'Opening', targets: [
    { chapterId: 'a', nodeId: 'b/c', lineId: 'a/b/c' },
    { chapterId: 'a/b', nodeId: 'c', lineId: 'a/b/c' },
    { chapterId: 'a/b', nodeId: 'room', lineId: 'a/b/room' },
    { nodeId: 'c', lineId: 'a/b/c' },
    { chapterId: 'a', nodeId: 'room', lineId: 'a/room' },
    { chapterId: 'a', nodeId: 'room', lineId: 'a/b/room' },
    { chapterId: 'a', nodeId: 'c', lineId: 'a/b/c' }
  ] }] };
  assert.deepEqual(creativeIssuePaths(project), [
    [3, 'nodeId'], [3, 'lineId'], [4, 'nodeId'], [5, 'nodeId'],
    [5, 'lineId'], [6, 'nodeId'], [6, 'lineId']
  ].map(([index, field]) => ['CREATIVE_TARGET', ['production', 'beats', 0, 'targets', index, field]]));

  const narrative = newProject('vn');
  narrative.scenes[0].lines.push({ ...narrative.scenes[0].lines[0] });
  narrative.production = { schema: 1, beats: [{ id: 'opening', summary: 'Opening', targets: [{ nodeId: 'start', lineId: 'start-1' }] }] };
  assert.deepEqual(creativeIssuePaths(narrative), []);

  // The direct diagnostics API can receive an array with an empty slot.
  narrative.scenes.length++;
  assert.deepEqual(creativeDiagnostics(narrative), []);
});

test('production task cycles follow the first duplicate definition and keep issue order', () => {
  const project = newProject('script');
  const task = (id, fields = {}) => ({ id, kind: 'story', state: 'draft', brief: 'Check route', ...fields });
  project.production = { schema: 1, beats: [{ id: 'opening', summary: 'Opening',
    targets: [{ nodeId: 'missing', lineId: 'missing' }], characters: ['unknown'], tasks: ['unknown'] }],
    tasks: [task('toString', { dependsOn: ['leaf'] }), task('leaf'), task('toString', {
      dependsOn: ['toString', 'unknown'], assets: ['unknown'], characters: ['unknown']
    })] };
  const expected = [
    ['CREATIVE_DUPLICATE', ['production', 'tasks', 2, 'id']],
    ['CREATIVE_TARGET', ['production', 'beats', 0, 'targets', 0, 'nodeId']],
    ['CREATIVE_TARGET', ['production', 'beats', 0, 'targets', 0, 'lineId']],
    ['CREATIVE_REFERENCE', ['production', 'beats', 0, 'characters', 0]],
    ['CREATIVE_REFERENCE', ['production', 'beats', 0, 'tasks', 0]],
    ['CREATIVE_REFERENCE', ['production', 'tasks', 2, 'dependsOn', 1]],
    ['CREATIVE_REFERENCE', ['production', 'tasks', 2, 'assets', 0]],
    ['CREATIVE_REFERENCE', ['production', 'tasks', 2, 'characters', 0]]
  ];
  assert.deepEqual(creativeIssuePaths(project), expected);

  project.production.tasks[0].dependsOn = ['toString'];
  project.production.tasks[2].dependsOn = ['leaf', 'unknown'];
  assert.deepEqual(creativeIssuePaths(project), [...expected, ['CREATIVE_CYCLE', ['production', 'tasks']]]);
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

test('editor validates branch list shapes before opening or committing while broken targets remain editable', () => {
  const narrative = newProject('vn');
  narrative.scenes[0].choices = { id: 'mistyped-list' };
  assert.throws(() => readDocument(JSON.stringify(narrative)), /scenes\[0\]\.choices/);

  const script = newProject('script');
  const model = new EditorModel(script);
  model.set(['title'], 'Kept edit');
  const previous = model.serialize();
  script.program.blocks[0].exit = { type: 'branch', routes: [null] };
  assert.throws(() => model.replaceProject(JSON.stringify(script)), /program\.blocks\[0\]\.exit\.routes/);
  assert.equal(model.serialize(), previous);
  assert.equal(model.canUndo, true);

  const investigation = newProject('investigation');
  investigation.chapters[0].nodes.room.actions = {};
  assert.throws(() => readDocument(investigation), /chapters\[0\]\.nodes\["room"\]\.actions/);

  script.program.blocks[0].exit = { type: 'jump', next: 'missing' };
  assert.equal(model.replaceProject(script), true);
  assert.ok(model.diagnostics().some(issue => issue.code === 'target'));
  assert.equal(model.undo(), true);
  assert.equal(model.serialize(), previous);
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

function captureCollectionReplay(project, drive) {
  const { session } = createProject(project, 'https://test.invalid/', { settings: { textDelayMs: 0 } });
  try { drive(session); return session.save(); }
  finally { session.dispose(); }
}

test('collection replay diagnoses interleaved mini-game and route failures even with bad metadata', () => {
  const project = newProject('script');
  project.program.blocks[0].cue = { miniGame: { id: 'switches', kind: 'switches', initial: [false, false], target: [true, true], maxMoves: 3,
    results: { success: 'yes', failure: 'yes', abort: 'yes' } } };
  const valid = captureCollectionReplay(project, session => {
    assert.equal(session.startMiniGame(), true);
    assert.equal(session.playMiniGame(0), true);
  });
  const forgedMiniGame = structuredClone(valid);
  Object.assign(forgedMiniGame.vnMiniGame.state, { phase: 'complete', result: 'success' });
  const unreachable = { ...valid, state: { ...valid.state, blockId: 'missing' } };
  project.assets = ['forged', 'valid'].map(id => ({ id, kind: 'cg', src: `assets/${id}.svg` }));
  const ending = project.program.blocks[1].exit.ending;
  project.collections = { cgs: [{ id: 'forged', replay: forgedMiniGame }, { id: 'valid', replay: valid }],
    endings: [{ id: ending, replay: unreachable }] };
  const expected = ['forged', ending].map(id => ({ severity: 'error', code: 'collection-replay', message: `回看起点不属于当前作品或版本：${id}` }));
  const before = structuredClone(project);
  assert.deepEqual(new EditorModel(project).diagnostics(), expected);
  assert.deepEqual(project, before);

  project.collections.cgs[1].id = 'missing-cg';
  assert.deepEqual(diagnoseProject(project), [
    { severity: 'error', code: 'runtime', message: '运行校验：Unknown or mismatched asset: missing-cg' }, ...expected
  ]);
});

test('collection replay validates real Investigation and Rain route histories', () => {
  const rain = { schema: 1, type: 'rain', game: 'replay-rain-fixture', version: '1', title: 'Rain replay fixture', assets: [],
    story: { schema_version: 1, entry: 'start', initial_state: {}, state_definitions: {}, nodes: [
      { id: 'start', lines: [{ id: 'intro', speaker: 'n', text: 'Start' }], choices: [{ id: 'go', text: 'Go', next: 'finish', effects: {} }] },
      { id: 'finish', lines: [{ id: 'done', speaker: 'n', text: 'Finish' }], ending: 'done' }
    ] } };
  for (const [project, ending, actions] of [[newProject('investigation'), 'chapter-1:complete', ['read', 'back', 'reason']], [rain, 'done', ['go']]]) {
    const valid = captureCollectionReplay(project, session => {
      for (const action of actions) assert.equal(session.act(action), true, `${project.type}: ${action}`);
    });
    const invalid = structuredClone(valid);
    if (project.type === 'investigation') invalid.journal[0].id = 'unknown-action';
    else invalid.state.decisions[0].choiceId = 'unknown-choice';
    project.assets = [{ id: 'invalid', kind: 'cg', src: 'assets/invalid.svg' }];
    project.collections = { cgs: [{ id: 'invalid', replay: invalid }], endings: [{ id: ending, replay: valid }] };
    assert.deepEqual(new EditorModel(project).diagnostics(), [
      { severity: 'error', code: 'collection-replay', message: '回看起点不属于当前作品或版本：invalid' }
    ], project.type);
  }
});

test('direct diagnosis evaluates custom narrative presentation in a fresh session for every replay', () => {
  const project = newProject('vn');
  project.scenes[1].lines.push({ id: 'end-2', speaker: '作者', text: '第二段结局。' });
  const first = captureCollectionReplay(project, session => assert.equal(session.act('continue'), true));
  const second = captureCollectionReplay(project, session => {
    assert.equal(session.act('continue'), true);
    assert.equal(session.next(), true);
  });
  project.assets = [{ id: 'first', kind: 'cg', src: 'assets/first.svg' }];
  project.collections = { cgs: [{ id: 'first', replay: first }], endings: [{ id: project.scenes[1].ending, replay: second }] };
  const visits = [];
  project.stage = { presentation(scene, line) {
    visits.push(`${scene.id}/${line}`);
    if (scene.id === 'end' && line === 0) throw Error('First ending frame has invalid presentation');
    return { expression: 'default' };
  } };
  assert.deepEqual(diagnoseProject(project), [
    { severity: 'error', code: 'collection-replay', message: '回看起点不属于当前作品或版本：first' }
  ]);
  assert.deepEqual(visits, ['start/0', 'start/0', 'end/0', 'start/0', 'end/1']);

  const callback = project.stage.presentation;
  visits.length = 0;
  project.stage.presentation = (scene, line) => {
    if (visits.length === 1) delete project.stage.presentation;
    return callback(scene, line);
  };
  assert.deepEqual(diagnoseProject(project), [
    { severity: 'error', code: 'collection-replay', message: '回看起点不属于当前作品或版本：first' }
  ]);
  assert.deepEqual(visits, ['start/0', 'start/0', 'end/0']);
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

test('shared author validation rejects orphan presentation keys and exposes their field paths',()=>{
 const model=new EditorModel(newProject('vn'));model.set(['stage','lines','orphan'],{pauseMs:10});const diagnostic=model.diagnostics().find(d=>d.code==='presentation-target-missing');assert.deepEqual(diagnostic.path,['stage','lines','orphan']);
});
