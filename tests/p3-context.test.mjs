import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTextScript, checkTextScriptProject } from '../dist/script/text.js';

const source = cues => 'vn-script 1\ngame "p3-context"\nversion "1"\nentry start\n' + cues.join('\n')
  + '\nblock start\nline hello "旁白" "上下文检查"\nend done\n';
const compile = cues => {
  const text = source(cues), result = compileTextScript(text, { fileName: '中文-context.vn' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return { text, result };
};
const context = assets => ({ type: 'script', game: 'p3-context', version: '1', assets });
const failure = (result, code) => {
  assert.equal(result.ok, false); assert.equal(Object.hasOwn(result, 'program'), false);
  assert.ok(result.diagnostics.some(item => item.code === code), JSON.stringify(result.diagnostics));
};

test('project context checks only declared asset IDs and kinds without reading src or host data', () => {
  const { result } = compile([
    'cue block start background "背景/教室 #一"', 'cue block start portrait "人物/甲"', 'cue block start cg "CG:相遇"',
    'cue block start music music', 'cue line hello ambience ambience', 'cue line hello sound sound', 'cue line hello voice "语音/甲 #1"'
  ]);
  const assets = [['背景/教室 #一', 'background'], ['人物/甲', 'portrait'], ['CG:相遇', 'cg'], ['music', 'audio'],
    ['ambience', 'audio'], ['sound', 'audio'], ['语音/甲 #1', 'audio'], ['unreferenced/ui', 'ui'], ['unreferenced/font', 'font'],
    ['unreferenced/video', 'video'], ['__proto__', 'ui'], ['   ', 'ui']].map(([id, kind]) => ({ id, kind,
      get src() { throw Error('Context checking must not read paths or asset bytes'); } }));
  const checked = checkTextScriptProject(result, context(assets));
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  assert.deepEqual(checked.program, result.program);
  assert.deepEqual(checked.projectContext, { checked: true, game: 'p3-context', version: '1', assetCount: assets.length });
});

test('missing block and line assets retain exact candidate cue spans and program-relative paths', () => {
  const declarations = ['cue block start background missing-room', 'cue line hello voice "缺少/语音"'];
  const { text, result } = compile(declarations), checked = checkTextScriptProject(result, context([]));
  failure(checked, 'DSL_ASSET_MISSING');
  assert.equal(checked.diagnostics.length, 2);
  for (const [index, path] of [['blocks', 0, 'cue', 'background'], ['blocks', 0, 'lines', 0, 'cue', 'voice']].entries()) {
    const item = checked.diagnostics[index], mapped = result.sourceMap.find(entry => entry.kind === 'cue' && JSON.stringify(entry.path) === JSON.stringify(path));
    assert.deepEqual(item.path, path); assert.deepEqual(item.span, mapped.span); assert.equal(item.fileName, '中文-context.vn');
    assert.equal(text.slice(item.span.start.offset, item.span.end.offset), declarations[index]);
    assert.equal(item.blockId, 'start'); assert.equal(item.lineId, index ? 'hello' : undefined);
    assert.deepEqual(item.origin, { game: 'p3-context', storyVersion: '1', nodeId: 'start', ...(index ? { lineId: 'hello' } : {}),
      assetId: index ? '缺少/语音' : 'missing-room', path: ['program', ...path] });
    assert.equal(Object.hasOwn(item.origin, 'sourceSha256'), false);
  }
});

test('visual assets and all four audio cues require their declared runtime kinds', () => {
  for (const [field, expected, actual] of [['background', 'background', 'portrait'], ['portrait', 'portrait', 'cg'], ['cg', 'cg', 'background'],
    ['music', 'audio', 'video'], ['ambience', 'audio', 'ui'], ['sound', 'audio', 'background'], ['voice', 'audio', 'font']]) {
    const { result } = compile([`cue line hello ${field} shared`]);
    const checked = checkTextScriptProject(result, context([{ id: 'shared', kind: actual }]));
    failure(checked, 'DSL_ASSET_KIND');
    assert.equal(checked.diagnostics.length, 1); assert.equal(checked.diagnostics[0].assetId, 'shared');
    assert.ok(checked.diagnostics[0].message.includes(expected));
    assert.deepEqual(checked.diagnostics[0].path, ['blocks', 0, 'lines', 0, 'cue', field]);
  }
});

test('persistent null clears have no resource dependency while a quoted null ID remains an asset', () => {
  const { result } = compile(['background', 'portrait', 'cg', 'music', 'ambience'].map(field => `cue block start ${field} null`));
  assert.equal(checkTextScriptProject(result, context([])).ok, true);
  const quoted = compile(['cue line hello background "null"']).result;
  failure(checkTextScriptProject(quoted, context([])), 'DSL_ASSET_MISSING');
  assert.equal(checkTextScriptProject(quoted, context([{ id: 'null', kind: 'background' }])).ok, true);
});

test('project type and identity must match without replacing the current project or candidate', () => {
  const { result } = compile([]);
  for (const changes of [{ type: 'narrative' }, { game: 'other-game' }, { version: 'other-version' }]) {
    const project = { ...context([]), ...changes }, original = structuredClone(project);
    const checked = checkTextScriptProject(result, project);
    failure(checked, 'DSL_PROJECT_IDENTITY'); assert.equal(checked.projectContext.checked, false);
    assert.deepEqual(project, original);
    const field = changes.game ? 'game' : changes.version ? 'version' : undefined;
    const mapping = result.sourceMap.find(item => item.kind === 'program' && JSON.stringify(item.path) === JSON.stringify(field ? [field] : []));
    assert.deepEqual(checked.diagnostics[0].span, mapping.span);
  }
  assert.equal(result.ok, true); assert.ok(result.program);
});

test('invalid or duplicate catalogs are rejected and IDs have only the documented nonempty size bound', () => {
  const { result } = compile([]);
  const invalidAssets = [null, {}, Array(1), [{ id: '', kind: 'audio' }], [{ id: 'a'.repeat(4097), kind: 'audio' }],
    [{ id: 42, kind: 'audio' }], [{ id: 'a', kind: 'unknown' }], [{ id: 'a', kind: 'audio' }, { id: 'a', kind: 'portrait' }],
    Array.from({ length: 10001 }, (_, index) => ({ id: String(index), kind: 'ui' }))];
  for (const assets of invalidAssets) failure(checkTextScriptProject(result, context(assets)), 'DSL_PROJECT_CONTEXT');
  for (const value of [null, [], {}, { ...context([]), type: 3 }, { ...context([]), game: '' }, { ...context([]), version: '' }])
    failure(checkTextScriptProject(result, value), 'DSL_PROJECT_CONTEXT');
  const valid = [{ id: 'a'.repeat(4096), kind: 'audio' }, { id: '特殊/未引用 ?#%\\', kind: 'ui' }];
  assert.equal(checkTextScriptProject(result, context(valid)).ok, true);
  let calls = 0;
  const getter = { get id() { calls++; return 'a'; }, kind: 'audio' };
  failure(checkTextScriptProject(result, context([getter])), 'DSL_PROJECT_CONTEXT'); assert.equal(calls, 0);
});

test('context validation is detached and preserves original syntax failures without inferring an IR', () => {
  const { result } = compile(['cue line hello voice spoken']), project = context([{ id: 'spoken', kind: 'audio' }]);
  const original = structuredClone(result), originalProject = structuredClone(project);
  const checked = checkTextScriptProject(result, project);
  checked.program.blocks[0].lines[0].text = 'Changed returned candidate'; checked.sourceMap[0].span.start.offset = 99;
  checked.projectContext.game = 'Changed result summary';
  assert.deepEqual(result, original); assert.deepEqual(project, originalProject);
  const broken = compileTextScript('vn-script 1\nexecute arbitrary\n'), before = structuredClone(broken);
  const inaccessible = { get type() { throw Error('Syntax failures must not inspect a project'); }, get assets() { throw Error('No candidate IR'); } };
  const failed = checkTextScriptProject(broken, inaccessible);
  assert.deepEqual(failed.diagnostics, broken.diagnostics); assert.deepEqual(failed.sourceMap, broken.sourceMap);
  assert.deepEqual(failed.projectContext, { checked: false }); assert.deepEqual(broken, before);
  assert.equal(Object.hasOwn(failed, 'program'), false);
});

test('merged diagnostics are bounded and exhausting warnings or asset errors cannot produce success', () => {
  const { result } = compile(['cue block start music absent-a', 'cue line hello voice absent-b']);
  const checked = checkTextScriptProject(result, context([]), { maxDiagnostics: 1 });
  failure(checked, 'DSL_DIAGNOSTIC_BUDGET'); assert.equal(checked.diagnostics.length, 1);
  const onlyOne = checkTextScriptProject(compile(['cue line hello voice absent']).result, context([]), { maxDiagnostics: 1 });
  failure(onlyOne, 'DSL_ASSET_MISSING'); assert.equal(onlyOne.diagnostics.length, 1);
  const withWarning = compileTextScript(source(['cue line hello voice absent']) + '\nblock unused\nline unused-line "N" "Unused"\nend unused\n');
  assert.equal(withWarning.ok, true); assert.equal(withWarning.diagnostics[0].severity, 'warning');
  const merged = checkTextScriptProject(withWarning, context([]), { maxDiagnostics: 1 });
  failure(merged, 'DSL_DIAGNOSTIC_BUDGET'); assert.equal(merged.diagnostics.length, 1);
  for (const maxDiagnostics of [0, 101, -1, 1.5, Infinity, NaN, '1'])
    failure(checkTextScriptProject(result, context([]), { maxDiagnostics }), 'DSL_OPTIONS');
  failure(checkTextScriptProject(result, context([]), null), 'DSL_OPTIONS');
});
