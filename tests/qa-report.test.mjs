import {syntheticAcceptance} from './acceptance-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assessQaEvidence, validateProjectCompliance, ReleaseQaGateError } from '../dist/index.js';
import { buildQaReport } from '../tools/qa-report.mjs';
import { packageGame } from '../tools/package-game.mjs';
import { qaFixture, writeQaFixture } from './qa-fixture.mjs';
import { createHash } from 'node:crypto';
import { fingerprintFiles, renderWorker } from '../tools/pwa.mjs';

// Keep byte checks valid so each case exercises dependency closure, not a stale checksum.
async function refreshBuild(output, changeWorker = text => text) {
  const filename = join(output, 'build-manifest.json'), manifest = JSON.parse(await readFile(filename, 'utf8'));
  const files = await Promise.all(manifest.files.filter(entry => entry.name !== 'sw.js').map(async entry => ({ name: entry.name, bytes: await readFile(join(output, entry.name)) })));
  manifest.contentFingerprint = fingerprintFiles(files);
  const worker = changeWorker(renderWorker({ namespace: 'vn-self-' + manifest.game, version: manifest.contentFingerprint, urls: files.map(file => file.name) }));
  await writeFile(join(output, 'sw.js'), worker);
  for (const entry of manifest.files) {
    const bytes = await readFile(join(output, entry.name));
    entry.size = bytes.length; entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(filename, JSON.stringify(manifest));
}

test('R4-B004: current checksums cannot hide broken startup, CSS, web manifest or offline cache references', async t => {
  const cases = [
    ['html-startup', async output => {
      const file = join(output, 'index.html'); await writeFile(file, (await readFile(file, 'utf8')).replace('./app.mjs', './missing-entry.mjs'));
    }, /missing-entry\.mjs/],
    ['html-no-loader', async output => {
      const file = join(output, 'index.html'); await writeFile(file, (await readFile(file, 'utf8')).replace(/<script[^>]*><\/script>/, ''));
    }, /module entry/],
    ['css-resource', async output => {
      const file = join(output, 'index.html'); await writeFile(file, (await readFile(file, 'utf8')).replace('</style>', '.scene{background:url(./missing-image.png)}</style>'));
    }, /missing-image\.png/],
    ['manifest-icon', async output => {
      const file = join(output, 'manifest.webmanifest'), manifest = JSON.parse(await readFile(file, 'utf8')); manifest.icons[0].src = 'missing-icon.svg'; await writeFile(file, JSON.stringify(manifest));
    }, /missing-icon\.svg/],
    ['manifest-start', async output => {
      const file = join(output, 'manifest.webmanifest'), manifest = JSON.parse(await readFile(file, 'utf8')); manifest.start_url = './missing-start.html'; await writeFile(file, JSON.stringify(manifest));
    }, /missing-start\.html/],
    ['offline-cache', async () => {}, /cache|worker/i, text => text.replace('"app.mjs",', '')],
    ['offline-stale-fingerprint', async () => {}, /worker|fingerprint/i, text => text.replace(/^const CACHE = .*$/m, 'const CACHE = PREFIX + "stale-version";')]
  ];
  for (const [name, damage, reason, changeWorker] of cases) await t.test(name, async t => {
    const root = await mkdtemp(join(tmpdir(), 'vn-build-dependencies-')); t.after(() => rm(root, { recursive: true, force: true }));
    const fixture = qaFixture(), source = await writeQaFixture(root, fixture.project, fixture.picture), output = join(root, 'game');
    const previous = process.env.VN_ENGINE_COMMIT; process.env.VN_ENGINE_COMMIT = 'a'.repeat(40);
    try { await packageGame(source, output); } finally { if (previous === undefined) delete process.env.VN_ENGINE_COMMIT; else process.env.VN_ENGINE_COMMIT = previous; }
    await damage(output); await refreshBuild(output, changeWorker);
    const before = await readFile(join(output, 'build-manifest.json')), report = await buildQaReport(source, { buildDirectory: output });
    assert.equal(report.build.status, 'FAIL', name); assert.match(report.build.reason, reason);
    assert.deepEqual(await readFile(join(output, 'build-manifest.json')), before, 'Inspection preserves the inspected artifact');
  });
});

test('build dependency resolution accepts local query/fragment URLs and inline data without leaving the package scope', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vn-build-urls-')); t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = qaFixture(), source = await writeQaFixture(root, fixture.project, fixture.picture), output = join(root, 'game');
  const previous = process.env.VN_ENGINE_COMMIT; process.env.VN_ENGINE_COMMIT = 'a'.repeat(40);
  try { await packageGame(source, output); } finally { if (previous === undefined) delete process.env.VN_ENGINE_COMMIT; else process.env.VN_ENGINE_COMMIT = previous; }
  const file = join(output, 'index.html');
  await writeFile(file, (await readFile(file, 'utf8')).replace('./app.mjs', './app.mjs?v=1#start').replace('</style>', '.scene{background:url(./icon.svg#scene)}.inline{background:url(data:image/svg+xml;base64,PHN2Zy8+)}</style>'));
  await refreshBuild(output);
  assert.equal((await buildQaReport(source, { buildDirectory: output })).build.status, 'PASS');
});

test('R4-B005: directory aliases preserve current acceptance without weakening asset boundaries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vn-qa-alias-')); t.after(() => rm(root, { recursive: true, force: true }));
  const actual = join(root, 'actual'), alias = join(root, 'alias'); await mkdir(actual);
  const fixture = qaFixture(), source = await writeQaFixture(actual, fixture.project, fixture.picture);
  await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const direct = await buildQaReport(source), throughAlias = await buildQaReport(join(alias, 'project.json'));
  assert.equal(direct.contentReview.release, 'PASS');
  assert.equal(throughAlias.contentReview.release, 'PASS', JSON.stringify(throughAlias.contentReview));
  assert.equal(throughAlias.status, direct.status); assert.deepEqual(throughAlias.project, direct.project);
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'room.svg'), fixture.picture);
  await rm(join(actual, 'assets'), { recursive: true });
  await symlink(outside, join(actual, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  const escaped = await buildQaReport(join(alias, 'project.json'));
  assert.equal(escaped.contentReview.release, 'BLOCKED'); assert.equal(escaped.files.status, 'FAIL');
});

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
