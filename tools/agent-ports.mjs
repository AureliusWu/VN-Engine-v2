import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AgentError, AGENT_LIMITS } from '../dist/agent/index.js';
import { runRouteSuite } from '../dist/regression/suite.js';
import { packageGame } from './package-game.mjs';
const repository = fileURLToPath(new URL('..',import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function newOutput(value) { const output = path.resolve(value); try { const stat = await fs.lstat(output); if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(output)).length) throw new AgentError('OUTPUT_EXISTS','Output must be new or empty'); } catch(e) { if(e.code!=='ENOENT')throw e; } await fs.mkdir(output,{recursive:true}); return output; }
function commitIdentity() {
 let commit; try { commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); }catch{commit=process.env.VN_ENGINE_COMMIT??process.env.GITHUB_SHA??'UNVERIFIED';}
 for(const value of [process.env.VN_ENGINE_COMMIT,process.env.GITHUB_SHA])if(value && value!==commit)throw new AgentError('BUILD_IDENTITY_CONFLICT','Environment commit differs from checked-out engine');
 return commit;
}
async function listen(server) { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)}); return `http://127.0.0.1:${server.address().port}/`; }
export function createAgentPorts({sourceFile,readAsset}) {
 return {
  async build(document,request,identity) {
   const output=await newOutput(request.params.output), staging=await fs.mkdtemp(path.join(os.tmpdir(),'vn-agent-build-'));
   const old={release:process.env.VN_RELEASE_BUILD,commit:process.env.VN_ENGINE_COMMIT};
   try {
    const project=document.project, source=path.join(staging,'project.json');await fs.writeFile(source,JSON.stringify(project,null,2)+'\n');
    for(const asset of project.assets)for(const relative of [asset.src,...(asset.license?[asset.license.src]:[])]){const dest=path.resolve(staging,relative);if(!dest.startsWith(staging+path.sep))throw new AgentError('ASSET_PATH_UNSAFE','Asset escapes staging');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,await readAsset(relative));}
    process.env.VN_RELEASE_BUILD=request.params.mode==='release'?'1':'0';process.env.VN_ENGINE_COMMIT=commitIdentity();
    const built=await packageGame(source,output,{sourceIdentity:{...identity,file:sourceFile}});
    const manifestFile=path.join(output,'build-manifest.json'),bytes=await fs.readFile(manifestFile),manifest=JSON.parse(bytes);
    return {data:{...built,mode:request.params.mode??'development',buildIdentity:manifest.buildIdentity,source:identity,compliance:manifest.compliance,files:manifest.files.map(f=>f.name).concat('build-manifest.json'),manifestSha256:sha(bytes)},artifacts:[{kind:'build-manifest',path:manifestFile,sha256:sha(bytes)},{kind:'game-directory',path:output}]};
   }catch(error){if(error.name?.startsWith('Release'))throw new AgentError('RELEASE_GATE_BLOCKED',error.message,{actual:error.report},'BLOCKED');throw error instanceof AgentError?error:new AgentError('BUILD_ERROR',error.message);}
   finally{for(const [key,value]of Object.entries({VN_RELEASE_BUILD:old.release,VN_ENGINE_COMMIT:old.commit})){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(staging,{recursive:true,force:true});}
  },
  async preview(document,request,identity) {
   const project=document.project,route=project.routeTests?.cases.find(c=>c.id===request.params.caseId);
   if(!route)throw new AgentError('NOT_FOUND','Preview requires an authored route case');
   const report=runRouteSuite(project,{schema:1,cases:[route]},{maxOperations:request.params.maxOperations??AGENT_LIMITS.routeOperations}),executed=report.cases[0];
   if(executed?.status!=='PASS')throw new AgentError(executed?.status==='UNVERIFIED'?'BUDGET_EXCEEDED':'ROUTE_FAILED',executed?.failure?.message??'Preview route did not pass',{},executed?.status==='UNVERIFIED'?'UNVERIFIED':'FAIL');
   const output=await newOutput(request.params.output),deadline=request.params.previewMs??AGENT_LIMITS.previewMs;
   let browser,context,timer,task,cancelled=false;const failures=[];
   const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://local/');let bytes,type='text/javascript';
    if(url.pathname==='/'){type='text/html';bytes=Buffer.from('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#111820}main{max-width:1280px;margin:auto}</style><main id="game"></main></html>');}
    else if(url.pathname.startsWith('/lib/')){const file=path.resolve(repository,'dist',decodeURIComponent(url.pathname.slice(5)));if(!file.startsWith(path.join(repository,'dist')+path.sep))throw Error('Unsafe module path');bytes=await fs.readFile(file);}
    else if(url.pathname.startsWith('/assets/')){bytes=await readAsset(decodeURIComponent(url.pathname.slice(8)));const ext=path.extname(url.pathname);type=({'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.ogg':'audio/ogg','.wav':'audio/wav'})[ext]??'application/octet-stream';}
    else{res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(bytes);
   }catch(e){failures.push(e.message);res.writeHead(404);res.end();}});
   try {
    const base=await listen(server),{chromium}=await import('playwright');
    const work=async()=>{
     browser=await chromium.launch({headless:true,timeout:deadline,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
     if(cancelled){await browser.close();throw new AgentError('TIMEOUT','Preview deadline exhausted',{},'UNVERIFIED');}
     context=await browser.newContext({viewport:{width:request.params.width??1280,height:request.params.height??800},reducedMotion:'reduce',serviceWorkers:'block'});
     const page=await context.newPage();page.setDefaultTimeout(deadline);page.on('pageerror',e=>failures.push(e.message));await page.goto(base);
     const actual=await page.evaluate(async({project,route,maxOperations})=>{
      // Storage poisoning ensures a preview cannot accidentally touch Save, Meta or read keys.
      Object.defineProperty(window,'localStorage',{get(){throw Error('Preview accessed player storage')}});
      const {createProject}=await import('/lib/runtime/project.js'),{DOMRenderer}=await import('/lib/render/dom.js'),{RouteClock,observeRoute}=await import('/lib/regression/suite.js');
      const clock=new RouteClock(),{session,assets}=createProject(project,location.href,{clock,settings:{textDelayMs:0,reducedMotion:true},assetURL:relative=>new URL('/assets/'+relative,location.href).href});
      const renderer=new DOMRenderer(document.getElementById('game'),session,assets,{title:project.title,font:project.font,storage:null});window.agentPreview={session,renderer};
      let operations=0;const consume=()=>{if(++operations>maxOperations)throw Error('Preview operation budget exhausted')};const settle=()=>{while(!session.getView().ready){consume();clock.tick()}};
      const saves=new Map();settle();for(const step of route.steps){consume();settle();let accepted=true;switch(step.type){case'next':accepted=session.next();break;case'action':accepted=session.act(step.id);break;case'mini-start':accepted=session.startMiniGame();break;case'mini-input':accepted=session.playMiniGame(step.index);break;case'mini-skip':accepted=session.skipMiniGame();break;case'mini-abort':accepted=session.abortMiniGame();break;case'mini-finish':accepted=session.finishMiniGame();break;case'checkpoint':saves.set(step.id,session.save());break;case'restore':if(!saves.has(step.id))throw Error('Unknown checkpoint');session.restore(saves.get(step.id));break;}if(!accepted)throw Error('Rejected route action');settle();}
      await Promise.all(project.assets.filter(asset=>['background','portrait','cg','ui'].includes(asset.kind)).map(async asset=>{const img=new Image();img.src=assets.url(asset.id);await img.decode()}));await document.fonts.ready;await Promise.all([...document.images].filter(img=>img.getAttribute('src')).map(img=>img.decode()));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return observeRoute(session,project.type);
     },{project,route,maxOperations:request.params.maxOperations??AGENT_LIMITS.routeOperations});
     if(JSON.stringify(actual)!==JSON.stringify(executed.final))throw new AgentError('PREVIEW_STATE_MISMATCH','Rendered session differs from verified route');
     if(failures.length)throw new AgentError('PREVIEW_RENDER_FAILED',failures.join('; '));
     const screenshot=path.join(output,'preview.png');await page.screenshot({path:screenshot,fullPage:true});
     const preview={protocol:'vn-agent-v1',status:'PASS',source:identity,engineCommit:commitIdentity(),caseId:route.id,routeStatus:executed.status,restoreChecks:executed.restoreChecks,scope:{realRenderer:true,legalEntry:true,isolatedStorage:true,audioDevice:false,humanAcceptance:'UNVERIFIED'},final:actual,screenshot:{path:screenshot,sha256:sha(await fs.readFile(screenshot))}};
     const reportFile=path.join(output,'PREVIEW_REPORT.json');await fs.writeFile(reportFile,JSON.stringify(preview,null,2)+'\n');
     return {data:{caseId:route.id,final:{sceneId:actual.sceneId,lineId:actual.lineId,ending:actual.ending},source:identity,storage:'isolated',humanAcceptance:'UNVERIFIED'},artifacts:[{kind:'screenshot',...preview.screenshot},{kind:'preview-report',path:reportFile,sha256:sha(await fs.readFile(reportFile))}]};
    };
    return await Promise.race([task=work(),new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(new AgentError('TIMEOUT','Preview deadline exhausted',{},'UNVERIFIED'));},deadline)})]);
   }catch(error){throw error instanceof AgentError?error:new AgentError('PREVIEW_ERROR',error.message);}
   finally{clearTimeout(timer);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});if(cancelled)await task?.catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
 };
}
