import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';
const server=await createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.route('**/creative-ui',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0}main{max-width:1280px}</style><main id="game"></main>'}));await page.goto(base+'/creative-ui');
 const result=await page.evaluate(async()=>{
  const {mountGame}=await import('/lib/index.js');const p=await(await fetch('/samples/campus.json')).json();p.titleScreen=false;p.ui={schema:1,preset:'paper',density:'compact',colors:{accent:'#8c4f32'}};
  Object.defineProperty(window,'localStorage',{get(){throw Error('Unexpected player storage access')}});
  const game=mountGame(document.getElementById('game'),p,{baseURL:new URL('/samples/',location.href),storage:null,audio:false});window.creativeUI=game;
  const root=document.querySelector('.vn-engine');const normal={theme:root.dataset.uiTheme,color:getComputedStyle(root).color,accent:getComputedStyle(root).getPropertyValue('--vn-ui-accent')};
  game.session.configure({highContrast:true,fontScale:1.6});const high={reading:getComputedStyle(document.querySelector('.vn-reading')).backgroundColor,text:getComputedStyle(document.querySelector('.vn-reading')).color};return{normal,high};
 });
 assert.equal(result.normal.theme,'paper');assert.equal(result.normal.color,'rgb(48, 44, 39)');assert.equal(result.normal.accent,'#8c4f32');assert.equal(result.high.reading,'rgb(0, 0, 0)');assert.equal(result.high.text,'rgb(255, 255, 255)');
 await page.evaluate(()=>window.creativeUI.session.configure({highContrast:false,fontScale:1}));await page.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await page.locator('.vn-panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 248, 236)');await page.keyboard.press('Escape');await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/creative-theme-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.creativeUI.session.configure({fontScale:1.6}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await page.locator('.vn-toolbar button').first().evaluate(e=>e.getBoundingClientRect().height)>=44);await page.screenshot({path:'test-results/creative-theme-mobile.png',fullPage:true});
 await page.evaluate(()=>window.creativeUI.dispose());console.log('PASS Typed project themes render real colors, preserve high contrast and player scale, isolate storage and fit 390px');
}finally{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
