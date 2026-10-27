import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateKeyVisual, validateProjectCompliance, assessProductionArt } from '../dist/index.js';
import { newProject, diagnoseProject } from '../dist/editor/index.js';

test('Key Visual requires a bounded lifetime and an explicitly eligible fullscreen scene', () => {
  const cue = { asset: 'brand', scope: 'banner', sceneType: 'story', durationMs: 1000 };
  assert.doesNotThrow(() => validateKeyVisual(cue));
  assert.throws(() => validateKeyVisual({ ...cue, durationMs: 0 }));
  assert.throws(() => validateKeyVisual({ ...cue, durationMs: Infinity }));
  assert.throws(() => validateKeyVisual({ ...cue, scope: 'fullscreen' }), /presentation scene/);
  assert.doesNotThrow(() => validateKeyVisual({ ...cue, scope: 'fullscreen', sceneType: 'transition' }));
});

test('Key Visual is a one-visit cue, validates UI references and cannot repeat through global defaults', () => {
  const project = newProject('script'); project.assets = [{ id: 'brand', kind: 'ui', src: 'brand.svg' }];
  project.program.blocks[0].cue = { keyVisual: { asset: 'brand', scope: 'banner', sceneType: 'story', durationMs: 1000 } };
  project.program.blocks[0].lines.push({ id: 'second', speaker: 'N', text: 'second' });
  const { session } = createProject(project, 'https://test.invalid/');
  assert.equal(session.getView().frame.stage.keyVisual.asset, 'brand'); session.next(); session.next();
  assert.equal(session.getView().frame.stage.keyVisual, undefined); session.dispose();
  assert.equal(validateProjectCompliance(project).references, 1);
  project.defaults = project.program.blocks[0].cue;
  assert.throws(() => validateProjectCompliance(project), /global defaults/);
  assert.ok(diagnoseProject(project).some(item => item.code === 'key-visual'));
  const report = assessProductionArt(project, ['brand'], { keyVisualUsed: true });
  assert.equal(report.KEY_VISUAL_LIFECYCLE, 'FAIL');
});
