import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assessAiAcceptance, assessQaEvidence, assessProductionArt, validateProjectCompliance, captureAcceptanceContext } from '../dist/index.js';
import { runAgentFileRequest, runAgentFileRequestInProcess } from '../tools/agent-node.mjs';
import { packageGame } from '../tools/package-game.mjs';
import { buildQaReport } from '../tools/qa-report.mjs';
import { qaFixture, writeQaFixture } from './qa-fixture.mjs';
import { syntheticAcceptance } from './acceptance-fixture.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const request=(command,params,project,id=command)=>({protocol:'vn-agent-v1',requestId:id,command,params,project});
async function setup(t) {
  const root=await fs.mkdtemp(path.join(tmpdir(),'vn-r4-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fixture=qaFixture(),source=await writeQaFixture(root,fixture.project,fixture.picture),sourceText=await fs.readFile(source,'utf8');
  const doc=JSON.parse(await fs.readFile(path.join(root,'acceptance.json'),'utf8'));
  return{root,source,sourceText,doc,...fixture};
}
test('R4-B001: fresh AI acceptance satisfies release without human signatures; changed text and targets invalidate it',async()=>{
  const {project,picture}=qaFixture();delete project.releaseEvidence.qa;delete project.releaseEvidence.art.room.reviewer;
  const options=await syntheticAcceptance(project,picture);
  assert.equal(validateProjectCompliance(project,{...options,mode:'release'}).qaGate.reviewMode,'ai-simulated');
  project.scenes[0].lines[0].text='Unreviewed replacement';
  assert.equal(assessQaEvidence(project,options).release,'BLOCKED');
  assert.equal(assessQaEvidence(project).release,'BLOCKED');
  const next=await syntheticAcceptance(project,picture);project.releaseEvidence.targets.desktop=false;
  assert.equal(assessAiAcceptance(project,next).status,'BLOCKED');
});
test('technical reviews cannot reuse a report for undeclared categories or a Linux run as Windows acceptance',async()=>{
  const {project,picture}=qaFixture(),options=await syntheticAcceptance(project,picture);
  const technical=options.acceptanceContext.verifiedInputs.find(i=>i.kind==='test-report');
  technical.platform='linux';
  assert.equal(assessAiAcceptance(project,options).checks.find(c=>c.key==='windows').status,'UNVERIFIED');
  technical.platform='win32';technical.categories=['web'];
  assert.equal(assessAiAcceptance(project,options).checks.find(c=>c.key==='accessibility').status,'UNVERIFIED');
});
test('AI review rejects changed evidence, partial coverage, missing modality, fake technical mode and unresolved blocking findings',async()=>{
  const {project,picture}=qaFixture(),original=await syntheticAcceptance(project,picture);
  for(const change of [
    o=>o.acceptance.reviews.find(r=>r.category==='visualIntegration').modalities=['text'],
    o=>o.acceptance.reviews.find(r=>r.category==='text').coverage='sampled',
    o=>o.acceptance.reviews.find(r=>r.category==='windows').mode='ai-simulated',
    o=>o.acceptance.reviews.find(r=>r.category==='text').findings.push({severity:'error',location:'start/line',message:'Unresolved typo',resolved:false}),
    o=>o.acceptance.inputs.find(i=>i.kind==='image').sha256='b'.repeat(64),
    o=>o.acceptance.rubricVersion='old',
    o=>o.acceptance.reviews[0].model='UNVERIFIED'
  ]){const options=structuredClone(original);change(options);assert.equal(assessAiAcceptance(project,options).status,'BLOCKED');}
  const context=await captureAcceptanceContext(project,JSON.stringify(project),original.acceptance,async()=>picture,async()=>new Uint8Array([1]));
  assert.equal(assessAiAcceptance(project,{acceptance:original.acceptance,acceptanceContext:context}).status,'BLOCKED');
});
test('Listening PASS requires actual current audio evidence and an audio-capable review, independently of decode measurements',async()=>{
  const {project,picture}=qaFixture();project.assets.push({id:'voice',kind:'audio',src:'voice.wav',sha256:hash(picture)});
  const options=await syntheticAcceptance(project,picture),review=options.acceptance.reviews.find(r=>r.category==='audio');
  assert.equal(assessAiAcceptance(project,options).checks.find(c=>c.key==='audio').status,'PASS');
  review.modalities=['text','image'];
  assert.equal(assessAiAcceptance(project,options).checks.find(c=>c.key==='audio').status,'UNVERIFIED');
});
test('R4-B002: stale or non-ready linked Neutral blocks a referenced variant without directly referencing Neutral',async()=>{
  const {project,picture}=qaFixture(),base=project.releaseEvidence.art.room,sha256=project.assets[0].sha256;
  for(const name of ['neutral','smile']){project.assets.push({id:'hero/'+name,kind:'portrait',src:name+'.svg',status:'READY',sha256});project.releaseEvidence.art['hero/'+name]={...base,masterSha256:sha256,characterMaster:{id:'hero',role:name==='neutral'?'neutral':'variant'}};}
  project.releaseEvidence.characterMasters={hero:{...base,masterSha256:sha256,neutralAsset:'hero/neutral',evidence:'test://synthetic-master'}};
  const assess=async()=>assessProductionArt(project,['room','hero/smile'],await syntheticAcceptance(project,picture));
  assert.equal((await assess()).release,'PASS');
  project.releaseEvidence.art['hero/neutral'].runtimeSha256='b'.repeat(64);
  const stale=await assess();assert.equal(stale.release,'BLOCKED');assert.equal(stale.CHARACTER_MASTER_INHERITANCE,'FAIL');
  assert.equal(stale.assets.find(a=>a.id==='hero/smile').ART_READY,'FAIL');
  project.releaseEvidence.art['hero/neutral'].runtimeSha256=sha256;project.assets.find(a=>a.id==='hero/neutral').status='DRAFT';
  assert.equal((await assess()).CHARACTER_MASTER_INHERITANCE,'FAIL');
  project.releaseEvidence.characterMasters.hero.neutralAsset='missing-neutral';
  assert.equal((await assess()).CHARACTER_MASTER_INHERITANCE,'FAIL');
});
test('source changes during packaging preserve the external edit and never label an old payload with new source identity',async t=>{
  const f=await setup(t),output=path.join(f.root,'raced-build');
  await assert.rejects(packageGame(f.source,output,{onPhase:async phase=>{
    if(phase==='snapshot-ready')await fs.writeFile(f.source,f.sourceText+'\n');
  }}),/SOURCE_CONFLICT/);
  assert.equal(await fs.readFile(f.source,'utf8'),f.sourceText+'\n');await assert.rejects(fs.access(output));
});
test('R4-B003: omitted startup files, omitted runtime dependencies and wrong content fingerprint never pass build verification',async t=>{
  const f=await setup(t),old=process.env.VN_ENGINE_COMMIT;process.env.VN_ENGINE_COMMIT='a'.repeat(40);
  try{for(const name of ['app.mjs','lib/compliance/qa.js','fingerprint']){
    const output=path.join(f.root,'build-'+name.replaceAll('/','-'));await packageGame(f.source,output);
    const manifestFile=path.join(output,'build-manifest.json'),manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
    if(name==='fingerprint')manifest.contentFingerprint='wrong';else{await fs.rm(path.join(output,name));manifest.files=manifest.files.filter(e=>e.name!==name);}
    await fs.writeFile(manifestFile,JSON.stringify(manifest));const report=await buildQaReport(f.source,{buildDirectory:output});
    assert.equal(report.build.status,'FAIL',name);
  }}finally{if(old===undefined)delete process.env.VN_ENGINE_COMMIT;else process.env.VN_ENGINE_COMMIT=old;}
});
test('SDK/CLI acceptance import replays once, preserves source, rejects conflicts and retains immutable review revisions',async t=>{
  const f=await setup(t),file=path.join(f.root,'imported-acceptance.json');
  const put=request('acceptance.import',{acceptanceFile:file,expectedSourceSha256:hash(f.sourceText),expectedReviewSha256:null,document:f.doc},f.source);
  const saved=await runAgentFileRequest(put);assert.equal(saved.status,'PASS',JSON.stringify(saved));assert.equal(saved.data.status,'PASS');
  assert.equal((await runAgentFileRequest(put)).data.replayed,true);assert.equal(await fs.readFile(f.source,'utf8'),f.sourceText);
  const conflict=structuredClone(put);conflict.requestId='conflict';assert.equal((await runAgentFileRequest(conflict)).diagnostics.at(-1).code,'REVIEW_CONFLICT');
  const prior=hash(await fs.readFile(file)),revision=structuredClone(f.doc);revision.supersedesSha256=prior;revision.reviews[0].rationale+=' Rechecked.';
  const next=request('acceptance.import',{...put.params,expectedReviewSha256:prior,document:revision},f.source,'revision');
  assert.equal((await runAgentFileRequest(next)).status,'PASS');assert.ok((await fs.readdir(file+'.history')).includes(prior+'.json'));
  await fs.writeFile(path.join(f.root,'review-inputs/synthetic-390.png'),'changed after acceptance');
  const replay=await runAgentFileRequest(next);assert.equal(replay.data.replayed,true);assert.equal(replay.data.status,'BLOCKED');
  const bundle=await runAgentFileRequest(request('acceptance.bundle',{output:path.join(f.root,'bundle')},f.source));
  assert.equal(bundle.status,'PASS',JSON.stringify(bundle));assert.equal(bundle.data.modelExecuted,false);assert.equal(bundle.data.status,'UNVERIFIED');
});
test('real process death before/after acceptance rename reconciles exactly once with source unchanged',async t=>{
  for(const phase of ['prepared','renamed']){
    const f=await setup(t),file=path.join(f.root,'recovered-acceptance.json');
    const put=request('acceptance.import',{acceptanceFile:file,expectedSourceSha256:hash(f.sourceText),expectedReviewSha256:null,document:f.doc},f.source,phase);
    const code='import {runAgentFileRequestInProcess} from '+JSON.stringify(new URL('../tools/agent-node.mjs',import.meta.url).href)+';await runAgentFileRequestInProcess('+JSON.stringify(put)+',{onPhase:p=>{if(p==='+JSON.stringify(phase)+')process.exit(41)}});';
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,41,child.stderr);
    put.params.recover=true;assert.equal((await runAgentFileRequest(put)).status,'PASS');assert.equal((await runAgentFileRequest(put)).data.replayed,true);
    assert.equal(await fs.readFile(f.source,'utf8'),f.sourceText);
  }
});
test('changed evidence between prepare and commit cannot replace an acceptance file',async t=>{
  const f=await setup(t),file=path.join(f.root,'raced-acceptance.json');
  const put=request('acceptance.import',{acceptanceFile:file,expectedSourceSha256:hash(f.sourceText),expectedReviewSha256:null,document:f.doc},f.source);
  const result=await runAgentFileRequestInProcess(put,{onPhase:async phase=>{if(phase==='prepared')await fs.writeFile(path.join(f.root,'review-inputs/synthetic-390.png'),'changed');}});
  assert.equal(result.status,'FAIL');await assert.rejects(fs.access(file));assert.equal(await fs.readFile(f.source,'utf8'),f.sourceText);
});
