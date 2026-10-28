/** File host for vn-agent-v1. Importing this module performs no I/O. */
import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { executeAgentRequest, validateAgentRequest, AgentError, agentResponse, failAgent, AGENT_LIMITS } from '../dist/agent/index.js';
import {prepareImports,publishImports,importReceipt,assertImportsUsed,importsPresent} from './agent-imports.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const decode = bytes => { if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new AgentError('INVALID_ENCODING', 'Project and journal files must use UTF-8 without BOM; original bytes are preserved'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); };
async function readText(file) { const stat = await fs.stat(file); if (stat.size > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'File exceeds input budget', {}, 'UNVERIFIED'); return decode(await fs.readFile(file)); }
async function current(file) { try { return hash(await fs.readFile(file)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function atomic(file, text, mode = 0o600) {
  const temp = file + '.tmp-' + randomUUID(); let handle;
  try { handle = await fs.open(temp, 'wx', mode); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null; await fs.rename(temp, file); }
  finally { await handle?.close(); await fs.rm(temp, { force: true }); }
}
async function filePath(file) {
  const absolute = path.resolve(file), parent = await fs.realpath(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  try { const stat = await fs.lstat(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new AgentError('PROJECT_PATH_UNSAFE', 'Project must be a regular file, not a symlink'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return resolved;
}
export async function releaseAgentLease(lease) {
  if (!lease) return;
  try { const owner = JSON.parse(await fs.readFile(lease.file, 'utf8')); if (owner.token === lease.token) await fs.unlink(lease.file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function acquire(file, request, phase) {
  const lease = { file: file + '.agent-lock', token: randomUUID(), pid: process.pid, requestId: request.requestId };
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const h = await fs.open(lease.file, 'wx'); await h.writeFile(JSON.stringify(lease)); await h.close(); phase?.('lease', lease); return lease; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner; try { owner = JSON.parse(await fs.readFile(lease.file, 'utf8')); } catch { throw new AgentError('RECOVERY_REQUIRED', 'Unreadable lease; inspect it before removing'); }
      let dead = false; if (Number.isSafeInteger(owner.pid) && owner.pid > 0) { try { process.kill(owner.pid, 0); } catch (err) { dead = err.code === 'ESRCH'; } }
      if (!dead) throw new AgentError('LOCKED', 'Another writer owns the lease', { actual: owner.requestId ?? null });
      if (!request.params.recover) throw new AgentError('RECOVERY_REQUIRED', 'Dead writer lease; retry the identical request with recover=true');
      if (typeof owner.token !== 'string' || !owner.token) throw new AgentError('RECOVERY_REQUIRED', 'Dead lease has no ownership token');
      await releaseAgentLease({ file: lease.file, token: owner.token });
    }
  }
  throw new AgentError('LOCKED', 'Could not acquire writer lease');
}
function assetReader(root, budget={bytes:0}) {
  const cache = new Map();
  return async relative => {
    if (cache.has(relative)) return cache.get(relative);
    const file = await fs.realpath(path.resolve(root, relative));
    if (!file.startsWith(root + path.sep)) throw new AgentError('ASSET_PATH_UNSAFE', 'Asset escapes project directory');
    const stat = await fs.stat(file); if (!stat.isFile()) throw new AgentError('ASSET_UNREADABLE', 'Asset is not a file');
    if (stat.size > AGENT_LIMITS.assetBytes || budget.bytes + stat.size > AGENT_LIMITS.assetTotalBytes) throw new AgentError('BUDGET_EXCEEDED', 'Asset byte budget exhausted', {}, 'UNVERIFIED');
    const bytes = await fs.readFile(file); budget.bytes += bytes.length; cache.set(relative, bytes); return bytes;
  };
}
async function journalRead(file) {
  try { const value = JSON.parse(await readText(file)); if (value.protocol !== 'vn-agent-v1' || !Array.isArray(value.entries) || value.entries.length > 128) throw Error('Invalid journal'); return value; }
  catch (e) { if (e.code === 'ENOENT') return { protocol: 'vn-agent-v1', schema: 1, entries: [] }; throw new AgentError('JOURNAL_ERROR', 'Cannot read request journal: ' + e.message); }
}
async function journalWrite(file, journal) {
  const text = JSON.stringify(journal, null, 2) + '\n'; if (Buffer.byteLength(text) > AGENT_LIMITS.inputBytes) throw new AgentError('JOURNAL_FULL', 'Journal byte budget exhausted; archive the journal before new writes');
  await atomic(file, text);
}
/** Internal host, also useful to embedders that provide their own execution deadline. */
export async function runAgentFileRequestInProcess(input, options = {}) {
  let request, lease, response = agentResponse(), committed = false, committedSha;const importedArtifacts=[];
  try {
    if (typeof input === 'string') { if (Buffer.byteLength(input) > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Request exceeds input budget', {}, 'UNVERIFIED'); try { input = JSON.parse(input); } catch { throw new AgentError('MALFORMED_JSON', 'Request is not valid JSON'); } }
    response = agentResponse(typeof input?.command === 'string' && input.command.trim() ? input.command.slice(0,500) : 'unknown', typeof input?.requestId === 'string' && input.requestId.trim() ? input.requestId.slice(0,128) : 'unknown');
    request = validateAgentRequest(input);
    if(request.command.startsWith('feedback.'))return await (await import('./feedback-node.mjs')).runFeedbackFileRequest(request,options);
    if(request.command==='probe'){const {probeAgentFiles}=await import('./agent-probe.mjs');const result=await executeAgentRequest(request,{probe:probeAgentFiles});if(request.params.output&&result.report){const output=path.resolve(request.params.output);await fs.mkdir(path.dirname(output),{recursive:true});const handle=await fs.open(output,'wx',0o600);try{await handle.writeFile(JSON.stringify({...result.report,protocol:result.response.protocol,engineVersion:result.response.engineVersion,requestId:request.requestId},null,2)+'\n');await handle.sync();}finally{await handle.close();}result.response.artifacts.push({kind:'media-probe-report',path:output,sha256:await current(output)});}return result.response;}
    if (request.command === 'capabilities') return (await executeAgentRequest(request)).response;
    const target = request.command === 'init' ? request.params.output ?? request.project : request.project;
    if (typeof target !== 'string' || !target.trim()) throw new AgentError('PROJECT_REQUIRED', 'Provide project path (init also accepts params.output)');
    const file = await filePath(target), root = path.dirname(file), write = request.command === 'init' || request.command === 'apply' && !request.params.dryRun;
    const budget={bytes:0};const readExistingAsset = assetReader(root,budget);
    let journal, receipt, journalFile, digest;
    if (write) {
      lease = await acquire(file, request, options.onPhase);
      journalFile = file + '.agent-journal.json'; journal = await journalRead(journalFile);
      const semantic = structuredClone(request); delete semantic.params.recover; delete semantic.params.timeoutMs;
      semantic.project = file; if (request.command === 'init') semantic.params.output = file;
      digest = hash(JSON.stringify(canonical(semantic))); const sha = await current(file);
      receipt = journal.entries.find(e => e.requestId === request.requestId);
      if (receipt && receipt.requestSha256 !== digest) throw new AgentError('REQUEST_REUSED', 'Request ID already has a different input digest');
      // Reconcile every unfinished receipt against actual bytes, never assume a rename completed.
      for (const pending of journal.entries.filter(e => e.state === 'prepared')) {
        if (sha === pending.afterSha256 && await importsPresent(root,pending.imports)) { pending.state = 'committed'; pending.response.data.applied = true;for(const entry of pending.imports??[])if(!pending.response.artifacts.some(a=>a.kind==='imported-asset'&&a.path===path.join(root,entry.relative)))pending.response.artifacts.push({kind:'imported-asset',path:path.join(root,entry.relative),sha256:entry.sha256}); }
        else if (sha === pending.beforeSha256) pending.state = 'not-applied';
        else throw new AgentError('RECOVERY_REQUIRED', 'Source differs from both sides of an unfinished request', { actual: sha, expected: pending.afterSha256 });
      }
      if (receipt && ['committed','rejected'].includes(receipt.state)) {
        if (sha !== receipt.afterSha256) throw new AgentError('REPLAY_CONFLICT', 'Source changed after this receipt', { expected: receipt.afterSha256, actual: sha });
        if(receipt.state==='committed'&&!await importsPresent(root,receipt.imports))throw new AgentError('IMPORTED_ASSET_MISSING','Committed source has missing immutable imports; repair the files with a new request');
        await journalWrite(journalFile, journal); response = structuredClone(receipt.response); response.data = { ...(response.data ?? {}), replayed: true }; return response;
      }
      if (!receipt && journal.entries.length >= 128) throw new AgentError('JOURNAL_FULL', '128 receipts retained; archive journal before starting a new request');
      if (request.command === 'init' && sha !== null) throw new AgentError('OUTPUT_EXISTS', 'Init does not overwrite existing files');
    }
    const source = request.command === 'init' ? undefined : await readText(file);
    const imports=['apply','impact'].includes(request.command)&&request.params.expectedSourceSha256===hash(source)?await prepareImports(root,request.params.imports,budget):[];
    const importedBytes=new Map(imports.map(entry=>[entry.relative,entry.bytes]));const readAsset=relative=>importedBytes.has(relative)?Promise.resolve(importedBytes.get(relative)):readExistingAsset(relative);
    const ports = request.command === 'preview' || request.command === 'build' ? await import('./agent-ports.mjs') : null;
    const result = await executeAgentRequest(request, { source, readAsset, importsPrepared:!!imports.length,
      ...(ports ? ports.createAgentPorts({ sourceFile: file, readAsset, onPhase: options.onPhase }) : {}) });
    response = result.response;
    if(result.candidate&&imports.length){assertImportsUsed(imports,result.candidate.document.project);response.data={...response.data,imports:imports.map(({relative,sha256,size})=>({path:relative,sha256,bytes:size})),unreferencedFilesPossible:false};}
    if (['test','impact'].includes(request.command) && request.params.output && result.report) {
      const output = path.resolve(request.params.output); await fs.mkdir(path.dirname(output), { recursive: true });
      const handle = await fs.open(output, 'wx', 0o600); try { await handle.writeFile(JSON.stringify({ ...result.report, source: response.project }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); } response.artifacts.push({ kind: request.command==='impact'?'impact-report':'route-report', path: output, sha256: await current(output) });
    }
    if (!write) return response;
    const before = source === undefined ? null : hash(source);
    if (await current(file) !== before) throw new AgentError('SOURCE_CONFLICT', 'Source changed before commit', { expected: before, actual: await current(file) });
    const candidate = response.ok ? result.candidate : undefined;
    const saved = structuredClone(response);
    if (candidate) { saved.project.sourceSha256 = candidate.afterSha256; saved.data = { ...saved.data, applied: true, beforeSha256: before, afterSha256: candidate.afterSha256 }; saved.artifacts.push({ kind: 'project', path: file, sha256: candidate.afterSha256 }); }
    const entry = { requestId: request.requestId, requestSha256: digest, beforeSha256: before, afterSha256: candidate?.afterSha256 ?? before, state: candidate ? 'prepared' : 'rejected', imports:importReceipt(imports), response: saved };
    if (receipt) Object.assign(receipt, entry); else journal.entries.push(entry);
    await journalWrite(journalFile, journal); await options.onPhase?.('prepared', entry);
    if (candidate) {
      const files=await publishImports(root,imports,async(phase,data)=>{importedArtifacts.push(data.artifact);await options.onPhase?.(phase,data);});saved.artifacts.push(...files);entry.response=saved;
      // All cooperating writers hold the same lease; detect external edits immediately before rename.
      if (await current(file) !== before) throw new AgentError('SOURCE_CONFLICT', 'Source changed during prepare');
      const mode = before ? (await fs.stat(file)).mode & 0o777 : 0o600;
      await atomic(file, candidate.sourceText, mode); committed = true; committedSha = candidate.afterSha256; await options.onPhase?.('renamed', entry);
      entry.state = 'committed'; await journalWrite(journalFile, journal);
    }
    return saved;
  } catch (error) {
    if(importedArtifacts.length){response.artifacts.push(...importedArtifacts);response.data={...(response.data??{}),unreferencedFilesPossible:!committed,importedFiles:importedArtifacts.map(a=>a.path)};}
    if (committed) { if (response.project) response.project.sourceSha256 = committedSha; response.data = { ...(response.data ?? {}), applied: true, recoveryRequired: true }; return failAgent(response, new AgentError('JOURNAL_ERROR', 'Source was committed; retry the identical request to reconcile receipt: ' + error.message)); }
    if (!(error instanceof AgentError)) error = new AgentError(error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : error.code === 'EEXIST' ? 'OUTPUT_EXISTS' : error instanceof TypeError ? 'INVALID_ENCODING' : 'IO_ERROR', error.message);
    return failAgent(response, error);
  } finally { await releaseAgentLease(lease); }
}
/** Supervised worker: CPU-bound routes and browsers cannot overrun the caller's deadline. */
export async function runAgentFileRequest(input, options = {}) {
  let request; try { if (typeof input === 'string' && Buffer.byteLength(input) > AGENT_LIMITS.inputBytes) return (await executeAgentRequest(input)).response; request = validateAgentRequest(typeof input === 'string' ? JSON.parse(input) : input); } catch { return (await executeAgentRequest(input)).response; }
  const response = agentResponse(request.command, request.requestId);
  if (options.signal?.aborted) return failAgent(response, new AgentError('ABORTED', 'Request cancelled', {}, 'UNVERIFIED'));
  return new Promise(resolve => {
    let done = false, lease, planned=[];const imported=[];
    const worker = new Worker(new URL('./agent-worker.mjs', import.meta.url), { workerData: request, stdout: true, stderr: true, execArgv: [] });
    worker.stdout.on('data', b => options.onLog?.(b.toString())); worker.stderr.on('data', b => options.onLog?.(b.toString()));
    const finish = async result => { if (done) return; done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); await worker.terminate();
      if(result.status!=='PASS'&&lease&&planned.length){
        const root=path.dirname(lease.file);
        for(const entry of planned){const file=path.join(root,entry.relative);try{const stat=await fs.lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=AGENT_LIMITS.assetBytes&&!imported.some(a=>a.path===file))imported.push({kind:'imported-asset',path:file,sha256:await current(file)});}catch{}}
        for(const artifact of imported)if(!result.artifacts.some(a=>a.path===artifact.path&&a.kind===artifact.kind))result.artifacts.push(artifact);
        if(imported.length)result.data={...result.data,unreferencedFilesPossible:true,importedFiles:imported.map(a=>a.path)};
      }
      await releaseAgentLease(lease); resolve(result); };
    const cancel = code => {const write=['init','apply','feedback.put','feedback.transition'].includes(request.command)&&!request.params.dryRun;response.artifacts.push(...imported); response.data = { applied: write ? 'unknown' : false, recoveryRequired: write }; finish(failAgent(response, new AgentError(code, code === 'TIMEOUT' ? 'Worker deadline exceeded; inspect source and retry identical request' : 'Request cancelled', {}, 'UNVERIFIED'))); };
    const abort = () => cancel('ABORTED');
    const timer = setTimeout(() => cancel('TIMEOUT'), request.params.timeoutMs ?? AGENT_LIMITS.requestMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', msg => { if (msg.phase === 'lease') lease = msg.data; else if(msg.phase==='prepared')planned=msg.data.imports??[]; else if(msg.phase==='imported')imported.push(msg.data.artifact); else if (msg.response) finish(msg.response); });
    worker.on('error', e => finish(failAgent(response, new AgentError('WORKER_ERROR', e.message))));
    worker.on('exit', code => { if (!done) finish(failAgent(response, new AgentError('WORKER_EXIT', 'Worker exited before responding: ' + code, {}, 'UNVERIFIED'))); });
  });
}
/** Internal primitives shared by project and independent author-review transactions. */
export const agentFileIO=Object.freeze({filePath,readText,current,atomic,acquire,releaseAgentLease,journalRead,journalWrite,assetReader,hash,canonical});
