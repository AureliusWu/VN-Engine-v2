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
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
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
