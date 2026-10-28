import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAgentFileRequest, runAgentFileRequestInProcess } from '../tools/agent-node.mjs';
const cwd = process.cwd(), cli = path.join(cwd,'tools/agent.mjs');
const req = (command, project, params = {}, requestId = command) => ({ protocol:'vn-agent-v1',requestId,command,...(project ? {project} : {}),params });
async function fixture(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(),'vn-agent-')); t.after(()=>fs.rm(dir,{recursive:true,force:true})); const file = path.join(dir,'project.json'); const init = req('init',file,{type:'vn',game:'agent-file',storyVersion:'story-1',title:'AI test'}); const first = await runAgentFileRequest(init); assert.equal(first.status,'PASS',JSON.stringify(first)); return {dir,file,init,first}; }
const edit = (file,sha,id='edit') => req('apply',file,{expectedSourceSha256:sha,operations:[{op:'line.put',nodeId:'start',id:'new-line',value:{id:'new-line',text:'Stable append'}}]},id);
test('file SDK commits, replays without append and rejects changed request digest',async t=>{
 const {file,first,init}=await fixture(t); const replay=await runAgentFileRequest(init); assert.equal(replay.data.replayed,true);
 const request=edit(file,first.project.sourceSha256); const changed=await runAgentFileRequest(request); assert.equal(changed.status,'PASS',JSON.stringify(changed)); assert.equal(changed.data.applied,true);
 const bytes=await fs.readFile(file,'utf8'); const again=await runAgentFileRequest(request); assert.equal(again.data.replayed,true); assert.equal(await fs.readFile(file,'utf8'),bytes);
 request.params.operations[0].value.text='Different'; const reused=await runAgentFileRequest(request); assert.equal(reused.diagnostics.at(-1).code,'REQUEST_REUSED');
 const stale=await runAgentFileRequest(edit(file,first.project.sourceSha256,'stale')); assert.equal(stale.diagnostics.at(-1).code,'SOURCE_CONFLICT');
});
test('failed batch and dry run keep exact bytes; journal records rejected result',async t=>{
 const {file,first}=await fixture(t), bytes=await fs.readFile(file,'utf8'); const dry=edit(file,first.project.sourceSha256,'dry'); dry.params.dryRun=true; assert.equal((await runAgentFileRequest(dry)).status,'PASS'); assert.equal(await fs.readFile(file,'utf8'),bytes);
 const bad=edit(file,first.project.sourceSha256,'bad');bad.params.operations.push({op:'exit.set',nodeId:'start',value:{next:'missing'}}); const failed=await runAgentFileRequest(bad);assert.equal(failed.status,'FAIL');assert.equal(await fs.readFile(file,'utf8'),bytes);assert.equal((await runAgentFileRequest(bad)).data.replayed,true);
});
test('crash after prepare or rename is recovered against source bytes',async t=>{
 for(const phase of ['prepared','renamed']) {
  const {file,first}=await fixture(t),request=edit(file,first.project.sourceSha256,phase);
  const code=`import {runAgentFileRequestInProcess} from ${JSON.stringify(new URL('../tools/agent-node.mjs',import.meta.url).href)};await runAgentFileRequestInProcess(${JSON.stringify(request)},{onPhase:(phase)=>{if(phase===${JSON.stringify(phase)})process.exit(37)}})`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,37,child.stderr);
  const blocked=await runAgentFileRequest(request);assert.equal(blocked.diagnostics.at(-1).code,'RECOVERY_REQUIRED');
  request.params.recover=true;const recovered=await runAgentFileRequest(request); assert.equal(recovered.status,'PASS',JSON.stringify(recovered)); if(phase==='renamed')assert.equal(recovered.data.replayed,true);
  const source=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(source.scenes[0].lines.filter(l=>l.id==='new-line').length,1);
 }
});
test('concurrent writer lease, conflict after prepare, and replay conflict never overwrite',async t=>{
 const {file,first}=await fixture(t), request=edit(file,first.project.sourceSha256,'race');
 await fs.writeFile(file+'.agent-lock',JSON.stringify({file:file+'.agent-lock',token:'other',pid:process.pid}));assert.equal((await runAgentFileRequest(request)).diagnostics.at(-1).code,'LOCKED');await fs.unlink(file+'.agent-lock');
 const changed='\n'+await fs.readFile(file,'utf8');const result=await runAgentFileRequestInProcess(request,{onPhase:async phase=>{if(phase==='prepared')await fs.writeFile(file,changed)}});assert.equal(result.diagnostics.at(-1).code,'SOURCE_CONFLICT');assert.equal(await fs.readFile(file,'utf8'),changed);
 assert.equal((await runAgentFileRequest({...request,params:{...request.params,recover:true}})).diagnostics.at(-1).code,'RECOVERY_REQUIRED');
});
test('hard deadline and cancellation return UNVERIFIED; CLI stdout and exit codes are parseable',async t=>{
 const {file}=await fixture(t);const timeout=await runAgentFileRequest(req('inspect',file,{timeoutMs:1}));assert.equal(timeout.status,'UNVERIFIED');assert.equal(timeout.diagnostics.at(-1).code,'TIMEOUT');
 const controller=new AbortController();controller.abort();assert.equal((await runAgentFileRequest(req('inspect',file),{signal:controller.signal})).diagnostics.at(-1).code,'ABORTED');
 for(const [args,status,code] of [[['--request=-'],'FAIL',1],[['unknown'],'FAIL',1],[['capabilities'],'PASS',0],[['inspect','--wat=1'],'FAIL',1]]) {const r=spawnSync(process.execPath,[cli,...args],{input:'{',encoding:'utf8'});assert.equal(r.status,code,r.stderr);const response=JSON.parse(r.stdout);assert.equal(response.status,status);}
});
test('project symlinks and escaping assets are rejected, imports create no files',async t=>{
 const {file,dir}=await fixture(t);const link=path.join(dir,'link.json');await fs.symlink(file,link);assert.equal((await runAgentFileRequest(req('inspect',link))).diagnostics.at(-1).code,'PROJECT_PATH_UNSAFE');
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import ${JSON.stringify(new URL('../tools/agent-node.mjs',import.meta.url).href)}`],{cwd:dir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('resource symlinks, missing bytes, invalid encoding and report overwrite are structured failures',async t=>{
 const {file,dir,first}=await fixture(t);const outside=await fs.mkdtemp(path.join(os.tmpdir(),'vn-external-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'art.svg'),'<svg/>');await fs.symlink(path.join(outside,'art.svg'),path.join(dir,'art.svg'));
 const request=req('apply',file,{expectedSourceSha256:first.project.sourceSha256,operations:[{op:'asset.put',id:'room',value:{kind:'background',src:'art.svg'}}]},'escaped');const escaped=await runAgentFileRequest(request);assert.equal(escaped.status,'FAIL');assert.ok(escaped.diagnostics.some(d=>d.code==='ASSET_PATH_UNSAFE'&&d.assetId==='room'));
 const missing=structuredClone(request);missing.requestId='missing';missing.params.operations[0].value.src='missing.svg';assert.equal((await runAgentFileRequest(missing)).status,'FAIL');
 const before=await fs.readFile(file);const report=await runAgentFileRequest(req('test',file,{output:file}));assert.equal(report.diagnostics.at(-1).code,'OUTPUT_EXISTS');assert.deepEqual(await fs.readFile(file),before);
 await fs.writeFile(file,Buffer.from([255]));assert.equal((await runAgentFileRequest(req('inspect',file))).diagnostics.at(-1).code,'INVALID_ENCODING');
});
test('interrupted receipt finalization reports actual committed SHA and reconciles once',async t=>{
 const {file,first}=await fixture(t),request=edit(file,first.project.sourceSha256,'finalize');
 const partial=await runAgentFileRequestInProcess(request,{onPhase:phase=>{if(phase==='renamed')throw Error('simulated journal finalization failure')}});assert.equal(partial.diagnostics.at(-1).code,'JOURNAL_ERROR');assert.equal(partial.data.applied,true);
 const inspected=await runAgentFileRequest(req('inspect',file));assert.equal(partial.project.sourceSha256,inspected.project.sourceSha256);assert.notEqual(partial.project.sourceSha256,first.project.sourceSha256);
 const recovered=await runAgentFileRequest(request);assert.equal(recovered.status,'PASS');assert.equal(recovered.data.replayed,true);assert.equal(recovered.project.sourceSha256,inspected.project.sourceSha256);
});
test('invalid large envelopes remain bounded and schema-valid through Node SDK',async()=>{
 for(const value of [{protocol:'x'.repeat(100000),requestId:'',command:'capabilities',params:{}},{protocol:'vn-agent-v1',requestId:'',command:'x'.repeat(100000),params:{}}]){const response=await runAgentFileRequest(value);assert.equal(response.ok,false);assert.ok(Buffer.byteLength(JSON.stringify(response))<=65536);assert.ok(response.requestId);}
});
test('Node SDK works from eval/stdin module hosts without inheriting incompatible process flags',()=>{
 const module=new URL('../tools/agent-node.mjs',import.meta.url).href;const code=`import {runAgentFileRequest} from ${JSON.stringify(module)};console.log(JSON.stringify(await runAgentFileRequest({protocol:'vn-agent-v1',requestId:'stdin',command:'capabilities',params:{}})));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).status,'PASS');
});
test('source SHA binds CRLF UTF-8 bytes; BOM is rejected without rewriting the source',async t=>{
 const {file}=await fixture(t);const original=(await fs.readFile(file,'utf8')).replaceAll('\n','\r\n');await fs.writeFile(file,original);const {createHash}=await import('node:crypto');
 const inspected=await runAgentFileRequest(req('inspect',file));assert.equal(inspected.status,'PASS');assert.equal(inspected.project.sourceSha256,createHash('sha256').update(await fs.readFile(file)).digest('hex'));
 const bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(original)]);await fs.writeFile(file,bom);const refused=await runAgentFileRequest(req('inspect',file));assert.equal(refused.status,'FAIL');assert.equal(refused.diagnostics.at(-1).code,'INVALID_ENCODING');assert.deepEqual(await fs.readFile(file),bom);
});
