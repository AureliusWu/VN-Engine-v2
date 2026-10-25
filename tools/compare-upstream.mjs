/** Read-only differential checks against explicitly supplied source snapshots. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { createHealingEngine, createNetLoveEngine, createHealingSaveCodec, createNetLoveSaveCodec,
  healingPresentationAt, netlovePresentationAt, InvestigationEngine } from '../dist/index.js';

const args = process.argv.slice(2), sourceRoot = args.find(arg => !arg.startsWith('--'));
if (!sourceRoot) throw new Error('Usage: npm run verify:upstream -- /path/to/snapshots [--out=report.json]');

// Only development-time, user-owned TS modules are evaluated. Runtime story JSON
// never runs code. Circuit artwork decorators are deliberately outside this check.
function loader(root, stubs = {}) {
  const cache = new Map();
  function load(path) {
    if (stubs[path]) return stubs[path];
    const filename = [path, path + '.ts', path + '.json', path + '/index.ts'].find(file => existsSync(file) && /\.(ts|json)$/.test(file));
    if (!filename || !filename.startsWith(root + '/')) throw new Error('Unsupported upstream import: ' + path);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    if (filename.endsWith('.json')) module.exports = JSON.parse(readFileSync(filename, 'utf8'));
    else {
      const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
      const requireLocal = specifier => {
        if (!specifier.startsWith('.')) throw new Error('Nonlocal upstream import: ' + specifier);
        return load(resolve(dirname(filename), specifier));
      };
      new Function('require', 'exports', 'module', code)(requireLocal, module.exports, module);
    }
    return module.exports;
  }
  return file => load(resolve(root, file));
}

const report = { schema: 1, checkedAt: new Date().toISOString(), checks: [], excludes: ['UI/media decorators', 'native Windows execution', 'RenPy execution (separate Python comparison)'] };
for (const [repo, factory, codecFor, presentation] of [
  ['Healing', createHealingEngine, createHealingSaveCodec, healingPresentationAt],
  ['NetLove', createNetLoveEngine, createNetLoveSaveCodec, netlovePresentationAt]
]) {
  const load = loader(resolve(sourceRoot, repo));
  const scenes = load('src/story/index.ts').scenes, original = load('src/game/engine.ts');
  const originalPresentation = load('src/game/presentation.ts').presentationAt;
  const engine = factory(scenes), codec = codecFor(engine), visited = new Set(), terminals = [];
  let positions = 0;
  function explore(native, extracted) {
    for (let steps = 0; steps < 10000; steps++) {
      assert.deepEqual(extracted, native, `${repo}: state parity`);
      const scene = original.getScene(native), other = engine.getScene(extracted); positions++; visited.add(scene.id);
      assert.deepEqual(other, scene, `${repo}: scene/text variants`);
      assert.deepEqual(presentation(other, extracted.line), originalPresentation(scene, native.line), `${repo}: presentation`);
      if (native.line === scene.lines.length - 1) {
        if (scene.choices) {
          for (const choice of scene.choices) explore(original.choose(native, choice.id), engine.choose(extracted, choice.id));
          return;
        }
        if (scene.continuation) { native = original.continueStory(native); extracted = engine.continueStory(extracted); continue; }
        if (scene.ending || scene.chapterEnd) {
          assert.deepEqual(engine.replay(native.decisions, native.sceneId, native.line), original.replay(native.decisions, native.sceneId, native.line));
          const save = { schema: 1, game: engine.config.game, savedAt: '2026-10-25T00:00:00.000Z', state: { ...native, stats: {}, history: [] } };
          assert.deepEqual(codec.decode(JSON.stringify(save)).state, original.replay(native.decisions, native.sceneId, native.line));
          terminals.push(scene.ending ?? scene.id); return;
        }
      }
      const next = original.advance(native);
      if (next.sceneId === native.sceneId && next.line === native.line) throw new Error('Unexpected route stop');
      native = next; extracted = engine.advance(extracted);
    }
    throw new Error('Route comparison budget exceeded');
  }
  explore(original.newGame(), engine.newGame());
  assert.equal(visited.size, scenes.length, `${repo}: all authored scenes covered`);
  report.checks.push({ repository: repo, scenes: visited.size, paragraphVisits: positions, fullRoutes: terminals.length, endings: [...new Set(terminals)], result: 'passed' });
  console.log(repo, JSON.stringify(report.checks.at(-1)));
}

{
  const root = resolve(sourceRoot, 'Circuit');
  const load = loader(root, { [resolve(root, 'src/game/fullMedia')]: { withFullMedia: chapter => chapter }, [resolve(root, 'src/game/characters')]: { getCharacter: () => null } });
  const original = load('src/story/engine.ts'), chapters = Object.values(original.CHAPTERS);
  const engine = new InvestigationEngine(chapters);
  let states = 0, actions = 0;
  for (const chapter of chapters) {
    assert.deepEqual(engine.initial(chapter.id), original.createInitialState(chapter.id));
    for (const state of engine.explore(chapter.id)) {
      states++;
      assert.equal(original.isGameState(state), true);
      assert.deepEqual(engine.actions(state), original.getAvailableActions(state));
      for (const action of engine.actions(state)) {
        assert.deepEqual(engine.transition(state, action.id), original.transition(state, action.id)); actions++;
      }
    }
  }
  report.checks.push({ repository: 'Circuit', chapters: chapters.length, inventoryStates: states, actionTransitions: actions, result: 'passed' });
  console.log('Circuit', JSON.stringify(report.checks.at(-1)));
}
const out = args.find(arg => arg.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
