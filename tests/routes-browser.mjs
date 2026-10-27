import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createDemoServer} from '../tools/serve.mjs';
const server=await createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`);await page.waitForSelector('.vn-engine');
  const result=await page.evaluate(async()=>{
    const {runRouteSuite}=await import('./lib/index.js'),{newProject}=await import('./lib/editor/index.js');vnDemo.dispose();
    const before=JSON.stringify({...localStorage}),cases=[];
    for(const kind of ['vn','chat','script','investigation']){
      const p=newProject(kind),ids=kind==='investigation'?['read','back','reason']:[kind==='script'?'yes':'continue'];
      const report=runRouteSuite(p,{schema:1,cases:[{id:kind,steps:ids.map(id=>({type:'action',id})),expect:{ending:kind==='investigation'?'chapter-1:complete':'完成'}}]});
      cases.push({kind,status:report.status,checks:report.restoreChecks});
    }
    return {cases,unchanged:before===JSON.stringify({...localStorage})};
  });assert.ok(result.cases.every(c=>c.status==='PASS'&&c.checks>1),JSON.stringify(result));assert.equal(result.unchanged,true);assert.deepEqual(errors,[]);
  console.log('PASS Real Chromium runs route matrices for VN/chat/script/investigation with restore checks and no player storage writes');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
