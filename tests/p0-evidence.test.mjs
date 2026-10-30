import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeEvidence, RuntimeSession, ScriptDriver, ScriptEngine, createRouteRecorder, runRouteSuite, resolveSourceOrigin } from '../dist/index.js';

class Clock {
  serial = 0; time = 0; tasks = new Map(); all = [];
  now = () => this.time;
  set = (callback, delay) => { const id = ++this.serial, task = { callback, due: this.time + delay }; this.tasks.set(id, task); this.all.push(task); return id; };
  clear = id => this.tasks.delete(id);
  tick() { const [id, task] = [...this.tasks].sort((a,b) => a[1].due-b[1].due)[0] ?? []; if (!task) return false; this.tasks.delete(id); this.time=task.due; task.callback(); return true; }
}
function program(mini = false) {
  return { schema:1,game:'p0-proof',version:'v1',entry:'a',variables:{trust:{initial:0,min:0,max:1}},blocks:[
    {id:'a',lines:[{id:'a1',speaker:'N',text:'A👩‍🚀B'},...(!mini?[{id:'a2',speaker:'N',text:'Second line'}]:[])],
      ...(mini?{cue:{miniGame:{id:'switch',kind:'switches',initial:[false],target:[true],maxMoves:2,results:{success:'yes',failure:'yes',abort:'yes',skip:'yes'}}}}:{}),
      exit:{type:'choice',choices:[{id:'yes',text:'Go',next:'b',effects:[{op:'add',key:'trust',value:1}]}]}},
    {id:'b',lines:[{id:'b1',speaker:'N',text:'End'}],exit:{type:'end',ending:'done'}}]};
}
function setup(evidence, options = {}) {
  const clock = new Clock(), driver = new ScriptDriver(new ScriptEngine(program(options.mini)));
  return {clock,session:new RuntimeSession(driver,{clock,evidence,settings:{textDelayMs:options.typing?10:0,autoDelayMs:20,skipDelayMs:10}})};
}

test('bounded evidence validates own data without running getters, toJSON or callbacks', () => {
  let called=0;
  assert.throws(()=>new RuntimeEvidence({get sessionId(){called++;return 'bad';}}));
  const evidence=new RuntimeEvidence({sessionId:'safe'});
  assert.equal(evidence.append({type:'input',visit:1,get outcome(){called++;return 'advanced';}}),false);
  assert.equal(evidence.append({type:'input',visit:1,toJSON(){called++;return {};}}),false);
  assert.equal(evidence.append({type:'input',visit:1,outcome:()=>{called++;}}),false);
  assert.equal(called,0); assert.equal(evidence.snapshot().dropped,3);
  assert.equal(evidence.append({type:'input',visit:1,input:'next',outcome:'advanced'}),true);
  assert.equal(evidence.snapshot().events[0].sequence,4);
});

test('event and UTF-8 byte bounds retain a visible truncated window and immutable detached snapshots', () => {
  const evidence=new RuntimeEvidence({sessionId:'budget',maxEvents:2,maxBytes:1000});
  for(let visit=1;visit<=4;visit++) evidence.append({type:'navigation',visit,reason:'advance'});
  const report=evidence.snapshot(); assert.deepEqual(report.events.map(e=>e.visit),[3,4]); assert.equal(report.dropped,2); assert.equal(report.truncated,true);
  assert.equal(report.firstSequence,3); assert.equal(report.nextSequence,5); assert.ok(report.bytes<=1000);
  assert.throws(()=>report.events.push({})); assert.throws(()=>{report.events[0].visit=99;});
  const drained=evidence.drain(); assert.equal(drained.events.length,2); assert.equal(evidence.snapshot().events.length,0);
  evidence.append({type:'navigation',visit:5,reason:'advance'}); assert.equal(report.events.length,2); assert.equal(evidence.snapshot().events[0].sequence,5);
  const bytes=new RuntimeEvidence({sessionId:'bytes',maxBytes:256});
  assert.equal(bytes.append({type:'effect',visit:1,assetId:'汉'.repeat(100)}),false);
  assert.equal(bytes.snapshot().bytes,0); assert.equal(bytes.snapshot().dropped,1);
  for(const maxEvents of [0,4097,Infinity])assert.throws(()=>new RuntimeEvidence({sessionId:'bad',maxEvents}));
  for(const sourceSha256 of ['', 'x'.repeat(64)])assert.throws(()=>new RuntimeEvidence({sessionId:'bad',sourceSha256}));
});

test('optional evidence and consumer failures do not change replay payload or invoke overridden writers', () => {
  const evidence=new RuntimeEvidence({sessionId:'isolated'}), plain=setup(), observed=setup(evidence);
  evidence.append=()=>{throw Error('consumer callback must never execute');};
  evidence.snapshot=()=>{throw Error('consumer read failure');};
  for(const item of [plain,observed]){item.session.next();item.session.act('yes');}
  assert.deepEqual(observed.session.save(),plain.session.save()); assert.deepEqual(observed.session.getView(),plain.session.getView());
  let called=0; observed.session.recordEffect({effect:'stage.sound',get phase(){called++;observed.session.restart();return 'started';}});
  assert.equal(called,0); assert.equal(observed.session.getView().frame.lineId,'b1');
  const report=RuntimeEvidence.prototype.snapshot.call(evidence);
  assert.ok(report.events.some(e=>e.type==='input'&&e.outcome==='action-applied'));
  assert.equal(JSON.stringify(observed.session.save()).includes('evidence'),false);
  assert.equal(JSON.stringify(observed.session.getSnapshot()).includes('sequence'),false);
  plain.session.dispose(); observed.session.dispose();
});

test('text completion and actual advancement have distinct outcomes and existing recorder remains replay-equivalent', () => {
  const evidence=new RuntimeEvidence({sessionId:'typing'}), {session}=setup(evidence,{typing:true});
  const recorder=createRouteRecorder(session,'script');
  assert.equal(session.next(),true); assert.equal(session.getView().frame.lineId,'a1'); assert.equal(recorder.count,0);
  assert.equal(session.next(),true); assert.equal(session.getView().frame.lineId,'a2'); assert.equal(recorder.count,1);
  assert.equal(session.next(),true); assert.equal(recorder.count,1); assert.equal(session.act('yes'),true);
  const route=recorder.finish('recorded'); assert.deepEqual(route.steps,[{type:'next'},{type:'action',id:'yes'}]);
  const project={schema:1,type:'script',game:'p0-proof',version:'v1',title:'Proof',assets:[],program:program()};
  assert.equal(runRouteSuite(project,{schema:1,cases:[route]}).status,'PASS');
  const inputs=evidence.snapshot().events.filter(e=>e.type==='input');
  assert.deepEqual(inputs.map(e=>e.outcome),['text-completed','advanced','text-completed','action-applied']);
  assert.deepEqual(inputs.map(e=>[e.visit,e.sceneId,e.lineId]),[[1,'a','a1'],[1,'a','a1'],[2,'a','a2'],[2,'a','a2']]);
  const actionOrigin=resolveSourceOrigin(project,inputs[3]);
  assert.equal(actionOrigin.nodeId,'a');assert.equal(actionOrigin.lineId,'a2');assert.equal(inputs[3].actionId,'yes');
  assert.deepEqual(actionOrigin.path,['program','blocks',0,'lines',1]);
  const events=evidence.snapshot().events,accepted=events.find(e=>e.type==='input'&&e.outcome==='action-applied');
  assert.ok(accepted.sequence<events.find(e=>e.type==='navigation'&&e.visit===3).sequence);
  session.dispose();
});

test('automatic and read-skip advancement remain distinguishable from manual input', () => {
  const evidence=new RuntimeEvidence({sessionId:'automatic'}), {session,clock}=setup(evidence);
  session.setAuto(true); clock.tick(); assert.equal(session.getView().frame.lineId,'a2');
  session.restart(); assert.equal(session.setSkip(true),true); clock.tick();
  const advanced=evidence.snapshot().events.filter(e=>e.type==='input'&&e.outcome==='advanced');
  assert.deepEqual(advanced.map(e=>e.input),['auto','skip']);assert.deepEqual(advanced.map(e=>[e.visit,e.lineId]),[[1,'a1'],[3,'a1']]);
  session.dispose();
});

test('navigation and disposal invalidate stale work without serializing evidence into saves', () => {
  const evidence=new RuntimeEvidence({sessionId:'navigation'}), {session,clock}=setup(evidence,{typing:true});
  const old=clock.all[0]; session.next(); session.next(); const save=session.save();
  session.restore(save); const restored=session.getView(); old.callback(); assert.deepEqual(session.getView(),restored);
  session.next(); session.act('yes'); assert.equal(session.rollback(),true); session.reread('0:a1'); session.restart(); session.dispose();
  const events=evidence.snapshot().events;
  for(const reason of ['start','advance','restore','rollback','reread'])assert.ok(events.some(e=>e.type==='navigation'&&e.reason===reason),reason);
  assert.equal(events.at(-1).reason,'dispose'); assert.equal(JSON.stringify(save).includes('sequence'),false);
});

test('mini-game input evidence reports accepted revisions and keeps result action at its originating visit', () => {
  const evidence=new RuntimeEvidence({sessionId:'mini'}), {session}=setup(evidence,{mini:true});
  assert.equal(session.playMiniGame(0),false); session.startMiniGame(); assert.equal(session.playMiniGame(8),false); session.playMiniGame(0);
  const saved=session.save(); assert.equal(session.finishMiniGame(),true); assert.equal(session.save().state.decisions[0].choiceId,'yes');
  const inputs=evidence.snapshot().events.filter(e=>e.type==='input');
  assert.deepEqual(inputs.map(e=>[e.input,e.outcome]),[['mini-start','mini-revised'],['mini-input','mini-revised'],['mini-finish','action-applied']]);
  assert.equal(inputs[1].index,0);assert.equal(inputs[2].visit,inputs[1].visit);assert.ok(session.getView().visit>inputs[2].visit);session.restore(saved);session.dispose();
});
