import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import {createDemoServer} from '../tools/serve.mjs';
import {newProject} from '../dist/editor/model.js';

const out=process.env.VN_ENGINE_TEST_OUTPUT??'test-results/p0-studio';await mkdir(out,{recursive:true});
const server=await createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1360,height:1000},acceptDownloads:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/editor/`);await page.waitForSelector('body[data-editor-ready=true]');
  await page.frameLocator('#preview').locator('[data-action=yes]').waitFor();
  await page.locator('[data-tab=evidence]').click();
  await page.locator('[data-evidence-command=capture]').click();await page.waitForSelector('body[data-evidence-binding=current]');
  assert.match(await page.locator('[data-evidence-status]').innerText(),/非验收通过/);
  assert.ok(await page.locator('[data-semantic-id]').count()>10);
  assert.ok(await page.locator('[data-evidence-sequence]').count()>0);
  await page.locator('[data-evidence-navigate]').first().click();assert.equal(await page.getByLabel('节点 ID',{exact:true}).inputValue(),'start');
  await page.locator('[data-tab=evidence]').click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-evidence-command=download]').click()]);
  const report=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(report.contract,'vn-runtime-evidence-v1');assert.match(report.sourceSha256,/^[a-f0-9]{64}$/);
  await page.locator('#auto-preview').uncheck();await page.getByLabel('作品名称',{exact:true}).fill('改后需重新采集');await page.getByLabel('作品名称',{exact:true}).blur();
  await page.waitForSelector('body[data-evidence-binding=stale]');assert.equal(await page.locator('[data-evidence-navigate]:enabled').count(),0);
  await page.getByLabel('导入运行证据文件',{exact:true}).setInputFiles({name:'old-evidence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
  await page.waitForSelector('body[data-evidence-binding=stale]');assert.match(await page.locator('[data-evidence-status]').innerText(),/过期/);
  await page.locator('[data-command=preview]').click();await page.frameLocator('#preview').locator('[data-action=yes]').waitFor();
  await page.locator('[data-evidence-command=capture]').click();await page.waitForSelector('body[data-evidence-binding=current]');
  await page.frameLocator('#preview').locator('[data-action=yes]').click();await page.locator('[data-evidence-command=capture]').click();
  await page.waitForFunction(()=>document.querySelector('[data-evidence-status]')?.textContent.includes('当前工程')&&document.querySelector('.evidence-events')?.textContent.includes('action-applied'));
  await page.screenshot({path:out+'/studio-evidence.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // A preview/worker update can rebuild routes while a pending field still has focus.
  // Its native change event must commit once and preserve the edited value without nested DOM removal.
  await page.setViewportSize({width:1360,height:1000});await page.locator('#auto-preview').check();
  const p=newProject('script');p.routeTests={schema:1,cases:[{id:'blur-race',steps:[{type:'action',id:'yes'}],expect:{ending:'完成'}}]};
  await page.locator('#open-file').setInputFiles({name:'blur-race.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
  await page.locator('[data-tab=routes]').click();await page.getByLabel('用例 1 名称',{exact:true}).waitFor();
  await page.route('**/editor/route-worker.mjs',r=>r.fulfill({contentType:'text/javascript',body:"import {runRouteSuite} from '../lib/index.js';self.onmessage=e=>setTimeout(()=>self.postMessage({requestId:e.data.requestId,report:runRouteSuite(JSON.parse(e.data.source))}),200);"}));
  await page.locator('[data-route-command=run]').click();await page.waitForSelector('body[data-route-status=RUNNING]');
  await page.getByLabel('用例 1 名称',{exact:true}).fill('预览完成时仍聚焦的字段');await page.waitForTimeout(650);
  assert.equal(await page.getByLabel('用例 1 名称',{exact:true}).inputValue(),'预览完成时仍聚焦的字段');
  assert.equal(await page.locator('body').getAttribute('data-route-status'),'STALE');
  assert.deepEqual(errors,[]);
  console.log('PASS P0 Studio semantic catalogue, source-bound preview evidence, node navigation, stale import and renewed capture');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
