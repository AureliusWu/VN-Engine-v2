import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProjectCompliance, ReleaseArtGateError, ReleaseQaGateError, ReleaseRouteGateError, localAssetPath } from '../dist/index.js';

class ReleaseFileGateError extends Error {
  constructor(asset, reason) { super(`Release file check failed: ${asset}: ${reason}`); this.name = 'ReleaseFileGateError'; this.report = { asset, reason, status: 'BLOCKED' }; }
}

export async function validateProjectFile(filename, options = {}) {
  const source = resolve(filename), project = JSON.parse(await readFile(source, 'utf8'));
  const report = validateProjectCompliance(project, options);
  if (options.mode !== 'release') return report;
  const root = await realpath(dirname(source)); let checked = 0;
  const local = async (assetId, path) => {
    if (!localAssetPath(path)) throw new ReleaseFileGateError(assetId, 'unsafe or missing relative path');
    let actual;
    try { actual = await realpath(resolve(root, path)); } catch { throw new ReleaseFileGateError(assetId, 'file does not exist'); }
    if (!actual.startsWith(root + sep)) throw new ReleaseFileGateError(assetId, 'file escapes the project directory');
    try { return await readFile(actual); } catch { throw new ReleaseFileGateError(assetId, 'file cannot be read'); }
  };
  for (const asset of project.assets) {
    const bytes = await local(asset.id, asset.src); checked++;
    if (asset.sha256 && createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new ReleaseFileGateError(asset.id, 'SHA256 mismatch');
    if (asset.kind === 'font' && !asset.license) throw new ReleaseFileGateError(asset.id, 'font license is missing');
    if (asset.license) await local(asset.id, asset.license.src);
  }
  return { ...report, fileIntegrity: { status: 'PASS', assetsChecked: checked, note: 'Presence, local path and declared SHA256 checked; decoding and visual quality not checked.' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), release = args.includes('--release'), requiresPwa = args.includes('--pwa-package');
  const files = args.filter(arg => arg !== '--release' && arg !== '--pwa-package');
  if (!files.length) throw new Error('Usage: node tools/validate-project.mjs [--release] [--pwa-package] project.json [...]');
  for (const file of files) {
    try {
      const report = await validateProjectFile(file, { mode: release ? 'release' : 'development', requiresPwa });
      console.log('SPEC_PROJECT_OK', JSON.stringify({ file, ...report }));
    } catch (error) {
      if (error instanceof ReleaseArtGateError) console.error('SPEC_ART_GATE_BLOCKED', JSON.stringify({ file, ...error.report }));
      if (error instanceof ReleaseQaGateError) console.error('SPEC_QA_GATE_BLOCKED', JSON.stringify({ file, ...error.report }));
      if (error instanceof ReleaseRouteGateError) console.error('SPEC_ROUTE_GATE_BLOCKED', JSON.stringify({ file, ...error.report }));
      if (error instanceof ReleaseFileGateError) console.error('SPEC_FILE_GATE_BLOCKED', JSON.stringify({ file, ...error.report }));
      throw error;
    }
  }
}
