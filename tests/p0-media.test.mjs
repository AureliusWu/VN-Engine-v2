import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeEvidence, RuntimeSession, NarrativeEngine, NarrativeDriver, MediaDirector, AssetCatalog, SceneLoop } from '../dist/index.js';
import { tick } from './helpers.mjs';

function audioContext() {
  const sources=[];
  const gain=()=>({gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}},connect(target){return target;},disconnect(){this.disconnected=true;}});
  return {state:'running',currentTime:0,destination:{},sources,createGain:gain,
    async resume(){this.state='running';},async suspend(){this.state='suspended';},
    async decodeAudioData(){return {length:8,numberOfChannels:1};},
    createBufferSource(){const source={buffer:null,loop:false,started:0,connect(target){return target;},disconnect(){},start(){this.started++;},stop(){this.onended?.();}};sources.push(source);return source;}};
}
function setup(options={}) {
  const evidence=new RuntimeEvidence({sessionId:'media-proof'});
  const driver=new NarrativeDriver(new NarrativeEngine({game:'p0-media',storyVersion:'v1',entry:'a',stats:{},scenes:[
    {id:'a',lines:[{id:'a1',speaker:'N',text:'First'},{id:'a2',speaker:'N',text:'Second'}],ending:'done'}
  ]}),{lines:{a1:{sound:'cue',...(options.voice===false?{}:{voice:'voice'})},a2:{sound:'cue'}}});
  const session=new RuntimeSession(driver,{evidence,settings:{textDelayMs:0},initialPause:options.initialPause});
  const assets=new AssetCatalog([{id:'voice',kind:'audio',src:'voice.wav'},{id:'cue',kind:'audio',src:'cue.wav'}],'https://proof.invalid/');
  const context=audioContext(),players=[],errors=[];
  const media=new MediaDirector(session,assets,{context,onError:message=>errors.push(message),createAudio:src=>{
    if(options.failCreate&&src.endsWith('cue.wav'))throw Error('audio factory failed');
    const player={src,volume:0,paused:true,ended:false,currentTime:0,plays:0,onended:null,onerror:null,
      play(){this.plays++;this.paused=false;return options.play?.(this)??Promise.resolve();},pause(){this.paused=true;},removeAttribute(){},load(){}};
    players.push(player);return player;
  }});
  return {evidence,session,media,context,players,errors};
}
const effectEvents=(evidence,effect)=>evidence.snapshot().events.filter(e=>e.type==='effect'&&e.effect===effect);

test('SE restore policy produces suppressed evidence without replaying once-only audio',async t=>{
  const env=setup();t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  env.session.next();await tick();assert.equal(env.session.rollback(),true);await tick();env.session.restore(env.session.save());await tick();
  assert.equal(env.players.filter(p=>p.src.endsWith('cue.wav')).length,2);
  const events=effectEvents(env.evidence,'stage.sound');
  assert.equal(events.filter(e=>e.phase==='started').length,2);assert.equal(events.filter(e=>e.phase==='suppressed').length,2);
  assert.deepEqual(events.filter(e=>e.phase==='suppressed').map(e=>e.reason),['rollback','restore']);
  assert.ok(events.every(e=>e.assetId==='cue'&&e.lineId&&e.effectId&&e.attempt>=1));
  assert.equal(env.session.getView().voiceBlocked,true);
});

test('paused first-visit SE stays scheduled until readable and resumes the same player without a new one-shot',async t=>{
  const env=setup({voice:false,initialPause:'title'});t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  assert.equal(env.players.length,0);assert.deepEqual(effectEvents(env.evidence,'stage.sound').map(e=>e.phase),['scheduled']);
  env.session.pause('title',false);await tick();const player=env.players[0];player.currentTime=.4;
  env.session.pause('panel',true);env.session.pause('background',true);env.session.pause('panel',false);await tick();assert.equal(player.plays,1);
  env.session.pause('background',false);await tick();assert.equal(player.plays,2);assert.equal(player.currentTime,.4);assert.equal(env.players.length,1);
  const events=effectEvents(env.evidence,'stage.sound');assert.equal(events.filter(e=>e.phase==='scheduled').length,1);
  assert.deepEqual(events.filter(e=>['started','resumed'].includes(e.phase)).map(e=>[e.phase,e.attempt]),[['started',1],['resumed',2]]);
  player.onended();assert.equal(effectEvents(env.evidence,'stage.sound').at(-1).phase,'settled');
});

test('late SE play resolution after another pause never records a successful obsolete attempt',async t=>{
  let resolve;
  const env=setup({voice:false,play:player=>player.plays===2?new Promise(done=>{resolve=()=>{player.paused=false;done();};}):Promise.resolve()});
  t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  env.session.pause('panel',true);env.session.pause('panel',false);env.session.hide(true);resolve();await tick();
  assert.equal(env.players[0].paused,true);assert.equal(effectEvents(env.evidence,'stage.sound').filter(e=>e.phase==='resumed').length,0);
  env.session.hide(false);await tick();assert.equal(effectEvents(env.evidence,'stage.sound').filter(e=>e.phase==='resumed').length,1);
  assert.equal(env.players.length,1);
});

test('failed and stale SE completions preserve the current visit and report only relevant failure',async t=>{
  let reject;
  const env=setup({voice:false,play:player=>player.plays===2?new Promise((resolve,failed)=>{reject=failed;}):Promise.resolve()});
  t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  env.session.pause('panel',true);env.session.pause('panel',false);env.session.next();reject(Error('obsolete'));await tick();
  assert.deepEqual(env.errors,[]);assert.equal(effectEvents(env.evidence,'stage.sound').filter(e=>e.phase==='failed').length,0);
  const current=env.players.at(-1);current.onerror();assert.equal(effectEvents(env.evidence,'stage.sound').at(-1).phase,'failed');
  assert.equal(env.session.getView().frame.lineId,'a2');assert.equal(env.errors.length,1);
});

test('synchronous SE factory failure settles its consumed cue with inspectable evidence',async t=>{
  const env=setup({voice:false,failCreate:true});t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  assert.deepEqual(effectEvents(env.evidence,'stage.sound').map(e=>e.phase),['scheduled','failed']);
  assert.equal(effectEvents(env.evidence,'stage.sound').at(-1).code,'SE_START_FAILED');assert.equal(env.errors.length,1);
  env.session.pause('panel',true);env.session.pause('panel',false);await tick();
  assert.equal(env.errors.length,1);assert.equal(env.session.getView().frame.lineId,'a1');
});

test('voice blocked, resumed, paused and ended outcomes reflect actual player lifecycle',async t=>{
  const env=setup({play:player=>player.src.endsWith('voice.wav')&&player.plays===1?Promise.reject(Object.assign(Error('gesture'),{name:'NotAllowedError'})):Promise.resolve()});
  t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  assert.ok(effectEvents(env.evidence,'stage.voice').some(e=>e.phase==='blocked'));assert.equal(env.session.getView().voiceBlocked,true);
  await env.media.unlock();await tick();const voice=env.players.find(p=>p.src.endsWith('voice.wav'));voice.currentTime=.3;
  env.session.pause('panel',true);env.session.pause('panel',false);await tick();
  assert.equal(env.players.filter(p=>p.src.endsWith('voice.wav')).length,1);assert.equal(voice.currentTime,.3);
  voice.onended();assert.equal(env.session.getView().voiceBlocked,false);assert.equal(effectEvents(env.evidence,'stage.voice').at(-1).phase,'settled');
  assert.ok(effectEvents(env.evidence,'stage.voice').filter(e=>e.phase==='started').every(e=>e.attempt>=2));
});

test('voice failure releases auto blocking while its evidence remains inspectable',async t=>{
  const env=setup({play:player=>player.src.endsWith('voice.wav')?Promise.reject(Error('bad media')):Promise.resolve()});
  t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  assert.equal(env.session.getView().voiceBlocked,false);assert.ok(effectEvents(env.evidence,'stage.voice').some(e=>e.phase==='failed'&&e.code==='VOICE_PLAYBACK_FAILED'));
  assert.equal(env.session.next(),true);
});

test('audio graph resume failure marks current durable music blocked without advancing or starting it',async t=>{
  const evidence=new RuntimeEvidence({sessionId:'graph-failure'}),context=audioContext();context.state='suspended';context.resume=async()=>{throw Error('audio device unavailable');};
  const driver=new NarrativeDriver(new NarrativeEngine({game:'graph-proof',storyVersion:'v1',entry:'a',stats:{},scenes:[{id:'a',lines:[{id:'a1',speaker:'N',text:'First'},{id:'a2',speaker:'N',text:'Second'}],ending:'done'}]}),{defaults:{music:'bgm'}});
  const session=new RuntimeSession(driver,{evidence,settings:{textDelayMs:0}}),errors=[];
  const media=new MediaDirector(session,new AssetCatalog([{id:'bgm',kind:'audio',src:'bgm.wav'}],'https://proof.invalid/'),{context,onError:error=>errors.push(error)});
  t.after(()=>{media.dispose();session.dispose();});await media.unlock();await tick();
  assert.ok(effectEvents(evidence,'stage.music').some(e=>e.phase==='blocked'&&e.code==='AUDIO_GRAPH_TRANSITION_FAILED'&&e.lineId==='a1'));
  assert.equal(effectEvents(evidence,'stage.music').filter(e=>e.phase==='started').length,0);assert.equal(context.sources.length,0);
  assert.equal(session.getView().frame.lineId,'a1');assert.equal(session.next(),true);assert.ok(errors.length>=1);
});

test('re-enabling voice in the same visit creates a new attempt with its own terminal outcome',async t=>{
  const env=setup();t.after(()=>{env.media.dispose();env.session.dispose();});await tick();
  env.session.configure({voiceEnabled:false});env.session.configure({voiceEnabled:true});await tick();
  const voices=env.players.filter(p=>p.src.endsWith('voice.wav'));assert.equal(voices.length,2);voices[1].onended();
  const events=effectEvents(env.evidence,'stage.voice');
  assert.ok(events.every(e=>e.attempt>=1));assert.deepEqual(events.filter(e=>e.phase==='started').map(e=>e.attempt),[1,2]);
  assert.equal(events.at(-1).phase,'settled');assert.equal(events.at(-1).attempt,2);
});

test('music failures can retry and persistent same-track visits retain rather than restart their source',async t=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return {ok:requests>1,arrayBuffer:async()=>new ArrayBuffer(1)};};
  t.after(()=>{globalThis.fetch=original;});
  const evidence=new RuntimeEvidence({sessionId:'loop-retry'}),context=audioContext(),loop=new SceneLoop(context,context.createGain());t.after(()=>loop.dispose());
  const identity={collector:evidence,visit:1,sceneId:'a',lineId:'a1',reason:'start',assetId:'bgm',effect:'stage.music',effectId:'1:stage.music'};
  loop.select('https://proof.invalid/bgm.wav',identity);await tick();assert.ok(effectEvents(evidence,'stage.music').some(e=>e.phase==='failed'));
  loop.select('https://proof.invalid/bgm.wav',identity);await tick();assert.equal(context.sources.length,1);assert.equal(requests,2);
  loop.select('https://proof.invalid/bgm.wav',{...identity,visit:2,lineId:'a2',effectId:'2:stage.music'});await tick();
  assert.equal(context.sources.length,1);assert.ok(effectEvents(evidence,'stage.music').some(e=>e.phase==='retained'&&e.visit===2));
  assert.ok(effectEvents(evidence,'stage.music').some(e=>e.phase==='started'&&e.attempt===2));
  loop.dispose();assert.equal(effectEvents(evidence,'stage.music').at(-1).phase,'cancelled');
});

test('cancelled old music download cannot start or emit a false successful event for a newer selection',async t=>{
  const original=globalThis.fetch;let completeOld,oldSignal;
  globalThis.fetch=(url,{signal})=>url.endsWith('old.wav')?new Promise(resolve=>{oldSignal=signal;completeOld=()=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});}):Promise.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
  t.after(()=>{globalThis.fetch=original;});
  const evidence=new RuntimeEvidence({sessionId:'loop-race'}),context=audioContext(),loop=new SceneLoop(context,context.createGain());t.after(()=>loop.dispose());
  const identity={collector:evidence,visit:1,sceneId:'a',lineId:'a1',reason:'start',effect:'stage.ambience',effectId:'1:stage.ambience',assetId:'old'};
  loop.select('https://proof.invalid/old.wav',identity);
  loop.select('https://proof.invalid/new.wav',{...identity,visit:2,assetId:'new',effectId:'2:stage.ambience'});await tick();completeOld();await tick();
  assert.equal(oldSignal.aborted,true);assert.equal(context.sources.length,1);
  assert.deepEqual(effectEvents(evidence,'stage.ambience').filter(e=>e.phase==='started').map(e=>e.assetId),['new']);
  assert.ok(effectEvents(evidence,'stage.ambience').some(e=>e.assetId==='old'&&e.phase==='cancelled'));
});

test('same pending music selection changes evidence owner without claiming an already-playing source',async t=>{
  const original=globalThis.fetch;let complete,requests=0;
  globalThis.fetch=()=>{requests++;return new Promise(resolve=>{complete=()=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});});};
  t.after(()=>{globalThis.fetch=original;});
  const evidence=new RuntimeEvidence({sessionId:'loop-owner'}),context=audioContext(),loop=new SceneLoop(context,context.createGain());t.after(()=>loop.dispose());
  const identity={collector:evidence,visit:1,sceneId:'a',lineId:'a1',reason:'start',effect:'stage.music',effectId:'1:stage.music',assetId:'bgm'};
  loop.select('https://proof.invalid/bgm.wav',identity);loop.select('https://proof.invalid/bgm.wav',{...identity,visit:2,lineId:'a2',effectId:'2:stage.music'});
  assert.equal(effectEvents(evidence,'stage.music').filter(e=>e.phase==='retained').length,0);complete();await tick();
  assert.equal(requests,1);assert.equal(context.sources.length,1);
  assert.deepEqual(effectEvents(evidence,'stage.music').filter(e=>e.phase==='started').map(e=>e.visit),[2]);
});
