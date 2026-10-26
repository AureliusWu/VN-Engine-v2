import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GALGAME_SPEC_CONTRACT, validateProjectCompliance } from '../dist/index.js';

function project(text = '正式文本') {
  return {
    schema: 1,
    game: 'spec-fixture',
    version: 'v1',
    title: 'SPEC fixture',
    type: 'narrative',
    assets: [{ id: 'room', kind: 'background', src: 'assets/room.webp' }],
    scenes: [{ id: 'start', background: 'room', lines: [{ id: 'line-1', speaker: '旁白', text }], ending: 'END' }],
  };
}

test('GALGAME SPEC project gate validates identity, formal text and asset references', () => {
  const report = validateProjectCompliance(project());
  assert.equal(report.contract, GALGAME_SPEC_CONTRACT);
  assert.equal(report.game, 'spec-fixture');
  assert.equal(report.assets, 1);
  assert.equal(report.references, 1);
  assert.deepEqual(report.endings, ['END']);

  const missing = project(); missing.scenes[0].background = 'missing';
  assert.throws(() => validateProjectCompliance(missing), /Missing or mismatched asset reference/);
});

test('release compliance rejects placeholder text while development reports it', () => {
  const draft = project('TODO replace this line');
  assert.equal(validateProjectCompliance(draft).warnings.length, 1);
  assert.throws(() => validateProjectCompliance(draft, { mode: 'release' }), /Placeholder text/);
});
