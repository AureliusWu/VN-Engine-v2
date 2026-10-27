import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({viewport:{width:1100,height:950}}), errors=[]; page.on('pageerror', error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}/engine/`;
  await page.goto(url); await page.waitForSelector('.vn-engine');
  const mount = async () => page.evaluate(async () => {
    const {mountGame} = await import('./lib/index.js'); window.vnDemo?.dispose(); window.lifecycleGame?.dispose();
    const project={schema:1,game:'lifecycle-fixture',version:'v1',title:'Lifecycle fixture',type:'narrative',assets:[],settings:{textDelayMs:0},
      scenes:[{id:'start',lines:[{id:'one',speaker:'N',text:'First paragraph'},{id:'two',speaker:'N',text:'Saved paragraph'}],ending:'done'}]};
    window.lifecycleGame=mountGame(document.getElementById('game'),project,{audio:false});
  });
  await mount(); await page.evaluate(()=>{lifecycleGame.session.next(); localStorage.setItem('lifecycle-expected-auto',localStorage.getItem(lifecycleGame.persistence.contract.keyFor('auto')));});
  await page.reload(); await page.waitForSelector('.vn-engine'); await mount();
  assert.equal(await page.evaluate(()=>localStorage.getItem(lifecycleGame.persistence.contract.keyFor('auto'))===localStorage.getItem('lifecycle-expected-auto')),true);
  await page.locator('#game > .vn-engine [data-control=continue]').click();
  assert.equal(await page.evaluate(()=>lifecycleGame.session.getView().frame.lineId),'two');
  await page.evaluate(()=>{lifecycleGame.persistence.quickSave();localStorage.setItem(lifecycleGame.persistence.contract.keyFor('auto'),'{broken}');});
  await mount(); assert.equal(await page.evaluate(()=>localStorage.getItem(lifecycleGame.persistence.contract.keyFor('auto'))),'{broken}');
  await page.locator('[data-control=continue]').click(); assert.equal(await page.evaluate(()=>lifecycleGame.session.getView().frame.lineId),'two');
  await page.evaluate(()=>{localStorage.setItem(lifecycleGame.persistence.contract.keyFor('auto'),'{broken}');localStorage.setItem(lifecycleGame.persistence.contract.keyFor('quick'),'{broken}');});
  await mount(); const before=await page.evaluate(()=>lifecycleGame.session.getView().visit);
  await page.locator('[data-control=continue]').click(); assert.match(await page.locator('.vn-status').innerText(),/没有可恢复/);
  assert.equal(await page.evaluate(()=>lifecycleGame.session.getView().visit),before); assert.deepEqual(errors,[]);
  console.log('PASS Startup and real reload preserve previous Auto; Continue validates routes, skips corrupt saves and retains failed data');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
