import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageGame } from './package-game.mjs';
import { buildQaReport } from './qa-report.mjs';

/** Create a local reviewable candidate only after source/evidence/decode gates pass. Never publishes. */
export async function runReleaseGate(source, options = {}) {
  let output;
  if (options.outputDirectory) {
    output = resolve(options.outputDirectory); await mkdir(output, { recursive: true });
    if ((await readdir(output)).length) throw Error('Release gate output must be new or empty; existing files are preserved');
  } else { await mkdir(resolve('build'), { recursive: true }); output = await mkdtemp(resolve('build/release-gate-')); }
  let report = await buildQaReport(source, { decode: true, requiresPwa: true }), candidate;
  if (report.status === 'PASS') {
    const old = process.env.VN_RELEASE_BUILD; process.env.VN_RELEASE_BUILD = '1';
    try {
      const directory = join(output, 'candidate'); await packageGame(source, directory); candidate = directory;
      report = await buildQaReport(source, { decode: true, buildDirectory: candidate });
    } catch (error) { report = { ...report, status: 'BLOCKED', build: { status: 'FAIL', requested: true, reason: error.message } }; }
    finally { if (old === undefined) delete process.env.VN_RELEASE_BUILD; else process.env.VN_RELEASE_BUILD = old; }
  }
  const reportFile = join(output, 'QA_REPORT.json'); await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  return { status: report.status, reportFile, ...(candidate ? { candidate } : {}), report };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), source = args.find(arg => !arg.startsWith('--'));
  if (!source) throw Error('Usage: node tools/release-gate.mjs project.json [--output=new-directory]');
  if (args.filter(arg => !arg.startsWith('--')).length !== 1 || args.some(arg => arg.startsWith('--') && !arg.startsWith('--output='))) throw Error('Unknown release gate argument');
  const { report, ...result } = await runReleaseGate(source, { outputDirectory: args.find(arg => arg.startsWith('--output='))?.slice(9) });
  console.log('RELEASE_GATE_REPORT', JSON.stringify(result)); if (result.status !== 'PASS') process.exitCode = 1;
}
