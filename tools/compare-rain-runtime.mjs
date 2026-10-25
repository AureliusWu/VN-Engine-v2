import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRainRuntime } from '../dist/index.js';

const root = process.argv[2]; if (!root) throw new Error('Usage: node tools/compare-rain-runtime.mjs /path/to/Rain-snapshot [report.json]');
const story = JSON.parse(readFileSync(resolve(root, 'game/data/story.json'), 'utf8'));
const native = spawnSync(process.env.PYTHON ?? 'python', ['-c', 'import json,sys; from tools.story_model import enumerate_routes; story=json.load(open(sys.argv[1],encoding="utf-8")); print(json.dumps(enumerate_routes(story),ensure_ascii=False))', resolve(root, 'game/data/story.json')], { cwd: resolve(root), encoding: 'utf8' });
if (native.status !== 0) throw new Error(native.stderr);
const report = JSON.parse(native.stdout); assert.deepEqual(report.errors, []);
const engine = createRainRuntime(story, { game: 'rain-self-runtime-verification', version: 'v1' });
const nodes = new Map(story.nodes.map(node => [node.id, node])); let visits = 0, responses = 0;
for (const route of report.routes) {
  const expected = [], choices = [...route.choices];
  for (const id of route.path) {
    const node = nodes.get(id); expected.push(...(node.lines ?? []).map(line => line.id));
    if (node.choices) { const selected = choices.shift(); const choice = node.choices.find(choice => choice.id === selected); assert.ok(choice); expected.push(...(choice.response ?? []).map(line => line.id)); responses += choice.response?.length ?? 0; }
  }
  const actual = []; let state = engine.initial(), choiceIndex = 0, ended = false;
  for (let count = 0; count < 10000; count++) {
    const block = engine.block(state); actual.push(block.lines[state.line].id); visits++;
    if (state.line === block.lines.length - 1 && block.exit.type === 'end') {
      assert.equal(block.exit.ending, route.ending); assert.deepEqual(state.variables, route.state);
      assert.deepEqual(engine.decode(JSON.stringify(engine.encode(state))), engine.replay(state.decisions, state.blockId, state.line)); ended = true; break;
    }
    state = state.line === block.lines.length - 1 && block.exit.type === 'choice'
      ? engine.choose(state, route.choices[choiceIndex++]) : engine.advance(state);
  }
  assert.equal(ended, true); assert.deepEqual(actual, expected, 'Every original line and post-choice response keeps its exact order');
}
const result = { repository: 'Rain', sourceScenes: story.nodes.length, selfRuntimeBlocks: engine.blocks.size,
  routes: report.routes.length, paragraphVisits: visits, responseLineVisits: responses,
  checks: ['all original line IDs and post-choice responses in exact order', 'boolean/numeric final state', 'all reachable native endings', 'self-runtime save replay'],
  usesRenpyRuntime: false, result: 'passed' };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
