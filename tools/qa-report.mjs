import {loadAcceptanceOptions} from './acceptance-node.mjs';
import {fingerprintFiles, renderWorker} from './pwa.mjs';
import {posix} from 'node:path';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateProjectCompliance, assessProductionArt, assessQaEvidence, assessDeclaredQaEvidence, ReleaseArtGateError, ReleaseQaGateError, runRouteSuite, ReleaseRouteGateError, localAssetPath, isRecord, ENGINE_VERSION } from '../dist/index.js';
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

/** Verify the generated entry documents and offline worker, beyond their self-declared hashes. */
function inspectEntryDependencies(files, project, fingerprint) {
  const base = new URL('https://vn-package.invalid/package/');
  function requireFile(owner, reference, { directory = false, inline = false } = {}) {
    if (typeof reference !== 'string' || !reference.trim()) throw Error('Invalid build dependency in ' + owner);
    const value = reference.trim();
    if (inline && /^data:/i.test(value)) return;
    if (value.startsWith('/') || /[\\\u0000-\u001f]/.test(value)) throw Error('Non-local build dependency in ' + owner + ': ' + value);
    const url = new URL(value, new URL(owner, base));
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw Error('Build dependency leaves package scope: ' + value);
    let name = decodeURIComponent(url.pathname.slice(base.pathname.length));
    if (directory && (!name || name.endsWith('/'))) name += 'index.html';
    if (!localAssetPath(name) || !files.has(name)) throw Error('Required build dependency missing: ' + value + ' (from ' + owner + ')');
    return name;
  }
  function inspectCss(owner, text) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi))
      requireFile(owner, match[1] ?? match[2] ?? match[3], { inline: true });
    for (const match of css.matchAll(/@import\s*(?:"([^"]+)"|'([^']+)')/gi)) requireFile(owner, match[1] ?? match[2]);
  }
  const entity = text => text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f\d]+);/gi, value => {
    if (value[1] === '#') return String.fromCodePoint(parseInt(value.slice(value[2].toLowerCase() === 'x' ? 3 : 2, -1), value[2].toLowerCase() === 'x' ? 16 : 10));
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[value.toLowerCase()];
  });
  for (const [name, bytes] of files) {
    const text = bytes.toString('utf8');
    if (name.endsWith('.css')) inspectCss(name, text);
    if (!name.endsWith('.html')) continue;
    // Only the packager's local document model is supported; a base tag changes URL authority.
    const html = text.replace(/<!--[\s\S]*?-->/g, '');
    if (/<base\b/i.test(html)) throw Error('Packaged entry cannot override its local base URL');
    let moduleEntry = false;
    for (const tag of html.matchAll(/<(?:script|link|img|source|audio|video|iframe|object|embed)\b[^>]*>/gi)) {
      const attributes = new Map([...tag[0].matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
        .map(attr => [attr[1].toLowerCase(), entity(attr[2] ?? attr[3] ?? attr[4])]));
      for (const key of ['src', 'href', 'poster', 'data']) if (attributes.has(key)) {
        const dependency = requireFile(name, attributes.get(key), { inline: /^(?:<img|<source)/i.test(tag[0]) });
        if (/^<script\b/i.test(tag[0]) && key === 'src' && dependency === 'app.mjs' && attributes.get('type')?.toLowerCase() === 'module') moduleEntry = true;
      }
    }
    if (name === 'index.html' && !moduleEntry) throw Error('Required module entry app.mjs is missing from index.html');
    for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) inspectCss(name, style[1]);
  }
  const manifest = JSON.parse(files.get('manifest.webmanifest').toString('utf8'));
  requireFile('manifest.webmanifest', manifest.start_url, { directory: true });
  for (const image of [...(manifest.icons ?? []), ...(manifest.screenshots ?? [])]) requireFile('manifest.webmanifest', image.src, { inline: true });
  const worker = files.get('sw.js').toString('utf8'), match = worker.match(/^const FILES = (\[.*\]);$/m);
  if (!match) throw Error('Offline worker has no verifiable cache list');
  const cached = JSON.parse(match[1]), expected = [...files.keys()].filter(name => name !== 'sw.js');
  if (cached.length !== expected.length || new Set(cached).size !== cached.length || cached.some(name => !expected.includes(name)))
    throw Error('Offline cache list differs from actual build files');
  if (worker !== renderWorker({ namespace: 'vn-self-' + project.game, version: fingerprint, urls: cached }))
    throw Error('Offline worker differs from the current package scope or content fingerprint');
}

async function inspectBuild(directory, project, sourceSha256) {
  if (!directory) return { status: 'UNVERIFIED', requested: false, reason: 'No built artifact was supplied.' };
  const checks = [];
  try {
    const root = await realpath(resolve(directory)), manifest = JSON.parse(await readFile(resolve(root, 'build-manifest.json'), 'utf8'));
    if (manifest.game !== project.game || manifest.version !== project.version || manifest.buildIdentity?.gameVersion !== project.version
      || manifest.buildIdentity?.engineVersion !== ENGINE_VERSION || manifest.source?.sourceSha256 !== sourceSha256
      || !/^[a-f0-9]{40}$/i.test(manifest.buildIdentity?.commitSha ?? '') || !Array.isArray(manifest.files)) throw Error('Build identity differs from current source/engine or has no commit lock');
    const names = new Set(), decodedFiles=new Map();
    const required=['index.html','app.mjs','project.json','lib/index.js','sw.js','manifest.webmanifest','icon.svg','LICENSE.txt',...project.assets.flatMap(a=>[a.src,...(a.license?[a.license.src]:[])])];
    const entries=new Set(manifest.files.map(e=>e.name));
    for(const name of required)if(!entries.has(name))throw Error('Required build file missing from manifest: '+name);
    for (const entry of manifest.files) {
      try {
        if (names.has(entry.name)) throw Error('Duplicate build file'); names.add(entry.name);
        const bytes = await localBytes(root, entry.name);
        if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw Error('Build checksum or size mismatch');
        decodedFiles.set(entry.name,bytes);
        checks.push({ name: entry.name, status: 'PASS', bytes: bytes.length, actualSha256: digest(bytes) });
      } catch (error) { checks.push({ name: entry.name, status: 'FAIL', reason: errorText(error) }); }
    }
    for(const [name,bytes]of decodedFiles)if(name.endsWith('.js')||name.endsWith('.mjs')){
      const imports=bytes.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g);
      for(const match of imports){const dependency=posix.normalize(posix.join(posix.dirname(name),match[1]));if(!entries.has(dependency))throw Error('Required runtime dependency missing: '+dependency);}
    }
    if(checks.every(c=>c.status==='PASS')&&fingerprintFiles([...decodedFiles].filter(([name])=>name!=='sw.js').map(([name,bytes])=>({name,bytes})))!==manifest.contentFingerprint)throw Error('Build content fingerprint mismatch');
    if (!names.has('project.json') || !isDeepStrictEqual(JSON.parse(await localBytes(root, 'project.json')), project)) throw Error('Packaged project differs from the current source');
    if (checks.every(check => check.status === 'PASS')) inspectEntryDependencies(decodedFiles, project, manifest.contentFingerprint);
    return { status: checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS', requested: true, identity: manifest.buildIdentity,
      contentFingerprint: manifest.contentFingerprint, filesChecked: checks.length, checks };
  } catch (error) { return { status: 'FAIL', requested: true, reason: errorText(error), checks }; }
}

/** Aggregate every phase; an art/evidence failure must not hide independent file failures. */
export async function buildQaReport(filename, options = {}) {
  const source = resolve(filename), sourceBytes = await readFile(source), project = JSON.parse(sourceBytes), root = await realpath(dirname(source));
  if (!isRecord(project)) throw Error('QA report requires a JSON project object');
  const requiresPwa = options.requiresPwa === true || !!options.buildDirectory;
  let structure, formalStructure, routes, acceptanceOptions={},acceptanceError;
  try{acceptanceOptions=await loadAcceptanceOptions(source,options);}catch(error){acceptanceError=errorText(error);}
  try { structure = { status: 'PASS', report: validateProjectCompliance(project) }; } catch (error) { structure = { status: 'FAIL', reason: errorText(error) }; }
  try { routes = validateProjectCompliance(project, { ...acceptanceOptions,mode: 'release', requiresPwa }).routeGate; formalStructure = { status: 'PASS' }; }
  catch (error) {
    if (error instanceof ReleaseRouteGateError) routes = error.report;
    formalStructure = error instanceof ReleaseArtGateError || error instanceof ReleaseQaGateError || error instanceof ReleaseRouteGateError ? { status: 'PASS' } : { status: 'FAIL', reason: errorText(error) };
  }
  try { routes ??= runRouteSuite(project); }
  catch (error) { routes = { status: 'FAIL', error: errorText(error), cases: [], coverage: { required: [], covered: [], missing: [] } }; }
  let art, contentReview;
  try { art = assessProductionArt(project, project.assets.map(asset => asset.id), { ...acceptanceOptions, requiresPwa, keyVisualUsed: structure.report?.keyVisualUsed }); }
  catch (error) { art = { release: 'BLOCKED', issues: [errorText(error)] }; }
  try { contentReview = assessQaEvidence(project, { ...acceptanceOptions,requiresPwa }); } catch (error) { contentReview = { release: 'BLOCKED', issues: [errorText(error)] }; }
  const humanQa={...assessDeclaredQaEvidence(project,{requiresPwa}),scope:'legacy-declared; historical only; not current release approval'};
  if(acceptanceError)contentReview={...contentReview,release:'BLOCKED',issues:[...contentReview.issues,acceptanceError]};
  const { report: files, inputs } = await inspectFiles(project, root);
  const decoding = options.decode ? await probeAssets(inputs) : { status: 'UNVERIFIED', reason: 'Run with --decode to probe local asset bytes in Chromium.', checks: [] };
  const build = await inspectBuild(options.buildDirectory, project,digest(sourceBytes));
  const blocked = structure.status === 'FAIL' || formalStructure.status === 'FAIL' || art.release !== 'PASS' || contentReview.release !== 'PASS'
    || routes.status !== 'PASS' || files.status === 'FAIL' || decoding.status === 'FAIL' || (build.requested && build.status === 'FAIL');
  const status = blocked ? 'BLOCKED' : decoding.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'PASS';
  return { schema: 1, contract: 'GALGAME_SPEC-v0.2-qa-draft', checkedAt: new Date().toISOString(), status,
    scope: { source: true, routeExecution: true, declaredHumanEvidence: false,aiSimulatedAcceptance:true, localBytes: true, decodingRequested: !!options.decode, buildRequested: !!options.buildDirectory, fullSpecCertification: false },
    project: { game: project.game, version: project.version, title: project.title, sourceSha256: digest(sourceBytes) }, engine: ENGINE_VERSION,
    structure, formalStructure, routes, art, contentReview, humanQa, files, decoding, build,
    limitations: ['AI/model identity declarations, provenance and physical-device claims are not authenticated automatically.', 'File/decode success does not establish art quality or listening experience.',
      'Route execution covers authored cases and declared endings, not all branch combinations or narrative quality.',
      'Video probing covers the first decoded frame only. Full playback and target-platform acceptance need separate evidence.', 'This report covers the declared scope and is not full GALGAME SPEC v0.2 certification.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), source = args.find(arg => !arg.startsWith('--'));
  if (!source) throw Error('Usage: node tools/qa-report.mjs project.json [--decode] [--release] [--pwa-package] [--build=directory] [--output=report.json]');
  if (args.filter(arg => !arg.startsWith('--')).length !== 1 || args.some(arg => arg.startsWith('--') && !['--decode', '--release', '--pwa-package'].includes(arg) && !arg.startsWith('--build=') && !arg.startsWith('--output=') && !arg.startsWith('--acceptance='))) throw Error('Unknown QA report argument');
  const output = args.find(arg => arg.startsWith('--output='))?.slice(9);
  const report = await buildQaReport(source, { acceptanceFile:args.find(arg=>arg.startsWith('--acceptance='))?.slice(13), decode: args.includes('--decode') || args.includes('--release'), requiresPwa: args.includes('--pwa-package'), buildDirectory: args.find(arg => arg.startsWith('--build='))?.slice(8) });
  if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n'); console.log('QA_REPORT_WRITTEN', JSON.stringify({ file: output, status: report.status })); }
  else console.log(JSON.stringify(report, null, 2));
  if (args.includes('--release') && report.status !== 'PASS') process.exitCode = 1;
}
