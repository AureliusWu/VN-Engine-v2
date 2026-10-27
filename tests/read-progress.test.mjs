import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadProgress,createProject,readSignature,MAX_READ_RECORDS,MAX_READ_PROGRESS_BYTES} from '../dist/index.js';
import {memoryStorage} from './helpers.mjs';

const project=()=>({schema:1,game:'read-fixture',version:'v1',title:'Read fixture',type:'narrative',assets:[],
  scenes:[{id:'a',lines:[{id:'one',speaker:'N',text:'First'},{id:'two',speaker:'N',text:'Second'}],choices:[{id:'yes',text:'Yes',next:'end'}]},
    {id:'end',lines:[{id:'done',speaker:'N',text:'Done'}],ending:'done'}]});
const signature=(id,text=id,speaker='N')=>readSignature({lineId:id,speaker,text});

test('only fully displayed unpaused text reaches persistent read progress; skip stops at new text and choices',()=>{
  const p=project(),storage=memoryStorage(),progress=createReadProgress(p.game,p.version,storage);
  const tasks=new Map();let serial=0;
  const clock={now:()=>0,set:fn=>{tasks.set(++serial,fn);return serial;},clear:id=>tasks.delete(id)};
  const {session}=createProject(p,'https://test.invalid/',{readProgress:progress,settings:{textDelayMs:10},clock,initialPause:'title'});
  assert.equal(progress.count,0);session.configure({textDelayMs:0});assert.equal(progress.count,0);
  session.pause('title',false);assert.equal(progress.count,1);session.configure({textDelayMs:10});session.next();assert.equal(progress.count,1);
  session.pause('panel',true);session.configure({textDelayMs:0});assert.equal(progress.count,1);session.pause('panel',false);assert.equal(progress.count,2);
  assert.equal(session.setSkip(true),false);session.restart();assert.equal(session.setSkip(true),true);
  const advance=[...tasks.values()][0];advance();assert.equal(session.getView().frame.lineId,'two');assert.equal(session.getView().skipping,false);assert.equal(session.save().state.decisions.length,0);
  assert.equal(progress.flush().status,'saved');session.dispose();
});

test('new sessions reuse exact markers while changed text, speaker, game or story version stays unread',()=>{
  const p=project(),storage=memoryStorage();let progress=createReadProgress(p.game,p.version,storage);
  let {session}=createProject(p,'https://test.invalid/',{readProgress:progress,settings:{textDelayMs:0}});progress.flush();session.dispose();
  progress=createReadProgress(p.game,p.version,storage);({session}=createProject(p,'https://test.invalid/',{readProgress:progress,settings:{textDelayMs:0}}));
  assert.equal(session.setSkip(true),true);session.dispose();
  for(const change of ['text','speaker','game','version']){
    const other=project();if(change==='text')other.scenes[0].lines[0].text='Changed';else if(change==='speaker')other.scenes[0].lines[0].speaker='Other';else other[change]+='-changed';
    const store=createReadProgress(other.game,other.version,storage);const game=createProject(other,'https://test.invalid/',{readProgress:store,settings:{textDelayMs:0}}).session;
    assert.equal(game.setSkip(true),false,change);game.dispose();
  }
});

test('rollback never marks read progress and imported history is not copied into persistent markers',()=>{
  const p=project(),calls=[];
  const {session}=createProject(p,'https://test.invalid/',{readProgress:{has:()=>false,mark:key=>calls.push(key)},settings:{textDelayMs:0}});
  session.next();const before=calls.length;assert.equal(session.rollback(),true);assert.equal(calls.length,before);
  session.next();session.act('yes');const saved=session.save();session.dispose();
  const store=createReadProgress(p.game,p.version,memoryStorage()),restored=createProject(p,'https://test.invalid/',{readProgress:store,initialPause:'title',settings:{textDelayMs:0}}).session;
  restored.restore(saved);assert.equal(store.count,0);restored.pause('title',false);assert.equal(store.count,1);assert.equal(store.has(signature('done','Done')),true);assert.equal(store.has(signature('one','First')),false);restored.dispose();
});

test('invalid markers retain their bytes and storage failures keep reading and retryable memory progress',()=>{
  const storage=memoryStorage();let failing=false;
  const port={...storage,setItem(key,raw){if(failing)throw Error('quota');storage.setItem(key,raw);}};
  let progress=createReadProgress('read','v1',port);progress.mark(signature('a'));progress.flush();const original=storage.getItem(progress.key);
  failing=true;progress.mark(signature('b'));assert.equal(progress.flush().status,'unavailable');assert.equal(storage.getItem(progress.key),original);assert.equal(progress.has(signature('b')),true);
  failing=false;assert.equal(progress.flush().status,'saved');
  storage.setItem(progress.key,'{broken');progress=createReadProgress('read','v1',port);progress.mark(signature('c'));assert.equal(progress.flush().status,'invalid');assert.equal(storage.getItem(progress.key),'{broken');
  storage.setItem(progress.key,JSON.stringify({schema:1,game:'another',storyVersion:'v1',records:[]}));assert.equal(progress.flush().status,'invalid');
  const denied=createReadProgress('read','v1',null);denied.mark(signature('a'));assert.equal(denied.flush().status,'unavailable');
  const p=project(),game=createProject(p,'https://test.invalid/',{settings:{textDelayMs:0},readProgress:{has(){throw Error();},mark(){throw Error();}}}).session;
  assert.equal(game.next(),true);game.dispose();
});

test('bounded marker storage caps counts and text and merges another writer before flushing',()=>{
  const storage=memoryStorage(),a=createReadProgress('read','v1',storage),b=createReadProgress('read','v1',storage);
  a.mark(signature('a'));a.flush();b.mark(signature('b'));b.flush();let reopened=createReadProgress('read','v1',storage);assert.equal(reopened.has(signature('a')),true);assert.equal(reopened.has(signature('b')),true);
  for(let i=0;i<MAX_READ_RECORDS+3;i++)reopened.mark(signature('line-'+i));assert.ok(reopened.count<=MAX_READ_RECORDS);assert.equal(reopened.flush().status,'saved');
  for(let i=0;i<4;i++)reopened.mark(signature('long-'+i,'字'.repeat(150000)));
  assert.equal(reopened.flush().status,'saved');assert.ok(new TextEncoder().encode(storage.getItem(reopened.key)).length<=MAX_READ_PROGRESS_BYTES);
  reopened=createReadProgress('read','v1',storage);assert.equal(reopened.status,'valid');
  const longRecords=JSON.parse(storage.getItem(reopened.key)).records.filter(key=>JSON.parse(key)[0].startsWith('long-'));assert.ok(longRecords.length<4);assert.equal(reopened.has(signature('long-3','字'.repeat(150000))),true);
});
