import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAgentRequest,sourceHash,schemaErrors} from '../dist/agent/index.js';
import {newProject,EditorModel} from '../dist/editor/index.js';
import {PRODUCTION_SCHEMA,UI_SCHEMA,reviewCreativeProject,resolveProjectUI,uiContrast,createProject} from '../dist/index.js';
const req=(command,params={})=>({protocol:'vn-agent-v1',requestId:'creative-'+command,command,params});
const text=p=>JSON.stringify(p,null,2)+'\n';
const call=(command,params,p)=>executeAgentRequest(req(command,params),{source:typeof p==='string'?p:text(p)});
const apply=async(p,operations)=>{const source=typeof p==='string'?p:text(p);return call('apply',{expectedSourceSha256:await sourceHash(source),operations},source)};
const plan=()=>({schema:1,brief:{premise:'A book returned after the rain'},characters:[{id:'an',name:'An',description:'A bookseller'}],beats:[{id:'opening',summary:'A late visitor arrives',targets:[{nodeId:'start',lineId:'start-1'}],characters:['an'],tasks:['story']}],tasks:[{id:'story',kind:'story',brief:'Write the opening',state:'draft',targets:[{nodeId:'start',lineId:'start-1'}]}]});
test('creative schemas and discovery are additive to R1; UI has safe fixed tokens',async()=>{
 const cap=(await call('capabilities',{})).response;assert.ok(cap.data.extensions.includes('vn-creative-v1'));assert.ok(cap.data.commands.includes('review'));assert.ok(cap.data.operations.includes('task.rename'));assert.ok(cap.data.schemas.production.file);
 for(const name of ['production','ui'])assert.equal((await call('capabilities',{schema:name})).response.status,'PASS');
 assert.deepEqual(schemaErrors(PRODUCTION_SCHEMA,plan()),[]);assert.deepEqual(schemaErrors(UI_SCHEMA,{schema:1,preset:'dusk'}),[]);
 assert.ok(uiContrast({schema:1,preset:'paper'})>=4.5);assert.equal(resolveProjectUI({schema:1,preset:'paper'}).colors.text,'#302c27');assert.throws(()=>resolveProjectUI({schema:1,colors:{accent:'url(javascript:bad)'}}));
});
test('six creative disciplines are editable by IDs, refs rename and metadata survive',async()=>{
 const p=newProject('script');p.authorNotes={keep:true};const production=plan();production.notes={keep:true};
 const ops=[{op:'production.patch',value:production},...['art','music','ui','sfx','text'].map(kind=>({op:'task.put',id:kind,value:{kind,brief:kind+' requirement',state:'draft',dependsOn:['story'],targets:[{nodeId:'start'}]}})),{op:'character.rename',id:'an',newId:'lin'},{op:'task.rename',id:'story',newId:'plot'},{op:'ui.set',value:{schema:1,preset:'dusk',density:'compact'}}];
 const result=await apply(p,ops);assert.equal(result.response.status,'PASS',JSON.stringify(result.response));const value=result.candidate.document.project;assert.equal(value.production.characters[0].id,'lin');assert.deepEqual(value.production.beats[0].tasks,['plot']);assert.equal(value.production.tasks.length,6);assert.deepEqual(value.production.notes,{keep:true});assert.deepEqual(value.authorNotes,{keep:true});
 const refs=(await call('refs',{kind:'task',id:'plot'},result.candidate.sourceText)).response;assert.equal(refs.data.items.length,6);
 const catalogue=(await call('inspect',{kind:'text',id:'start-1'},result.candidate.sourceText)).response;assert.equal(catalogue.data.items[0].nodeId,'start');
 assert.equal((await call('review',{},result.candidate.sourceText)).response.status,'UNVERIFIED');
 const blocked=await apply(result.candidate.sourceText,[{op:'task.remove',id:'plot'}]);assert.equal(blocked.response.diagnostics[0].code,'CREATIVE_REFERENCED');assert.equal(blocked.candidate,undefined);
});
test('cycles, orphan targets and illegal approval states block final batch and Studio equally',async()=>{
 for(const change of [p=>p.tasks[0].dependsOn=['story'],p=>p.beats[0].targets[0].nodeId='missing',p=>p.tasks[0].state='approved']){const p=newProject('vn'),production=plan();change(production);const result=await apply(p,[{op:'production.patch',value:production}]);assert.equal(result.response.status,'FAIL');assert.equal(result.candidate,undefined);p.production=production;assert.ok(new EditorModel(p).diagnostics().some(d=>d.severity==='error'));assert.throws(()=>createProject(p,'https://test.invalid/'));}
});
test('shared node and chapter renames synchronize creative targets and refuse protected chapter deletion',()=>{
 const p=newProject('vn');p.production=plan();const m=new EditorModel(p);m.rename('["start"]','opening');assert.equal(m.getView().project.production.beats[0].targets[0].nodeId,'opening');assert.deepEqual(m.diagnostics(),[]);
 const i=newProject('investigation');i.production={schema:1,tasks:[{id:'investigation',kind:'story',brief:'Check the note',state:'draft',targets:[{chapterId:'chapter-1',nodeId:'room',lineId:'chapter-1/room'}]}]};const im=new EditorModel(i);im.addChapter({id:'two'});im.renameChapter('chapter-1','first');assert.equal(im.getView().project.production.tasks[0].targets[0].chapterId,'first');assert.equal(im.getView().project.production.tasks[0].targets[0].lineId,'first/room');assert.throws(()=>im.removeChapter('first'),/引用/);
});
test('review is bounded, identifies unfinished editorial work and never grants human approval',async()=>{
 const p=newProject('script');p.production=plan();p.production.tasks[0].state='planned';p.program.blocks[0].lines[0].text='TODO '+'长'.repeat(350);let r=(await call('review',{maxBytes:4096},p)).response;assert.equal(r.status,'UNVERIFIED');assert.ok(Buffer.byteLength(JSON.stringify(r))<=4096);assert.ok(r.data.items.some(i=>i.code==='TEXT_PLACEHOLDER'));
 p.assets=[{id:'voice',kind:'audio',src:'voice.wav'}];p.program.blocks[0].lines[0].cue={voice:'voice'};const report=reviewCreativeProject(p);assert.ok(report.issues.some(i=>i.code==='VOICE_REVIEW_REQUIRED'));assert.equal(report.scope.humanAcceptance,'UNVERIFIED');
});
test('asset provenance is owned immutable data and invalid source facts are refused',()=>{
 const p=newProject('vn');p.assets=[{id:'room',kind:'background',src:'room.png',provenance:{method:'generated',tool:'builtin-imagegen',sourceSha256:'a'.repeat(64),prompt:'A quiet room'}}];const instance=createProject(p,'https://test.invalid/');const a=instance.assets.get('room');a.provenance.prompt='mutated';assert.equal(instance.assets.get('room').provenance.prompt,'A quiet room');instance.session.dispose();p.assets[0].provenance.sourceSha256='wrong';assert.throws(()=>createProject(p,'https://test.invalid/'));
});
test('line identity, character tasks and brief extensions survive atomic edits and bounded lookup',async()=>{
 const p=newProject('script');p.production=plan();p.production.brief.extra={keep:true};p.production.tasks[0].characters=['an'];p.routeTests={schema:1,cases:[{id:'opening',steps:[],expect:{lineId:'start-1'}}]};
 const r=await apply(p,[{op:'production.patch',value:{brief:{tone:'quiet'}}},{op:'line.rename',nodeId:'start',id:'start-1',newId:'opening-1'},{op:'character.rename',id:'an',newId:'bookseller'}]);assert.equal(r.response.status,'PASS',JSON.stringify(r.response));
 const out=r.candidate.document.project;assert.equal(out.production.beats[0].targets[0].lineId,'opening-1');assert.equal(out.routeTests.cases[0].expect.lineId,'opening-1');assert.deepEqual(out.production.tasks[0].characters,['bookseller']);assert.deepEqual(out.production.brief.extra,{keep:true});
 assert.equal((await call('inspect',{kind:'tasks',characterId:'bookseller',taskKind:'story',query:'opening'},r.candidate.sourceText)).response.data.items.length,1);
 assert.equal((await apply(out,[{op:'line.remove',nodeId:'start',id:'opening-1'}])).response.diagnostics[0].code,'CREATIVE_REFERENCED');
 assert.equal((await apply(out,[{op:'character.remove',id:'bookseller'}])).response.diagnostics[0].code,'CREATIVE_REFERENCED');
});
test('Rain stable text and response lines remain discoverable without rewriting native data',async()=>{
 const {readFile}=await import('node:fs/promises');const p=JSON.parse(await readFile('examples/runtime/rain.json','utf8'));
 const result=await call('inspect',{kind:'text',limit:100},p);assert.equal(result.response.status,'PASS');assert.ok(result.response.data.items.length>0);assert.ok(result.response.data.items.every(l=>l.id&&l.path[0]==='story'));
});
