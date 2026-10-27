import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel, newProject, evidenceReferences, conditionFromTerms } from '../dist/editor/index.js';
import { createProject, runRouteSuite } from '../dist/index.js';

const route = (lineId = 'chapter-1/end') => ({ id: 'complete', steps: ['read', 'back', 'reason'].map(id => ({ type: 'action', id })), expect: { lineId, ending: 'chapter-1:complete', evidence: ['note'] } });

test('evidence rename atomically preserves exact references, metadata, actual routes and undo', () => {
  const project = newProject('investigation');
  project.chapters[0].evidence.note.recordings = [{ clipId: 'recording', label: '声音记录' }];
  project.routeTests = { schema: 1, cases: [route()] };
  const model = new EditorModel(project), original = model.serialize();
  const before = runRouteSuite(project); assert.equal(before.status, 'PASS');
  assert.ok(evidenceReferences(project, 'chapter-1', 'note').length >= 6);
  model.renameEvidence('chapter-1', 'note', 'clue');
  const next = model.getView().project;
  assert.equal(next.chapters[0].evidence.note, undefined);
  assert.equal(next.chapters[0].evidence.clue.recordings[0].clipId, 'recording');
  assert.equal(evidenceReferences(next, 'chapter-1', 'note').length, 0);
  assert.equal(next.chapters[0].nodes.note.text, project.chapters[0].nodes.note.text);
  assert.deepEqual(next.routeTests.cases[0].expect.evidence, ['clue']);
  assert.equal(runRouteSuite(next).status, 'PASS'); assert.deepEqual(model.diagnostics(), []);
  model.undo(); assert.equal(model.serialize(), original); model.redo(); assert.equal(runRouteSuite(model.getView().project).status, 'PASS');
});

test('evidence identifiers remain chapter scoped and ambiguous route assertions block mutation', () => {
  const project = newProject('investigation'), second = structuredClone(project.chapters[0]); second.id = 'chapter-2'; second.order = 1; project.chapters.push(second);
  project.routeTests = { schema: 1, cases: [route(), { ...route('chapter-2/end'), id: 'second' }] };
  const model = new EditorModel(project); model.renameEvidence('chapter-1', 'note', 'clue');
  assert.ok(model.getView().project.chapters[1].evidence.note);
  assert.deepEqual(model.getView().project.routeTests.cases.map(c => c.expect.evidence), [['clue'], ['note']]);
  const ambiguous = structuredClone(project); delete ambiguous.routeTests.cases[0].expect.lineId;
  const blocked = new EditorModel(ambiguous), original = blocked.serialize();
  assert.throws(() => blocked.renameEvidence('chapter-1', 'note', 'clue'), /无法确定章节/);
  assert.equal(blocked.serialize(), original); assert.equal(blocked.canUndo, false);
});

test('evidence deletion refuses referenced entries and rejected commands preserve history and bytes', () => {
  const model = new EditorModel(newProject('investigation')), before = model.serialize();
  assert.throws(() => model.removeEvidence('chapter-1', 'note'), /引用/);
  for (const id of ['__proto__', 'constructor', '', ' note']) assert.throws(() => model.renameEvidence('chapter-1', 'note', id));
  assert.equal(model.renameEvidence('chapter-1', 'note', 'note'), false);
  assert.equal(model.serialize(), before); assert.equal(model.canUndo, false);
  const id = model.addEvidence('chapter-1'); assert.notEqual(model.addEvidence('chapter-1'), id);
  assert.throws(() => model.renameEvidence('chapter-1', 'note', id), /已使用/);
  model.removeEvidence('chapter-1', id); assert.equal(model.getView().project.chapters[0].evidence[id], undefined);
  model.undo(); assert.ok(model.getView().project.chapters[0].evidence[id]);
});

test('evidence diagnostics locate missing and contradictory node constraints without changing imports', () => {
  const project = newProject('investigation'); project.chapters[0].nodes.room.requiresEvidence = ['absent'];
  project.chapters[0].nodes.room.excludesEvidence = ['absent'];
  const model = new EditorModel(project), before = model.serialize(), diagnostics = model.diagnostics();
  assert.ok(diagnostics.some(d => d.code === 'evidence-reference' && d.node === '["chapter-1","room"]'));
  assert.ok(diagnostics.some(d => d.code === 'evidence-conflict'));
  assert.equal(model.serialize(), before);
});

test('typed conditions preserve booleans, finite numbers and combined comparisons with runtime semantics', () => {
  const variables = { trust: { initial: 0, min: 0, max: 10 }, found: { initial: false } };
  const terms = [{ key: 'trust', op: 'gte', value: 2 }, { key: 'trust', op: 'eq', value: 3 }, { key: 'found', op: 'eq', value: false }];
  const before = structuredClone(terms), condition = conditionFromTerms(variables, terms);
  assert.deepEqual(condition, { trust: { gte: 2, eq: 3 }, found: { eq: false } }); assert.deepEqual(terms, before);
  const project = newProject('script'); project.program.variables = variables;
  project.program.blocks[0].exit.choices[0].effects = [{ op: 'set', key: 'trust', value: 3 }];
  project.program.blocks[0].exit.choices[0].next = 'routing';
  project.program.blocks.push({ id: 'routing', lines: [], exit: { type: 'branch', routes: [{ when: condition, next: 'end' }, { next: 'end' }] } });
  const { session } = createProject(project, 'https://example.test/');
  try { session.next(); session.act('yes'); assert.equal(session.getView().frame.sceneId, 'end'); } finally { session.dispose(); }
});

test('typed conditions reject unknown operators, duplicate comparisons, unknown variables and coercion', () => {
  const variables = { n: { initial: 0 }, b: { initial: false } };
  for (const term of [{ key: 'unknown', op: 'eq', value: 0 }, { key: 'n', op: 'eq', value: '' }, { key: 'n', op: 'eq', value: Infinity }, { key: 'b', op: 'gte', value: false }, { key: 'n', op: 'eval', value: 0 }, { key: '__proto__', op: 'eq', value: 0 }]) assert.throws(() => conditionFromTerms(variables, [term]));
  assert.throws(() => conditionFromTerms(variables, [{ key: 'n', op: 'eq', value: 0 }, { key: 'n', op: 'eq', value: 1 }]), /重复/);
});
