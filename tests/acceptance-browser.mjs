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
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/assets/room.svg',route=>route.fulfill({body:picture,contentType:'image/svg+xml'}));
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
  await panel.getByRole('button',{name:'核对 AI 终审',exact:true}).click();await panel.locator('[data-ai-status=BLOCKED]').waitFor();
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
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'R4_BROWSER_REPORT.json'),JSON.stringify({status:'PASS',syntheticReviewFixtures:true,checks:[
    'Actual acceptance file and evidence-directory import; no human signature required',
    'Invalid JSON preserves previous document; downloaded review stays separate',
    'Source edit invalidates AI acceptance; undo and re-verification restore the matching source',
    '390px keyboard/overflow and unchanged player storage'
  ]},null,2)+'\n');
  await page.close({runBeforeUnload:false});
  console.log('PASS R4 source-bound AI acceptance workbench, real files, stale rejection, undo, keyboard and storage isolation: '+root);
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
