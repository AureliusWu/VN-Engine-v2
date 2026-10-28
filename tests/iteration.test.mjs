import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {newProject,contentCatalogue,contentKey,captureReviewBinding,readAuthorReview,editAuthorReview,assessAuthorReview,analyseContentImpact} from '../dist/editor/index.js';
import {executeAgentRequest,sourceHash,schemaErrors,AGENT_RESPONSE_SCHEMA} from '../dist/agent/index.js';
import {createProject} from '../dist/index.js';
import {runAgentFileRequest,runAgentFileRequestInProcess} from '../tools/agent-node.mjs';
const text=p=>JSON.stringify(p,null,2)+'\n';
const req=(command,params={},project)=>({protocol:'vn-agent-v1',requestId:'iteration-'+command,command,params,...(project?{project}:{})});
test('content catalogue preserves authored identity and matches actual one-shot voice precedence',()=>{
 for(const type of ['vn','chat','script']){
  const p=newProject(type);p.assets=['default','scene','line'].map(id=>({id,kind:'audio',src:id+'.wav'}));
  if(p.type==='narrative'){p.stage={defaults:{voice:'default'},scenes:{start:{voice:'scene'}},lines:{'second':{voice:'line'}}};p.scenes[0].lines.push({id:'second',speaker:'N',text:'Second'});p.scenes[0].lines[0].variant={stat:'score',min:1,text:'Conditional text'};}
  else{p.defaults={voice:'default'};p.program.blocks[0].cue={voice:'scene'};p.program.blocks[0].lines.push({id:'second',speaker:'N',text:'Second'});p.program.blocks[0].lines[1].cue={voice:'line'};}
  const rows=contentCatalogue(p);assert.ok(rows.some(r=>r.kind==='choice'));assert.equal(rows.filter(r=>r.kind==='line'&&r.nodeId==='start')[0].voice,'scene');
  const runtime=createProject(p,'https://test.invalid/');assert.equal(runtime.session.getView().frame.stage.voice,'scene');runtime.session.configure({textDelayMs:0});runtime.session.next();assert.equal(runtime.session.getView().frame.stage.voice,'line');runtime.session.dispose();
  assert.equal(rows.find(r=>r.id==='second').voice,'line');if(type==='vn'||type==='chat')assert.ok(rows.some(r=>r.kind==='variant'&&r.lineId==='start-1'&&r.derived));
 }
 const investigation=contentCatalogue(newProject('investigation'));assert.ok(investigation.some(r=>r.kind==='action'&&r.chapterId));
});
test('block voice is one-shot and Rain response identity/path and actual speaker are discoverable',async()=>{
 const p=newProject('script');p.defaults={voice:'default'};p.program.blocks[0].cue={voice:'first'};p.program.blocks[0].lines.push({id:'second',speaker:'N',text:'Second'});
 const rows=contentCatalogue(p);assert.equal(rows.find(r=>r.id==='second').voice,'default');
 const rain=JSON.parse(await fs.readFile('examples/runtime/rain.json'));const r=await executeAgentRequest(req('inspect',{kind:'content',limit:100}),{source:text(rain)});assert.equal(r.response.status,'PASS');assert.ok(r.response.data.items.some(r=>r.kind==='choice'));assert.ok(r.response.data.items.every(r=>r.path[0]==='story'));
});
test('impact and apply dry-run expose bounded real node, task, voice and global changes without authorizing selective release',async()=>{
 const p=newProject('script');p.production={schema:1,tasks:[{id:'plot',kind:'story',brief:'Plot',state:'review',targets:[{nodeId:'start'}]},{id:'art',kind:'art',brief:'Art',state:'review',dependsOn:['plot']}]};const source=text(p);
 const request=req('impact',{expectedSourceSha256:await sourceHash(source),operations:[{op:'exit.set',nodeId:'start',value:{type:'jump',next:'end'}}],limit:1});const r=await executeAgentRequest(request,{source});assert.equal(r.response.status,'PASS',JSON.stringify(r.response));assert.equal(r.candidate,undefined);assert.ok(r.response.data.impact.nodes.items.includes('start'));assert.equal(r.response.data.impact.tasks.total,2);assert.equal(r.response.data.impact.tasks.truncated,true);assert.equal(r.response.data.impact.fullRouteSuiteRequired,true);assert.equal(r.response.data.applied,false);
 const global=await executeAgentRequest(req('impact',{expectedSourceSha256:await sourceHash(source),operations:[{op:'ui.set',value:{schema:1,preset:'paper'}}]}),{source});assert.deepEqual(global.response.data.impact.globalChanges,['ui']);assert.equal(global.response.data.impact.tasks.total,2);
 const a=newProject('script');a.assets=[{id:'voice',kind:'audio',src:'old.wav'}];a.defaults={voice:'voice'};const b=structuredClone(a);b.assets[0].src='revised.wav';const impact=analyseContentImpact(a,b,'a'.repeat(64),'b'.repeat(64));assert.equal(impact.content.total,0);assert.ok(impact.affectedContent.total>0);assert.ok(impact.affectedNodes.items.includes('start'));assert.ok(impact.voiceWarnings.total>0);
});
test('review model binds actual bytes, preserves extensions and makes source, target and file changes stale',async()=>{
 const p=newProject('script'),bytes=new Uint8Array([1,2,3]);p.assets=[{id:'picture',kind:'background',src:'picture.png',sha256:await sourceHash(bytes)}];const source=text(p),binding=await captureReviewBinding(p,source,async()=>bytes);assert.equal(binding.filesVerified,true);
 let doc=readAuthorReview(null,p);doc.notes={keep:true};doc=editAuthorReview(doc,p,binding,{op:'put',id:'issue',actor:'Synthetic test reviewer',value:{category:'text',target:{kind:'line',id:'start-1',nodeId:'start'},comment:'Shorten this line',extension:{keep:true}}});
 doc=editAuthorReview(doc,p,binding,{op:'transition',id:'issue',state:'addressed',actor:'Test agent',note:'Shortened'});doc=editAuthorReview(doc,p,binding,{op:'transition',id:'issue',state:'verified',actor:'Synthetic test reviewer',note:'Test assertion only',evidence:'synthetic fixture'});assert.equal(assessAuthorReview(doc,p,binding).status,'PASS');assert.deepEqual(doc.notes,{keep:true});assert.deepEqual(doc.items[0].extension,{keep:true});
 const changed=await captureReviewBinding(p,source,async()=>new Uint8Array([4]));assert.equal(changed.filesVerified,false);assert.equal(assessAuthorReview(doc,p,changed).items[0].freshness,'stale');assert.throws(()=>editAuthorReview(doc,p,changed,{op:'transition',id:'issue',state:'verified',actor:'Test',note:'Wrong',evidence:'test'}),/fresh/);
 const noFiles=await captureReviewBinding(p,source);assert.equal(assessAuthorReview(doc,p,noFiles).items[0].freshness,'unverified');
 p.program.blocks[0].lines[0].text='Changed';const next=await captureReviewBinding(p,text(p),async()=>bytes);assert.equal(assessAuthorReview(doc,p,next).items[0].freshness,'stale');assert.equal(assessAuthorReview(doc,p,next).scope.releaseApproval,false);
});
async function setup(t){const dir=await fs.mkdtemp(path.join(tmpdir(),'vn-feedback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const project=path.join(dir,'project.json');const init=await runAgentFileRequest(req('init',{type:'script',game:'iteration',storyVersion:'1',title:'Iteration'},project));const reviewFile=path.join(dir,'review.json');const put=req('feedback.put',{reviewFile,expectedSourceSha256:init.project.sourceSha256,expectedReviewSha256:null,id:'issue',actor:'Synthetic test reviewer',value:{category:'text',target:{kind:'line',id:'start-1',nodeId:'start'},comment:'Test feedback'}},project);return{dir,project,reviewFile,put};}
test('Node review transaction, dry-run, duplicate receipt and stale project preserve source bytes',async t=>{
 const f=await setup(t),source=await fs.readFile(f.project);const dry=structuredClone(f.put);dry.params.dryRun=true;assert.equal((await runAgentFileRequest(dry)).status,'PASS');await assert.rejects(fs.access(f.reviewFile));
 const saved=await runAgentFileRequest(f.put);assert.equal(saved.status,'PASS',JSON.stringify(saved));assert.equal(saved.data.applied,true);assert.equal(saved.project.sourceSha256,f.put.params.expectedSourceSha256);assert.deepEqual(schemaErrors(AGENT_RESPONSE_SCHEMA,saved),[]);
 assert.equal((await runAgentFileRequest(f.put)).data.replayed,true);assert.deepEqual(await fs.readFile(f.project),source);
 const changed=JSON.parse(source);changed.title='Changed';await fs.writeFile(f.project,text(changed));assert.equal((await runAgentFileRequest(f.put)).diagnostics.at(-1).code,'REPLAY_CONFLICT');const inspect=await runAgentFileRequest(req('feedback.inspect',{reviewFile:f.reviewFile,maxBytes:4096},f.project));assert.equal(inspect.data.items[1].freshness,'stale');assert.ok(Buffer.byteLength(JSON.stringify(inspect))<=4096);
});
test('real process death before and after review rename reconciles once, without changing project',async t=>{
 for(const phase of ['prepared','renamed']){const f=await setup(t),before=await fs.readFile(f.project);const code=`import {runAgentFileRequestInProcess} from ${JSON.stringify(new URL('../tools/agent-node.mjs',import.meta.url).href)};await runAgentFileRequestInProcess(${JSON.stringify(f.put)},{onPhase:p=>{if(p===${JSON.stringify(phase)})process.exit(41)}});`;const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,41,child.stderr);f.put.params.recover=true;const recovered=await runAgentFileRequest(f.put);assert.equal(recovered.status,'PASS',JSON.stringify(recovered));assert.equal(JSON.parse(await fs.readFile(f.reviewFile)).items.length,1);assert.equal((await runAgentFileRequest(f.put)).data.replayed,true);assert.deepEqual(await fs.readFile(f.project),before);}
});
test('review conflicts, missing targets, false verification and related-source races do not silently overwrite',async t=>{
 const f=await setup(t),before=await fs.readFile(f.project);const invalid=structuredClone(f.put);invalid.params.value.target.id='missing';const fail=await runAgentFileRequest(invalid);assert.equal(fail.status,'FAIL');await assert.rejects(fs.access(f.reviewFile));
 f.put.requestId='valid';const saved=await runAgentFileRequest(f.put);const transition=req('feedback.transition',{reviewFile:f.reviewFile,expectedSourceSha256:saved.project.sourceSha256,expectedReviewSha256:saved.data.reviewSha256,id:'issue',actor:'Synthetic test reviewer',state:'verified',note:'Invalid shortcut',evidence:'synthetic'},f.project);assert.equal((await runAgentFileRequest(transition)).diagnostics.at(-1).code,'REVIEW_STALE');
 transition.requestId='stale-file';transition.params.state='addressed';transition.params.expectedReviewSha256='a'.repeat(64);assert.equal((await runAgentFileRequest(transition)).diagnostics.at(-1).code,'REVIEW_CONFLICT');assert.deepEqual(await fs.readFile(f.project),before);
 const g=await setup(t);const race=await runAgentFileRequestInProcess(g.put,{onPhase:async phase=>{if(phase==='prepared')await fs.writeFile(g.project,text({...JSON.parse(before),title:'External edit'}));}});assert.equal(race.diagnostics.at(-1).code,'SOURCE_CONFLICT');await assert.rejects(fs.access(g.reviewFile));
});
