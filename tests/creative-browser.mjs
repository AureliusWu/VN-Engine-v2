import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {runCreativeExample} from '../tools/creative-example.mjs';
import {runAgentFileRequest} from '../tools/agent-node.mjs';
import {createDemoServer} from '../tools/serve.mjs';

await fs.mkdir('test-results',{recursive:true});const root=await fs.mkdtemp(path.resolve('test-results/creative-'));
const flows=[];for(const transport of ['sdk','cli'])flows.push(await runCreativeExample(path.join(root,transport),{transport}));
const project=JSON.parse(await fs.readFile(path.join(root,'sdk/project.json'),'utf8'));
const evidence={status:'PASS',engineCommit:flows[0].engineCommit,engineVersion:flows[0].engineVersion,flows:flows.map(({media,...r})=>r),playback:{},offline:[],negative:[],humanAcceptance:'UNVERIFIED',artStatus:'DRAFT'};
for(const flow of flows){assert.equal(flow.disciplines.length,6);assert.equal(flow.assetStatus,'DRAFT');assert.equal(flow.releaseStatus,'BLOCKED');assert.ok(flow.restoreChecks>=8);}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.wav':'audio/wav','.txt':'text/plain','.woff2':'font/woff2','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const demo=await createDemoServer();await new Promise(r=>demo.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${demo.address().port}`;
const server=createServer(async(req,res)=>{try{const match=/^\/stories\/(sdk|cli)\/(.*)$/.exec(new URL(req.url,'http://test/').pathname);if(!match)throw Error('Unknown path');const dir=path.join(root,match[1],'game'),file=path.resolve(dir,decodeURIComponent(match[2]||'index.html'));if(!file.startsWith(dir+path.sep))throw Error('Unsafe path');res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const context=await browser.newContext({viewport:{width:1280,height:950}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/samples/assets/imported/**',async route=>{const relative=new URL(route.request().url()).pathname.slice('/samples/'.length);await route.fulfill({body:await fs.readFile(path.join(root,'sdk',relative)),contentType:mime[path.extname(relative)]});});
 await page.route('**/creative-player',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0}main{max-width:1280px;margin:auto}</style><main id="game"></main>'}));
 await page.goto(base+'/creative-player');
 await page.evaluate(async project=>{
  Object.defineProperty(window,'localStorage',{get(){throw Error('Creative preview accessed player storage')}});
  const NativeContext=window.AudioContext;window.r2Contexts=[];window.r2Sounds=[];window.r2Sources=[];
  window.AudioContext=class extends NativeContext{constructor(...args){super(...args);r2Contexts.push(this);const analyser=this.createAnalyser();analyser.fftSize=2048;this.r2Analyser=analyser;analyser.connect(this.destination);const make=this.createGain.bind(this);this.createGain=()=>{const gain=make(),connect=gain.connect.bind(gain);gain.connect=target=>connect(target===this.destination?analyser:target);return gain;};const source=this.createBufferSource.bind(this);this.createBufferSource=()=>{const node=source(),start=node.start.bind(node);node.start=(...args)=>{r2Sources.push({loop:node.loop});return start(...args);};return node;};}};
  const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.addEventListener('playing',()=>r2Sounds.push(this.currentSrc),{once:true});return play.call(this);};
  window.r2Peak=()=>{const a=r2Contexts[0]?.r2Analyser;if(!a)return 0;const b=new Float32Array(a.fftSize);a.getFloatTimeDomainData(b);return Math.max(...b.map(Math.abs));};
  const {mountGame}=await import('/lib/index.js');window.r2Game=mountGame(document.getElementById('game'),project,{baseURL:new URL('/samples/',location.href),storage:null});
 },project);
 await page.waitForFunction(()=>[...document.images].filter(i=>i.getAttribute('src')).every(i=>i.complete&&i.naturalWidth>0));
 await page.locator('[data-control=sound]').click();await page.waitForFunction(()=>r2Contexts[0]?.state==='running'&&r2Sources.length>=2&&r2Peak()>0.0001);
 evidence.playback.initial=await page.evaluate(()=>({state:r2Contexts[0].state,peak:r2Peak(),loops:r2Sources.filter(s=>s.loop).length}));assert.ok(evidence.playback.initial.peak>0);assert.equal(evidence.playback.initial.loops,2);
 await page.screenshot({path:path.join(root,'player-desktop.png'),fullPage:true});
 await page.locator('[data-control=next]').click();await page.waitForFunction(()=>r2Sounds.length===1);await page.evaluate(()=>{window.r2Saved=r2Game.session.save();r2Game.session.configure({fontScale:1.2});});
 await page.locator('[data-control=settings]').click();await page.waitForFunction(()=>r2Contexts[0].state==='suspended');const stopped=await page.evaluate(()=>r2Contexts[0].currentTime);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>r2Contexts[0].currentTime),stopped);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>r2Contexts[0].state==='running'&&r2Peak()>0.0001);
 await page.evaluate(()=>r2Game.session.restore(r2Saved));await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>r2Sounds.length),1);
 evidence.playback.pauseResume={suspendedClockStopped:true,resumed:true};evidence.playback.oneShot={actualPlayingEvents:1,noReplayOnSettingsOrRestore:true};
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>r2Game.session.configure({fontScale:1.6}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(root,'player-mobile.png'),fullPage:true});
 await page.evaluate(()=>r2Game.dispose());await page.goto(base+'/editor/');await page.waitForFunction(()=>document.body.dataset.editorReady==='true');
 await page.evaluate(p=>{localStorage.setItem('vn-engine:vn-creative-bookshop:save:auto','sentinel');localStorage.setItem('vn-engine:vn-creative-bookshop:meta','sentinel');localStorage.setItem('vn-engine:vn-creative-bookshop:read','sentinel');document.querySelector('[data-tab=source]').click();document.querySelector('#source').value=JSON.stringify(p);document.querySelector('[data-command=apply-source]').click();document.querySelector('[data-command=preview]').click();},project);
 const preview=page.frameLocator('#preview');await preview.locator('.vn-engine[data-ui-theme=dusk]').waitFor();await preview.locator('.vn-portrait').evaluate(img=>img.decode());
 assert.equal(await preview.locator('.vn-engine').evaluate(e=>getComputedStyle(e).getPropertyValue('--vn-ui-accent')),'#edc98f');
 const download=page.waitForEvent('download');await page.locator('[data-command=export]').click();const exported=path.join(root,'studio-export.json');await(await download).saveAs(exported);const roundtrip=JSON.parse(await fs.readFile(exported,'utf8'));assert.deepEqual(roundtrip.production,project.production);assert.deepEqual(roundtrip.ui,project.ui);
 assert.deepEqual(await page.evaluate(()=>['save:auto','meta','read'].map(k=>localStorage.getItem('vn-engine:vn-creative-bookshop:'+k))),['sentinel','sentinel','sentinel']);
 await page.screenshot({path:path.join(root,'studio-mobile.png'),fullPage:true});evidence.studio={theme:true,exportRetainedMetadata:true,playerBytesUnchanged:true};assert.deepEqual(errors,[]);await context.close();
 for(const transport of ['sdk','cli']){
  const context=await browser.newContext();try{let page=await context.newPage();const url=origin+`/stories/${transport}/`;await page.goto(url);await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='已下载，可离线游玩');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller&&document.querySelector('.vn-engine[data-ui-theme=dusk]'));await page.close();await context.setOffline(true);page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>!!document.querySelector('.vn-engine[data-ui-theme=dusk]'));await page.waitForFunction(()=>[...document.images].filter(i=>i.getAttribute('src')).every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('#error').innerText(),'');await page.screenshot({path:path.join(root,transport+'-offline.png')});evidence.offline.push({transport,path:`/stories/${transport}/`,reopened:true,images:true,status:'PASS'});}finally{await context.close();}
 }
 const invalid=path.join(root,'bad.wav');await fs.writeFile(invalid,'invalid audio bytes');
 for(const [id,params,status,code]of [['bad',{files:[{id:'bad',kind:'audio',file:invalid}]},'FAIL','MEDIA_DECODE_FAILED'],['missing',{files:[{id:'missing',kind:'portrait',file:path.join(root,'absent.png')}]},'FAIL','MEDIA_UNREADABLE'],['budget',{probeMs:1,files:[{id:'image',kind:'background',file:path.resolve('examples/creative/assets/bookshop-r2.png')}]},'UNVERIFIED','MEDIA_UNVERIFIED']]){const response=await runAgentFileRequest({protocol:'vn-agent-v1',requestId:'negative-probe-'+id,command:'probe',params});assert.equal(response.status,status,JSON.stringify(response));assert.ok(response.diagnostics.some(d=>d.code===code));evidence.negative.push(response);}
}finally{await browser?.close();for(const s of [server,demo]){s.closeAllConnections();await new Promise(r=>s.close(r));}}
await fs.writeFile(path.join(root,'CREATIVE_BROWSER_REPORT.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS R2 SDK/CLI six disciplines, byte probe, real audio graph + one-shot + pause/resume, Studio theme/export, 390px, two nested offline reopened packages, bad media/missing/timeout, DRAFT and release gate retained: '+root);
