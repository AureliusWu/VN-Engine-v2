import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateProjectCompliance } from '../dist/index.js';

export async function validateProjectFile(filename, options = {}) {
  const project = JSON.parse(await readFile(filename, 'utf8'));
  return validateProjectCompliance(project, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), release = args.includes('--release');
  const files = args.filter(arg => arg !== '--release');
  if (!files.length) throw new Error('Usage: node tools/validate-project.mjs [--release] project.json [...]');
  for (const file of files) {
    const report = await validateProjectFile(file, { mode: release ? 'release' : 'development' });
    console.log('SPEC_PROJECT_OK', JSON.stringify({ file, ...report }));
  }
}
