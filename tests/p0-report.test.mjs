import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeEvidence, createRuntimeEvidenceReport, readRuntimeEvidenceReport, assessRuntimeEvidenceReport, createProject } from '../dist/index.js';
import { newProject } from '../dist/editor/model.js';

const sha = 'a'.repeat(64), otherSha = 'b'.repeat(64);
function fixture({ bound = true, maxBytes = 131072 } = {}) {
  const project = newProject('script');
  const evidence = new RuntimeEvidence({ sessionId: 'source-fixture', ...(bound ? { sourceSha256: sha } : {}), maxBytes });
  const instance = createProject(project, 'https://example.test/', { evidence, settings: { textDelayMs: 0 } });
  return { project, evidence, ...instance };
}
test('P0 report binds current source paths without changing driver saves or trusting imported origins', () => {
  const { project, evidence, session } = fixture();
  const before = session.save(), document = createRuntimeEvidenceReport(project, evidence.snapshot());
  const assessment = assessRuntimeEvidenceReport(project, sha, document);
  assert.equal(assessment.binding, 'current'); assert.equal(assessment.externalClaim, true);
  assert.deepEqual(assessment.report.events[0].origin.path, ['program','blocks',0,'lines',0]);
  assert.deepEqual(session.save(), before);
  const forged = structuredClone(document); forged.events[0].origin.path = ['assets', 999];
  assert.deepEqual(assessRuntimeEvidenceReport(project, sha, forged).report.events[0].origin.path, ['program','blocks',0,'lines',0]);
  assert.equal(assessRuntimeEvidenceReport(project, otherSha, document).binding, 'stale');
  assert.equal(assessRuntimeEvidenceReport(project, otherSha, document).report.events[0].origin.path, undefined);
  assert.equal(assessRuntimeEvidenceReport({ ...project, version: 'different' }, sha, document).binding, 'stale');
  assert.ok(Object.isFrozen(document.events[0].origin.path)); session.dispose();
});
test('P0 source binding does not inflate raw full-buffer bytes; no source remains explicitly unbound', () => {
  const { project, evidence, session } = fixture({ bound: false, maxBytes: 1024 });
  for (let i = 0; i < 50; i++) evidence.append({ type: 'effect', visit: 1, sceneId: 'start', lineId: 'start-1', effect: 'stage.sound', phase: 'failed', code: 'x'.repeat(100) });
  const raw = evidence.snapshot(), document = createRuntimeEvidenceReport(project, raw, sha);
  assert.equal(document.bytes, raw.bytes); assert.ok(document.bytes <= document.maxBytes);
  assert.equal(assessRuntimeEvidenceReport(project, sha, document).binding, 'current'); assert.equal(document.truncated, true);
  const unbound = createRuntimeEvidenceReport(project, raw);
  assert.equal(assessRuntimeEvidenceReport(project, sha, unbound).binding, 'unbound'); session.dispose();
});
test('P0 imported report rejects corruption, mismatched identities and accessors without invoking them', () => {
  const { project, evidence, session } = fixture(); const original = createRuntimeEvidenceReport(project, evidence.snapshot());
  for (const mutate of [
    value => { value.bytes++; }, value => { value.events[0].sessionId = 'other'; },
    value => { value.events[0].sequence = value.nextSequence; }, value => { value.scope.audioDevice = true; },
    value => { value.events[0].sourceSha256 = otherSha; }, value => { value.unknown = true; },
    value => { value.events[0].origin.path = ['x'.repeat(4_000_001)]; }
  ]) { const value = structuredClone(original); mutate(value); assert.throws(() => readRuntimeEvidenceReport(value)); }
  let calls = 0; const value = { ...original }; Object.defineProperty(value, 'game', { get() { calls++; return 'x'; } });
  assert.throws(() => readRuntimeEvidenceReport(value)); assert.equal(calls, 0);
  assert.throws(() => createRuntimeEvidenceReport(project, evidence.snapshot(), otherSha)); session.dispose();
});

test('P0 full legal collector reports remain exportable when repeated source origins reach the document budget', () => {
  const project = newProject('script');
  project.game = 'g'.repeat(500); project.version = 'v'.repeat(500);
  project.program.game = project.game; project.program.version = project.version;
  const evidence = new RuntimeEvidence({ sessionId: 'full-origin-budget', sourceSha256: sha, maxEvents: 4096, maxBytes: 1048576 });
  for (let index = 0; index < 4096; index++) evidence.append({ type: 'lifecycle', visit: 1 });
  const raw = evidence.snapshot();
  assert.equal(raw.events.length, 4096); assert.equal(raw.truncated, false);
  const document = createRuntimeEvidenceReport(project, raw);
  assert.ok(new TextEncoder().encode(JSON.stringify(document)).byteLength <= 4_000_000);
  assert.ok(document.events.length > 0 && document.events.length < raw.events.length);
  assert.equal(document.truncated, true);
  assert.equal(document.dropped, raw.dropped + raw.events.length - document.events.length);
  assert.equal(document.firstSequence, document.events[0].sequence);
  assert.equal(document.nextSequence, raw.nextSequence);
  assert.equal(document.events.at(-1).sequence, raw.events.at(-1).sequence);
  assert.ok(document.bytes <= document.maxBytes);
  assert.deepEqual(readRuntimeEvidenceReport(document), document);
  assert.equal(assessRuntimeEvidenceReport(project, sha, document).binding, 'current');
  assert.equal(evidence.snapshot().events.length, raw.events.length);
  assert.equal(evidence.snapshot().bytes, raw.bytes);
});
