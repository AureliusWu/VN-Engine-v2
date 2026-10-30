import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileTextScript, TEXT_SCRIPT_FORMAT } from '../dist/script/text.js';
import { ScriptEngine } from '../dist/script/engine.js';
import { ScriptDriver } from '../dist/runtime/drivers.js';
import { RuntimeSession } from '../dist/runtime/session.js';

const example = await readFile(new URL('../examples/dsl/branch.vn.txt', import.meta.url), 'utf8');
const minimal = `vn-script 1\ngame "p1-test"\nversion "1"\nentry start\nblock start\nline first "旁白" "Hello"\nend done\n`;
const handWritten = {
  schema: 1, game: 'p1-dsl-demo', version: '1', entry: 'start',
  variables: { trust: { initial: 0, min: 0, max: 10 }, consent: { initial: false } },
  blocks: [
    { id: 'start', title: '开场 / Opening', lines: [{ id: 'hello', speaker: '旁白', text: '你好，world。\n请选择一条路线。' }],
      exit: { type: 'choice', choices: [
        { id: 'accept', text: '继续 / Continue', next: 'route', effects: [{ op: 'add', key: 'trust', value: 2 }, { op: 'set', key: 'consent', value: true }] },
        { id: 'decline', text: '离开 / Leave', next: 'neutral' }
      ] } },
    { id: 'route', lines: [], exit: { type: 'branch', routes: [{ when: { trust: { gte: 2 }, consent: { eq: true } }, next: 'good' }, { next: 'neutral' }] } },
    { id: 'good', lines: [{ id: 'good-line', speaker: '旁白', text: '第一行：完成。\nSecond line: stable IDs survive formatting edits.' }], exit: { type: 'end', ending: 'good' } },
    { id: 'neutral', lines: [{ id: 'neutral-line', speaker: '旁白', text: '暂时停在这里。' }], exit: { type: 'end', ending: 'neutral' } }
  ]
};
function success(text, options) {
  const result = compileTextScript(text, options);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.program); return result;
}
function failure(text, code, options) {
  const result = compileTextScript(text, options);
  assert.equal(result.ok, false); assert.equal(Object.hasOwn(result, 'program'), false);
  assert.ok(result.diagnostics.some(item => item.code === code), `${code}: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

test('restricted DSL lowers to the exact existing JSON IR and preserves both routes, replay and save bytes', () => {
  assert.equal(TEXT_SCRIPT_FORMAT, 'vn-script-text-v1');
  const compiled = success(example).program;
  assert.deepEqual(compiled, handWritten);
  for (const choice of ['accept', 'decline']) {
    const a = new ScriptEngine(compiled), b = new ScriptEngine(handWritten);
    assert.deepEqual(a.initial(), b.initial());
    const left = a.choose(a.initial(), choice), right = b.choose(b.initial(), choice);
    assert.deepEqual(left, right);
    assert.deepEqual(a.replay(left.decisions, left.blockId, left.line), b.replay(right.decisions, right.blockId, right.line));
    assert.equal(JSON.stringify(a.encode(left)), JSON.stringify(b.encode(right)));
    assert.deepEqual(a.decode(JSON.stringify(b.encode(right))), b.decode(JSON.stringify(a.encode(left))));
    assert.equal(a.block(left).exit.ending, choice === 'accept' ? 'good' : 'neutral');
    const forged = a.encode(left); forged.state.variables = { trust: 100, consent: false }; forged.state.history = [{ text: 'injected' }];
    assert.deepEqual(a.decode(JSON.stringify(forged)), a.replay(left.decisions, left.blockId, left.line));
    assert.ok(!JSON.stringify(a.encode(left)).includes('sourceMap'));
  }
});

test('compiled and direct JSON use the same driver/session restore, reread and alternate choice behavior', () => {
  const sessions = [success(example).program, handWritten].map(program => new RuntimeSession(new ScriptDriver(new ScriptEngine(program)), { settings: { textDelayMs: 0 } }));
  try {
    const [a, b] = sessions;
    assert.deepEqual(a.getSnapshot().frame, b.getSnapshot().frame);
    assert.equal(a.act('accept'), true); assert.equal(b.act('accept'), true);
    assert.deepEqual(a.getSnapshot().frame, b.getSnapshot().frame);
    assert.deepEqual(a.save(), b.save());
    const save = a.save(); b.restore(save); a.restore(b.save());
    assert.deepEqual(a.getSnapshot().frame, b.getSnapshot().frame);
    assert.equal(a.reread('0:hello'), true); assert.equal(b.reread('0:hello'), true);
    assert.deepEqual(a.save(), b.save());
    assert.equal(a.act('decline'), true); assert.equal(b.act('decline'), true);
    assert.deepEqual(a.getSnapshot().frame, b.getSnapshot().frame);
    assert.equal(a.getSnapshot().frame.ending, 'neutral');
  } finally { sessions.forEach(session => session.dispose()); }
});

test('Unicode/quoted IDs, JSON escapes, raw multiline strings, CRLF and comment markers retain exact authored values', () => {
  const source = '\uFEFFvn-script 1\r\ngame "测试" // 注释\r\nversion "v1"\r\nentry "开场 空格"\r\nblock "开场 空格"\r\nline "第一句" "角色\\u7532" "\\\"quoted\\\" \\\\ # // 😀" medium chat\r\nline second "旁白" """line 1\r\nline 2 # // \\n""" medium call\r\nend "完成 结局"\r\n';
  const result = success(source, { fileName: '中文.vn.txt' });
  const lines = result.program.blocks[0].lines;
  assert.equal(lines[0].speaker, '角色甲'); assert.equal(lines[0].text, '"quoted" \\ # // 😀');
  assert.equal(lines[0].medium, 'chat'); assert.equal(lines[1].medium, 'call');
  assert.equal(lines[1].text, 'line 1\r\nline 2 # // \\n');
  const first = result.sourceMap.find(item => item.kind === 'line' && item.id === '第一句');
  assert.equal(first.fileName, '中文.vn.txt'); assert.equal(first.span.start.line, 6); assert.equal(first.span.start.column, 1);
  assert.equal(source.slice(first.span.start.offset, first.span.end.offset), 'line "第一句" "角色\\u7532" "\\\"quoted\\\" \\\\ # // 😀" medium chat');
});

test('formatting changes only spans: explicit identities, paths and lowered IR are stable', () => {
  const original = success(minimal), formatted = success(minimal.replace('block start', '# blank and indentation\n\n  block   start').replace('line first', '    line    first').replace('end done', 'end done // final comment'));
  assert.deepEqual(formatted.program, original.program);
  const identities = value => value.sourceMap.map(({ span, ...rest }) => rest);
  assert.deepEqual(identities(formatted), identities(original));
  assert.notDeepEqual(formatted.sourceMap.find(item => item.kind === 'line').span, original.sourceMap.find(item => item.kind === 'line').span);
});

test('source map includes variable/choice/effect/route paths; unknown targets carry concrete source and stable IDs', () => {
  const result = success(example, { fileName: 'branch.vn.txt' });
  const effect = result.sourceMap.find(item => item.kind === 'effect' && item.path.at(-1) === 1);
  assert.deepEqual(effect.path, ['blocks', 0, 'exit', 'choices', 0, 'effects', 1]);
  assert.equal(effect.blockId, 'start'); assert.equal(effect.choiceId, 'accept');
  assert.equal(example.slice(effect.span.start.offset, effect.span.end.offset), 'set consent true');
  assert.deepEqual(result.sourceMap.find(item => item.kind === 'variable').path, ['variables', 'trust']);
  assert.deepEqual(result.sourceMap.find(item => item.kind === 'route').path, ['blocks', 1, 'exit', 'routes', 0]);
  const invalid = failure(example.replace('-> route with', '-> missing with'), 'DSL_UNKNOWN_TARGET', { fileName: 'broken.vn.txt' });
  const error = invalid.diagnostics.find(item => item.code === 'DSL_UNKNOWN_TARGET');
  assert.equal(error.fileName, 'broken.vn.txt'); assert.equal(error.blockId, 'start'); assert.equal(error.choiceId, 'accept');
  assert.deepEqual(error.path, ['blocks', 0, 'exit', 'choices', 0, 'next']);
  assert.ok(error.span.start.offset < error.span.end.offset); assert.ok(error.span.start.line > 1);
});

test('unknown commands, standalone mutation, call stacks, HTML and expressions are rejected as data without execution', () => {
  globalThis.__p1DslExecuted = false;
  try {
    for (const command of ['set score 4', 'add score 2', 'call callback', 'eval "globalThis.__p1DslExecuted = true"', 'javascript "fetch(\'https://example.test\')"', '<script>globalThis.__p1DslExecuted=true</script>']) {
      failure(minimal.replace('end done', `${command}\nend done`), 'DSL_UNKNOWN_COMMAND');
    }
    failure(example.replace('trust >= 2 && consent == true', 'trust + 2 >= 4'), 'DSL_CONDITION');
    failure(example.replace('with add trust 2, set consent true', 'with execute trust 2'), 'DSL_EFFECT');
    failure(example.replace('with add trust 2, set consent true', 'with set consent "true"'), 'DSL_SCALAR');
    assert.equal(globalThis.__p1DslExecuted, false);
  } finally { delete globalThis.__p1DslExecuted; }
});

test('duplicates, missing explicit IDs, empty dialogue and misplaced declarations receive errors', () => {
  failure(minimal.replace('block start', 'block'), 'DSL_ID_REQUIRED');
  failure(minimal.replace('line first', 'line ""'), 'DSL_ID_REQUIRED');
  failure(minimal.replace('end done', 'end done\nblock start\nline second "甲" "B"\nend other'), 'DSL_DUPLICATE_BLOCK');
  failure(minimal.replace('end done', 'line first "甲" "B"\nend done'), 'DSL_DUPLICATE_LINE');
  failure(example.replace('choice decline', 'choice accept'), 'DSL_DUPLICATE_CHOICE');
  failure(example.replace('var consent boolean false', 'var consent boolean false\nvar consent boolean true'), 'DSL_DUPLICATE_VARIABLE');
  failure(minimal.replace('"Hello"', '"  "'), 'DSL_EMPTY_DIALOGUE');
  failure(minimal.replace('end done', 'var late number 0\nend done'), 'DSL_DECLARATION_ORDER');
  failure(minimal.replace('end done', 'end done\nline late "甲" "B"'), 'DSL_LINE_AFTER_EXIT');
  failure(minimal.replace('end done', 'end done\njump start'), 'DSL_DUPLICATE_EXIT');
  failure(minimal.replace('version "1"\n', ''), 'DSL_METADATA');
});

test('variable bounds/types/condition operators and prototype keys are checked without coercion', () => {
  failure(example.replace('number 0 min 0 max 10', 'number 12 min 0 max 10'), 'DSL_VARIABLE_BOUNDS');
  failure(example.replace('boolean false', 'boolean false min 0'), 'DSL_VARIABLE_BOUNDS');
  failure(example.replace('number 0 min 0 max 10', 'number 0 min 0 min 1'), 'DSL_VARIABLE_BOUNDS');
  failure(example.replace('add trust 2', 'add consent 2'), 'DSL_VARIABLE_TYPE');
  failure(example.replace('set consent true', 'set consent 1'), 'DSL_VARIABLE_TYPE');
  failure(example.replace('set consent true', 'set trust 11'), 'DSL_VARIABLE_BOUNDS');
  failure(example.replace('add trust 2', 'add undeclared 2'), 'DSL_UNKNOWN_VARIABLE');
  failure(example.replace('trust >= 2', 'trust >= 2 && trust >= 1'), 'DSL_CONDITION');
  failure(example.replace('consent == true', 'consent >= 1'), 'DSL_VARIABLE_TYPE');
  failure(example.replace('var consent boolean false', 'var constructor boolean false'), 'DSL_RESERVED_VARIABLE');
  failure(example.replace('consent == true', '__proto__ == true'), 'DSL_RESERVED_VARIABLE');
  failure(example.replace('add trust 2', 'add trust 1e999'), 'DSL_SCALAR');
  assert.equal(Object.prototype.polluted, undefined);
  // Ordered effects have existing VM behavior: add may cross a bound only at player execution.
  const valid = success(example.replace('add trust 2', 'add trust 20')).program;
  const engine = new ScriptEngine(valid); assert.throws(() => engine.choose(engine.initial(), 'accept'), /bounds/);
});

test('empty routes, missing fallback/targets and immediate hidden loops fail before a program is returned', () => {
  failure(minimal.replace('end done', ''), 'DSL_EXIT_REQUIRED');
  failure(minimal.replace('line first "旁白" "Hello"\n', ''), 'DSL_EMPTY_BLOCK');
  failure(example.replace('  when trust >= 2 && consent == true -> good\n  else -> neutral', ''), 'DSL_BRANCH_FALLBACK');
  failure(example.replace('  else -> neutral\n', ''), 'DSL_BRANCH_FALLBACK');
  failure(example.replace('  else -> neutral', '  else -> neutral\n  when trust == 0 -> good'), 'DSL_BRANCH_FALLBACK');
  failure(minimal.replace('end done', 'jump nowhere'), 'DSL_UNKNOWN_TARGET');
  failure(minimal.replace('line first "旁白" "Hello"\nend done', 'jump start'), 'DSL_PROGRAM_INVALID');
  failure(example.replace('  branch\n', ''), 'DSL_BRANCH_REQUIRED');
});

test('structurally unreachable blocks are an explicit warning, not an invented coverage result', () => {
  const result = success(`${minimal}\nblock unused\nline unused-line "旁白" "Unused"\nend unused-ending\n`);
  assert.deepEqual(result.diagnostics.map(({ code, severity, blockId }) => ({ code, severity, blockId })),
    [{ code: 'DSL_UNREACHABLE_BLOCK', severity: 'warning', blockId: 'unused' }]);
});

test('malformed strings and unsupported syntax recover with bounded, positioned diagnostics', () => {
  failure(minimal.replace('"Hello"', '"bad\\q"'), 'DSL_STRING_ESCAPE');
  failure(minimal.replace('"Hello"', '"unterminated'), 'DSL_STRING_UNTERMINATED');
  failure(minimal.replace('"Hello"', '"""unterminated'), 'DSL_STRING_UNTERMINATED');
  failure(minimal.replace('line first', 'line first "extra"'), 'DSL_SYNTAX');
  const result = failure(Array.from({ length: 100 }, () => 'unknown nope').join('\n'), 'DSL_DIAGNOSTIC_BUDGET', { maxDiagnostics: 4 });
  assert.equal(result.diagnostics.length, 4);
  for (const item of result.diagnostics) {
    assert.equal(item.severity, 'error'); assert.ok(item.span.start.offset >= 0); assert.ok(item.span.start.line >= 1); assert.ok(item.span.start.column >= 1);
  }
});

test('explicit source/token/string/structure budgets halt safely and options cannot raise hard ceilings', () => {
  failure(minimal, 'DSL_SOURCE_BUDGET', { maxSourceLength: 10 });
  failure(minimal, 'DSL_TOKEN_BUDGET', { maxTokens: 3 });
  failure(minimal, 'DSL_STRING_BUDGET', { maxStringLength: 3 });
  failure(example, 'DSL_BLOCK_BUDGET', { maxBlocks: 1 });
  failure(example, 'DSL_LINE_BUDGET', { maxLines: 1 });
  failure(example, 'DSL_CHOICE_BUDGET', { maxChoices: 1 });
  failure(example, 'DSL_VARIABLE_BUDGET', { maxVariables: 1 });
  failure(minimal.replace('line first', `line "${'x'.repeat(257)}"`), 'DSL_ID_BUDGET');
  for (const options of [{ maxTokens: 100_001 }, { maxSourceLength: Infinity }, { maxBlocks: 0 }, { maxLines: 1.5 }, { fileName: 3 }, { fileName: 'x'.repeat(4097) }, null]) failure(minimal, 'DSL_OPTIONS', options);
  failure(42, 'DSL_SOURCE_BUDGET');
});

test('thousands of routing blocks and choices are scanned iteratively with bounded work', () => {
  const prefix = 'vn-script 1\ngame "large"\nversion "1"\nentry b0\n';
  const route = Array.from({ length: 3500 }, (_, i) => `block b${i}\njump b${i + 1}\n`).join('');
  const result = success(`${prefix}${route}block b3500\nline final "旁白" "完成"\nend done\n`);
  assert.equal(result.program.blocks.length, 3501); assert.equal(new ScriptEngine(result.program).initial().blockId, 'b3500');
  const choices = Array.from({ length: 2500 }, (_, i) => `choice c${i} "Choice ${i}" -> done\n`).join('');
  const wide = success(`${prefix}block b0\nline first "旁白" "选择"\n${choices}block done\nline last "旁白" "完成"\nend done\n`);
  assert.equal(wide.program.blocks[0].exit.choices.length, 2500);
  assert.equal(new ScriptEngine(wide.program).choose(new ScriptEngine(wide.program).initial(), 'c2499').blockId, 'done');
});
