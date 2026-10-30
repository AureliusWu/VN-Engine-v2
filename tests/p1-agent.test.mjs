import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAgentRequest,agentCapabilities} from '../dist/agent/sdk.js';
import {AGENT_RESPONSE_SCHEMA,schemaErrors} from '../dist/agent/schema.js';
import {newProject} from '../dist/editor/model.js';

const source=`vn-script 1\ngame "p1-agent"\nversion "1"\nentry start\nvar trust number 0 min 0 max 10\nblock start\nline hello "旁白" "你好"\nchoice yes "继续" -> finish with add trust 1\nblock finish\nline final "旁白" "结束"\nend 完成\n`;
const request=(command,params)=>({protocol:'vn-agent-v1',requestId:'p1-agent',command,params});

test('P1 compilation is project-independent, read-only and returns independent ranges',async()=>{
  const output=await executeAgentRequest(request('script.compile',{source,fileName:'story.vn',limit:100}));
  assert.equal(output.response.status,'PASS');assert.equal(output.response.project,null);
  assert.equal(output.candidate,undefined);assert.equal(output.reviewCandidate,undefined);assert.deepEqual(output.response.artifacts,[]);
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,output.response),[]);
  const program=output.response.data.items.find(item=>item.id==='program').program;
  assert.equal(program.game,'p1-agent');assert.equal(program.blocks[0].lines[0].id,'hello');
  assert.equal(program.sourceMap,undefined);assert.equal(program.source,undefined);
  const range=output.response.data.items.find(item=>item.kind==='source-map'&&item.entry.kind==='line');
  assert.equal(range.entry.fileName,'story.vn');assert.ok(range.entry.span.start.line>1);
  assert.deepEqual(range.entry.path,['blocks',0,'lines',0]);
  assert.ok(agentCapabilities().commands.includes('script.compile'));
  assert.ok(agentCapabilities().runtimeInspection.kinds.includes('resources'));
});

test('P1 compiler failures expose source diagnostics without a write candidate',async()=>{
  const output=await executeAgentRequest(request('script.compile',{source:source+'\neval "globalThis.pwned = true"',limit:100}));
  assert.equal(output.response.status,'FAIL');assert.equal(output.candidate,undefined);
  assert.equal(output.response.data.items.some(item=>item.id==='program'),false);
  const diagnostic=output.response.data.items.find(item=>item.kind==='diagnostic');
  assert.ok(diagnostic.code.startsWith('DSL_'));assert.ok(diagnostic.span.start.offset>=source.length);
  assert.equal(globalThis.pwned,undefined);assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,output.response),[]);
});

test('P1 compiler output fragments obey budgets and cursors bind text and file identity',async()=>{
  const long=source.replace('"你好"',JSON.stringify('中'.repeat(3000)));
  const first=(await executeAgentRequest(request('script.compile',{source:long,fileName:'a.vn',limit:1,maxBytes:4096}))).response;
  assert.ok(first.data.nextCursor);let cursor=first.data.nextCursor,fragment=false,pages=0;
  while(cursor){
    const output=(await executeAgentRequest(request('script.compile',{source:long,fileName:'a.vn',cursor,limit:1,maxBytes:4096}))).response;
    assert.equal(output.status,'PASS');assert.ok(Buffer.byteLength(JSON.stringify(output))<=4096);
    fragment ||=!!output.data.fragment;cursor=output.data.nextCursor;assert.ok(++pages<100);
  }
  assert.equal(fragment,true);
  const stale=(await executeAgentRequest(request('script.compile',{source:long+' ',fileName:'a.vn',cursor:first.data.nextCursor,maxBytes:4096}))).response;
  assert.equal(stale.diagnostics.at(-1).code,'STALE_CURSOR');
  const renamed=(await executeAgentRequest(request('script.compile',{source:long,fileName:'b.vn',cursor:first.data.nextCursor,maxBytes:4096}))).response;
  assert.equal(renamed.diagnostics.at(-1).code,'STALE_CURSOR');
});

test('P1 resource inspection uses source-bound planner with no asset IO and rejects cross-query cursors',async()=>{
  const p=newProject('script');p.game='p1-agent';p.version='1';
  p.program={schema:1,game:p.game,version:p.version,entry:'start',variables:{},blocks:[
    {id:'start',lines:[{id:'hello',speaker:'旁白',text:'现在'}],exit:{type:'jump',next:'finish'}},
    {id:'finish',cue:{background:'future'},lines:[{id:'final',speaker:'旁白',text:'未来'}],exit:{type:'end',ending:'完成'}}]};
  p.assets=[{id:'future',kind:'background',src:'future.svg'}];const original=JSON.stringify(p);let reads=0;
  const params={kind:'resources',position:{sceneId:'start',lineId:'hello'},plan:{maxDepth:2,maxVisits:16,maxAssets:16,estimates:{future:1234}},limit:100};
  const output=await executeAgentRequest(request('inspect',params),{source:original,readAsset:async()=>{reads++;throw Error('must not read');}});
  assert.equal(output.response.status,'PASS');assert.equal(reads,0);assert.equal(output.candidate,undefined);assert.equal(JSON.stringify(p),original);
  assert.equal(output.response.data.items[0].contract,'vn-resource-plan-v1');
  const asset=output.response.data.items.find(item=>item.assetId==='future');assert.ok(asset);assert.equal(asset.estimatedBytes,1234);
  assert.ok(asset.origins.every(origin=>origin.sourceSha256===output.response.project.sourceSha256));
  assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,output.response),[]);
  const first=(await executeAgentRequest(request('inspect',{...params,limit:1,maxBytes:4096}),{source:original})).response;
  assert.ok(first.data.nextCursor);
  const bad=(await executeAgentRequest(request('inspect',{...params,plan:{...params.plan,maxDepth:1},cursor:first.data.nextCursor}),{source:original})).response;
  assert.equal(bad.diagnostics.at(-1).code,'STALE_CURSOR');
  const estimates=Object.fromEntries(Array.from({length:300},(_,i)=>['asset-'+i,i]));
  const bounded=(await executeAgentRequest(request('inspect',{...params,plan:{...params.plan,estimates},limit:1,maxBytes:4096}),{source:original})).response;
  assert.ok(bounded.data.nextCursor.length<4096);
  assert.equal((await executeAgentRequest(request('inspect',{...params,plan:{...params.plan,estimates},limit:1,maxBytes:4096,cursor:bounded.data.nextCursor}),{source:original})).response.status,'PASS');
});
