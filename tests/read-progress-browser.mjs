import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createDemoServer} from '../tools/serve.mjs';

const server=await createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1100,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}/engine/`;await page.goto(url);await page.waitForSelector('.vn-engine');
  const project={schema:1,game:'persisted-read-fixture',version:'v1',title:'Read fixture',titleScreen:true,type:'narrative',assets:[],settings:{textDelayMs:0},
    scenes:[{id:'start',lines:[{id:'one',speaker:'N',text:'Read before restart'},{id:'two',speaker:'N',text:'Unread paragraph'}],choices:[{id:'yes',text:'Choose',next:'end'}]},
      {id:'end',lines:[{id:'done',speaker:'N',text:'End'}],ending:'done'}]};
  const mount=()=>page.evaluate(async p=>{const {mountGame}=await import('./lib/index.js');window.vnDemo?.dispose();window.readGame?.dispose();window.readGame=mountGame(document.getElementById('game'),p,{audio:false});},project);
  const start=async()=>{await page.locator('[data-control=title-new]').click();await page.getByRole('button',{name:'确认开始新游戏',exact:true}).click();};
  await mount();assert.equal(await page.evaluate(()=>readGame.readProgress.count),0);
  await page.locator('[data-control=title-settings]').click();await page.getByLabel('高对比模式',{exact:true}).check();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>localStorage.getItem(readGame.readProgress.key)),null);
  await start();assert.equal(await page.evaluate(()=>readGame.readProgress.count),1);
  await page.evaluate(()=>{readGame.session.configure({textDelayMs:100});readGame.session.next();});
  assert.equal(await page.evaluate(()=>readGame.readProgress.count),1);
  // A real navigation must flush the completed first line, while the partially typed second line stays unread.
  await page.reload();await page.waitForSelector('.vn-engine');await mount();assert.equal(await page.evaluate(()=>readGame.readProgress.count),1);
  await start();assert.equal(await page.evaluate(()=>readGame.session.setSkip(true)),true);
  await page.waitForFunction(()=>readGame.session.getView().frame.lineId==='two');
  assert.equal(await page.evaluate(()=>readGame.session.getView().skipping),false);assert.equal(await page.evaluate(()=>readGame.session.save().state.decisions.length),0);
  await page.evaluate(()=>readGame.readProgress.flush());
  const before=await page.evaluate(()=>localStorage.getItem(readGame.readProgress.key));
  await page.locator('[data-control=rollback]').click();await page.evaluate(()=>readGame.readProgress.flush());assert.equal(await page.evaluate(()=>localStorage.getItem(readGame.readProgress.key)),before);
  project.scenes[0].lines[0].text='Edited paragraph using the same ID';await mount();await start();assert.equal(await page.evaluate(()=>readGame.session.setSkip(true)),false);
  project.version='v2';await mount();assert.equal(await page.evaluate(()=>readGame.readProgress.count),0);await start();assert.equal(await page.evaluate(()=>readGame.session.setSkip(true)),false);
  await page.evaluate(()=>{readGame.readProgress.flush();localStorage.setItem(readGame.readProgress.key,'{broken');});
  await mount();await start();await page.waitForFunction(()=>document.querySelector('.vn-status').textContent.includes('已读记录暂未保存'));
  assert.equal(await page.evaluate(()=>localStorage.getItem(readGame.readProgress.key)),'{broken');assert.equal(await page.evaluate(()=>readGame.session.next()),true);
  await page.evaluate(()=>readGame.dispose());assert.deepEqual(errors,[]);
  console.log('PASS Page reload persists completed reads; title/partial text/rollback stay isolated; skip stops at unread choices and changed text/version; corrupt records remain readable');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
