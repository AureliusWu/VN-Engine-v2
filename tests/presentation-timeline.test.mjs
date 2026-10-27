import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog, createProject, resolvePresentationTimeline, settlePresentationTimeline, validatePresentationTimeline, validateProjectCompliance } from '../dist/index.js';

test('presentation timeline resolves movement, scale, opacity and camera deterministically', () => {
  const timeline = {
    durationMs: 1000,
    animations: [{ id: 'hero-enter', layer: 'character', target: 'hero', from: { x: -100, scale: 1, opacity: 0 }, to: { x: 0, scale: 1.2, opacity: 1 }, durationMs: 1000 }],
    camera: [{ atMs: 0, x: 0, y: 0, scale: 1 }, { atMs: 1000, x: 20, y: -10, scale: 1.5 }]
  };
  const half = resolvePresentationTimeline(timeline, 500);
  assert.equal(half.timeMs, 500);
  assert.equal(half.animations[0].progress, .5);
  assert.deepEqual(half.animations[0].transform, { x: -50, y: 0, scale: 1.1, opacity: .5 });
  assert.deepEqual(half.camera, { x: 10, y: -5, scale: 1.25 });
});

test('skip and reduced-motion settle presentation timelines to their final state', () => {
  const timeline = { durationMs: 900, animations: [{ id: 'cg', layer: 'cg', from: { opacity: 0 }, to: { opacity: 1, scale: 1.1 }, startMs: 100, durationMs: 800 }] };
  const settled = settlePresentationTimeline(timeline);
  assert.equal(settled.settled, true);
  assert.equal(settled.animations[0].progress, 1);
  assert.deepEqual(settled.animations[0].transform, { x: 0, y: 0, scale: 1.1, opacity: 1 });
  assert.deepEqual(resolvePresentationTimeline(timeline, 0, { reducedMotion: true }), settled);
});

test('timeline authoring rejects duplicate IDs, invalid scale and out-of-range tracks', () => {
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, animations: [
    { id: 'a', layer: 'character', to: { x: 1 }, durationMs: 50 },
    { id: 'a', layer: 'cg', to: { x: 2 }, durationMs: 50 }
  ] }));
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, animations: [{ id: 'a', layer: 'character', to: { scale: 0 }, durationMs: 50 }] }));
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, animations: [{ id: 'a', layer: 'character', to: { x: 1 }, startMs: 80, durationMs: 30 }] }));
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, animations: [{ id: 'a', layer: 'character', to: { opacity: 2 }, durationMs: 100 }] }));
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, animations: [{ id: 'a', layer: 'character', to: { x: NaN }, durationMs: 100 }] }));
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, camera: [{ atMs: 0, x: Infinity }] }));
  assert.throws(() => validatePresentationTimeline({ durationMs: 100, animations: [{ id: 'a', layer: 'ui', target: 'hero', to: { x: 1 }, durationMs: 100 }] }), /Only visual asset layers/);
});

test('video is a first-class asset kind and compliance validates video fallback references', () => {
  const assets = [
    { id: 'opening', kind: 'video', src: 'opening.webm' },
    { id: 'opening-fallback', kind: 'cg', src: 'opening.webp' }
  ];
  const catalog = new AssetCatalog(assets, 'https://example.invalid/game/');
  assert.equal(catalog.get('opening', 'video').kind, 'video');
  const project = {
    schema: 1, game: 'timeline-demo', version: '1.0.0', title: 'Timeline demo', assets, type: 'script',
    defaults: { video: { asset: 'opening', fallback: { asset: 'opening-fallback', kind: 'cg' } }, timeline: { durationMs: 100 } },
    program: { schema: 1, game: 'timeline-demo', version: '1.0.0', entry: 'start', variables: {}, blocks: [{ id: 'start', lines: [{ id: 'line-1', speaker: 'Narrator', text: 'ready' }], exit: { type: 'end', ending: 'done' } }] }
  };
  assert.equal(validateProjectCompliance(project).references, 2);
  project.defaults.video.fallback.asset = 'missing';
  assert.throws(() => validateProjectCompliance(project), /Missing or mismatched asset reference/);
  project.defaults.video.fallback.asset = 'opening-fallback'; project.defaults.video.asset = '';
  assert.throws(() => validateProjectCompliance(project), /Invalid video cue/);
  project.defaults.video.asset = 'opening'; project.defaults.video.fallback.kind = 'audio';
  assert.throws(() => validateProjectCompliance(project), /Invalid video fallback/);
});

test('timeline, video and visual layers reach real driver frames without persisting one-shot cues', () => {
  const timeline = { durationMs: 100, animations: [{ id: 'move', layer: 'character-front', target: 'hero', to: { x: 20 }, durationMs: 100 }] };
  const project = { schema: 1, game: 'cue-test', version: 'v1', title: 'Cue test', type: 'narrative', settings: { textDelayMs: 0 },
    assets: [{ id: 'hero', kind: 'portrait', src: 'hero.svg' }, { id: 'clip', kind: 'video', src: 'clip.webm' }],
    stage: { lines: { first: { layers: { 'character-front': { asset: 'hero', kind: 'portrait' } }, timeline, video: { asset: 'clip' } } } },
    scenes: [{ id: 'start', lines: [{ id: 'first', speaker: 'Narrator', text: 'one' }, { id: 'second', speaker: 'Narrator', text: 'two' }], ending: 'done' }] };
  const { session } = createProject(project, 'https://example.invalid/');
  assert.deepEqual(session.getSnapshot().frame.stage.timeline, timeline);
  assert.equal(session.getSnapshot().frame.stage.video.asset, 'clip');
  session.next(); const cue = session.getSnapshot().frame.stage;
  assert.equal(cue.layers['character-front'].asset, 'hero');
  assert.equal(cue.timeline, undefined); assert.equal(cue.video, undefined);
  assert.equal(cue.presentationState.layers['character-front'].transform.x, 20);
  const saved = session.save(); session.restart(); session.restore(saved);
  assert.equal(session.getSnapshot().frame.stage.presentationState.layers['character-front'].transform.x, 20);
  assert.equal(validateProjectCompliance(project).references, 3);
  project.stage.lines.first.timeline.animations[0].target = 'missing';
  assert.throws(() => validateProjectCompliance(project), /Missing or mismatched asset reference/);
  project.stage.lines.first.timeline.animations[0].target = 'hero';
  project.stage.lines.first.layers['character-front'].asset = 'missing';
  assert.throws(() => validateProjectCompliance(project), /Missing or mismatched asset reference/);
  session.dispose();
});
