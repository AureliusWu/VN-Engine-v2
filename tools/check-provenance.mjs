import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/provenance.json'), 'utf8'));
assert.equal(manifest.schema, 2);
const paths = new Set();
for (const file of manifest.files) {
  assert.ok(!paths.has(file.target), `Duplicate target: ${file.target}`);
  assert.ok(!file.target.startsWith('/') && !file.target.split('/').includes('..'), 'Target must be relative');
  paths.add(file.target);
  const hash = createHash('sha256').update(readFileSync(resolve(root, file.target))).digest('hex');
  assert.equal(hash, file.targetSha256, `Update provenance after editing ${file.target}`);
  assert.ok(['new', 'adapted', 'verbatim'].includes(file.mode));
  if (file.mode === 'new') assert.equal(file.origins.length, 0);
  else assert.ok(file.origins.length > 0, `Missing source: ${file.target}`);
  for (const origin of file.origins) {
    assert.match(origin.commit, /^[a-f0-9]{40}$/);
    assert.equal(origin.commit, manifest.sources[origin.repository.split('/')[1]]);
    assert.match(origin.sha256, /^[a-f0-9]{64}$/);
    assert.ok(origin.path);
  }
  if (file.mode === 'verbatim') assert.equal(hash, file.origins[0].sha256, `Original source changed: ${file.target}`);
}
function visit(path) {
  for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const name = path + '/' + entry.name;
    if (entry.isDirectory()) visit(name);
    else if (/\.(ts|mjs|py)$/.test(name)) assert.ok(paths.has(name), `Unrecorded module: ${name}`);
  }
}
for (const path of ['src', 'adapters', 'tools']) visit(path);
console.log(`Provenance verified: ${manifest.files.length} files, four pinned source snapshots`);
