import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runAgentFileRequest,runAgentFileRequestInProcess} from '../tools/agent-node.mjs';
import {importAssetPath} from '../tools/agent-imports.mjs';
import {executeAgentRequest} from '../dist/agent/index.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const req=(command,project,params={},requestId=command)=>({protocol:'vn-agent-v1',requestId,command,...(project?{project}:{}),params});
async function setup(t){const dir=await fs.mkdtemp(path.join(tmpdir(),'vn-import-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const work=path.join(dir,'work');await fs.mkdir(work);const project=path.join(work,'project.json');const init=await runAgentFileRequest(req('init',project,{type:'script',game:'import-test',storyVersion:'1',title:'Import'}));assert.equal(init.status,'PASS');const source=path.join(dir,'room.svg'),bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>');await fs.writeFile(source,bytes);const sha256=hash(bytes),relative=importAssetPath(sha256,'svg');const edit=req('apply',project,{expectedSourceSha256:init.project.sourceSha256,imports:[{source,sha256,extension:'svg'}],operations:[{op:'asset.put',id:'room',value:{kind:'background',src:relative,sha256}},{op:'stage.set',scope:'defaults',value:{background:'room'}}]},'import-once');return{dir,work,project,source,bytes,sha256,relative,edit};}
test('dry-run validates external bytes without creating files; commit and replay use immutable blobs',async t=>{
 const f=await setup(t),before=await fs.readFile(f.project);const dry=structuredClone(f.edit);dry.params.dryRun=true;assert.equal((await runAgentFileRequest(dry)).status,'PASS');await assert.rejects(fs.access(path.join(f.work,'assets')));assert.deepEqual(await fs.readFile(f.project),before);
 const written=await runAgentFileRequest(f.edit);assert.equal(written.status,'PASS',JSON.stringify(written));assert.equal(written.data.applied,true);assert.deepEqual(await fs.readFile(path.join(f.work,f.relative)),f.bytes);await fs.unlink(f.source);const replay=await runAgentFileRequest(f.edit);assert.equal(replay.data.replayed,true);assert.equal(replay.project.sourceSha256,written.project.sourceSha256);
 await fs.unlink(path.join(f.work,f.relative));const missing=await runAgentFileRequest(f.edit);assert.equal(missing.status,'FAIL');assert.equal(missing.diagnostics.at(-1).code,'IMPORTED_ASSET_MISSING');
});
test('source SHA conflicts, existing blob conflicts, failed batches and unused imports never rewrite project',async t=>{
 const f=await setup(t),before=await fs.readFile(f.project);await fs.writeFile(f.source,'changed');assert.equal((await runAgentFileRequest(f.edit)).diagnostics.at(-1).code,'IMPORT_SOURCE_CONFLICT');await fs.writeFile(f.source,f.bytes);
 await fs.mkdir(path.dirname(path.join(f.work,f.relative)),{recursive:true});await fs.writeFile(path.join(f.work,f.relative),'wrong');assert.equal((await runAgentFileRequest(f.edit)).diagnostics.at(-1).code,'IMPORT_CONFLICT');await fs.unlink(path.join(f.work,f.relative));
 const bad=structuredClone(f.edit);bad.requestId='broken';bad.params.operations.push({op:'exit.set',nodeId:'start',value:{type:'jump',next:'missing'}});assert.equal((await runAgentFileRequest(bad)).status,'FAIL');await assert.rejects(fs.access(path.join(f.work,f.relative)));
 const unused=structuredClone(f.edit);unused.requestId='unused';unused.params.operations=[{op:'project.patch',value:{title:'No binding'}}];assert.equal((await runAgentFileRequest(unused)).diagnostics.at(-1).code,'IMPORT_UNUSED');assert.deepEqual(await fs.readFile(f.project),before);
});
test('actual crash after first blob publication resumes without its external source and commits once',async t=>{
 const f=await setup(t),before=await fs.readFile(f.project),second=path.join(f.dir,'second.svg'),bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>'),sha256=hash(bytes),relative=importAssetPath(sha256,'svg');await fs.writeFile(second,bytes);f.edit.params.imports.push({source:second,sha256,extension:'svg'});f.edit.params.operations.push({op:'asset.put',id:'second',value:{kind:'cg',src:relative,sha256}});
 const code=`import {runAgentFileRequestInProcess}from ${JSON.stringify(new URL('../tools/agent-node.mjs',import.meta.url).href)};await runAgentFileRequestInProcess(${JSON.stringify(f.edit)},{onPhase:phase=>{if(phase==='imported')process.exit(37)}});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,37,child.stderr);assert.deepEqual(await fs.readFile(f.project),before);await fs.unlink(f.source);f.edit.params.recover=true;const resumed=await runAgentFileRequest(f.edit);assert.equal(resumed.status,'PASS',JSON.stringify(resumed));assert.deepEqual(await fs.readFile(path.join(f.work,relative)),bytes);assert.equal((await runAgentFileRequest(f.edit)).data.replayed,true);
});
test('prepared no-op source edit still publishes its missing asset before replay can pass',async t=>{
 const f=await setup(t);const p=JSON.parse(await fs.readFile(f.project));p.assets=[{id:'room',kind:'background',src:f.relative,sha256:f.sha256}];const source=JSON.stringify(p,null,2)+'\n';await fs.writeFile(f.project,source);f.edit.params.expectedSourceSha256=hash(source);f.edit.params.operations=[{op:'project.patch',value:{title:p.title}}];
 const code=`import {runAgentFileRequestInProcess}from ${JSON.stringify(new URL('../tools/agent-node.mjs',import.meta.url).href)};await runAgentFileRequestInProcess(${JSON.stringify(f.edit)},{onPhase:phase=>{if(phase==='prepared')process.exit(38)}});`;const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,38,child.stderr);await assert.rejects(fs.access(path.join(f.work,f.relative)));f.edit.params.recover=true;const resumed=await runAgentFileRequest(f.edit);assert.equal(resumed.status,'PASS',JSON.stringify(resumed));assert.deepEqual(await fs.readFile(path.join(f.work,f.relative)),f.bytes);
});
test('partial import failures list unreferenced files and keep the project bytes',async t=>{
 const f=await setup(t),before=await fs.readFile(f.project);const failed=await runAgentFileRequestInProcess(f.edit,{onPhase:phase=>{if(phase==='imported')throw Error('simulated interruption')}});assert.equal(failed.status,'FAIL');assert.equal(failed.data.unreferencedFilesPossible,true);assert.ok(failed.artifacts.some(a=>a.kind==='imported-asset'));assert.deepEqual(await fs.readFile(f.project),before);
});
test('symlink import parents are refused; pure SDK requires an explicit import/decoder host',async t=>{
 const f=await setup(t),external=path.join(f.dir,'external');await fs.mkdir(external);await fs.symlink(external,path.join(f.work,'assets'));const failed=await runAgentFileRequest(f.edit);assert.equal(failed.diagnostics.at(-1).code,'IMPORT_PATH_UNSAFE');assert.deepEqual(await fs.readdir(external),[]);
 const probe=await executeAgentRequest(req('probe',null,{files:[{id:'x',kind:'background',file:f.source}]}));assert.equal(probe.response.status,'UNVERIFIED');assert.equal(probe.response.diagnostics.at(-1).code,'HOST_PORT_REQUIRED');
 const apply=await executeAgentRequest(f.edit,{source:await fs.readFile(f.project,'utf8')});assert.equal(apply.response.diagnostics.at(-1).code,'HOST_PORT_REQUIRED');assert.equal(apply.candidate,undefined);
});
