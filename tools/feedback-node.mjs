/** Independent review-file transaction; the related project is always read-only. */
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {executeAgentRequest,agentResponse,failAgent,AgentError} from '../dist/agent/index.js';
import {readDocument} from '../dist/editor/index.js';
import {agentFileIO as io} from './agent-node.mjs';

export async function runFeedbackFileRequest(request,options={}) {
 let lease,response=agentResponse(request.command,request.requestId),committed=false;
 try{
  if(!request.project)throw new AgentError('PROJECT_REQUIRED','Feedback requires its project file');
  const acceptanceMode=request.command.startsWith('acceptance.');
  const projectFile=await io.filePath(request.project),file=await io.filePath(acceptanceMode?(request.params.acceptanceFile??path.join(path.dirname(projectFile),'acceptance.json')):(request.params.reviewFile??projectFile+'.review.json'));
  const source=await io.readText(projectFile),project=readDocument(source).project,sourceSha=io.hash(source);
  const forbidden=[projectFile,projectFile+'.agent-journal.json',projectFile+'.agent-lock',...project.assets.flatMap(a=>[a.src,...(a.license?[a.license.src]:[])].map(src=>path.resolve(path.dirname(projectFile),src)))];
  if(forbidden.some(p=>process.platform==='win32'?p.toLowerCase()===file.toLowerCase():p===file))throw new AgentError('REVIEW_PATH_UNSAFE','Review file must be separate from project and assets');
  if(acceptanceMode&&request.params.document?.inputs?.some(input=>input.src!=='$source'&&path.resolve(path.dirname(file),input.src)===file))throw new AgentError('REVIEW_PATH_UNSAFE','Acceptance cannot overwrite its own evidence');
  const write=!['feedback.inspect','acceptance.inspect'].includes(request.command)&&!request.params.dryRun;
  let journal,receipt,digest;const journalFile=file+'.agent-journal.json';
  if(write){
   lease=await io.acquire(file,request,options.onPhase);journal=await io.journalRead(journalFile);
   const semantic=structuredClone(request);delete semantic.params.timeoutMs;delete semantic.params.recover;semantic.project=projectFile;semantic.params.reviewFile=file;
   digest=io.hash(JSON.stringify(io.canonical(semantic)));receipt=journal.entries.find(e=>e.requestId===request.requestId);
   if(receipt&&receipt.requestSha256!==digest)throw new AgentError('REQUEST_REUSED','Feedback request ID has different input');
   const actual=await io.current(file);
   for(const pending of journal.entries.filter(e=>e.state==='prepared')){
    if(actual===pending.afterSha256)pending.state='committed';else if(actual===pending.beforeSha256)pending.state='not-applied';else throw new AgentError('RECOVERY_REQUIRED','Review differs from both sides of unfinished edit');
   }
   if(receipt&&['committed','rejected'].includes(receipt.state)){
    if(actual!==receipt.afterSha256||sourceSha!==receipt.projectSourceSha256||await io.current(projectFile)!==sourceSha)throw new AgentError('REPLAY_CONFLICT','Project or review changed after this feedback receipt');
    await io.journalWrite(journalFile,journal);response=structuredClone(receipt.response);response.data={...response.data,replayed:true};
    if(acceptanceMode){try{const opts=await(await import('./acceptance-node.mjs')).loadAcceptanceOptions(projectFile,{acceptanceFile:file});const report=(await import('../dist/index.js')).assessAiAcceptance(project,opts);response.data.status=report.status;response.data.currentEvidenceRechecked=true;}catch{response.data.status='BLOCKED';response.data.currentEvidenceRechecked=false;}}
    return response;
   }
   if(!receipt&&journal.entries.length>=128)throw new AgentError('JOURNAL_FULL','Archive feedback journal before more requests');
  }
  const reviewSha=await io.current(file),reviewSource=reviewSha===null?null:await io.readText(file);
  const extra=acceptanceMode?{readEvidence:(await import('./acceptance-node.mjs')).acceptanceEvidenceReader(path.dirname(file))}:{};
  const result=await executeAgentRequest(request,{source,reviewSource,readAsset:io.assetReader(path.dirname(projectFile)),...extra});response=result.response;
  if(await io.current(projectFile)!==sourceSha)throw new AgentError('SOURCE_CONFLICT','Project changed while assessing review',{},'UNVERIFIED');
  if(!write)return response;
  const candidate=response.ok?result.reviewCandidate:undefined,saved=structuredClone(response);
  if(candidate){saved.data={...saved.data,applied:true,reviewSha256:candidate.afterSha256};saved.artifacts.push({kind:acceptanceMode?'ai-acceptance':'author-review',path:file,sha256:candidate.afterSha256});}
  const entry={requestId:request.requestId,requestSha256:digest,beforeSha256:reviewSha,afterSha256:candidate?.afterSha256??reviewSha,projectSourceSha256:sourceSha,state:candidate?'prepared':'rejected',response:saved};
  if(receipt)Object.assign(receipt,entry);else journal.entries.push(entry);
  await io.journalWrite(journalFile,journal);await options.onPhase?.('prepared',entry);
  if(candidate){
   if(await io.current(projectFile)!==sourceSha)throw new AgentError('SOURCE_CONFLICT','Project changed before review commit');
   if(await io.current(file)!==reviewSha)throw new AgentError('REVIEW_CONFLICT','Review changed before commit');
   if(acceptanceMode){
    const fresh=await executeAgentRequest(request,{source,reviewSource,readAsset:io.assetReader(path.dirname(projectFile)),readEvidence:(await import('./acceptance-node.mjs')).acceptanceEvidenceReader(path.dirname(file))});
    if(!fresh.reviewCandidate)throw new AgentError('REVIEW_STALE','Acceptance inputs changed before commit');
    const history=file+'.history';
    try{const stat=await fs.lstat(history);if(!stat.isDirectory()||stat.isSymbolicLink())throw new AgentError('REVIEW_PATH_UNSAFE','Acceptance history must be a regular directory');}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(history);}
    for(const [sha,text]of [[reviewSha,reviewSource],[candidate.afterSha256,candidate.sourceText]])if(sha){
      const snapshot=path.join(history,sha+'.json');try{await fs.writeFile(snapshot,text,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||(await fs.lstat(snapshot)).isSymbolicLink()||await io.current(snapshot)!==sha)throw error;}
    }
   }
   await io.atomic(file,candidate.sourceText,reviewSha?(await fs.stat(file)).mode&0o777:0o600);committed=true;response=saved;
   await options.onPhase?.('renamed',entry);entry.state='committed';
   if(await io.current(projectFile)!==sourceSha){failAgent(saved,new AgentError('SOURCE_CONFLICT','Review was written but its project changed; inspect freshness',{},'UNVERIFIED'));saved.data={...saved.data,applied:true,reviewMayBeStale:true};}
   await io.journalWrite(journalFile,journal);
  }
  return saved;
 }catch(error){
  if(committed){response.data={...response.data,applied:true,recoveryRequired:true};return failAgent(response,new AgentError('JOURNAL_ERROR','Review was written; retry identical request to reconcile: '+error.message));}
  return failAgent(response,error instanceof AgentError?error:new AgentError(error.code==='ENOENT'?'FILE_NOT_FOUND':'REVIEW_IO_ERROR',error.message));
 }finally{await io.releaseAgentLease(lease);}
}
