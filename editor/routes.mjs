import {createProject,routeExpectation,projectEndings} from '../lib/index.js';

export function createRoutesPanel(root,host){
  const {element,action,field}=host;let recording=false,recordingSource,report,reportSource,worker,jobSource,serial=0,timeout;
  const source=()=>JSON.stringify(host.project());
  const stop=()=>{clearTimeout(timeout);worker?.terminate();worker=undefined;};
  const setReport=(next,current)=>{report=next;reportSource=current;document.body.dataset.routeStatus=next.status;render();};
  const run=()=>{
    stop();jobSource=source();const current=jobSource,id=++serial,task=new Worker(new URL('./route-worker.mjs',import.meta.url),{type:'module'});worker=task;
    document.body.dataset.routeStatus='RUNNING';render();
    task.onmessage=event=>{if(worker!==task||event.data.requestId!==id)return;stop();if(current!==source()){document.body.dataset.routeStatus='STALE';render();return;}setReport(event.data.report,current);};
    task.onerror=()=>{if(worker===task){stop();setReport({status:'FAIL',error:'路线检查线程未完成，请重试',cases:[],coverage:{missing:[]}},current);}};
    timeout=setTimeout(()=>{if(worker===task){stop();setReport({status:'UNVERIFIED',error:'检查超时，请减少用例步骤或分批执行',cases:[],coverage:{missing:[]}},current);}},30_000);
    task.postMessage({requestId:id,source:JSON.stringify(host.project(),null,2)+'\n'});
  };
  const nextId=()=>{const ids=new Set((host.project().routeTests?.cases??[]).map(c=>c.id));let i=1;while(ids.has('route-'+i))i++;return 'route-'+i;};
  const edit=(index,fn)=>{const tests=structuredClone(host.project().routeTests??{schema:1,cases:[]});fn(tests.cases[index],tests.cases);host.set(tests);};
  const command=(label,id,callback)=>{const button=action(label,callback);button.dataset.routeCommand=id;return button;};
  function render(){
    const scroller=root.closest('.panel'),scrollTop=scroller?.scrollTop??0;
    root.replaceChildren();const controls=element('div',undefined,{class:'route-controls'});
    controls.append(command('从头录制路线','record',()=>host.record()),command('完成录制并添加用例','capture',async()=>{const id=nextId(),test=await host.capture(id);const tests=structuredClone(host.project().routeTests??{schema:1,cases:[]});tests.cases.push(test);host.set(tests);}),
      command('新增空白用例','add',()=>{const p=host.project(),instance=createProject(p,'https://route.invalid/');try{const tests=structuredClone(p.routeTests??{schema:1,cases:[]});tests.cases.push({id:nextId(),steps:[],expect:routeExpectation(instance.session,p.type)});host.set(tests);}finally{instance.session.dispose();}}),
      command('运行全部路线','run',run),command('取消检查','cancel',()=>{stop();document.body.dataset.routeStatus='CANCELLED';render();}));
    controls.querySelector('[data-route-command=capture]').disabled=!recording;controls.querySelector('[data-route-command=cancel]').disabled=!worker;
    root.append(controls,element('p',recording?'正在从开场录制，请手动推进、选择或操作小游戏。读档与回退会中断录制。':'录制只在预览内进行；路线检查在独立线程执行，不改玩家存档。',{class:'help'}));
    if(worker)root.append(element('p','正在检查，可随时取消。',{role:'status'}));
    else if(document.body.dataset.routeStatus==='CANCELLED')root.append(element('p','本次检查已取消，未产生新的通过结果。',{role:'status'}));
    const project=host.project(),tests=Array.isArray(project.routeTests?.cases)?project.routeTests.cases:[];
    tests.forEach((test,i)=>{
      const card=element('section',undefined,{class:'route-card'});root.append(card);if(!test||typeof test!=='object'){card.textContent='用例无效，请在工程 JSON 修复';return;}
      field(card,`用例 ${i+1} ID`,test.id,value=>edit(i,c=>{c.id=value;}));field(card,`用例 ${i+1} 名称`,test.label??'',value=>edit(i,c=>{if(value)c.label=value;else delete c.label;}));
      field(card,`用例 ${i+1} 期望结局`,test.expect?.ending??'',value=>edit(i,c=>{c.expect??={};if(value)c.expect.ending=value;else delete c.expect.ending;}),{choices:[['','不单独检查结局'],...projectEndings(project).map(id=>[id,id])]});
      field(card,`用例 ${i+1} 步骤`,JSON.stringify(test.steps??[],null,2),value=>edit(i,c=>{c.steps=JSON.parse(value);}),{multiline:true});
      field(card,`用例 ${i+1} 期望状态`,JSON.stringify(test.expect??{},null,2),value=>edit(i,c=>{c.expect=JSON.parse(value);}),{multiline:true});
      card.append(action('删除用例',()=>edit(i,(_c,cases)=>cases.splice(i,1)),'small-button danger'));
    });
    if(!tests.length)root.append(element('p','尚无路线用例。可从头录制，或新增用例。',{class:'help'}));
    const current=source(),stale=!!report&&current!==reportSource;
    if(report){
      const summary=element('div',undefined,{class:'route-report'});summary.dataset.routeReport=stale?'STALE':report.status;root.append(summary);
      summary.append(element('h2',stale?'结果已过期，请重新运行':`路线结果：${report.status}`));
      if(report.error)summary.append(element('p',report.error));
      if(report.coverage?.missing?.length)summary.append(element('p','未覆盖结局：'+report.coverage.missing.join('、')));
      for(const item of report.cases??[]){const row=element('div',undefined,{class:'route-result'});row.dataset.routeCase=item.id;row.dataset.result=item.status;
        row.append(element('strong',`${item.label??item.id} · ${item.status}`));if(item.failure)row.append(element('p',`步骤 ${item.failure.step}：${item.failure.message}`));
        if(item.final)row.append(action('定位节点',()=>host.navigate(item.final)));summary.append(row);}
      const download=command('导出路线报告','download',()=>host.download(JSON.stringify(report,null,2)+'\n','ROUTE_REPORT.json'));download.disabled=stale;summary.append(download);
    }
    if(scroller)scroller.scrollTop=scrollTop;
  }
  return {render,get active(){return recording;},recording(value){recording=value;recordingSource=value?source():undefined;document.body.dataset.routeRecording=String(value);render();},
    changed(){const current=source();if(recording&&current!==recordingSource){recording=false;document.body.dataset.routeRecording='false';}if(worker&&current!==jobSource){stop();document.body.dataset.routeStatus='STALE';}if(report&&current!==reportSource)document.body.dataset.routeStatus='STALE';},dispose:stop};
}
