/** Explicit author-time evidence IO. Importing this module invokes neither a model nor filesystem IO. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureAcceptanceContext, readAiAcceptance, requiredAcceptanceKeys, AI_ACCEPTANCE_CONTRACT,
  AI_REVIEW_RUBRIC, ENGINE_VERSION, localAssetPath, runRouteSuite } from '../dist/index.js';
import { readDocument } from '../dist/editor/index.js';
import { agentFileIO as io } from './agent-node.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function acceptanceEvidenceReader(root) {
  const read=io.assetReader(root);
  return async input => {
    if (!localAssetPath(input.src)) throw Error('Unsafe acceptance evidence path');
    return read(input.src);
  };
}
export async function loadAcceptanceOptions(projectFile, options = {}) {
  const file = path.resolve(projectFile), sourceText = await io.readText(file), project = readDocument(sourceText).project;
  const acceptanceFile = path.resolve(options.acceptanceFile ?? path.join(path.dirname(file), 'acceptance.json'));
  let acceptance = options.acceptance;
  if (acceptance === undefined) {
    try { acceptance = await io.readText(await io.filePath(acceptanceFile)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (acceptance !== undefined) acceptance = readAiAcceptance(acceptance);
  const acceptanceContext = await captureAcceptanceContext(project, sourceText, acceptance,
    io.assetReader(path.dirname(file)), acceptanceEvidenceReader(await fs.realpath(path.dirname(acceptanceFile))));
  return { acceptance, acceptanceContext };
}
export async function bundleAcceptanceFile(request) {
  const file = await io.filePath(request.project), sourceText = await io.readText(file), project = readDocument(sourceText).project;
  const output = path.resolve(request.params.output), root = path.dirname(file);
  if (output === root || output.startsWith(root + path.sep) && project.assets.some(a => path.resolve(root, a.src).startsWith(output + path.sep)))
    throw Error('Acceptance output must not contain project inputs');
  try { const stat = await fs.lstat(output); if (stat.isSymbolicLink() || !stat.isDirectory() || (await fs.readdir(output)).length) throw Error('Output must be new or empty'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const readAsset = io.assetReader(root), context = await captureAcceptanceContext(project, sourceText, null, readAsset);
  if (!context.binding.filesVerified) throw Error('Acceptance bundle requires current actual asset bytes');
  await fs.mkdir(output, { recursive: true });
  const copied=new Map();
  const write = async (name, bytes) => {
    if(copied.has(name)){if(copied.get(name)!==hash(bytes))throw Error('Bundle path conflict');return;}
    copied.set(name,hash(bytes));
    if (!localAssetPath(name) || name === 'acceptance.draft.json') throw Error('Reserved or unsafe acceptance path');
    const dest = path.resolve(output, name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const handle = await fs.open(dest, 'wx', 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
  };
  const inputs = [{ id: 'project', kind: 'project', src: '$source', sha256: context.binding.sourceSha256 }];
  await write('project.json', sourceText);
  for (const asset of project.assets) {
    if (['project.json', 'acceptance.json', 'acceptance.draft.json'].includes(asset.src) || asset.src.startsWith('review-inputs/')) throw Error('Reserved bundle asset path');
    const bytes = await readAsset(asset.src); await write(asset.src, bytes);
    if (['background', 'portrait', 'cg', 'ui', 'audio', 'video'].includes(asset.kind))
      inputs.push({ id: 'asset:' + asset.id, kind: ['audio', 'video'].includes(asset.kind) ? 'audio' : 'image',
        src: asset.src, sha256: hash(bytes), assetId: asset.id });
    if (asset.license && asset.license.src !== asset.src) {
      const dest = path.resolve(output, asset.license.src);
      try { await fs.access(dest); } catch { await write(asset.license.src, await readAsset(asset.license.src)); }
    }
  }
  const routes = { ...runRouteSuite(project), sourceSha256: context.binding.sourceSha256 };
  const routeBytes = JSON.stringify(routes, null, 2) + '\n';
  await write('review-inputs/routes.json', routeBytes);
  inputs.push({ id: 'routes', kind: 'routes', src: 'review-inputs/routes.json', sha256: hash(routeBytes) });
  for (const [index, entry] of (request.params.inputs ?? []).entries()) {
    const inputFile = await fs.realpath(path.resolve(entry.file)), stat = await fs.stat(inputFile);
    if (!stat.isFile() || stat.size > 67_108_864) throw Error('Evidence input must be a bounded regular file');
    const bytes = await fs.readFile(inputFile), src = 'review-inputs/input-' + index + path.extname(inputFile);
    await write(src, bytes);
    const record = { id: entry.id, kind: entry.kind, src, sha256: hash(bytes) };
    if (entry.kind === 'screenshot') {
      if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw Error('Screenshot evidence must be PNG');
      record.width = bytes.readUInt32BE(16); record.height = bytes.readUInt32BE(20);
    }
    inputs.push(record);
  }
  const draft = { contract: AI_ACCEPTANCE_CONTRACT, schema: 1, game: project.game, storyVersion: project.version,
    engineVersion: ENGINE_VERSION, rubricVersion: AI_REVIEW_RUBRIC, binding: context.binding, inputs,
    reviews: requiredAcceptanceKeys(project, true).map(key => {
      const separator = key.indexOf(':'), category = separator < 0 ? key : key.slice(0, separator), target = separator < 0 ? null : key.slice(separator + 1);
      return { id: key, category, ...(target ? { target } : {}), status: 'UNVERIFIED',
        mode: ['accessibility', 'web', 'pwa', 'windows'].includes(category) ? 'automated' : 'ai-simulated',
        model: 'UNVERIFIED', modalities: [], reviewedAt: new Date().toISOString(), coverage: 'sampled',
        rationale: 'Review has not been executed. Record actual observations and all missing scope.',
        evidenceIds: inputs.map(i => i.id), findings: [] };
    }) };
  readAiAcceptance(draft);
  if (await io.current(file) !== context.binding.sourceSha256) throw Error('SOURCE_CONFLICT: Project changed during bundle');
  const draftFile = path.join(output, 'acceptance.draft.json');
  await fs.writeFile(draftFile, JSON.stringify(draft, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, draftFile, binding: context.binding, inputs: inputs.length, status: 'UNVERIFIED',
    modelExecuted: false, instructions: 'Observe actual inputs, record AI or real test results, then acceptance.import. Drafts never approve release.' };
}
