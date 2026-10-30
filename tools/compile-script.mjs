import { open, lstat, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileTextScript, checkTextScriptProject, TEXT_SCRIPT_FORMAT } from '../dist/script/text.js';

/** Filesystem adapter only; the compiler itself has no IO. Never overwrites author files. */
export async function compileScriptFile(input, output, mapOutput, options = {}) {
  const sourcePath = resolve(input), outputs = [resolve(output), ...(mapOutput ? [resolve(mapOutput)] : [])];
  if (new Set([sourcePath, ...outputs]).size !== outputs.length + 1) throw Error('Input and outputs must be different files');
  const stat = await lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) throw Error('Input must be a regular text file within 4 MB');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(sourcePath));
  const syntax = compileTextScript(source, { fileName: sourcePath });
  let result = syntax;
  if (syntax.ok && options.project !== undefined) {
    const projectPath = resolve(options.project), projectStat = await lstat(projectPath);
    if (!projectStat.isFile() || projectStat.isSymbolicLink() || projectStat.size > 8_000_000) throw Error('Project context must be a regular JSON file within 8 MB');
    const projectBytes = await readFile(projectPath);
    if (projectBytes.byteLength > 8_000_000) throw Error('Project context must be within 8 MB');
    const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(projectBytes));
    result = checkTextScriptProject(syntax, document?.format === 'vn-engine-editor' ? document.project : document);
  }
  if (!result.ok) return result;
  const payloads = [JSON.stringify(result.program, null, 2) + '\n', JSON.stringify({ format: TEXT_SCRIPT_FORMAT, sourceMap: result.sourceMap }, null, 2) + '\n'];
  const created = [], handles = [];
  try {
    // Reserve every destination before publishing any bytes; a collision leaves all existing files intact.
    for (const file of outputs) { handles.push(await open(file, 'wx', 0o600)); created.push(file); }
    for (let i = 0; i < handles.length; i++) { await handles[i].writeFile(payloads[i]); await handles[i].sync(); }
  } catch (error) {
    for (const handle of handles) await handle.close().catch(() => {});
    for (const file of created) await unlink(file).catch(() => {});
    throw error;
  }
  for (const handle of handles) await handle.close();
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), input = args.shift(); let output, mapOutput, project;
    while (args.length) {
      const flag = args.shift(), value = args.shift();
      if (!value || value.startsWith('--')) throw Error('Missing output path');
      if (flag === '--out' && output === undefined) output = value;
      else if (flag === '--map' && mapOutput === undefined) mapOutput = value;
      else if (flag === '--project' && project === undefined) project = value;
      else throw Error('Unknown or duplicate option: ' + flag);
    }
    if (!input || !output) throw Error('Usage: node tools/compile-script.mjs INPUT --out PROGRAM.json [--map SOURCE-MAP.json] [--project PROJECT.json]');
    const result = await compileScriptFile(input, output, mapOutput, { project });
    process.stdout.write(JSON.stringify({ format: TEXT_SCRIPT_FORMAT, ok: result.ok, diagnostics: result.diagnostics, ...(result.projectContext ? { projectContext: result.projectContext } : {}), ...(result.ok ? { output: resolve(output), ...(mapOutput ? { sourceMap: resolve(mapOutput) } : {}) } : {}) }) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
