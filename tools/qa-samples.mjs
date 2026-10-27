import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { packageGame } from './package-game.mjs';
import { buildQaReport } from './qa-report.mjs';

// Alpha samples deliberately do not contain human production acceptance.
await mkdir(resolve('build'), { recursive: true });
const bundles = await mkdtemp(resolve('build/qa-bundles-')), reports = resolve('build/qa-reports'); await mkdir(reports, { recursive: true });
for (const name of ['campus', 'netlove', 'circuit', 'rain']) {
  const source = resolve(`examples/runtime/${name}.json`), output = join(bundles, name);
  await packageGame(source, output);
  const report = await buildQaReport(source, { decode: true, buildDirectory: output });
  await writeFile(join(reports, name + '-QA_REPORT.json'), JSON.stringify(report, null, 2) + '\n');
  await copyFile(join(output, 'build-manifest.json'), join(reports, name + '-build-manifest.json'));
  console.log(JSON.stringify({ sample: name, status: report.status, files: report.files.status, decoding: report.decoding.status, build: report.build.status, humanQa: report.humanQa.release }));
  if (report.structure.status !== 'PASS' || report.files.status !== 'PASS' || !['PASS', 'N/A'].includes(report.decoding.status) || report.build.status !== 'PASS') process.exitCode = 1;
}
