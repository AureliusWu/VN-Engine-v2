import {syntheticAcceptance} from './acceptance-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assessQaEvidence, validateProjectCompliance, ReleaseQaGateError } from '../dist/index.js';
import { buildQaReport } from '../tools/qa-report.mjs';
import { packageGame } from '../tools/package-game.mjs';
import { qaFixture, writeQaFixture } from './qa-fixture.mjs';

test('current AI acceptance replaces human signatures, binds source, and requires only applicable scopes', async () => {
  const {project,picture}=qaFixture(),options=await syntheticAcceptance(project,picture);
  assert.equal(assessQaEvidence(project,options).release,'PASS');
  assert.equal(assessQaEvidence(project,options).checks.find(c=>c.category==='audio').status,'N/A');
  delete project.releaseEvidence.qa;
  assert.equal(assessQaEvidence(project,options).release,'BLOCKED');
  const fresh=await syntheticAcceptance(project,picture);
  assert.equal(assessQaEvidence(project,fresh).release,'PASS');
  project.scenes[0].lines[0].text='Changed content without a story version bump';
  assert.equal(assessQaEvidence(project,fresh).release,'BLOCKED');
  assert.equal(assessQaEvidence(project).release,'BLOCKED');
});

test('QA aggregation retains independent art, human QA and actual byte failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-qa-aggregate-')), { project, picture } = qaFixture();
  project.releaseEvidence.art.room.ART_READY = 'UNVERIFIED'; project.releaseEvidence.qa.text.status = 'FAIL';
  const filename = await writeQaFixture(root, project, picture); await writeFile(join(root, 'assets/room.svg'), 'corrupted bytes');
  const report = await buildQaReport(filename);
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.structure.status, 'PASS'); assert.equal(report.art.ART_READY, 'FAIL');
  assert.equal(report.files.status, 'FAIL'); assert.match(report.files.checks[0].reason, /SHA256/);
  assert.equal(report.humanQa.checks.find(check => check.category === 'text').status, 'FAIL');
  assert.equal(report.decoding.status, 'UNVERIFIED'); assert.equal(report.scope.fullSpecCertification, false);
});

test('QA verifies the actual build bytes and rejects a stale project with the same version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-qa-build-')), { project, picture } = qaFixture(), source = await writeQaFixture(root, project, picture), output = join(root, 'game');
  const old = process.env.VN_ENGINE_COMMIT; process.env.VN_ENGINE_COMMIT = 'a'.repeat(40);
  try { await packageGame(source, output); } finally { if (old === undefined) delete process.env.VN_ENGINE_COMMIT; else process.env.VN_ENGINE_COMMIT = old; }
  const report = await buildQaReport(source, { buildDirectory: output }); assert.equal(report.build.status, 'PASS'); assert.equal(report.status, 'UNVERIFIED');
  project.title = 'Changed story without a version bump'; await writeFile(source, JSON.stringify(project));
  const stale = await buildQaReport(source, { buildDirectory: output }); assert.equal(stale.build.status, 'FAIL'); assert.match(stale.build.reason, /differs/);
  await writeFile(source, JSON.stringify(qaFixture().project)); await writeFile(join(output, 'lib/index.js'), 'corrupted runtime');
  const damaged = await buildQaReport(source, { buildDirectory: output }); assert.equal(damaged.build.status, 'FAIL'); assert.ok(damaged.build.checks.some(check => check.status === 'FAIL'));
});

test('strict QA CLI still writes a reviewable blocked report and returns a failing exit code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-qa-cli-')), { project } = qaFixture(); delete project.releaseEvidence.qa;
  const source = join(root, 'project.json'), output = join(root, 'QA_REPORT.json'); await writeFile(source, JSON.stringify(project));
  const result = spawnSync(process.execPath, ['tools/qa-report.mjs', source, '--release', '--output=' + output], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stdout, /QA_REPORT_WRITTEN/);
  const report = JSON.parse(await readFile(output, 'utf8')); assert.equal(report.status, 'BLOCKED'); assert.equal(report.files.status, 'FAIL'); assert.equal(report.humanQa.release, 'BLOCKED');
});
