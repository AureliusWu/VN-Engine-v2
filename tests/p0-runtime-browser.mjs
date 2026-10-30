import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../tools/serve.mjs';

const output=(process.env.VN_ENGINE_TEST_OUTPUT??'test-results')+'/p0-runtime';
await mkdir(output,{recursive:true});
const server=await createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const checks=[],failures=[],errors=[],evidence=[],releases=new Set();let browser,page;
try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
    args:process.env.PLAYWRIGHT_CHROMIUM_ARGS?JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS):['--no-sandbox']});
  page=await browser.newPage({viewport:{width:1100,height:950},serviceWorkers:'block',reducedMotion:'no-preference'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`);await page.waitForSelector('.vn-engine');
  const check=async(name,run)=>{try{await run();checks.push(name);console.log('PASS',name);}catch(error){failures.push({name,error:error.stack??error.message});console.error('FAIL',name,error.message);await page.screenshot({path:`${output}/failure-${failures.length}.png`,fullPage:true});}};
  const mount=async(options={})=>page.evaluate(async options=>{
    globalThis.vnDemo?.dispose();globalThis.p0Game?.dispose();document.getElementById('p0-unlock')?.remove();
    const api=await import('./lib/index.js');
    const assets=[{id:'room',kind:'background',src:'assets/classroom.svg'},{id:'hero',kind:'portrait',src:'assets/student.svg'},
      {id:'memory',kind:'cg',src:'assets/letter.svg'},{id:'music',kind:'audio',src:'assets/music-test.wav'},{id:'voice',kind:'audio',src:'assets/voice-test.wav'},
      {id:'cue',kind:'audio',src:'assets/cue.wav'},{id:'clip',kind:'video',src:'assets/test-video.webm'},
      {id:'recover',kind:'background',src:'assets/p0-recover.svg'},{id:'slow',kind:'background',src:'assets/p0-slow.svg'},{id:'fresh',kind:'background',src:'assets/p0-fresh.svg'}];
    const timeline={durationMs:320,animations:[{id:'enter',layer:'character-front',target:'hero',from:{x:0,y:0,scale:1,opacity:0},to:{x:90,y:30,scale:1.5,opacity:.8},durationMs:320}],
      camera:[{atMs:0,x:0,y:0,scale:1},{atMs:320,x:40,y:10,scale:1.2}]};
    const first=options.kind==='images'?{background:options.first??'recover'}:{background:'room',layers:{'character-front':{asset:'hero',kind:'portrait'}},timeline,
      ...(options.kind==='media'?{music:'music',voice:'voice',sound:'cue',video:{asset:'clip',muted:true}}:{})};
    const second=options.kind==='images'?{background:options.second??options.first??'recover'}:{};
    const project={schema:1,game:'p0-runtime-browser',version:'v1',title:'P0 生命周期与来源证据',type:'script',assets,
      settings:{textDelayMs:options.typing?10:0,reducedMotion:!!options.reducedMotion},collections:{cgs:[{id:'memory'}],endings:[{id:'done'}]},
      program:{schema:1,game:'p0-runtime-browser',version:'v1',entry:'start',variables:{},blocks:[{id:'start',lines:[
        {id:'one',speaker:'旁白',text:options.typing?'加载失败不会让打字产生重复请求。'.repeat(5):'只读证据关联当前访问、资源与稳定台词。',cue:first},
        {id:'two',speaker:'旁白',text:'进入下一次访问后，保留合法的展示终态。',cue:second},
        {id:'three',speaker:'旁白',text:'存档与全局收藏保持原有兼容边界。',cue:{...second,...(options.kind==='images'?{}:{cg:'memory'})}}
      ],exit:{type:'end',ending:'done'}}]}};
    const source=JSON.stringify(project,null,2)+'\n',sourceSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),n=>n.toString(16).padStart(2,'0')).join('');
    const collector=new api.RuntimeEvidence({sessionId:'p0-browser-'+(options.kind??'timeline'),sourceSha256,maxEvents:512,maxBytes:131072});
    const bytes=new Map([['vn-engine:foreign-game:v2:save:manual-1','foreign save bytes'],['foreign-native:persistent','foreign meta bytes']]);
    const storage={getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value),removeItem:key=>bytes.delete(key)};
    globalThis.p0Game=api.mountGame(document.getElementById('game'),project,{audio:options.kind==='media',storage,evidence:collector});
    if(options.pauseBeforeFrame){p0Game.session.pause('p0-first-frame',true);p0Game.session.pause('p0-first-frame',false);}
    globalThis.p0Fixture={project,sourceSha256,collector,bytes,api};
    const unlock=document.createElement('button');unlock.id='p0-unlock';unlock.textContent='启用 P0 实际媒体';unlock.onclick=()=>p0Game.unlockAudio();document.body.append(unlock);
  },options);
  const report=async(scope={})=>page.evaluate(scope=>p0Fixture.api.createRuntimeEvidenceReport(p0Fixture.project,p0Fixture.collector.snapshot(),p0Fixture.sourceSha256,{runtime:true,media:p0Game.audioActive,audioDevice:false,...scope}),scope);
  const styles=()=>page.evaluate(()=>({layer:document.querySelector('[data-layer="character-front"]').style.transform,opacity:document.querySelector('[data-layer="character-front"]').style.opacity,camera:document.querySelector('.vn-camera').style.transform}));
  const finalStyle={layer:'translate(90px, 30px) scale(1.5)',opacity:'0.8',camera:'translate(40px, 10px) scale(1.2)'};

  await check('Timeline pause before the first frame resumes one effect instead of claiming a second start',async()=>{
    await mount({pauseBeforeFrame:true});await page.waitForFunction(()=>p0Fixture.collector.snapshot().events.some(e=>e.effect==='stage.timeline'&&e.phase==='settled'));
    const events=await page.evaluate(()=>p0Fixture.collector.snapshot().events.filter(e=>e.effect==='stage.timeline'));
    assert.equal(events.filter(e=>e.phase==='started').length,1);assert.equal(events.filter(e=>e.phase==='paused').length,1);assert.equal(events.filter(e=>e.phase==='resumed').length,1);
    assert.deepEqual(await styles(),finalStyle);
  });

  await check('Image failure retries on a new visit with source-bound outcomes and no request storm',async()=>{
    const body=await readFile('examples/runtime/assets/classroom.svg');let requests=0;
    await page.route('**/assets/p0-recover.svg',route=>{requests++;return route.fulfill({status:requests===1?503:200,contentType:'image/svg+xml',body:requests===1?'temporary failure':body});});
    try {
      await mount({kind:'images',typing:true});
      await page.waitForFunction(()=>p0Fixture.collector.snapshot().events.some(e=>e.effect==='stage.background'&&e.phase==='failed'));
      await page.waitForFunction(()=>p0Game.session.getView().text.length>=8);
      await page.evaluate(()=>{for(let i=0;i<6;i++)p0Game.session.configure({opacity:.4+i*.05});});assert.equal(requests,1);
      await page.evaluate(()=>{p0Game.session.configure({textDelayMs:0});p0Game.session.next();});
      await page.waitForFunction(()=>!document.querySelector('.vn-background').hidden&&document.querySelector('.vn-background').naturalWidth>0);
      const loaded=requests;await page.evaluate(()=>p0Game.session.next());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(requests,loaded);
      const proof=await report();const failed=proof.events.find(e=>e.effect==='stage.background'&&e.phase==='failed');const settled=proof.events.find(e=>e.effect==='stage.background'&&e.phase==='settled');
      assert.equal(failed.lineId,'one');assert.equal(settled.lineId,'two');assert.equal(failed.assetId,'recover');assert.equal(settled.origin.sourceSha256,proof.sourceSha256);assert.ok(settled.origin.path?.length);
      evidence.push({case:'image-retry',report:proof,requests});await page.screenshot({path:output+'/image-recovered.png',fullPage:true});
    }finally{await page.unroute('**/assets/p0-recover.svg');}
  });

  await check('Late image completion is cancelled at its original visit and cannot replace newer pixels',async()=>{
    let began,release,finished;
    const fresh='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="teal"/></svg>';
    await page.route('**/assets/p0-fresh.svg',route=>route.fulfill({contentType:'image/svg+xml',body:fresh}));
    await page.route('**/assets/p0-slow.svg',async route=>{began?.();await new Promise(resolve=>{release=resolve;releases.add(resolve);});try{await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'});}catch{}finally{releases.delete(release);finished?.();}});
    try {
      const started=new Promise(resolve=>{began=resolve;}),done=new Promise(resolve=>{finished=resolve;});
      await mount({kind:'images',first:'slow',second:'fresh'});await started;await page.evaluate(()=>p0Game.session.next());
      await page.waitForFunction(()=>document.querySelector('.vn-background').naturalWidth===64);release();await done;await page.evaluate(()=>new Promise(requestAnimationFrame));
      assert.deepEqual(await page.locator('.vn-background').evaluate(node=>[node.dataset.asset,node.naturalWidth]),['fresh',64]);
      const proof=await report();assert.ok(proof.events.some(e=>e.assetId==='slow'&&e.phase==='cancelled'&&e.lineId==='one'));
      assert.equal(proof.events.some(e=>e.assetId==='slow'&&e.phase==='settled'),false);assert.ok(proof.events.some(e=>e.assetId==='fresh'&&e.phase==='settled'&&e.lineId==='two'));
      evidence.push({case:'late-image',report:proof});
    }finally{for(const release of releases)release();await page.unroute('**/assets/p0-slow.svg');await page.unroute('**/assets/p0-fresh.svg');}
  });

  await check('Real timeline normal, skip, reduced motion, load and rollback settle to identical transforms without evidence writes',async()=>{
    await mount({kind:'timeline'});await page.waitForFunction(()=>p0Fixture.collector.snapshot().events.some(e=>e.effect==='stage.timeline'&&e.phase==='settled'));assert.deepEqual(await styles(),finalStyle);
    const baseline=await page.evaluate(()=>p0Game.session.save());
    const skipped=await page.evaluate(()=>{p0Game.session.restart();const accepted=p0Game.session.setSkip(true);p0Game.session.setSkip(false);return accepted;});assert.equal(skipped,true);assert.deepEqual(await styles(),finalStyle);
    await page.evaluate(()=>{p0Game.session.configure({reducedMotion:true});p0Game.session.restart();});assert.deepEqual(await styles(),finalStyle);
    await page.evaluate(saved=>{p0Game.session.configure({reducedMotion:false});p0Game.session.restore(saved);},baseline);assert.deepEqual(await styles(),finalStyle);assert.deepEqual(await page.evaluate(()=>p0Game.session.save()),baseline);
    await page.evaluate(()=>{p0Game.session.next();p0Game.session.next();p0Game.persistence.saveManual(1);p0Game.persistence.quickSave();p0Game.readProgress.flush();});
    const bytes=await page.evaluate(()=>Object.fromEntries(p0Fixture.bytes));
    const beforeRead=await page.evaluate(()=>{const raw=Object.fromEntries(p0Fixture.bytes);p0Fixture.collector.snapshot();p0Fixture.collector.drain();return {raw,after:Object.fromEntries(p0Fixture.bytes)};});assert.deepEqual(beforeRead.after,beforeRead.raw);
    assert.equal(await page.evaluate(()=>p0Game.session.rollback(2)),true);assert.deepEqual(await styles(),finalStyle);
    assert.deepEqual(await page.evaluate(()=>Object.fromEntries(p0Fixture.bytes)),bytes);assert.deepEqual(await page.evaluate(()=>p0Game.session.save()),baseline);
    const proof=await report();assert.ok(proof.events.some(e=>e.effect==='stage.timeline'&&e.phase==='settled'&&e.reason==='rollback'));
    assert.equal(bytes['vn-engine:foreign-game:v2:save:manual-1'],'foreign save bytes');assert.equal(bytes['foreign-native:persistent'],'foreign meta bytes');
    for(const raw of Object.values(bytes))assert.equal(raw.includes('vn-runtime-evidence'),false);
    evidence.push({case:'timeline-and-persistence',report:proof,storedKeys:Object.keys(bytes)});await page.screenshot({path:output+'/timeline-restored.png',fullPage:true});
  });

  await check('Actual Chromium AudioContext, audio elements and video emit lifecycle evidence without claiming physical listening',async()=>{
    await mount({kind:'media'});await page.locator('#p0-unlock').click();
    await page.waitForFunction(()=>['stage.music','stage.voice','stage.sound','stage.video'].every(effect=>p0Fixture.collector.snapshot().events.some(e=>e.effect===effect&&e.phase==='started')),null,{timeout:15000});
    await page.waitForFunction(()=>['stage.voice','stage.sound'].every(effect=>p0Fixture.collector.snapshot().events.some(e=>e.effect===effect&&e.phase==='settled')),null,{timeout:15000});
    const save=await page.evaluate(()=>p0Game.session.save());await page.evaluate(()=>p0Game.session.restore(p0Game.session.save()));
    await page.waitForFunction(()=>p0Fixture.collector.snapshot().events.some(e=>e.effect==='stage.sound'&&e.phase==='suppressed'&&e.reason==='restore'));
    assert.deepEqual(await page.evaluate(()=>p0Game.session.save()),save);
    const proof=await report();assert.equal(proof.scope.audioDevice,false);assert.ok(proof.events.some(e=>e.effect==='stage.music'&&e.phase==='retained'));
    evidence.push({case:'real-browser-media',report:proof});await page.screenshot({path:output+'/actual-media.png',fullPage:true});
  });

  await page.evaluate(()=>p0Game?.dispose());
  await writeFile(output+'/P0_RUNTIME_REPORT.json',JSON.stringify({status:failures.length||errors.length?'FAIL':'PASS',browser:await browser.version(),mode:'headless',
    scope:{actualBrowser:true,physicalAudioListening:false,nativeWindowsInput:false,exhaustive:false},checks,failures,errors,evidence},null,2)+'\n');
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{for(const release of releases)release();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
