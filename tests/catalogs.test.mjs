import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel, newProject, variableReferences, chapterReferences, validateVariable, validateEffects } from '../dist/editor/index.js';
import { createProject, runRouteSuite, ScriptEngine } from '../dist/index.js';

function scripted() {
  const p = newProject('script'); p.settings = { textDelayMs: 0 }; p.program.variables.found = { initial: false };
  p.program.blocks[0].exit.choices[0].next = 'gate';
  p.program.blocks.push({ id: 'gate', lines: [], exit: { type: 'branch', routes: [{ when: { trust: { gte: 1, eq: 1 }, found: false }, next: 'end' }, { next: 'other' }] } });
  p.program.blocks.push({ id: 'other', lines: [{ id: 'other-1', speaker: '作者', text: '另一条路线。' }], exit: { type: 'end', ending: 'other' } });
  p.routeTests = { schema: 1, cases: [{ id: 'yes', steps: [{ type: 'action', id: 'yes' }], expect: { ending: '完成', variables: { trust: 1, found: false } } }] };
  return p;
}
function chapters() {
  const p = newProject('investigation'), second = structuredClone(p.chapters[0]); second.id = 'chapter-2'; second.order = 1; p.chapters.push(second);
  const steps = ['read', 'back', 'reason'].map(id => ({ type: 'action', id }));
  p.routeTests = { schema: 1, cases: [
    { id: 'one', steps, expect: { ending: 'chapter-1:complete', lineId: 'chapter-1/end', evidence: ['note'] } },
    { id: 'two', steps: [...steps, { type: 'action', id: '@chapter:chapter-2' }, ...steps], expect: { ending: 'chapter-2:complete', lineId: 'chapter-2/end', evidence: ['note'] } }
  ] }; return p;
}

test('variable rename preserves combined conditions, effects, route assertions, old-format saves and undo', () => {
  const p = scripted(), instance = createProject(p, 'https://test.invalid/'); instance.session.act('yes'); const save = instance.session.save(); instance.session.dispose();
  p.collections = { endings: [{ id: '完成', replay: save }] }; p.program.variables.trust.description = '保留自定义元数据';
  const model = new EditorModel(p), original = model.serialize(); assert.equal(variableReferences(p, 'trust').length, 3);
  model.renameVariable('trust', 'affinity'); const next = model.getView().project;
  assert.deepEqual(next.program.blocks.find(b => b.id === 'gate').exit.routes[0].when.affinity, { gte: 1, eq: 1 });
  assert.equal(next.program.blocks[0].exit.choices[0].effects[0].key, 'affinity');
  assert.equal(next.routeTests.cases[0].expect.variables.affinity, 1); assert.equal(next.program.variables.affinity.description, '保留自定义元数据');
  assert.deepEqual(new ScriptEngine(next.program).decode(JSON.stringify(save)).variables, { affinity: 1, found: false });
  assert.deepEqual(model.diagnostics(), []); assert.equal(runRouteSuite(next).cases[0].status, 'PASS');
  assert.equal(next.program.blocks[0].lines[0].text, p.program.blocks[0].lines[0].text);
  model.undo(); assert.equal(model.serialize(), original); model.redo(); assert.ok(model.getView().project.program.variables.affinity);
});

test('variable type changes, deletes, bounds and duplicate targets fail atomically when unsafe', () => {
  const model = new EditorModel(scripted()), before = model.serialize();
  assert.throws(() => model.removeVariable('trust'), /引用/); assert.throws(() => model.updateVariable('trust', { initial: false }), /类型/);
  assert.throws(() => model.renameVariable('trust', 'found'), /已使用/); assert.throws(() => model.renameVariable('trust', '__proto__'));
  assert.throws(() => model.updateVariable('trust', { initial: 3, min: 5, max: 2 }), /边界/);
  assert.equal(model.serialize(), before); assert.equal(model.canUndo, false);
  const id = model.addVariable('boolean'); model.updateVariable(id, { initial: true }); model.removeVariable(id); model.undo();
  assert.equal(model.getView().project.program.variables[id].initial, true);
  model.renameVariable('trust', 'trust'); assert.equal(model.getView().project.program.variables.trust.initial, 0);
});

test('typed effect commands preserve ordered set/add semantics and reject coercion or invalid assignments', () => {
  const model = new EditorModel(newProject('script')); model.addVariable('boolean');
  const effects = [{ op: 'set', key: 'trust', value: 2 }, { op: 'add', key: 'trust', value: 3 }, { op: 'set', key: 'variable-1', value: true }];
  model.setChoiceEffects('start', 'yes', effects); effects[0].value = 9;
  const p = model.getView().project, engine = new ScriptEngine(p.program), state = engine.choose(engine.initial(), 'yes');
  assert.deepEqual(state.variables, { trust: 5, 'variable-1': true }); const before = model.serialize();
  for (const bad of [[{ op: 'add', key: 'variable-1', value: 1 }], [{ op: 'set', key: 'trust', value: 99 }], [{ op: 'set', key: 'trust', value: '1' }], [{ op: 'set', key: 'absent', value: 1 }]]) assert.throws(() => model.setChoiceEffects('start', 'yes', bad));
  assert.equal(model.serialize(), before); model.undo(); assert.equal(model.getView().project.program.blocks[0].exit.choices[0].effects[0].value, 1);
});

test('variable definitions reject non-finite or boolean bounds and validate both supported effect operations', () => {
  for (const d of [{ initial: NaN }, { initial: Infinity }, { initial: false, min: 0 }, { initial: 1, max: 0 }, { initial: '1' }]) assert.throws(() => validateVariable(d));
  validateVariable({ initial: 0, min: 0, max: 1 }); validateVariable({ initial: false });
  assert.throws(() => validateEffects({ n: { initial: 0 } }, [{ op: 'eval', key: 'n', value: 1 }]));
});

test('chapter rename atomically preserves stage/layout, route steps, ending metadata and real cross-chapter routes', () => {
  const p = chapters(); p.stage = { nodes: { 'chapter-2/note': { pauseMs: 12 } } };
  p.collections = { endings: [{ id: 'chapter-2:complete', trueEnding: true }], trueRoute: { endings: ['chapter-2:complete'] } };
  const model = new EditorModel(p); model.move('["chapter-2","note"]', { x: 50, y: 70 }); const before = model.serialize();
  assert.ok(chapterReferences(p, 'chapter-2').length >= 5); assert.equal(runRouteSuite(p).status, 'PASS');
  model.renameChapter('chapter-2', 'final'); const next = model.getView().project;
  assert.equal(next.routeTests.cases[1].steps[3].id, '@chapter:final'); assert.equal(next.routeTests.cases[1].expect.lineId, 'final/end');
  assert.equal(next.collections.endings[0].id, 'final:complete'); assert.equal(next.collections.trueRoute.endings[0], 'final:complete');
  assert.equal(next.stage.nodes['final/note'].pauseMs, 12); assert.equal(next.stage.nodes['chapter-2/note'], undefined);
  assert.deepEqual(model.getView().positions['["final","note"]'], { x: 50, y: 70 }); assert.equal(runRouteSuite(next).status, 'PASS');
  assert.deepEqual(model.diagnostics(), []); model.undo(); assert.equal(model.serialize(), before); model.redo(); assert.equal(runRouteSuite(model.getView().project).status, 'PASS');
});

test('chapter add/remove and ordered moves keep contiguous runtime order and restore owned layout/stage on undo', () => {
  const model = new EditorModel(newProject('investigation')), id = model.addChapter();
  model.set(['stage', 'nodes', id + '/start'], { pauseMs: 5 }); model.move(JSON.stringify([id, 'start']), { x: 25, y: 25 });
  const before = model.serialize(); model.moveChapter(id, -1);
  assert.deepEqual(model.getView().project.chapters.map(c => c.order), [0, 1]);
  const instance = createProject(model.getView().project, 'https://test.invalid/'); assert.equal(instance.session.getView().frame.lineId, id + '/start'); instance.session.dispose();
  model.undo(); assert.equal(model.serialize(), before); model.removeChapter(id); assert.equal(model.getView().positions[JSON.stringify([id, 'start'])], undefined);
  assert.equal(model.getView().project.stage.nodes[id + '/start'], undefined); model.undo(); assert.equal(model.serialize(), before);
  assert.deepEqual(model.diagnostics(), []);
});

test('chapter identity/order/deletion protect replay snapshots and direct external references without partial writes', () => {
  const p = chapters(), instance = createProject(p, 'https://test.invalid/'); const replay = instance.session.save(); instance.session.dispose();
  p.collections = { endings: [{ id: 'chapter-1:complete', replay }] }; const model = new EditorModel(p), before = model.serialize();
  for (const command of [() => model.renameChapter('chapter-2', 'new'), () => model.moveChapter('chapter-2', -1), () => model.removeChapter('chapter-2')]) assert.throws(command, /回看/);
  assert.equal(model.serialize(), before); assert.equal(model.canUndo, false);
  const referenced = new EditorModel(chapters()); assert.throws(() => referenced.removeChapter('chapter-2'), /引用/);
  assert.throws(() => new EditorModel(newProject('investigation')).removeChapter('chapter-1'), /至少一个/);
  for (const id of ['bad/id', 'bad:id', '__proto__']) assert.throws(() => referenced.renameChapter('chapter-2', id));
});

test('chapter rename rejects stale key collisions and actual reordering requires fresh route validation', () => {
  const p = chapters(); p.stage = { nodes: { 'final/room': { pauseMs: 5 } } }; const model = new EditorModel(p), before = model.serialize();
  assert.throws(() => model.renameChapter('chapter-2', 'final'), /冲突/); assert.equal(model.serialize(), before); assert.equal(model.canUndo, false);
  const ordered = new EditorModel(chapters()); ordered.moveChapter('chapter-2', -1); assert.notEqual(runRouteSuite(ordered.getView().project).status, 'PASS');
  ordered.undo(); assert.equal(runRouteSuite(ordered.getView().project).status, 'PASS');
});
