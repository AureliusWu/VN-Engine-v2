import { runtimeSemantics } from '../lib/runtime/semantics.js';
import { readRuntimeEvidenceReport, assessRuntimeEvidenceReport } from '../lib/runtime/evidence-report.js';
import { sourceHash } from '../lib/agent/protocol.js';
import { createAsyncOperation } from './async-operation.mjs';

/** Source-bound inspection only. No engine controls or project writes live in this panel. */
export function createEvidencePanel(root, ports) {
  const {element,action}=ports;
  let document, assessment, pending, serial=0, disposed=false;
  const operation=createAsyncOperation(()=>[ports.project(),ports.source()]);
  const header=element('div',undefined,{class:'evidence-actions'}),message=element('p','尚未采集运行证据',{role:'status','data-evidence-status':'true'});
  const detail=element('p',undefined,{class:'help'}),events=element('ol',undefined,{class:'evidence-events','aria-label':'运行事件列表'});
  const input=element('input',undefined,{type:'file',accept:'.json','aria-label':'导入运行证据文件'});input.hidden=true;
  const capture=action('采集当前预览',()=>captureCurrent());capture.dataset.evidenceCommand='capture';
  const open=action('导入运行证据',()=>{input.value='';input.click();});open.dataset.evidenceCommand='open';
  const download=action('下载运行证据',()=>{if(document)ports.download(JSON.stringify(document)+'\n',document.game+'-runtime-evidence.json');});download.dataset.evidenceCommand='download';download.disabled=true;
  header.append(capture,open,download);root.replaceChildren(header,message,detail,events,input);
  const catalogue=element('details'),summary=element('summary','内建语义与恢复政策');catalogue.append(summary);
  const list=element('div',undefined,{class:'evidence-semantics'});
  for(const item of runtimeSemantics().entries){
    const entry=element('details',undefined,{'data-semantic-id':item.id}),title=element('summary',item.title+' · '+item.id);
    entry.append(title,element('p','恢复：'+item.restore,{class:'help'}),element('p','跳过：'+item.skip,{class:'help'}));
    list.append(entry);
  }
  catalogue.append(list);root.append(catalogue);

  const state=(binding,text)=>{message.textContent=text;root.dataset.evidenceBinding=binding;globalThis.document.body.dataset.evidenceBinding=binding;};
  const cancel=()=>{if(!pending)return;clearTimeout(pending.timer);pending.reject(Error('预览已改变，请重新采集'));pending=undefined;};
  const receive=event=>{
    if(event.source!==ports.frame().contentWindow||event.origin!==location.origin||event.data?.source!=='vn-engine-preview'||event.data.type!=='captured-evidence')return;
    if(!pending||event.data.requestId!==pending.id||event.data.revision!==pending.revision)return;
    const selected=pending;pending=undefined;clearTimeout(selected.timer);
    if(event.data.error)selected.reject(Error(event.data.error));else selected.resolve(event.data.report);
  };
  window.addEventListener('message',receive);
  async function captureCurrent(){
    cancel();const request=operation.begin();capture.disabled=true;
    try{
      if(!ports.ready())throw Error('预览尚未就绪，请先从头试玩');
      const revision=ports.revision(),id='evidence-'+(++serial);
      const report=await new Promise((resolve,reject)=>{
        pending={id,revision,resolve,reject,timer:setTimeout(()=>{pending=undefined;reject(Error('运行证据采集未响应，请重试'));},5000)};
        ports.frame().contentWindow.postMessage({source:'vn-engine-studio',type:'capture-evidence',revision,requestId:id},location.origin);
      });
      if(!request.current())return;
      await accept(report,request);
    }catch(error){if(request.current())state(document?'stale':'empty',error.message);}finally{if(!disposed)capture.disabled=false;}
  }
  async function accept(value,request=operation.begin()){
    const next=readRuntimeEvidenceReport(value),sha=await sourceHash(ports.source());
    if(!request.current()||disposed)return;
    const checked=assessRuntimeEvidenceReport(ports.project(),sha,next);
    document=checked.report;assessment=checked;download.disabled=false;draw();
  }
  function draw(){
    if(!document||!assessment)return;
    const binding=assessment.binding;
    state(binding,binding==='current'?'与当前工程关联 · 执行证据，非验收通过':binding==='stale'?'证据已过期 · 请对当前工程重新采集':'证据未绑定工程源码');
    detail.textContent=`会话 ${document.sessionId} · ${document.events.length} 条事件 · 丢弃 ${document.dropped} 条${document.truncated?' · 报告已截断':''}。`+
      (document.scope.media?'媒体宿主已执行；':'未执行媒体宿主；')+(document.scope.audioDevice?'音频宿主已启动，听感仍需人工核查。':'未证明音频设备执行。')+'导入报告的声明未经独立认证。';
    events.replaceChildren();
    for(const event of document.events){
      const row=element('li',undefined,{'data-evidence-sequence':event.sequence});
      row.append(element('span',`#${event.sequence} · 访问 ${event.visit} · ${event.type} · ${event.effect??event.input??event.reason??''} · ${event.phase??event.outcome??''}${event.assetId?' · '+event.assetId:''}${event.code?' · '+event.code:''}`));
      if(event.origin?.path){
        const target=action('定位节点',()=>ports.navigate(event.origin));target.dataset.evidenceNavigate=String(event.sequence);target.disabled=!assessment.current;row.append(target);
        row.append(element('small',JSON.stringify(event.origin.path)));
      }
      events.append(row);
    }
  }
  input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file)return;const request=operation.begin();
    try{if(file.size>4_000_000)throw Error('运行证据超过 4 MB');await accept(JSON.parse(await file.text()),request);}
    catch(error){if(request.current())state(document?assessment.binding:'empty','导入失败，已有工程和证据保留：'+error.message);}
  });
  state('empty','尚未采集运行证据');
  return {
    render:async()=>{if(!document)return;const request=operation.begin();try{await accept(document,request);}catch(error){if(request.current())state('stale',error.message);}},
    changed(){operation.invalidate();cancel();if(document){assessment={...assessment,current:false,binding:'stale'};draw();}},
    reset(){operation.invalidate();cancel();document=undefined;assessment=undefined;download.disabled=true;events.replaceChildren();detail.textContent='';state('empty','尚未采集运行证据');},
    dispose(){disposed=true;operation.invalidate();cancel();window.removeEventListener('message',receive);}
  };
}
