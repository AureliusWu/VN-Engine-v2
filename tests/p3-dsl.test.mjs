import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileTextScript } from '../dist/script/text.js';
import { ScriptEngine } from '../dist/script/engine.js';
import { ScriptDriver } from '../dist/runtime/drivers.js';
import { RuntimeSession } from '../dist/runtime/session.js';

const minimal = 'vn-script 1\ngame "p3-test"\nversion "1"\nentry start\nblock start\nline hello "旁白" "Hello"\nend done\n';
const prefix = 'vn-script 1\ngame "p3-test"\nversion "1"\nentry route\nvar score number 0 min 0 max 10\n';
const cues = [
  'cue block route background room', 'cue block route music bgm',
  'cue line hello portrait actor/neutral', 'cue line hello cg memory', 'cue line hello ambience rain',
  'cue line hello sound tap', 'cue line hello voice spoken', 'cue line hello pause 125', 'cue line hello effect fade',
  'cue line second portrait null', 'cue line second cg null', 'cue line second ambience null', 'cue line second effect flash 0',
  'cue block good music null', 'cue block neutral music "null"'
];
const body = 'block route\njump start\nblock start\nline hello "旁白" "Hello"\nline second "旁白" "Choose"\nchoice go "Go" -> good with add score 2\nchoice leave "Leave" -> neutral\nblock good\nline good-line "旁白" "Good"\nend good\nblock neutral\nline neutral-line "旁白" "Neutral"\nend neutral\n';
const source = prefix + cues.join('\n') + '\n' + body;
const manual = {
  schema: 1, game: 'p3-test', version: '1', entry: 'route', variables: { score: { initial: 0, min: 0, max: 10 } },
  blocks: [
    { id: 'route', lines: [], cue: { background: 'room', music: 'bgm' }, exit: { type: 'jump', next: 'start' } },
    { id: 'start', lines: [
      { id: 'hello', speaker: '旁白', text: 'Hello', cue: { portrait: 'actor/neutral', cg: 'memory', ambience: 'rain', sound: 'tap', voice: 'spoken', pauseMs: 125, effect: { type: 'fade' } } },
      { id: 'second', speaker: '旁白', text: 'Choose', cue: { portrait: null, cg: null, ambience: null, effect: { type: 'flash', durationMs: 0 } } }
    ], exit: { type: 'choice', choices: [
      { id: 'go', text: 'Go', next: 'good', effects: [{ op: 'add', key: 'score', value: 2 }] },
      { id: 'leave', text: 'Leave', next: 'neutral' }
    ] } },
    { id: 'good', lines: [{ id: 'good-line', speaker: '旁白', text: 'Good' }], cue: { music: null }, exit: { type: 'end', ending: 'good' } },
    { id: 'neutral', lines: [{ id: 'neutral-line', speaker: '旁白', text: 'Neutral' }], cue: { music: 'null' }, exit: { type: 'end', ending: 'neutral' } }
  ]
};
const success = (text, options) => { const result = compileTextScript(text, options); assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); return result; };
const failure = (text, code, options) => { const result = compileTextScript(text, options); assert.equal(result.ok, false); assert.ok(!Object.hasOwn(result, 'program')); assert.ok(result.diagnostics.some(item => item.code === code), JSON.stringify(result.diagnostics)); return result; };

test('explicit cue targets lower to existing hand-written IR and retain both routes, replay and save bytes', () => {
  const compiled = success(source).program; assert.deepEqual(compiled, manual);
  for (const choice of ['go', 'leave']) {
    const engines = [compiled, manual].map(program => new ScriptEngine(program));
    const states = engines.map(engine => engine.advance(engine.initial()));
    assert.deepEqual(states[0], states[1]);
    const ends = engines.map((engine, index) => engine.choose(states[index], choice));
    assert.deepEqual(ends[0], ends[1]);
    assert.equal(JSON.stringify(engines[0].encode(ends[0])), JSON.stringify(engines[1].encode(ends[1])));
    assert.deepEqual(engines[0].decode(JSON.stringify(engines[1].encode(ends[1]))), ends[0]);
    assert.deepEqual(engines[0].replay(ends[0].decisions, ends[0].blockId, ends[0].line), ends[0]);
  }
});

test('compiled cues use the unchanged runtime frame, canonical restore and once-only data boundaries', () => {
  const sessions = [success(source).program, manual].map(program => new RuntimeSession(new ScriptDriver(new ScriptEngine(program)), { settings: { textDelayMs: 0 } }));
  try {
    assert.deepEqual(sessions[0].getSnapshot().frame, sessions[1].getSnapshot().frame);
    assert.equal(sessions[0].getView().frame.stage.sound, 'tap');
    const save = sessions[0].save(); sessions[0].restore(save); sessions[1].restore(save);
    assert.deepEqual(sessions[0].getSnapshot().frame, sessions[1].getSnapshot().frame);
    assert.equal(JSON.stringify(save).includes('sourceMap'), false); assert.equal(JSON.stringify(save).includes('cue'), false);
  } finally { sessions.forEach(session => session.dispose()); }
});

test('forward cue declarations and declarations after exits keep stable identities and exact source-map fields', () => {
  const before = success(source, { fileName: '演出.vn.txt' }), after = success(prefix + body + cues.join('\n') + '\n');
  assert.deepEqual(after.program, before.program);
  const entries = before.sourceMap.filter(item => item.kind === 'cue'); assert.equal(entries.length, cues.length);
  for (const entry of entries) {
    assert.equal(entry.fileName, '演出.vn.txt'); assert.ok(entry.blockId);
    assert.equal(source.slice(entry.span.start.offset, entry.span.end.offset).startsWith('cue '), true);
    assert.ok(entry.path.reduce((value, key) => value[key], before.program) !== undefined);
    assert.equal(entry.path.at(-2), 'cue');
  }
  const pause = entries.find(item => item.lineId === 'hello' && item.path.at(-1) === 'pauseMs');
  assert.deepEqual(pause.path, ['blocks', 1, 'lines', 0, 'cue', 'pauseMs']); assert.equal(pause.blockId, 'start');
  const effect = entries.find(item => item.lineId === 'hello' && item.path.at(-1) === 'effect');
  assert.equal(source.slice(effect.span.start.offset, effect.span.end.offset), 'cue line hello effect fade');
  assert.deepEqual(effect.path, ['blocks', 1, 'lines', 0, 'cue', 'effect']);
});

test('bare null clears only durable fields while quoted null and HTML remain inert asset IDs', () => {
  const fields = ['background', 'portrait', 'cg', 'music', 'ambience'];
  const cleared = success(minimal + fields.map(field => `cue line hello ${field} null`).join('\n')).program.blocks[0].lines[0].cue;
  assert.deepEqual(cleared, Object.fromEntries(fields.map(field => [field, null])));
  const named = success(minimal + fields.map(field => `cue line hello ${field} "null"`).join('\n')).program.blocks[0].lines[0].cue;
  assert.deepEqual(named, Object.fromEntries(fields.map(field => [field, 'null'])));
  globalThis.__p3CueExecuted = false;
  try {
    const asset = '<img onerror="globalThis.__p3CueExecuted=true">';
    const result = success(minimal + 'cue line hello background ' + JSON.stringify(asset));
    assert.equal(result.program.blocks[0].lines[0].cue.background, asset); assert.equal(globalThis.__p3CueExecuted, false);
  } finally { delete globalThis.__p3CueExecuted; }
  for (const field of ['sound', 'voice']) failure(minimal + `cue line hello ${field} null`, 'DSL_CUE_VALUE');
});

test('cue scope, fields, asset IDs, pause and effect durations use a closed typed grammar', () => {
  for (const command of ['cue scene start background room', 'cue "line" hello background room']) failure(minimal + command, 'DSL_CUE_SCOPE');
  for (const field of ['timeline', 'video', 'document', '__proto__', 'pauseMs', 'execute']) failure(minimal + `cue line hello ${field} room`, 'DSL_CUE_FIELD');
  for (const value of ['-1', '30001', '1.5', 'true', '"100"', 'null']) failure(minimal + `cue line hello pause ${value}`, 'DSL_CUE_VALUE');
  for (const value of ['fade -1', 'flash 2001', 'shake 0.5', 'fade true', 'fade null', 'spin', '"fade"']) failure(minimal + `cue line hello effect ${value}`, 'DSL_CUE_VALUE');
  assert.deepEqual(success(minimal + 'cue line hello effect shake 2000').program.blocks[0].lines[0].cue.effect, { type: 'shake', durationMs: 2000 });
  for (const value of ['""', '"  "', '42']) failure(minimal + `cue line hello sound ${value}`, 'DSL_ID_REQUIRED');
  failure(minimal + 'cue line hello background room extra', 'DSL_SYNTAX');
});

test('duplicate cue fields and unknown targets report positioned stable target identities', () => {
  const duplicate = failure(minimal + 'cue line hello pause 0\ncue line hello pause 1\n', 'DSL_DUPLICATE_CUE');
  const issue = duplicate.diagnostics.find(item => item.code === 'DSL_DUPLICATE_CUE');
  assert.equal(issue.blockId, 'start'); assert.equal(issue.lineId, 'hello'); assert.deepEqual(issue.path, ['blocks', 0, 'lines', 0, 'cue', 'pauseMs']);
  assert.equal(issue.span.start.line, 9);
  for (const scope of ['block', 'line']) {
    const result = failure(minimal + `cue ${scope} absent background room`, 'DSL_UNKNOWN_CUE_TARGET');
    assert.equal(result.diagnostics.find(item => item.code === 'DSL_UNKNOWN_CUE_TARGET')[scope === 'block' ? 'blockId' : 'lineId'], 'absent');
  }
  assert.deepEqual(success(minimal + 'cue block start music bgm\ncue line hello music bgm').program.blocks[0].cue, { music: 'bgm' });
});

test('routing blocks accept durable cues and reject cues requiring an actual dialogue visit', () => {
  const routing = minimal.replace('entry start', 'entry route') + 'block route\njump start\n';
  assert.deepEqual(success(routing + 'cue block route music bgm').program.blocks[1].cue, { music: 'bgm' });
  for (const [field, value] of [['sound', 'tap'], ['voice', 'spoken'], ['pause', '0'], ['effect', 'fade']]) {
    const result = failure(routing + `cue block route ${field} ${value}`, 'DSL_CUE_ROUTING_BLOCK');
    assert.equal(result.diagnostics.find(item => item.code === 'DSL_CUE_ROUTING_BLOCK').blockId, 'route');
  }
  assert.equal(success(minimal + 'cue block start sound tap').program.blocks[0].cue.sound, 'tap');
});

test('cue count budgets can be tightened but cannot raise the hard ceiling or weaken old limits', () => {
  failure(minimal + 'cue line hello sound tap\ncue line hello voice spoken', 'DSL_CUE_BUDGET', { maxCues: 1 });
  for (const maxCues of [0, -1, 30001, 1.5, Infinity]) failure(minimal, 'DSL_OPTIONS', { maxCues });
  assert.equal(success(minimal + 'cue line hello sound tap', { maxCues: 1 }).program.blocks[0].lines[0].cue.sound, 'tap');
  failure(minimal + 'cue line hello sound tap', 'DSL_TOKEN_BUDGET', { maxTokens: 3 });
  failure(minimal + 'cue line hello sound ' + 'x'.repeat(257), 'DSL_ID_BUDGET');
});

test('thousands of forward line cue targets resolve without repeated linear scans', () => {
  const count = 7000, targetSource = 'vn-script 1\ngame "large-cues"\nversion "1"\nentry start\n'
    + Array.from({ length: count }, (_, i) => `cue line l${i} sound tap\n`).join('') + 'block start\n'
    + Array.from({ length: count }, (_, i) => `line l${i} "N" "Line"\n`).join('') + 'end done\n';
  const original = Array.prototype.findIndex; let searchedLines = 0;
  try {
    Array.prototype.findIndex = function(...args) {
      if (this.length === count && this[0]?.id === 'l0') { searchedLines += this.length; assert.ok(searchedLines <= count * 2, 'Repeated linear scans resolving cue targets'); }
      return original.apply(this, args);
    };
    const result = success(targetSource); assert.equal(result.program.blocks[0].lines.length, count);
    assert.equal(result.sourceMap.filter(item => item.kind === 'cue').length, count);
    assert.equal(result.program.blocks[0].lines.at(-1).cue.sound, 'tap');
  } finally { Array.prototype.findIndex = original; }
});
