import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
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
  assert.equal(await page.evaluate(()=>lifecycleGame.session.getView().visit),before);
  await page.evaluate(async()=>{
    const {mountGame}=await import('./lib/index.js');lifecycleGame.dispose();
    for(const key of Object.keys(localStorage))if(key.startsWith('vn-engine:title-fixture:'))localStorage.removeItem(key);
    window.titleProject={schema:1,game:'title-fixture',version:'v1',title:'A quiet beginning',titleScreen:true,type:'narrative',assets:[{id:'memory',kind:'cg',src:'assets/letter.svg'}],settings:{textDelayMs:0,reducedMotion:true},
      stage:{lines:{one:{video:{asset:'missing',fallback:{asset:'memory',kind:'cg'}}}}},
      scenes:[{id:'start',lines:[{id:'one',speaker:'N',text:'Opening hidden until start'},{id:'two',speaker:'N',text:'Saved chapter'}],ending:'done'}],collections:{cgs:[{id:'memory',title:'Memory'}],endings:[{id:'done',title:'Done'}]}};
    // Optional video asset is deliberately unavailable; the explicit reduced-motion fallback is used.
    titleProject.assets.push({id:'missing',kind:'video',src:'assets/test-video.webm'});
    window.remountTitle=()=>{window.titleGame?.dispose();window.titleGame=mountGame(document.getElementById('game'),titleProject,{audio:false});};remountTitle();
  });
  const host=page.locator('#game > .vn-engine'),modal=host.locator(':scope > .vn-modal');
  assert.equal(await host.getAttribute('data-title'),'true');assert.equal(await page.evaluate(()=>titleGame.persistence.contract.loadAuto().status),'empty');
  assert.equal(await page.evaluate(()=>titleGame.meta.read().status),'empty');
  await page.keyboard.press('Escape'); assert.equal(await host.getAttribute('data-title'),'true');
  await modal.locator('[data-control=title-settings]').click();await page.keyboard.press('Escape');assert.equal(await modal.locator('[data-control=title-new]').count(),1);
  await modal.locator('[data-control=title-gallery]').click();assert.match(await modal.innerText(),/0 \/ 1/);await page.keyboard.press('Escape');
  const out=process.env.VN_ENGINE_TEST_OUTPUT??'test-results';await mkdir(out,{recursive:true});await page.screenshot({path:out+'/player-title-desktop.png',fullPage:true});
  await modal.locator('[data-control=title-new]').click();await modal.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>titleGame.persistence.contract.loadAuto().status),'empty');
  await modal.locator('[data-control=title-new]').click();await modal.getByRole('button',{name:'确认开始新游戏',exact:true}).click();
  assert.equal(await host.getAttribute('data-title'),'false');assert.deepEqual(await page.evaluate(()=>titleGame.meta.read().value.cg_unlocked),['memory']);
  await page.evaluate(()=>{titleGame.session.next();titleGame.persistence.saveManual(1);titleGame.persistence.quickSave();});
  const saved=await page.evaluate(()=>({auto:localStorage.getItem(titleGame.persistence.contract.keyFor('auto')),meta:localStorage.getItem(titleGame.meta.key),line:titleGame.session.getView().frame.lineId}));
  await host.locator('[data-control=title]').click();await modal.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await host.getAttribute('data-title'),'false');
  await host.locator('[data-control=title]').click();await modal.getByRole('button',{name:'确认返回标题',exact:true}).click();
  assert.equal(await page.evaluate(()=>titleGame.session.getView().paused),true);assert.equal(await page.evaluate(()=>localStorage.getItem(titleGame.persistence.contract.keyFor('auto'))),saved.auto);
  await modal.locator('[data-control=title-resume]').click();assert.equal(await page.evaluate(()=>titleGame.session.getView().frame.lineId),saved.line);
  await page.evaluate(()=>remountTitle());assert.equal(await page.evaluate(()=>localStorage.getItem(titleGame.persistence.contract.keyFor('auto'))),saved.auto);
  await modal.locator('[data-control=title-continue]').click();assert.equal(await page.evaluate(()=>titleGame.session.getView().frame.lineId),'two');
  await page.evaluate(()=>remountTitle());await modal.locator('[data-control=title-load]').click();await modal.locator('[data-slot="1"] button').click();assert.equal(await host.getAttribute('data-title'),'false');
  await page.evaluate(()=>remountTitle());await modal.locator('[data-control=title-new]').click();await modal.getByRole('button',{name:'确认开始新游戏',exact:true}).click();
  assert.equal(await page.evaluate(()=>titleGame.session.getView().frame.lineId),'one');assert.equal(await page.evaluate(()=>titleGame.persistence.contract.loadManual(1).status),'valid');
  assert.equal(await page.evaluate(()=>titleGame.persistence.contract.loadQuick().status),'valid');assert.equal(await page.evaluate(()=>titleGame.meta.read().value.playthrough_count),1);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>remountTitle());await page.screenshot({path:out+'/player-title-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1100,height:950});await page.goto(url.replace('/engine/','/editor/'));await page.waitForSelector('body[data-editor-ready=true]');
  await page.getByLabel('启动界面',{exact:true}).selectOption('title');const preview=page.frameLocator('#preview');await preview.locator('[data-control=title-new]').waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-command=export]').click()]);assert.equal(JSON.parse(await readFile(await download.path(),'utf8')).titleScreen,true);
  await page.locator('[data-command=undo]').click();await preview.locator('[data-control=title-new]').waitFor({state:'detached'});assert.equal(await page.getByLabel('启动界面',{exact:true}).inputValue(),'story');assert.deepEqual(errors,[]);
  console.log('PASS Startup preserves Auto; title/Continue/Load/settings/collections, cancellation, new-game isolation and Studio authoring/export execute in the real player');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
