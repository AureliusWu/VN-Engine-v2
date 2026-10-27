import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createRouteRecorder,runRouteSuite} from '../dist/index.js';
import {newProject} from '../dist/editor/index.js';

test('a manual recording excludes text-reveal clicks and becomes a replayable, independently asserted case',()=>{
  const p=newProject('script'),{session}=createProject(p,'https://route.invalid/',{settings:{textDelayMs:100}}),recorder=createRouteRecorder(session,p.type);
  session.next();assert.equal(recorder.count,0);session.act('yes');const testCase=recorder.finish('recorded');
  assert.deepEqual(testCase.steps,[{type:'action',id:'yes'}]);assert.equal(testCase.expect.variables.trust,1);assert.equal(recorder.active,false);
  assert.equal(runRouteSuite(p,{schema:1,cases:[testCase]}).status,'PASS');session.dispose();
});
test('auto and skip cannot generate unrecorded progress, while navigation invalidates and restores normal methods',()=>{
  const p=newProject('script'),{session}=createProject(p,'https://route.invalid/',{settings:{textDelayMs:0}});let invalid;
  const recorder=createRouteRecorder(session,p.type,message=>{invalid=message;});session.setAuto(true);assert.equal(session.getView().auto,false);assert.equal(session.setSkip(true),false);
  session.restart();assert.equal(recorder.active,false);assert.match(invalid,/中断/);assert.throws(()=>recorder.finish('bad'),/中断/);
  session.setAuto(true);assert.equal(session.getView().auto,true);assert.throws(()=>createRouteRecorder(session,p.type),/fresh/);session.dispose();
});
test('recorded mid-game expectations detect changed puzzle state even when the scene and text match',()=>{
  const p=newProject('script'),next=p.program.blocks[1].id;p.program.blocks[0].exit.choices=[{id:'yes',text:'yes',next},{id:'no',text:'no',next}];
  p.program.blocks[0].cue={miniGame:{id:'puzzle',kind:'switches',initial:[false,false],target:[true,true],maxMoves:3,results:{success:'yes',failure:'no',abort:'no'}}};
  const {session}=createProject(p,'https://route.invalid/',{settings:{textDelayMs:0}}),recorder=createRouteRecorder(session,p.type);session.startMiniGame();session.playMiniGame(0);
  const item=recorder.finish('middle');assert.deepEqual(item.expect.miniGame,{phase:'active',board:[true,false]});assert.equal(runRouteSuite(p,{schema:1,cases:[item]}).cases[0].status,'PASS');
  p.program.blocks[0].cue.miniGame.target=[true,false];assert.equal(runRouteSuite(p,{schema:1,cases:[item]}).cases[0].status,'FAIL');session.dispose();
});
