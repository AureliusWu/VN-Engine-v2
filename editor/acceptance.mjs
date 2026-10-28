import { readAiAcceptance, captureAcceptanceContext, assessAiAcceptance, assessQaEvidence } from '../lib/index.js';
import { nativeHost, nativeRequest } from './native.mjs';

export function createAcceptancePanel(ctx) {
  let document, report, files=new Map(), epoch=0, controller, active=false, error='';
  const summary=()=>report?.status??'BLOCKED';
  function changed(){epoch++;controller?.abort();report=undefined;}
  async function verify(output) {
    const current=++epoch,text=ctx.source(),request=new AbortController();controller?.abort();controller=request;
    const bytes=async input=>{
      if(files.has(input.src)){const file=files.get(input.src);if(file.size>67_108_864)throw Error('审核输入超过 64 MiB');return new Uint8Array(await file.arrayBuffer());}
      if(nativeHost&&document){const result=await nativeRequest('read-ai-acceptance-input',{inputId:input.id});return Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));}
      throw Error('未绑定审核证据 '+input.src);
    };
    const readAsset=async relative=>{
      const response=await fetch(ctx.assetURL(relative),{signal:request.signal,cache:'no-store'});
      if(!response.ok)throw Error('缺少当前工程素材 '+relative);
      const reader=response.body.getReader(),parts=[];let size=0;
      try{while(true){const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>67_108_864)throw Error('审核素材超过 64 MiB');parts.push(result.value);}}
      finally{await reader.cancel().catch(()=>{});}
      const all=new Uint8Array(size);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}return all;
    };
    output.replaceChildren(ctx.element('p','AI 模拟终审：正在核对（UNVERIFIED）',{'data-ai-status':'UNVERIFIED'}));
    const context=await captureAcceptanceContext(ctx.project(),text,document,readAsset,bytes);
    if(current!==epoch||!active||text!==ctx.source())throw Error('工程或面板已改变，审核核对已取消');
    report=assessAiAcceptance(ctx.project(),{acceptance:document,acceptanceContext:context});error='';
    ctx.qa=assessQaEvidence(ctx.project(),{acceptance:document,acceptanceContext:context});
    output.replaceChildren();output.append(ctx.element('p','AI 模拟终审：'+summary(),{'data-ai-status':summary()}));
    for(const check of report.checks){const row=ctx.element('p',check.key+' · '+check.status+' · '+check.reason,{class:'help'});row.dataset.aiScope=check.key;output.append(row);}
    ctx.status('AI 模拟终审核对完成：'+summary());
  }
  async function open(text){const next=readAiAcceptance(text);if(next.game!==ctx.project().game||next.storyVersion!==ctx.project().version)throw Error('AI 终审属于其他作品身份');changed();document=next;error='';}
  function render(parent){
    active=true;
    const {element:e,action}=ctx,box=e('article',undefined,{class:'production-card'});parent.append(box);
    box.append(e('h3','AI 模拟终审'),e('p','内容审核由 AI 模拟读者、视觉审阅者和听众；技术项执行真实测试。审核绑定实际输入，修改后须复审。',{class:'help'}));
    const result=e('div',undefined,{'data-ai-acceptance-report':''}),controls=e('div',undefined,{class:'production-controls'});
    const picker=e('input',undefined,{type:'file',accept:'.json',hidden:'','data-ai-acceptance-file':''});
    const folder=e('input',undefined,{type:'file',webkitdirectory:'',multiple:'',hidden:'','data-ai-acceptance-evidence':''});
    picker.addEventListener('change',()=>ctx.run(async()=>{const file=picker.files[0];if(!file)return;if(file.size>8_000_000)throw Error('终审文档超过 8 MB');const token=epoch,text=await file.text();if(token!==epoch||!active)throw Error('打开终审已取消');await open(text);await verify(result);}));
    folder.addEventListener('change',()=>ctx.run(async()=>{changed();const next=new Map();let total=0;for(const file of folder.files){total+=file.size;if(total>268_435_456)throw Error('审核证据总量超过 256 MiB');const name=file.webkitRelativePath.split('/').slice(1).join('/');if(next.has(name))throw Error('重复审核输入路径');next.set(name,file);}files=next;await verify(result);}));
    controls.append(action('打开 AI 终审文档',async()=>{if(nativeHost){const token=epoch,opened=await nativeRequest('open-ai-acceptance');if(!opened.cancelled&&token===epoch&&active){await open(opened.content);await verify(result);}}else{picker.value='';picker.click();}}),
      action('绑定审核证据目录',()=>{folder.value='';folder.click();}),action('核对 AI 终审',()=>verify(result)),
      action('保存 AI 终审文档',async()=>{if(!document)throw Error('请先打开 AI 终审文档');const text=JSON.stringify(document,null,2)+'\n';if(nativeHost)await nativeRequest('save-ai-acceptance',{content:text});else ctx.download(text,'acceptance.json');ctx.status('AI 终审文档已保存；未修改运行数据');}),
      action('记录 AI 审核问题',()=>{const issues=document?.reviews.flatMap(r=>r.findings.filter(f=>!f.resolved).map(f=>r.id+' / '+f.location+': '+f.message))??[];ctx.issue(issues.join('\n')||'记录当前 AI 模拟审阅需要修复或补证据的问题。');}));
    box.append(controls,picker,folder,result);
    result.append(e('p','AI 模拟终审：'+summary(),{'data-ai-status':summary()}));
    if(document)result.append(e('p','已载入 '+document.game+' / '+document.storyVersion+'；点击核对当前源与实际文件。',{class:'help'}));
    if(error)result.append(e('p',error,{class:'help'}));
  }
  return {render,changed,leave(){active=false;changed();},reset(){changed();document=undefined;files.clear();error='';},get report(){return report;}};
}
