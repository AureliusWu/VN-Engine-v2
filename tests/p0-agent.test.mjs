import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAgentRequest} from '../dist/agent/sdk.js';
import {sourceHash} from '../dist/agent/protocol.js';
import {schemaErrors,AGENT_RESPONSE_SCHEMA} from '../dist/agent/schema.js';
import {newProject} from '../dist/editor/model.js';
import {RuntimeEvidence} from '../dist/runtime/evidence.js';
import {createRuntimeEvidenceReport} from '../dist/runtime/evidence-report.js';

const project=()=>newProject('script'),serialize=value=>JSON.stringify(value,null,2)+'\n';
const request=(kind,params={})=>({protocol:'vn-agent-v1',requestId:'p0-'+kind,command:'inspect',params:{kind,...params}});
const inspect=async(source,kind,params={})=>(await executeAgentRequest(request(kind,params),{source})).response;
async function reportFor(p,source,extra=false){
  const collector=new RuntimeEvidence({sessionId:'p0-sdk',maxEvents:512});
  collector.append({type:'navigation',visit:1,sceneId:'start',lineId:'start-1',reason:'start'});
  if(extra)collector.append({type:'effect',visit:1,sceneId:'start',lineId:'start-1',effect:'stage.sound',phase:'suppressed',effectId:'se-1',attempt:0});
  return createRuntimeEvidenceReport(p,collector.snapshot(),await sourceHash(source),{runtime:true,media:false,audioDevice:false});
}

test('P0 runtime inspection is an additive read-only capability with existing save compatibility',async()=>{
  const capabilities=(await executeAgentRequest({protocol:'vn-agent-v1',requestId:'p0-cap',command:'capabilities',params:{}})).response;
  assert.equal(capabilities.data.compatibility.saveSchema,1);
  assert.equal(capabilities.data.compatibility.saveEnvelopeSchema,2);
  assert.equal(capabilities.data.compatibility.savePayloadSchema,1);
  for(const kind of ['semantics','source','evidence'])assert.ok(capabilities.data.runtimeInspection.kinds.includes(kind));
  const source=serialize(project()),result=await executeAgentRequest(request('semantics',{limit:100}),{source});
  assert.equal(result.response.status,'PASS');assert.equal(result.candidate,undefined);assert.equal(result.reviewCandidate,undefined);
  const descriptors=result.response.data.items;
  assert.ok(descriptors.some(item=>item.namespace==='script-exit'));
  assert.ok(descriptors.some(item=>item.namespace==='player-action'));
  assert.ok(descriptors.some(item=>item.namespace==='stage-cue'));
  assert.ok(descriptors.every(item=>!('handler' in item)));
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,result.response),[]);
});

test('P0 source inspection returns exact stable identity and source-bound JSON path, never guessed locations',async()=>{
  const source=serialize(project()),result=await inspect(source,'source',{selector:{nodeId:'start',lineId:'start-1'}});
  assert.equal(result.status,'PASS');assert.deepEqual(result.data.items[0].origin.path,['program','blocks',0,'lines',0]);
  assert.equal(result.data.items[0].origin.sourceSha256,await sourceHash(source));
  const formatted=await inspect(JSON.stringify(JSON.parse(source)),'source',{selector:{nodeId:'start',lineId:'start-1'}});
  assert.equal(formatted.data.items[0].origin.lineId,result.data.items[0].origin.lineId);
  assert.deepEqual(formatted.data.items[0].origin.path,result.data.items[0].origin.path);
  assert.notEqual(formatted.data.items[0].origin.sourceSha256,result.data.items[0].origin.sourceSha256);
  const unknown=await inspect(source,'source',{selector:{nodeId:'does-not-exist'}});
  assert.equal(unknown.data.items[0].located,false);assert.equal(unknown.data.items[0].origin.path,undefined);
});

test('P0 evidence inspection marks external claims unverified and distinguishes current, stale, missing and malformed binding',async()=>{
  const p=project(),source=serialize(p),document=await reportFor(p,source);
  const current=await inspect(source,'evidence',{document});
  assert.equal(current.status,'UNVERIFIED');assert.equal(current.ok,false);
  const summary=current.data.items[0];assert.equal(summary.binding,'current');assert.equal(summary.externalClaim,true);
  assert.equal(summary.scope.media,false);assert.equal(summary.scope.audioDevice,false);assert.equal(summary.acceptance,'UNVERIFIED');
  assert.deepEqual(current.data.items[1].origin.path,['program','blocks',0,'lines',0]);
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,current),[]);
  const stale=await inspect(source+' ','evidence',{document});
  assert.equal(stale.data.items[0].binding,'stale');assert.ok(stale.diagnostics.some(d=>d.code==='EVIDENCE_STALE'));
  assert.equal((await inspect(source,'evidence')).diagnostics[0].code,'EVIDENCE_REQUIRED');
  const malformed=await inspect(source,'evidence',{document:{...document,events:[{...document.events[0],sequence:999}]}});
  assert.equal(malformed.status,'FAIL');assert.equal(malformed.diagnostics[0].code,'INVALID_EVIDENCE');
});

test('P0 evidence pagination is bound to report bytes as well as the project source',async()=>{
  const p=project(),source=serialize(p),document=await reportFor(p,source);
  const first=await inspect(source,'evidence',{document,limit:1,maxBytes:4096});assert.ok(first.data.nextCursor);
  const next=await inspect(source,'evidence',{document,limit:1,maxBytes:4096,cursor:first.data.nextCursor});
  assert.equal(next.data.items[0].id,'event-1');assert.ok(Buffer.byteLength(JSON.stringify(next))<=4096);
  const changed=await inspect(source,'evidence',{document:await reportFor(p,source,true),limit:1,maxBytes:4096,cursor:first.data.nextCursor});
  assert.equal(changed.diagnostics.at(-1).code,'STALE_CURSOR');
});

test('P0 source enrichment preserves original diagnostics when author data cannot be indexed',async()=>{
  const p=project();p.program.blocks[0].lines=[null];
  const source=serialize(p),result=await executeAgentRequest({protocol:'vn-agent-v1',requestId:'p0-invalid-source',command:'validate',params:{}},{source});
  assert.equal(result.response.status,'FAIL');assert.ok(result.response.diagnostics.some(item=>item.code==='PROJECT_SHAPE'));
  assert.ok(result.response.diagnostics.every(item=>item.code!=='INTERNAL_ERROR'));
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,result.response),[]);
});
