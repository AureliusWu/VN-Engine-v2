/** Real CLI subprocess checks, shared by Linux and Windows CI. */
import { runAgentExamples } from './agent-example.mjs';
import { promises as fs } from 'node:fs';
import { spawnSync,execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const output=path.resolve(process.argv[2]??'test-results/agent-cli');
const result=await runAgentExamples(output,{transport:'cli',preview:false});
const file=path.join(output,'script/project.json');
function invoke(request){const child=spawnSync(process.execPath,['tools/agent.mjs','--request=-'],{input:typeof request==='string'?request:JSON.stringify(request),encoding:'utf8',timeout:65000});assert.equal(child.error,undefined);const response=JSON.parse(child.stdout);assert.equal(child.status,{PASS:0,FAIL:1,BLOCKED:2,UNVERIFIED:3}[response.status]);return response;}
const req=(command,params={},id='negative-'+command)=>({protocol:'vn-agent-v1',requestId:id,command,project:file,params});
const diagnostics=[];
for(const [request,code]of [['{','MALFORMED_JSON'],[req('bad'),'UNKNOWN_COMMAND'],[req('inspect',{limit:0}),'INVALID_REQUEST'],[req('test',{timeoutMs:1}),'TIMEOUT'],[req('apply',{expectedSourceSha256:'0'.repeat(64),operations:[{op:'project.patch',value:{title:'Stale'}}]}),'SOURCE_CONFLICT']]){const response=invoke(request);assert.equal(response.diagnostics.at(-1).code,code,JSON.stringify(response));diagnostics.push(response);}
const read=invoke(req('inspect'));const batch=req('apply',{expectedSourceSha256:read.project.sourceSha256,operations:[{op:'project.patch',value:{title:'CLI replay check'}}]},'retry-once');assert.equal(invoke(batch).status,'PASS');assert.equal(invoke(batch).data.replayed,true);
const saved=await fs.readFile(file,'utf8');const broken=invoke(req('apply',{expectedSourceSha256:invoke(req('inspect')).project.sourceSha256,operations:[{op:'exit.set',nodeId:'start',value:{type:'jump',next:'missing'}}]},'broken-link'));assert.equal(broken.status,'FAIL');assert.equal(await fs.readFile(file,'utf8'),saved);
const report={status:'PASS',platform:process.platform,node:process.version,engineVersion:read.engineVersion,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),flows:result.sourceHashes,calls:result.calls,diagnostics,replay:true,failedBatchPreserved:true};await fs.writeFile(path.join(output,'CLI_REPORT.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,diagnostics:diagnostics.map(r=>r.diagnostics.at(-1).code)}));
