import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { posix, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(root, 'docs/provenance.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const tracked = new Map(manifest.files.map(file => [file.target, file]));
const discovered = [];
const sha256 = target => createHash('sha256').update(readFileSync(resolve(root, target))).digest('hex');

function visit(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    if (['__pycache__', 'bin', 'obj'].includes(entry.name)) continue;
    const target = posix.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (/\.(ts|mjs|py|ps1|cs|csproj|manifest)$/.test(target) || (target.startsWith('schemas/') && /\.json$/.test(target)) || (target.startsWith('editor/') && /\.(html|css)$/.test(target))) discovered.push(target);
  }
}

for (const directory of ['src', 'adapters', 'tools', 'editor', 'hosts/windows', 'schemas']) visit(directory);
for (const target of discovered.sort()) {
  const existing = tracked.get(target);
  if (existing) existing.targetSha256 = sha256(target);
  else {
    const file = { target, mode: 'new', targetSha256: sha256(target), origins: [] };
    manifest.files.push(file);
    tracked.set(target, file);
  }
}
manifest.files.sort((a, b) => a.target.localeCompare(b.target));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Refreshed provenance hashes for ${discovered.length} tracked modules`);
