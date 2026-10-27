import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runRouteSuite,validateRouteSuite,createProject} from '../dist/index.js';
import {newProject} from '../dist/editor/index.js';
import {readJSON} from './helpers.mjs';

const suite=(steps,expect,id='route-1')=>({schema:1,cases:[{id,steps,expect}]});
const action=id=>({type:'action',id});
test('actual VN, chat, script, Rain and inventory routes execute with validated save/restore at every step',()=>{
  const fixtures=[['vn',[action('continue')],{ending:'完成'}],['chat',[action('continue')],{ending:'完成'}],
    ['script',[action('yes')],{ending:'完成',variables:{trust:1}}],['investigation',[action('read'),action('back'),action('reason')],{ending:'chapter-1:complete',evidence:['note']}]];
  for(const [kind,steps,expect] of fixtures){const p=newProject(kind),before=JSON.stringify(p);const report=runRouteSuite(p,suite(steps,expect));assert.equal(report.status,'PASS',JSON.stringify(report));assert.equal(report.restoreChecks,steps.length+1);assert.equal(JSON.stringify(p),before);}
  const rain=readJSON('examples/runtime/rain.json');
  const report=runRouteSuite(rain,{schema:1,cases:[
    {id:'trust',steps:[action('trust_choice'),{type:'next'},{type:'next'}],expect:{ending:'trust',variables:{trust:1}}},
    {id:'other',steps:[action('affection_choice'),{type:'next'}],expect:{ending:'other',variables:{affection:1}}}
  ]});assert.equal(report.status,'PASS',JSON.stringify(report));assert.deepEqual(report.coverage.missing,[]);
});

test('named checkpoints rebuild variables instead of retaining future effects, and holds use virtual time',()=>{
  const p=newProject('script');p.program.blocks[0].cue={pauseMs:30_000};
  const steps=[{type:'checkpoint',id:'before'},action('yes'),{type:'restore',id:'before'},action('yes')];
  const original=globalThis.setTimeout;globalThis.setTimeout=()=>{throw Error('Real timers forbidden in route QA');};
  try {const report=runRouteSuite(p,suite(steps,{ending:'完成',variables:{trust:1}}));assert.equal(report.status,'PASS',JSON.stringify(report));assert.equal(report.restoreChecks,5);}finally{globalThis.setTimeout=original;}
});

test('mini-game input journals, skip, abort and result actions survive route checkpoints',()=>{
  const p=newProject('script'),next=p.program.blocks[1].id;
  p.program.blocks[0].exit.choices=[{id:'yes',text:'success',next},{id:'no',text:'failure',next}];
  p.program.blocks[0].cue={miniGame:{id:'puzzle',kind:'switches',initial:[false,false],target:[true,true],maxMoves:3,results:{success:'yes',failure:'no',abort:'no',skip:'yes'}}};
  for(const commands of [[{type:'mini-input',index:0},{type:'mini-input',index:1}],[{type:'mini-skip'}],[{type:'mini-abort'}]]){
    const report=runRouteSuite(p,suite([{type:'mini-start'},...commands,{type:'mini-finish'}],{ending:'完成'}));assert.equal(report.status,'PASS',JSON.stringify(report));
  }
  assert.equal(runRouteSuite(p,suite([action('yes')],{ending:'完成'})).status,'FAIL');
});

test('route reports retain failure locations and actual values and never infer missing coverage as PASS',()=>{
  const p=newProject('script');
  let report=runRouteSuite(p,suite([action('missing')],{ending:'完成'}));assert.equal(report.status,'FAIL');assert.equal(report.cases[0].failure.step,1);assert.equal(report.cases[0].final.sceneId,'start');
  report=runRouteSuite(p,suite([action('yes')],{ending:'完成',variables:{trust:9}}));assert.equal(report.status,'FAIL');assert.match(report.cases[0].failure.message,/trust.*9.*1/);assert.deepEqual(report.coverage.covered,[]);
  report=runRouteSuite(p,suite([],{sceneId:'start'}));assert.equal(report.cases[0].status,'PASS');assert.equal(report.status,'UNVERIFIED');assert.deepEqual(report.coverage.missing,['完成']);
  report=runRouteSuite(p,suite([action('yes')],{ending:'完成'}),{maxOperations:1});assert.equal(report.status,'UNVERIFIED');assert.match(report.cases[0].failure.message,/budget/);
  assert.equal(runRouteSuite(p).status,'UNVERIFIED');assert.throws(()=>validateRouteSuite(suite([{type:'javascript',code:'alert(1)'}],{ending:'完成'})));
  assert.throws(()=>validateRouteSuite({schema:1,cases:[...suite([],{ending:'完成'}).cases,...suite([],{ending:'完成'}).cases]}),/duplicate/);
});

test('route test metadata is validated by author/runtime boundaries without running the cases on normal startup',()=>{
  const p=newProject('script');p.routeTests=suite([action('missing')],{ending:'完成'});
  const instance=createProject(p,'https://test.invalid/');assert.equal(instance.session.getView().frame.sceneId,'start');instance.session.dispose();
  p.routeTests.cases[0].expect={};assert.throws(()=>createProject(p,'https://test.invalid/'),/route case/);
});

test('CLI writes a source-bound failed report and exits unsuccessfully instead of hiding failures',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vn-route-')),p=newProject('script');p.routeTests=suite([action('missing')],{ending:'完成'});
  const source=join(root,'project.json'),output=join(root,'ROUTE_REPORT.json');await writeFile(source,JSON.stringify(p));
  const result=spawnSync(process.execPath,['tools/test-routes.mjs',source,'--output='+output],{encoding:'utf8'});assert.equal(result.status,1);
  const report=JSON.parse(await readFile(output,'utf8'));assert.equal(report.status,'FAIL');assert.match(report.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(report.cases[0].failure.step,1);
});

test('independent runtime samples execute every declared ending and retain their source data',()=>{
  let cases=0,checks=0,endings=0;
  for(const name of ['campus','netlove','circuit','rain']){
    const project=readJSON('examples/runtime/'+name+'.json'),before=JSON.stringify(project),report=runRouteSuite(project);
    assert.equal(report.status,'PASS',JSON.stringify(report));assert.deepEqual(report.coverage.missing,[]);
    assert.equal(JSON.stringify(project),before);cases+=report.cases.length;checks+=report.restoreChecks;endings+=report.coverage.required.length;
  }
  assert.equal(cases,10);assert.equal(endings,11);assert.ok(checks>=70);
});
