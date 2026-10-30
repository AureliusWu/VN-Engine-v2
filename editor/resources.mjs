import { sourceHash } from '../lib/agent/protocol.js';
import { createAsyncOperation } from './async-operation.mjs';

/** Read-only resource reports; prefetch is an explicit, bounded preview option. */
export function createResourcesPanel(root,ports){
  const {element,action}=ports,operation=createAsyncOperation(()=>[ports.project(),ports.source()]);
  let pending,serial=0,disposed=false,snapshot,appliedConfig=false;
  const message=element('p','尚未采集资源计划。',{role:'status','data-resource-status':'true'});
  const controls=element('div',undefined,{class:'resource-controls'}),enabled=element('input',undefined,{type:'checkbox','aria-label':'启用预览预算预取'});
  const opt=element('label',undefined,{class:'check'});opt.append(enabled,element('span','启用预览预算预取（默认关闭）'));controls.append(opt);
  const number=(label,value,min,max)=>{const wrap=element('label',undefined,{class:'field'}),input=element('input',undefined,{type:'number',min,max,step:1,'aria-label':label});input.value=value;wrap.append(element('span',label),input);controls.append(wrap);return input;};
  const concurrency=number('预取并发',2,1,4),queue=number('候选队列上限',8,1,32),memory=number('编码缓存预算 MiB',8,1,64),transfer=number('单资源下载上限 MiB',2,1,16),depth=number('资源前瞻深度',2,0,4);
  const bounded=(input,min,max)=>{const v=Number(input.value);if(!Number.isInteger(v)||v<min||v>max)throw Error('请在标注的边界内填写整数预算');return v;};
  const readControls=()=>enabled.checked?{maxConcurrent:bounded(concurrency,1,4),maxQueued:bounded(queue,1,32),maxBytes:bounded(memory,1,64)*1048576,maxTransferBytes:bounded(transfer,1,16)*1048576,plan:{maxDepth:bounded(depth,0,4),maxVisits:64,maxAssets:64}}:false;
  // Automatic previews consume a committed setting, never partially edited controls.
  const options=()=>appliedConfig;
  const actions=element('div',undefined,{class:'author-actions'}),refresh=action('应用预取设置并刷新预览',()=>{
    let next;try{next=readControls();}catch(error){message.textContent='设置未应用，保留上次预取预算：'+error.message;throw error;}
    appliedConfig=next?Object.freeze({...next,plan:Object.freeze(next.plan)}):false;
    ports.preview();message.textContent='预览已刷新，请采集最新计划；预取不解码、不播放或解锁音频。';
  });refresh.dataset.resourceCommand='configure';
  const capture=action('采集当前资源计划',captureCurrent);capture.dataset.resourceCommand='capture';actions.append(refresh,capture);
  const summary=element('p',undefined,{class:'help','data-resource-summary':'true'}),list=element('ol',undefined,{'aria-label':'资源计划候选',class:'resource-candidates'}),cache=element('pre',undefined,{'aria-label':'编码缓存指标',class:'resource-cache'});
  root.replaceChildren(element('p','计划是下一交互窗口的候选估算，不保证分支会执行。编码下载缓存、图片/音频解码缓存和离线 SW 缓存分别计量。当前资源受保护；换分支、隐藏或关闭预览会取消过期预取。',{class:'help'}),controls,actions,message,summary,list,cache);
  const state=(binding,text)=>{root.dataset.resourceBinding=binding;message.textContent=text;};
  const cancel=()=>{if(pending){clearTimeout(pending.timer);pending.reject(Error('预览已改变，请重新采集'));pending=undefined;}};
  const receive=event=>{
    if(event.source!==ports.frame().contentWindow||event.origin!==location.origin||event.data?.source!=='vn-engine-preview'||event.data.type!=='captured-plan')return;
    if(!pending||event.data.requestId!==pending.id||event.data.revision!==pending.revision)return;
    const request=pending;pending=undefined;clearTimeout(request.timer);
    if(event.data.error)request.reject(Error(event.data.error));else request.resolve(event.data);
  };window.addEventListener('message',receive);
  async function captureCurrent(){
    cancel();const operationRequest=operation.begin();capture.disabled=true;
    try{
      if(!ports.ready())throw Error('预览尚未就绪，请先从头试玩');
      const revision=ports.revision(),id='plan-'+(++serial),source=ports.source();
      const report=await new Promise((resolve,reject)=>{
        pending={id,revision,resolve,reject,timer:setTimeout(()=>{pending=undefined;reject(Error('资源计划采集未响应，请重试'));},5000)};
        ports.frame().contentWindow.postMessage({source:'vn-engine-studio',type:'capture-plan',revision,requestId:id},location.origin);
      });
      const sha=await sourceHash(source);
      if(!operationRequest.current()||disposed)return;
      if(report.sourceSha256!==sha)throw Error('预览来源与当前工程不同，请刷新当前工程预览后采集');
      snapshot=report.snapshot;draw();
    }catch(error){if(operationRequest.current())state(snapshot?'stale':'empty',error.message);}finally{if(!disposed)capture.disabled=false;}
  }
  function draw(){
    const {plan,cache:metrics,enabled:active}=snapshot;
    state('current',active?'当前来源资源计划 · 预算预取已启用':'当前来源资源计划 · 预算预取关闭');
    summary.textContent=`当前 ${plan.active.length} 项 · 候选 ${plan.candidates.length} 项 · 未知 ${plan.unknown.length} 项 · ${plan.visits} 次图访问${plan.truncated?' · 计划已截断':''}；深度 ${plan.budget.maxDepth} / 访问 ${plan.budget.maxVisits} / 资源 ${plan.budget.maxAssets}。已知估算 ${plan.estimates?.knownBytes??0} B，${plan.estimates?.unknownAssets??0} 项字节未知。`;
    list.replaceChildren();
    for(const [scope,assets] of [['当前',plan.active],['候选',plan.candidates]])for(const asset of assets){
      const row=element('li',undefined,{'data-resource-id':asset.assetId});
      row.append(element('span',`${scope} · ${asset.assetId} · ${asset.kind} · 距离 ${asset.distance} · ${asset.estimatedBytes===null?'字节未知':asset.estimatedBytes+' B'} · owner ${asset.owners.join(', ')} · 依赖 ${(asset.dependencies??[]).join(', ')||'无'}`));
      const origin=asset.origins.find(item=>item.nodeId&&item.path);if(origin){const target=action('定位来源',()=>ports.navigate(origin));target.dataset.resourceNavigate='true';row.append(target);}
      list.append(row);
    }
    for(const item of plan.unknown)list.append(element('li','未知：'+JSON.stringify(item)));
    cache.textContent=metrics?JSON.stringify(metrics,null,2):'预取未启用，没有编码缓存指标。';
  }
  return {options,render(){},changed(){operation.invalidate();cancel();if(snapshot){state('stale','工程已更改；请刷新并重新采集资源计划');for(const button of list.querySelectorAll('button'))button.disabled=true;}},
    reset(){operation.invalidate();cancel();snapshot=undefined;appliedConfig=false;enabled.checked=false;list.replaceChildren();summary.textContent='';cache.textContent='';state('empty','尚未采集资源计划。');},
    dispose(){disposed=true;operation.invalidate();cancel();window.removeEventListener('message',receive);}};
}
