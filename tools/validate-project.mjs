import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateProjectCompliance, ReleaseArtGateError } from '../dist/index.js';

export async function validateProjectFile(filename, options = {}) {
  const project = JSON.parse(await readFile(filename, 'utf8'));
  return validateProjectCompliance(project, options);
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
      throw error;
    }
  }
}
