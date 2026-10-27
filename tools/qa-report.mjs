import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateProjectCompliance, assessProductionArt, assessQaEvidence, ReleaseArtGateError, ReleaseQaGateError, localAssetPath, isRecord, ENGINE_VERSION } from '../dist/index.js';
import { probeAssets } from './probe-assets.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const errorText = error => error instanceof Error ? error.message : String(error);
const mimeTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
async function localBytes(root, name) {
  if (!localAssetPath(name)) throw Error('Unsafe relative path');
  const actual = await realpath(resolve(root, name)); if (!actual.startsWith(root + sep)) throw Error('File escapes the project directory');
  return readFile(actual);
}
async function inspectFiles(project, root) {
  const checks = [], inputs = [];
  for (const asset of Array.isArray(project.assets) ? project.assets : []) {
    if (!isRecord(asset)) { checks.push({ id: '<invalid>', status: 'FAIL', reason: 'Invalid asset entry' }); continue; }
    try {
      const bytes = await localBytes(root, asset.src), actualSha256 = digest(bytes);
      if (asset.sha256 && asset.sha256 !== actualSha256) throw Error('SHA256 mismatch');
      if (asset.kind === 'font' && !asset.license) throw Error('Font license is missing');
      if (asset.license) await localBytes(root, asset.license.src);
      checks.push({ id: asset.id, src: asset.src, status: 'PASS', bytes: bytes.length, actualSha256, declaredSha256: asset.sha256 ?? null });
      inputs.push({ id: asset.id, kind: asset.kind, bytes, mime: mimeTypes[extname(asset.src).toLowerCase()] ?? 'application/octet-stream' });
    } catch (error) { checks.push({ id: asset.id, src: asset.src, status: 'FAIL', reason: errorText(error) }); }
  }
  return { report: { status: checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS', assetsChecked: checks.length, checks }, inputs };
}
async function inspectBuild(directory, project) {
  if (!directory) return { status: 'UNVERIFIED', requested: false, reason: 'No built artifact was supplied.' };
  const checks = [];
  try {
    const root = await realpath(resolve(directory)), manifest = JSON.parse(await readFile(resolve(root, 'build-manifest.json'), 'utf8'));
    if (manifest.game !== project.game || manifest.version !== project.version || manifest.buildIdentity?.gameVersion !== project.version
      || !/^[a-f0-9]{40}$/i.test(manifest.buildIdentity?.commitSha ?? '') || !Array.isArray(manifest.files)) throw Error('Build identity does not match the project or has no commit lock');
    const names = new Set();
    for (const entry of manifest.files) {
      try {
        if (names.has(entry.name)) throw Error('Duplicate build file'); names.add(entry.name);
        const bytes = await localBytes(root, entry.name);
        if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw Error('Build checksum or size mismatch');
        checks.push({ name: entry.name, status: 'PASS', bytes: bytes.length, actualSha256: digest(bytes) });
      } catch (error) { checks.push({ name: entry.name, status: 'FAIL', reason: errorText(error) }); }
    }
    if (!names.has('project.json') || !isDeepStrictEqual(JSON.parse(await localBytes(root, 'project.json')), project)) throw Error('Packaged project differs from the current source');
    return { status: checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS', requested: true, identity: manifest.buildIdentity,
      contentFingerprint: manifest.contentFingerprint, filesChecked: checks.length, checks };
  } catch (error) { return { status: 'FAIL', requested: true, reason: errorText(error), checks }; }
}

/** Aggregate every phase; an art/evidence failure must not hide independent file failures. */
export async function buildQaReport(filename, options = {}) {
  const source = resolve(filename), sourceBytes = await readFile(source), project = JSON.parse(sourceBytes), root = await realpath(dirname(source));
  if (!isRecord(project)) throw Error('QA report requires a JSON project object');
  const requiresPwa = options.requiresPwa === true || !!options.buildDirectory;
  let structure, formalStructure;
  try { structure = { status: 'PASS', report: validateProjectCompliance(project) }; } catch (error) { structure = { status: 'FAIL', reason: errorText(error) }; }
  try { validateProjectCompliance(project, { mode: 'release', requiresPwa }); formalStructure = { status: 'PASS' }; }
  catch (error) { formalStructure = error instanceof ReleaseArtGateError || error instanceof ReleaseQaGateError ? { status: 'PASS' } : { status: 'FAIL', reason: errorText(error) }; }
  let art, humanQa;
  try { art = assessProductionArt(project, project.assets.map(asset => asset.id), { requiresPwa, keyVisualUsed: structure.report?.keyVisualUsed }); }
  catch (error) { art = { release: 'BLOCKED', issues: [errorText(error)] }; }
  try { humanQa = assessQaEvidence(project, { requiresPwa }); } catch (error) { humanQa = { release: 'BLOCKED', issues: [errorText(error)] }; }
  const { report: files, inputs } = await inspectFiles(project, root);
  const decoding = options.decode ? await probeAssets(inputs) : { status: 'UNVERIFIED', reason: 'Run with --decode to probe local asset bytes in Chromium.', checks: [] };
  const build = await inspectBuild(options.buildDirectory, project);
  const blocked = structure.status === 'FAIL' || formalStructure.status === 'FAIL' || art.release !== 'PASS' || humanQa.release !== 'PASS'
    || files.status === 'FAIL' || decoding.status === 'FAIL' || (build.requested && build.status === 'FAIL');
  const status = blocked ? 'BLOCKED' : decoding.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'PASS';
  return { schema: 1, contract: 'GALGAME_SPEC-v0.2-qa-draft', checkedAt: new Date().toISOString(), status,
    scope: { source: true, declaredHumanEvidence: true, localBytes: true, decodingRequested: !!options.decode, buildRequested: !!options.buildDirectory, fullSpecCertification: false },
    project: { game: project.game, version: project.version, title: project.title, sourceSha256: digest(sourceBytes) }, engine: ENGINE_VERSION,
    structure, formalStructure, art, humanQa, files, decoding, build,
    limitations: ['Human evidence, provenance and physical-device claims are not authenticated automatically.', 'File/decode success does not establish art quality or listening experience.',
      'Video probing covers the first decoded frame only. Full playback and target-platform acceptance need separate evidence.', 'This report covers the declared scope and is not full GALGAME SPEC v0.2 certification.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), source = args.find(arg => !arg.startsWith('--'));
  if (!source) throw Error('Usage: node tools/qa-report.mjs project.json [--decode] [--release] [--pwa-package] [--build=directory] [--output=report.json]');
  if (args.filter(arg => !arg.startsWith('--')).length !== 1 || args.some(arg => arg.startsWith('--') && !['--decode', '--release', '--pwa-package'].includes(arg) && !arg.startsWith('--build=') && !arg.startsWith('--output='))) throw Error('Unknown QA report argument');
  const output = args.find(arg => arg.startsWith('--output='))?.slice(9);
  const report = await buildQaReport(source, { decode: args.includes('--decode') || args.includes('--release'), requiresPwa: args.includes('--pwa-package'), buildDirectory: args.find(arg => arg.startsWith('--build='))?.slice(8) });
  if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n'); console.log('QA_REPORT_WRITTEN', JSON.stringify({ file: output, status: report.status })); }
  else console.log(JSON.stringify(report, null, 2));
  if (args.includes('--release') && report.status !== 'PASS') process.exitCode = 1;
}
