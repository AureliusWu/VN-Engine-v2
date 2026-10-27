import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildQaReport } from '../tools/qa-report.mjs';
import { runReleaseGate } from '../tools/release-gate.mjs';
import { qaFixture, writeQaFixture } from './qa-fixture.mjs';

const root = await mkdtemp(join(tmpdir(), 'vn-qa-decode-')), { project, picture } = qaFixture(), source = await writeQaFixture(root, project, picture);
const valid = await buildQaReport(source, { decode: true }); assert.equal(valid.decoding.status, 'PASS'); assert.equal(valid.status, 'PASS');
assert.equal(valid.decoding.checks[0].width, 2);
const old = { commit: process.env.VN_ENGINE_COMMIT, github: process.env.GITHUB_SHA };
try {
  process.env.VN_ENGINE_COMMIT = 'a'.repeat(40); delete process.env.GITHUB_SHA;
  const gate = await runReleaseGate(source, { outputDirectory: join(root, 'release') });
  assert.equal(gate.status, 'PASS'); assert.equal(gate.report.build.status, 'PASS'); assert.equal(gate.report.humanQa.release, 'PASS');
  await assert.rejects(runReleaseGate(source, { outputDirectory: join(root, 'release') }), /existing files/);
  const cli = spawnSync(process.execPath, ['tools/release-gate.mjs', source, '--output=' + join(root, 'release-cli')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout); assert.match(cli.stdout, /RELEASE_GATE_REPORT.*"status":"PASS"/);
} finally {
  if (old.commit === undefined) delete process.env.VN_ENGINE_COMMIT; else process.env.VN_ENGINE_COMMIT = old.commit;
  if (old.github === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = old.github;
}
const broken = Buffer.from('this is not an image'); project.assets[0].sha256 = createHash('sha256').update(broken).digest('hex'); project.releaseEvidence.art.room.runtimeSha256 = project.assets[0].sha256;
await writeFile(join(root, 'assets/room.svg'), broken); await writeFile(source, JSON.stringify(project));
const invalid = await buildQaReport(source, { decode: true }); assert.equal(invalid.files.status, 'PASS'); assert.equal(invalid.art.TECH_READY, 'PASS');
assert.equal(invalid.decoding.status, 'FAIL'); assert.equal(invalid.status, 'BLOCKED');
console.log('PASS QA decodes real local image bytes and blocks undecodable files even when declared hashes and human labels pass');
