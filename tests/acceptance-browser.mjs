import {createServer} from 'node:http';
import {packageStudio} from '../tools/package-studio.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';
import { qaFixture, writeQaFixture } from './qa-fixture.mjs';
await fs.mkdir('test-results',{recursive:true});
const root=await fs.mkdtemp(path.resolve('test-results/r4-acceptance-')),{project,picture}=qaFixture();
const source=await writeQaFixture(root,project,picture),sourceBytes=await fs.readFile(source);
const server=await createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;let browser;
async function verifyReadFailureRecovery(browser) {
  const page=await browser.newPage();
  try {
    await page.route('**/r5-panel-asset.svg',route=>route.fulfill({body:picture,contentType:'image/svg+xml'}));
    await page.goto(base+'/editor/');await page.waitForSelector('body[data-editor-ready=true]');
    await page.evaluate(async source=>{
      const {createAcceptancePanel}=await import('/editor/acceptance.mjs');
      const host=document.createElement('main'),footer=document.createElement('p');document.body.replaceChildren(host,footer);
      const state={source,pending:0,mode:'normal',release:undefined,statuses:[]};
      const run=async fn=>{state.pending++;try{await fn();}catch(error){ctx.status(error.message,true);}finally{state.pending--;}};
      const ctx={project:()=>JSON.parse(state.source),source:()=>state.source,assetURL:()=> '/r5-panel-asset.svg',
        element:(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;},
        action:(label,callback)=>{const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>run(callback));return button;},
        run,status:(text,error=false)=>{footer.textContent=text;state.statuses.push({text,error});},download:text=>state.saved=JSON.parse(text),issue:()=>{}};
      const read=File.prototype.arrayBuffer;
      const readText=File.prototype.text;state.openReads={};
      File.prototype.text=function(){
        if(!this.name.startsWith('r5-open-'))return readText.call(this);
        return new Promise((resolve,reject)=>{state.openReads[this.name]=fail=>{delete state.openReads[this.name];if(fail)reject(Error('R5 synthetic document read failed'));else readText.call(this).then(resolve,reject);};});
      };
      File.prototype.arrayBuffer=function(){
        if(this.name!=='room.svg'||state.mode==='normal')return read.call(this);
        const mode=state.mode;state.mode='normal';
        if(mode==='fail')throw Error('TIMEOUT: R5 synthetic evidence read failed');
        return new Promise((resolve,reject)=>{state.release=fail=>{state.release=undefined;if(fail)reject(Error('TIMEOUT: R5 late evidence read failed'));else read.call(this).then(resolve,reject);};});
      };
      state.ctx=ctx;state.panel=createAcceptancePanel(ctx);state.render=()=>{host.replaceChildren();state.panel.render(host);};state.render();window.r5Acceptance=state;
    },sourceBytes.toString());
    const panel=page.locator('main'),verify=panel.getByRole('button',{name:'核对 AI 终审',exact:true});
    const settled=()=>page.waitForFunction(()=>window.r5Acceptance.pending===0);
    const pass=async()=>{await panel.locator('[data-ai-status=PASS]').waitFor();await settled();assert.equal(await page.evaluate(()=>window.r5Acceptance.ctx.qa?.release),'PASS');};
    await panel.locator('[data-ai-acceptance-file]').setInputFiles(path.join(root,'acceptance.json'));await settled();
    await panel.locator('[data-ai-acceptance-evidence]').setInputFiles(root);await pass();
    await page.evaluate(()=>window.r5Acceptance.mode='fail');await verify.click();await settled();
    await page.screenshot({path:path.join(root,'r5-input-read-failure.png'),fullPage:true});
    assert.equal(await panel.locator('[data-ai-status]').getAttribute('data-ai-status'),'BLOCKED','A failed input read must finish with an explicit blocked panel');
    assert.match(await panel.innerText(),/TIMEOUT: R5 synthetic evidence read failed/);
    assert.notEqual(await page.evaluate(()=>window.r5Acceptance.ctx.qa?.release),'PASS','Failed reads must clear the previous QA pass');
    await verify.click();await pass();assert.doesNotMatch(await panel.innerText(),/read failed/);
    // The most recently selected document owns the open operation, regardless of read completion order.
    const acceptance=JSON.parse(await fs.readFile(path.join(root,'acceptance.json'),'utf8'));
    const documentFile=(name,model)=>{const document=structuredClone(acceptance);for(const review of document.reviews)review.model=model;return{name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))};};
    const picker=panel.locator('[data-ai-acceptance-file]');
    await picker.setInputFiles(documentFile('r5-open-A.json','R5 older A'));await page.waitForFunction(()=>!!window.r5Acceptance.openReads['r5-open-A.json']);
    await picker.setInputFiles(documentFile('r5-open-B.json','R5 newer B'));await page.waitForFunction(()=>!!window.r5Acceptance.openReads['r5-open-B.json']);
    const beforeOpen=await page.evaluate(()=>JSON.stringify(window.r5Acceptance.statuses));
    await page.evaluate(()=>window.r5Acceptance.openReads['r5-open-A.json']());await page.waitForFunction(()=>window.r5Acceptance.pending===1);
    await page.screenshot({path:path.join(root,'r5-document-open-order.png'),fullPage:true});
    assert.notEqual(await page.evaluate(()=>window.r5Acceptance.panel.report?.checks[0]?.model),'R5 older A','An older document must not open after a newer selection has begun');
    assert.equal(await page.evaluate(()=>JSON.stringify(window.r5Acceptance.statuses)),beforeOpen);
    await page.evaluate(()=>window.r5Acceptance.openReads['r5-open-B.json']());await pass();
    assert.equal(await page.evaluate(()=>window.r5Acceptance.panel.report?.checks[0]?.model),'R5 newer B');
    await picker.setInputFiles(documentFile('r5-open-failed.json','R5 failed open'));await page.waitForFunction(()=>!!window.r5Acceptance.openReads['r5-open-failed.json']);
    await page.evaluate(()=>window.r5Acceptance.openReads['r5-open-failed.json'](true));await settled();
    assert.equal(await page.evaluate(()=>window.r5Acceptance.panel.report?.checks[0]?.model),'R5 newer B','A failed read preserves the current document and report');
    await panel.getByRole('button',{name:'保存 AI 终审文档',exact:true}).click();await settled();
    assert.equal(await page.evaluate(()=>window.r5Acceptance.saved.reviews[0].model),'R5 newer B');
    await picker.setInputFiles(documentFile('r5-open-cancelled.json','R5 cancelled open'));await page.waitForFunction(()=>!!window.r5Acceptance.openReads['r5-open-cancelled.json']);
    const chooser=page.waitForEvent('filechooser');await panel.getByRole('button',{name:'打开 AI 终审文档',exact:true}).click();await(await chooser).setFiles([]);
    await page.evaluate(()=>window.r5Acceptance.openReads['r5-open-cancelled.json']());await settled();
    assert.equal(await page.evaluate(()=>window.r5Acceptance.panel.report?.checks[0]?.model),'R5 newer B','Cancelling a newer picker must preserve the current review and supersede older pending reads');
    // An older non-abortable File read may fail after a newer verification succeeds.
    await page.evaluate(()=>window.r5Acceptance.mode='defer');await verify.click();await page.waitForFunction(()=>!!window.r5Acceptance.release);
    assert.notEqual(await page.evaluate(()=>window.r5Acceptance.ctx.qa?.release),'PASS','In-flight verification must not retain the previous QA pass');
    await verify.click();await panel.locator('[data-ai-status=PASS]').waitFor();
    const completed=await page.evaluate(()=>JSON.stringify(window.r5Acceptance.statuses));
    await page.evaluate(()=>window.r5Acceptance.release(true));await pass();
    assert.equal(await page.evaluate(()=>JSON.stringify(window.r5Acceptance.statuses)),completed,'A superseded failure must not overwrite the new completion status');
    // Source invalidation and leaving the panel discard both late results and late errors.
    for(const invalidate of ['source','leave']){
      await page.evaluate(()=>window.r5Acceptance.mode='defer');await verify.click();await page.waitForFunction(()=>!!window.r5Acceptance.release);
      const before=await page.evaluate(invalidate=>{const state=window.r5Acceptance;if(invalidate==='source'){state.source+='\n';state.panel.changed();}else state.panel.leave();state.render();return JSON.stringify(state.statuses);},invalidate);
      await page.evaluate(()=>window.r5Acceptance.release(true));await settled();
      assert.equal(await panel.locator('[data-ai-status]').getAttribute('data-ai-status'),'BLOCKED');
      assert.doesNotMatch(await panel.innerText(),/正在核对|late evidence read failed/);
      assert.notEqual(await page.evaluate(()=>window.r5Acceptance.ctx.qa?.release),'PASS');
      assert.equal(await page.evaluate(()=>JSON.stringify(window.r5Acceptance.statuses)),before);
      if(invalidate==='source')await page.evaluate(()=>{const state=window.r5Acceptance;state.source=state.source.slice(0,-1);state.panel.changed();state.render();});
      await verify.click();await pass();
    }
    await page.screenshot({path:path.join(root,'r5-input-read-recovered.png'),fullPage:true});
    await fs.writeFile(path.join(root,'R5_ACCEPTANCE_PANEL_REPORT.json'),JSON.stringify({status:'PASS',syntheticReviewFixtures:true,checks:['Input read failure shows BLOCKED with the actual reason and clears the old QA pass','Retry verifies the same document and current files successfully','Most recently selected document wins delayed reads; failed reads preserve the current document and report','Pending reads invalidate old QA; superseded errors cannot overwrite a newer pass','Source changes and leaving the panel discard late read errors']},null,2)+'\n');
  } finally {await page.close({runBeforeUnload:false});}
}
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  await verifyReadFailureRecovery(browser);
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];let hold=false,releaseRead,readStarted;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/assets/room.svg',async route=>{if(hold){readStarted?.();await new Promise(resolve=>releaseRead=resolve);}try{await route.fulfill({body:picture,contentType:'image/svg+xml'});}catch{}});
  await page.goto(base+'/editor/');await page.waitForSelector('body[data-editor-ready=true]');
  await page.locator('#open-file').setInputFiles({name:'project.json',mimeType:'application/json',buffer:sourceBytes});
  await page.getByLabel('作品名称',{exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('vn-r4-player-sentinel','unchanged'));
  await page.locator('[data-tab=production]').click();
  await page.locator('#production-list').getByRole('button',{name:'验证状态',exact:true}).click();
  const panel=page.locator('#production-list');
  await panel.locator('[data-ai-acceptance-file]').setInputFiles(path.join(root,'acceptance.json'));
  await panel.locator('[data-ai-status=BLOCKED]').waitFor();
  await panel.locator('[data-ai-acceptance-evidence]').setInputFiles(root);
  await panel.locator('[data-ai-status=PASS]').waitFor();
  assert.match(await panel.innerText(),/AI 模拟终审/);
  const old=await fs.readFile(path.join(root,'acceptance.json'),'utf8');
  await panel.locator('[data-ai-acceptance-file]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error')||document.querySelector('#status').textContent.includes('JSON'));
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'保存 AI 终审文档',exact:true}).click();
  const saved=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));assert.deepEqual(saved,JSON.parse(old));
  await page.getByLabel('作品名称',{exact:true}).fill('Changed after AI review');await page.getByLabel('作品名称',{exact:true}).blur();
  await panel.getByRole('button',{name:'核对 AI 终审',exact:true}).click();await panel.locator('[data-ai-scope=text]').filter({hasText:/stale|differs|changed/}).waitFor();
  assert.match(await panel.locator('[data-ai-acceptance-report]').innerText(),/stale|differs|changed/);
  await page.locator('[data-command=undo]').click();
  await panel.getByRole('button',{name:'核对 AI 终审',exact:true}).click();await panel.locator('[data-ai-status=PASS]').waitFor();
  await page.screenshot({path:path.join(root,'studio-ai-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await panel.getByRole('button',{name:'打开 AI 终审文档',exact:true}).focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'绑定审核证据目录');
  await page.screenshot({path:path.join(root,'studio-ai-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>localStorage.getItem('vn-r4-player-sentinel')),'unchanged');
  const pending=new Promise(resolve=>readStarted=resolve);hold=true;
  await panel.getByRole('button',{name:'核对 AI 终审',exact:true}).click();await pending;hold=false;
  await panel.getByRole('button',{name:'问题与反馈',exact:true}).click();releaseRead?.();
  assert.equal(await panel.locator('[data-ai-acceptance-report]').count(),0);
  await panel.getByRole('button',{name:'验证状态',exact:true}).click();
  await panel.getByRole('button',{name:'核对 AI 终审',exact:true}).click();await panel.locator('[data-ai-status=PASS]').waitFor();
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'R4_BROWSER_REPORT.json'),JSON.stringify({status:'PASS',syntheticReviewFixtures:true,checks:[
    'Actual acceptance file and evidence-directory import; no human signature required',
    'Invalid JSON preserves previous document; downloaded review stays separate',
    'Source edit invalidates AI acceptance; undo and re-verification restore the matching source',
    '390px keyboard/overflow and unchanged player storage'
  ]},null,2)+'\n');
  await page.close({runBeforeUnload:false});
  const site=path.join(root,'offline-studio');await packageStudio(site);
  const offlineServer=createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://local/'),prefix='/studio/nested/';if(!url.pathname.startsWith(prefix))throw Error('outside');
    const relative=decodeURIComponent(url.pathname.slice(prefix.length)),file=path.resolve(site,relative);if(!file.startsWith(site+path.sep))throw Error('outside');
    const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.css':'text/css','.woff2':'font/woff2','.png':'image/png'}[path.extname(file)]??'application/octet-stream';
    const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime});res.end(bytes);
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>offlineServer.listen(0,'127.0.0.1',resolve));let offlineContext;
  try{
    offlineContext=await browser.newContext();const first=await offlineContext.newPage(),url='http://127.0.0.1:'+offlineServer.address().port+'/studio/nested/editor/index.html';
    await first.goto(url);await first.waitForSelector('body[data-editor-ready=true]');
    await first.waitForFunction(()=>document.body.dataset.studioOffline==='ready'&&!!navigator.serviceWorker.controller);
    await offlineContext.setOffline(true);const fresh=await offlineContext.newPage();await fresh.goto(url);await fresh.waitForSelector('body[data-editor-ready=true]');
    await fresh.locator('[data-command=preview]').click();await fresh.frameLocator('#preview').locator('.vn-engine').waitFor();
    await fresh.screenshot({path:path.join(root,'studio-ai-offline.png'),fullPage:true});
    await fs.writeFile(path.join(root,'R4_OFFLINE_STUDIO_REPORT.json'),JSON.stringify({status:'PASS',nested:true,offlineFreshPage:true,actualPreview:true},null,2)+'\n');
  }finally{await offlineContext?.close();offlineServer.closeAllConnections();await new Promise(resolve=>offlineServer.close(resolve));}
  console.log('PASS R4 source-bound AI acceptance workbench, real files, stale rejection, undo, keyboard and storage isolation: '+root);
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
