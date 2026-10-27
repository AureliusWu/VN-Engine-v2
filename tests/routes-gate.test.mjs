import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateProjectCompliance,ReleaseRouteGateError,createProject} from '../dist/index.js';
import {buildQaReport} from '../tools/qa-report.mjs';
import {packageGame} from '../tools/package-game.mjs';
import {qaFixture,writeQaFixture} from './qa-fixture.mjs';

const mutations=[
  ['missing',p=>{delete p.routeTests;},'UNVERIFIED'],
  ['failed',p=>{p.routeTests.cases[0].expect.ending='wrong';},'FAIL'],
  ['uncovered',p=>{p.scenes.push({id:'second',lines:[{id:'second-line',speaker:'N',text:'Another declared ending'}],ending:'second'});},'UNVERIFIED']
];

test('release requires real passing cases and every declared ending while development playback stays compatible',()=>{
  assert.equal(validateProjectCompliance(qaFixture().project,{mode:'release'}).routeGate.status,'PASS');
  for(const [name,mutate,status] of mutations){
    const {project}=qaFixture();mutate(project);
    const instance=createProject(project,'https://test.invalid/');assert.equal(instance.session.getView().frame.sceneId,'start');instance.session.dispose();
    assert.equal(validateProjectCompliance(project).mode,'development');
    assert.throws(()=>validateProjectCompliance(project,{mode:'release'}),error=>error instanceof ReleaseRouteGateError&&error.report.status===status,name);
  }
});

test('QA aggregation preserves route failures independently of art, human evidence and files',async()=>{
  for(const [name,mutate,status] of mutations){
    const root=await mkdtemp(join(tmpdir(),'vn-routes-qa-')),{project,picture}=qaFixture();mutate(project);
    if(name==='failed'){project.releaseEvidence.art.room.ART_READY='FAIL';project.releaseEvidence.qa.story.status='FAIL';}
    const source=await writeQaFixture(root,project,picture);
    if(name==='failed')await writeFile(join(root,'assets/room.svg'),'damaged');
    const report=await buildQaReport(source);assert.equal(report.status,'BLOCKED');assert.equal(report.routes.status,status);
    assert.equal(report.structure.status,'PASS');assert.equal(report.formalStructure.status,'PASS');
    if(name==='failed'){assert.equal(report.art.release,'BLOCKED');assert.equal(report.humanQa.release,'BLOCKED');assert.equal(report.files.status,'FAIL');}
  }
});

test('formal CLI and direct package API reject missing routes with a machine report and preserve output',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vn-routes-package-')),{project,picture}=qaFixture();delete project.routeTests;
  const source=await writeQaFixture(root,project,picture),output=join(root,'candidate');
  const cli=spawnSync(process.execPath,['tools/validate-project.mjs','--release',source],{encoding:'utf8'});
  assert.equal(cli.status,1);const line=cli.stderr.split('\n').find(line=>line.startsWith('SPEC_ROUTE_GATE_BLOCKED '));assert.ok(line,cli.stderr);
  assert.equal(JSON.parse(line.slice('SPEC_ROUTE_GATE_BLOCKED '.length)).status,'UNVERIFIED');
  const old=process.env.VN_RELEASE_BUILD;process.env.VN_RELEASE_BUILD='1';
  try{await assert.rejects(packageGame(source,output),error=>error instanceof ReleaseRouteGateError);await assert.rejects(access(output));}
  finally{if(old===undefined)delete process.env.VN_RELEASE_BUILD;else process.env.VN_RELEASE_BUILD=old;}
  assert.equal(JSON.parse(await readFile(source,'utf8')).routeTests,undefined);
});
