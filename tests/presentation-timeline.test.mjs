import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetCatalog, resolvePresentationTimeline, settlePresentationTimeline, validatePresentationTimeline, validateProjectCompliance } from '../dist/index.js';

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
});
