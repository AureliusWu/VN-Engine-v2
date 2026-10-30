import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** Isolate compiler leftovers from parallel tests and the author's actual dist directory. */
export async function packageRepositoryFixture({ baseline = false } = {}) {
  // Keep code mirrors below the repository so bare package imports resolve its dependencies.
  // Browser reports can still use an external VN_ENGINE_TEST_OUTPUT directory.
  const base = resolve(repositoryRoot, 'test-results', 'package-modules');
  await mkdir(base, { recursive: true });
  const run = await mkdtemp(join(base, baseline ? 'baseline-' : 'run-')), repository = join(run, 'repository');
  await mkdir(repository);
  const names = ['src', 'tools', 'editor', 'examples/runtime', 'licenses', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json'];
  if (baseline) {
    const archive = join(run, 'source.tar');
    await exec('git', ['archive', '--format=tar', '--output', archive, '011f7595117e2788767eada7a45f8d93fb08d503', ...names], { cwd: repositoryRoot });
    await exec('tar', ['-xf', archive, '-C', repository]);
  } else {
    for (const name of names) await cp(join(repositoryRoot, name), join(repository, name), { recursive: true });
  }
  await cp(join(repositoryRoot, 'dist'), join(repository, 'dist'), { recursive: true });
  return { run, repository };
}

export async function runPackageFixture(fixture, source) {
  await writeFile(join(fixture.repository, 'probe.mjs'), source);
  return exec(process.execPath, ['probe.mjs'], { cwd: fixture.repository, maxBuffer: 1024 * 1024,
    env: { ...process.env, VN_ENGINE_COMMIT: '011f7595117e2788767eada7a45f8d93fb08d503', SOURCE_DATE_EPOCH: '1710000000' } });
}
