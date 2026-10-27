import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ReleaseArtGateError, validateProjectCompliance } from '../dist/index.js';
import { packageGame } from '../tools/package-game.mjs';

const picture = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
const hash = createHash('sha256').update(picture).digest('hex');
function fixture() {
  const review = { TECH_READY: 'PASS', ART_READY: 'PASS', VISUAL_IDENTITY_PASS: 'PASS', COMPOSITION_PASS: 'PASS', STYLE_PASS: 'PASS',
    SCENE_INTEGRATION_PASS: 'PASS', MOBILE_PASS: 'PASS', DESKTOP_PASS: 'PASS', PROVENANCE_PASS: 'PASS',
    reviewer: 'test fixture reviewer', reviewedAt: '2026-10-27', source: 'synthetic test fixture', runtimeSha256: hash,
    evidence: { desktop: 'test://desktop', mobile: 'test://mobile', provenance: 'test://provenance' } };
  return { schema: 1, game: 'art-gate-test', version: 'v1', title: 'Art gate fixture', type: 'narrative',
    assets: [{ id: 'room', kind: 'background', src: 'assets/room.svg', sha256: hash, status: 'READY' }],
    scenes: [{ id: 'start', background: 'room', lines: [{ id: 'line', speaker: 'Narrator', text: 'sample' }], ending: 'done' }],
    releaseEvidence: { targets: { mobile: true, pwa: true, desktop: true }, mobilePhysicalDevice: { status: 'PASS', kind: 'physical', device: 'test device', reviewer: 'test reviewer', reviewedAt: '2026-10-27', evidence: 'test://physical' }, art: { room: review } } };
}
function blocked(project, predicate) {
  assert.throws(() => validateProjectCompliance(project, { mode: 'release' }), error => error instanceof ReleaseArtGateError && predicate(error.report));
}

test('technical readiness never automatically approves unreviewed art or an unverified physical device', () => {
  const project = fixture(); project.releaseEvidence.art.room.ART_READY = 'UNVERIFIED';
  project.releaseEvidence.mobilePhysicalDevice = { status: 'UNVERIFIED', device: '', reviewer: '', reviewedAt: '', evidence: 'browser viewport' };
  blocked(project, report => report.TECH_READY === 'PASS' && report.ART_READY === 'FAIL' && report.MOBILE_PHYSICAL_DEVICE === 'UNVERIFIED' && report.release === 'BLOCKED');
  assert.equal(validateProjectCompliance(project).mode, 'development');
  const emulated = fixture(); emulated.releaseEvidence.mobilePhysicalDevice.device = 'desktop browser viewport emulator';
  blocked(emulated, report => report.MOBILE_PHYSICAL_DEVICE === 'UNVERIFIED');
});

test('release blocks placeholders, unverified provenance and incomplete manual visual checks', () => {
  const placeholder = fixture(); placeholder.assets.push({ id: 'unused', kind: 'cg', src: 'placeholder.svg', status: 'PLACEHOLDER' });
  blocked(placeholder, report => report.PLACEHOLDER_SCAN === 'FAIL' && report.issues.some(issue => issue.includes('PLACEHOLDER')));
  const source = fixture(); source.releaseEvidence.art.room.source = 'UNVERIFIED';
  blocked(source, report => report.ART_READY === 'FAIL' && report.assets[0].issues.some(issue => issue.includes('source')));
  const composition = fixture(); composition.releaseEvidence.art.room.COMPOSITION_PASS = 'FAIL';
  blocked(composition, report => report.ART_READY === 'FAIL' && report.assets[0].issues.some(issue => issue.includes('COMPOSITION')));
  const digest = fixture(); digest.releaseEvidence.art.room.runtimeSha256 = 'b'.repeat(64);
  blocked(digest, report => report.TECH_READY === 'FAIL' && report.ART_READY === 'PASS');
});

test('dynamic portraits and UI key visuals cannot be omitted from the art review', () => {
  const project = fixture(); project.stage = { speakers: { A: 'hero' } };
  project.assets.push({ id: 'hero/neutral', kind: 'portrait', src: 'hero.svg', status: 'READY', sha256: hash },
    { id: 'title-visual', kind: 'ui', src: 'title.svg', status: 'READY', sha256: hash });
  blocked(project, report => report.assets.some(asset => asset.id === 'hero/neutral' && asset.ART_READY === 'FAIL')
    && report.assets.some(asset => asset.id === 'title-visual' && asset.ART_READY === 'FAIL'));
  project.releaseEvidence.art['hero/neutral'] = { ...project.releaseEvidence.art.room };
  project.releaseEvidence.art['title-visual'] = { ...project.releaseEvidence.art.room };
  blocked(project, report => report.issues.some(issue => issue.includes('Dynamic presentation')));
  project.releaseEvidence.dynamicPresentation = { status: 'PASS', reviewer: 'test reviewer', reviewedAt: '2026-10-27', evidence: 'test://runtime' };
  assert.equal(validateProjectCompliance(project, { mode: 'release' }).artGate.release, 'PASS');
});

test('a PWA package requires explicit physical-device evidence and a valid locked build identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-art-gate-')); await mkdir(join(root, 'assets'));
  const project = fixture(), file = join(root, 'project.json');
  await writeFile(join(root, 'assets/room.svg'), picture); await writeFile(file, JSON.stringify(project));
  const old = { release: process.env.VN_RELEASE_BUILD, commit: process.env.VN_ENGINE_COMMIT, github: process.env.GITHUB_SHA };
  try {
    process.env.VN_RELEASE_BUILD = '1'; process.env.VN_ENGINE_COMMIT = 'a'.repeat(40); delete process.env.GITHUB_SHA;
    const result = await packageGame(file, join(root, 'out'));
    const manifest = JSON.parse(await readFile(join(result.output, 'build-manifest.json'), 'utf8'));
    assert.equal(manifest.compliance.artGate.ART_READY, 'PASS'); assert.equal(manifest.compliance.artGate.MOBILE_PHYSICAL_DEVICE, 'PASS');
    project.releaseEvidence.targets.pwa = false; project.releaseEvidence.targets.mobile = false; delete project.releaseEvidence.mobilePhysicalDevice;
    await writeFile(file, JSON.stringify(project));
    await assert.rejects(packageGame(file, join(root, 'no-pwa-evidence')), error => error instanceof ReleaseArtGateError && error.report.release === 'BLOCKED');
    project.releaseEvidence.targets.pwa = true; project.releaseEvidence.mobilePhysicalDevice = fixture().releaseEvidence.mobilePhysicalDevice;
    await writeFile(file, JSON.stringify(project)); process.env.VN_ENGINE_COMMIT = 'not-a-commit';
    await assert.rejects(packageGame(file, join(root, 'bad-identity')), /valid matching/);
    process.env.VN_ENGINE_COMMIT = 'a'.repeat(40); await writeFile(join(root, 'assets/room.svg'), 'different');
    await assert.rejects(packageGame(file, join(root, 'bad-bytes')), /checksum mismatch/);
  } finally {
    for (const [key, value] of [['VN_RELEASE_BUILD', old.release], ['VN_ENGINE_COMMIT', old.commit], ['GITHUB_SHA', old.github]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('CLI prints a machine-readable blocked art report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vn-art-report-')), project = fixture(); delete project.releaseEvidence;
  const file = join(root, 'project.json'); await writeFile(file, JSON.stringify(project));
  const result = spawnSync(process.execPath, ['tools/validate-project.mjs', '--release', file], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /SPEC_ART_GATE_BLOCKED/);
  assert.match(result.stderr, /"MOBILE_PHYSICAL_DEVICE":"UNVERIFIED"/);
  await mkdir(join(root, 'assets')); await writeFile(join(root, 'assets/room.svg'), picture);
  const build = spawnSync(process.execPath, ['tools/package-game.mjs', file, join(root, 'blocked-build')], { encoding: 'utf8',
    env: { ...process.env, VN_RELEASE_BUILD: '1', VN_ENGINE_COMMIT: 'a'.repeat(40) } });
  assert.notEqual(build.status, 0); assert.match(build.stderr, /SPEC_ART_GATE_BLOCKED/);
  const desktop = fixture(); desktop.releaseEvidence.targets = { mobile: false, pwa: false, desktop: true }; delete desktop.releaseEvidence.mobilePhysicalDevice;
  await writeFile(file, JSON.stringify(desktop));
  assert.equal(spawnSync(process.execPath, ['tools/validate-project.mjs', '--release', file]).status, 0);
  const pwa = spawnSync(process.execPath, ['tools/validate-project.mjs', '--release', '--pwa-package', file], { encoding: 'utf8' });
  assert.notEqual(pwa.status, 0); assert.match(pwa.stderr, /includes a PWA/);
  assert.match(pwa.stderr, /"MOBILE_PHYSICAL_DEVICE":"UNVERIFIED"/);
});
