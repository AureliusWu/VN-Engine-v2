import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { runAgentExamples } from '../tools/agent-example.mjs';
import { runAgentFileRequest } from '../tools/agent-node.mjs';
await fs.mkdir('test-results',{recursive:true});const root=await fs.mkdtemp(path.resolve('test-results/agent-'));
const runs=[];
for(const transport of ['sdk','cli'])runs.push(await runAgentExamples(path.join(root,transport),{transport}));
const evidence={status:'PASS',engineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),flows:runs.map(r=>({transport:r.transport,calls:r.calls,sourceHashes:r.sourceHashes})),nestedOffline:[],negative:[]};
let serial=0;const call=(command,project,params={})=>runAgentFileRequest({protocol:'vn-agent-v1',requestId:'browser-'+(++serial),command,project,params});
const source=path.join(root,'sdk/script/project.json');
for(const [command,params,status,code]of [
 ['preview',{caseId:'together',previewMs:1,output:path.join(root,'timeout-preview')},'UNVERIFIED','TIMEOUT'],
 ['preview',{caseId:'together',maxOperations:1,output:path.join(root,'budget-preview')},'UNVERIFIED','BUDGET_EXCEEDED'],
 ['build',{mode:'release',output:path.join(root,'release-blocked')},'BLOCKED','RELEASE_GATE_BLOCKED'],
 ['build',{output:path.join(root,'sdk/script/game')},'FAIL','OUTPUT_EXISTS']
]){const result=await call(command,source,params);assert.equal(result.status,status,JSON.stringify(result));assert.equal(result.diagnostics.at(-1).code,code);evidence.negative.push(result);}
// Real missing resource bytes block validate and do not mutate the source.
const picture=path.join(root,'sdk/script/assets/room.svg'),original=await fs.readFile(source);await fs.rename(picture,picture+'.hold');const missing=await call('validate',source);assert.equal(missing.status,'FAIL');assert.ok(missing.diagnostics.some(d=>d.assetId==='room'));assert.deepEqual(await fs.readFile(source),original);await fs.rename(picture+'.hold',picture);evidence.negative.push(missing);
// Rain's original-format entry continues to use the same real runtime and packager.
const rain=path.resolve('examples/runtime/rain.json'),rainProject=JSON.parse(await fs.readFile(rain,'utf8'));
for(const command of ['inspect','validate','test']){const response=await call(command,rain);assert.equal(response.status,'PASS',JSON.stringify(response));}
const rainPreview=await call('preview',rain,{caseId:rainProject.routeTests.cases[0].id,output:path.join(root,'rain-preview')});assert.equal(rainPreview.status,'PASS',JSON.stringify(rainPreview));
const rainBuild=await call('build',rain,{output:path.join(root,'rain-game')});assert.equal(rainBuild.status,'PASS',JSON.stringify(rainBuild));evidence.rain={preview:rainPreview,build:rainBuild};
// Additional narrative templates are previewed / built through the identical interface.
for(const type of ['vn','chat']){const source=path.join(root,'sdk',type,'project.json');for(const [command,params]of [['preview',{caseId:'complete',output:path.join(root,type+'-preview')}],['build',{output:path.join(root,type+'-game')}]] ){const response=await call(command,source,params);assert.equal(response.status,'PASS',JSON.stringify(response));}}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.png':'image/png','.wav':'audio/wav','.ogg':'audio/ogg','.webm':'video/webm'};
const directories=new Map();for(const transport of ['sdk','cli'])for(const type of ['script','investigation'])directories.set(`${transport}-${type}`,path.join(root,transport,type,'game'));
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://test/'),match=/^\/stories\/([^/]+)\/(.*)$/.exec(url.pathname);if(!match||!directories.has(match[1]))throw Error('Unknown route');const base=directories.get(match[1]),file=path.resolve(base,decodeURIComponent(match[2]||'index.html'));if(!file.startsWith(base+path.sep))throw Error('Unsafe path');res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 for(const [name]of directories){const context=await browser.newContext();try{let page=await context.newPage();const url=origin+`/stories/${name}/`;await page.goto(url);await page.waitForFunction(()=>document.getElementById('status')?.textContent==='已下载，可离线游玩');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller&&document.querySelector('.vn-engine'));await page.screenshot({path:path.join(root,name+'-nested.png')});await page.close();await context.setOffline(true);page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>document.querySelector('.vn-engine'));assert.equal(await page.locator('#error').innerText(),'');await page.screenshot({path:path.join(root,name+'-offline.png')});evidence.nestedOffline.push({name,path:`/stories/${name}/`,status:'PASS',reopened:true});}finally{await context.close();}}
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
await fs.writeFile(path.join(root,'AGENT_BROWSER_REPORT.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS R1 SDK + CLI E2E, four templates, Rain preview/build, failed gates/resources/budgets, four nested offline reopened packages');
