import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeSemantics, runtimeSemantic, RUNTIME_SEMANTICS_VERSION } from '../dist/runtime/semantics.js';
import { createSourceResolver, resolveSourceOrigin } from '../dist/source/origin.js';
import { createProject } from '../dist/runtime/project.js';
import { compileRainProgram } from '../dist/adapters/rain-runtime.js';
import { ScriptEngine } from '../dist/script/engine.js';

const sourceSha = 'a'.repeat(64);
const program = () => ({ schema: 1, game: 'p0-contract', version: 'story-v1', entry: 'start', variables: { trust: { initial: 0, min: 0, max: 1 } }, blocks: [
  { id: 'start', lines: [{ id: 'hello', speaker: '旁白', text: '逐字说明' }, { id: 'question', speaker: '甲', text: '选择' }],
    exit: { type: 'choice', choices: [{ id: 'yes', text: '同意', next: 'gate', effects: [{ op: 'add', key: 'trust', value: 1 }] }, { id: 'no', text: '保留', next: 'gate' }] } },
  { id: 'gate', lines: [], exit: { type: 'branch', routes: [{ when: { trust: { gte: 1 } }, next: 'good' }, { next: 'other' }] } },
  { id: 'good', lines: [{ id: 'good-line', speaker: '旁白', text: '命中' }], exit: { type: 'end', ending: 'good' } },
  { id: 'other', lines: [{ id: 'other-line', speaker: '旁白', text: '保留' }], exit: { type: 'jump', next: 'good' } }
] });
const script = () => ({ schema: 1, type: 'script', game: 'p0-contract', version: 'story-v1', title: '技术夹具', assets: [], program: program() });

class Clock {
  time = 0; serial = 0; tasks = new Map();
  now = () => this.time;
  set = (callback, delay) => { const id = ++this.serial; this.tasks.set(id, { callback, due: this.time + delay }); return id; };
  clear = id => { this.tasks.delete(id); };
  advance(ms) {
    const until = this.time + ms;
    for (let remaining = 10000; remaining; remaining--) {
      const next = [...this.tasks.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > until) { this.time = until; return; }
      this.tasks.delete(next[0]); this.time = next[1].due; next[1].callback();
    }
    throw Error('Timer budget exhausted');
  }
}

test('the semantic catalogue is immutable data, separate from author operations and executable registrations', () => {
  const catalogue = runtimeSemantics();
  assert.equal(catalogue.version, RUNTIME_SEMANTICS_VERSION);
  assert.equal(catalogue.validation.executionRegistry, false);
  assert.equal(runtimeSemantic('node.patch'), undefined);
  assert.equal(runtimeSemantic('arbitrary-js'), undefined);
  assert.equal(new Set(catalogue.entries.map(entry => entry.id)).size, catalogue.entries.length);
  assert.throws(() => { runtimeSemantic('stage.sound').restore = 'rerun-everything'; }, TypeError);
  assert.throws(() => { catalogue.entries.push({ id: 'eval' }); }, TypeError);
  const wire = JSON.parse(JSON.stringify(catalogue));
  assert.equal(wire.entries.find(entry => entry.id === 'stage.sound').restore, 'suppress-on-restore-reread-rollback');
  assert.equal(wire.entries.find(entry => entry.id === 'stage.voice').blocking.next, 'none');
});

test('script contracts match legal routing, choice gates and canonical save replay', () => {
  const project = script(), clock = new Clock();
  const { session } = createProject(project, 'https://contract.invalid/', { clock, settings: { textDelayMs: 0, autoDelayMs: 10 } });
  assert.equal(runtimeSemantic('script.choice').blocking.auto, 'player-choice-required');
  session.next(); session.setAuto(true); clock.advance(1000);
  assert.equal(session.getView().frame.lineId, 'question');
  assert.equal(session.act('not-available'), false);
  assert.equal(session.act('yes'), true);
  assert.equal(session.getView().frame.ending, 'good');
  const saved = session.save();
  assert.equal(saved.state.blockId, 'good');
  assert.deepEqual(saved.state.decisions, [{ blockId: 'start', choiceId: 'yes' }]);
  assert.equal('variables' in saved.state, false);
  session.restore({ ...saved, state: { ...saved.state, variables: { trust: 999 } } });
  assert.deepEqual(session.save(), saved);
  assert.equal(session.getView().auto, false);
  assert.equal(runtimeSemantic('script.end').blocking.next, 'terminal');
  assert.equal(session.next(), false);
  session.dispose();
});

test('next reveal and finite authored hold are different gates, with no semantic format changes', () => {
  const project = script(); project.program.blocks[0].lines[0].cue = { pauseMs: 50000 };
  const clock = new Clock(), { session } = createProject(project, 'https://contract.invalid/', { clock, settings: { textDelayMs: 10 } });
  assert.equal(session.next(), true); // reveal only
  assert.equal(session.getView().frame.lineId, 'hello');
  assert.equal(session.getView().ready, false);
  assert.equal(session.next(), false);
  clock.advance(29999); assert.equal(session.next(), false);
  clock.advance(1); assert.equal(session.next(), true);
  assert.equal(session.getView().frame.lineId, 'question');
  assert.match(runtimeSemantic('stage.pauseMs').input.notes.join(' '), /clamped to 0–30000/);
  assert.equal(runtimeSemantic('player.next').blocking.next, 'reveal-before-advance');
  session.dispose();
});

test('source identity stays stable across source formatting and authored reordering', () => {
  const project = script();
  const selector = { nodeId: 'start', lineId: 'question' };
  const origin = resolveSourceOrigin(project, selector, sourceSha);
  assert.deepEqual(origin.path, ['program', 'blocks', 0, 'lines', 1]);
  assert.equal(origin.sourceSha256, sourceSha);
  assert.deepEqual(resolveSourceOrigin(JSON.parse(JSON.stringify(project, null, 4)), selector, sourceSha), origin);
  const moved = structuredClone(project); moved.program.blocks.unshift(moved.program.blocks.pop());
  const next = resolveSourceOrigin(moved, selector);
  assert.equal(next.nodeId, origin.nodeId); assert.equal(next.lineId, origin.lineId);
  assert.deepEqual(next.path, ['program', 'blocks', 1, 'lines', 1]);
  origin.path[0] = 'consumer-edit';
  assert.deepEqual(resolveSourceOrigin(project, selector).path, ['program', 'blocks', 0, 'lines', 1]);
});

test('source lookup does not invent locations for unknown, ambiguous, contradictory or unsafe selectors', () => {
  const project = script(), resolve = createSourceResolver(project, sourceSha);
  assert.equal(resolve({ lineId: 'missing' }).path, undefined);
  assert.equal(resolve({ nodeId: 'good', lineId: 'question' }).path, undefined);
  assert.equal(resolve({ nodeId: 'start', sceneId: 'good', lineId: 'question' }).path, undefined);
  assert.equal(resolve({ path: ['program', 'missing'] }).path, undefined);
  assert.equal(resolve({ path: ['__proto__', 'polluted'] }).path, undefined);
  assert.equal(resolve({ path: Array(61).fill('x') }).path, undefined);
  assert.throws(() => createSourceResolver(project, 'not-a-hash'), /SHA256/);
  const duplicate = script(); duplicate.program.blocks[2].lines[0].id = 'question';
  assert.equal(resolveSourceOrigin(duplicate, { lineId: 'question' }).path, undefined);
  assert.deepEqual(resolveSourceOrigin(duplicate, { nodeId: 'start', lineId: 'question' }).path, ['program', 'blocks', 0, 'lines', 1]);
});

test('narrative legacy fallback IDs remain the same and field diagnostics retain their exact JSON path', () => {
  const project = { schema: 1, type: 'narrative', game: 'legacy-test', version: 'v1', title: '技术夹具', assets: [{ id: 'bg', kind: 'background', src: 'bg.svg' }],
    scenes: [{ id: 'opening', lines: [{ speaker: '旁白', text: '旧格式' }, { id: 'stable', speaker: '旁白', text: '新行' }], ending: 'done' }] };
  assert.deepEqual(resolveSourceOrigin(project, { sceneId: 'opening', lineId: 'opening/0' }).path, ['scenes', 0, 'lines', 0]);
  const field = resolveSourceOrigin(project, { path: ['scenes', 0, 'lines', 1, 'text'] });
  assert.deepEqual(field, { game: 'legacy-test', storyVersion: 'v1', nodeId: 'opening', lineId: 'stable', path: ['scenes', 0, 'lines', 1, 'text'] });
  assert.deepEqual(resolveSourceOrigin(project, { assetId: 'bg' }).path, ['assets', 0]);
  assert.equal(resolveSourceOrigin(project, { assetId: 'absent' }).path, undefined);
});

test('investigation chapter and node IDs resolve without splitting slash-containing identities', () => {
  const node = { kind: 'dialogue', text: '技术夹具', location: '', time: '', actions: [], progress: 0 };
  const project = { schema: 1, type: 'investigation', game: 'investigation-source', version: 'v1', title: '技术夹具', assets: [], chapters: [
    { id: 'one', order: 1, title: '一', entryNode: 'shared', nodes: { shared: node }, evidence: {}, requiredEvidence: [] },
    { id: 'two/part', order: 2, title: '二', entryNode: 'shared', nodes: { shared: node }, evidence: {}, requiredEvidence: [] }
  ] };
  assert.equal(resolveSourceOrigin(project, { nodeId: 'shared' }).path, undefined);
  const origin = resolveSourceOrigin(project, { lineId: 'two/part/shared', sceneId: 'shared' });
  assert.equal(origin.chapterId, 'two/part');
  assert.deepEqual(origin.path, ['chapters', 1, 'nodes', 'shared']);
  assert.deepEqual(resolveSourceOrigin(project, { chapterId: 'one' }).path, ['chapters', 0]);
});

test('Rain response runtime blocks locate the original authored response instead of a fabricated compiled path', () => {
  const story = { schema_version: 1, entry: 'start/node', initial_state: { trust: 0 }, state_definitions: { trust: { type: 'int', min: 0, max: 1 } }, nodes: [
    { id: 'start/node', lines: [{ id: 'intro', speaker: 'n', text: '技术夹具' }], choices: [{ id: 'choice/yes', text: '选择', next: 'end', effects: { trust: 1 }, response: [{ id: 'response-line', speaker: 'n', text: '回应' }] }] },
    { id: 'end', lines: [{ id: 'end-line', speaker: 'n', text: '结束' }], ending: 'done' }
  ] };
  const project = { schema: 1, type: 'rain', game: 'rain-source', version: 'v1', title: '技术夹具', assets: [], story };
  const engine = new ScriptEngine(compileRainProgram(story, { game: project.game, version: project.version }));
  const state = engine.choose(engine.initial(), 'choice/yes');
  const line = engine.block(state).lines[state.line];
  const origin = resolveSourceOrigin(project, { sceneId: state.blockId, nodeId: 'start/node', lineId: line.id });
  assert.equal(origin.nodeId, 'start/node');
  assert.equal(origin.lineId, 'response-line');
  assert.deepEqual(origin.path, ['story', 'nodes', 0, 'choices', 0, 'response', 0]);
  assert.equal(origin.path.includes('blocks'), false);
});
