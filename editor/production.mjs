import {createAcceptancePanel} from './acceptance.mjs';
/** Production and review UI. Project edits use the public author operations; review data stays separate. */
import {EditorModel,applyAuthorOperation,contentCatalogue,contentAssetReferences,captureReviewBinding,readAuthorReview,editAuthorReview,assessAuthorReview,reviewSourceHash,analyseContentImpact} from '../lib/editor/index.js';
import {creativeNodes,reviewCreativeProject,validateCreativeProject,validateProjectUI,resolveProjectUI,assessQaEvidence} from '../lib/index.js';
import {nativeHost,nativeRequest} from './native.mjs';
const kinds=[['art','美术'],['music','音乐'],['ui','界面'],['sfx','音效'],['text','文案'],['story','剧情']],states=[['planned','计划中'],['draft','制作中'],['review','待终审']];
const categories=[['story','剧情'],['text','文字'],['art','美术'],['music','音乐'],['sfx','音效'],['ui','界面'],['other','其他']];
const stateName={open:'待处理',addressed:'已修复待复验',verified:'已复验',reopened:'重开'},freshName={fresh:'当前版本',stale:'过期',unverified:'文件未核实'};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createProductionPanel(root,ctx){
 const {element:e,action,field}=ctx;
 let view='context',query='',kind='',state='',character='',review=readAuthorReview(null,ctx.project()),past=[],future=[],saved=JSON.stringify(review),generation=0,reviewEpoch=0,controller,binding,bindingSource='',media,font,mediaEpoch=0,active=false,disposed=false,previous,impact,impactError='';
 let feedbackDraft={id:'',category:'text',target:'',comment:'',actor:'作者（自报）'},notes=new Map();
 const project=()=>ctx.project(), source=()=>ctx.source();
 const acceptance=createAcceptancePanel({...ctx,issue:comment=>{reviewFor({kind:'project',id:project().game});feedbackDraft.comment=comment;render();}});
 function card(title,parent=root){const box=e('article',undefined,{class:'production-card'});box.append(e('h3',title));parent.append(box);return box;}
 function controls(parent){const row=e('div',undefined,{class:'production-controls'});parent.append(row);return row;}
 function checked(parent,label,items,selected,change){
  const group=e('fieldset',undefined,{class:'production-checks'});group.append(e('legend',label));parent.append(group);
  const values=[...new Set([...items.map(i=>i[0]),...(selected??[])])];
  if(values.length>100)group.append(e('p','只显示前 100 项；未显示的已有关联会保留。',{class:'help'}));
  for(const id of values.slice(0,100)){const known=items.find(i=>i[0]===id),wrap=e('label',undefined,{class:'check'}),input=e('input',undefined,{type:'checkbox','aria-label':label+' '+id});input.checked=selected?.includes(id)??false;
   input.addEventListener('change',()=>ctx.run(()=>{const next=new Set(selected??[]);if(input.checked)next.add(id);else next.delete(id);change([...next]);}));wrap.append(input,document.createTextNode(known?.[1]??id+'（断链）'));group.append(wrap);}
  if(!values.length)group.append(e('p','暂无可选项',{class:'help'}));
 }
 function edit(op){
  try { const model=ctx.model(),candidate=new EditorModel(model.serialize());applyAuthorOperation(candidate,op);const next=candidate.getView().project;validateCreativeProject(next);validateProjectUI(next.ui);
  ctx.edit(()=>model.replaceProject(next));
  }catch(error){render();throw error;}
 }
 function put(group,id,value){edit({op:group+'.put',id,value});}
 function nextId(prefix,items){let i=1;while(items?.some(v=>v.id===prefix+'-'+i))i++;return prefix+'-'+i;}
 function targetOptions(){return [...creativeNodes(project()).map(t=>[JSON.stringify(t),(t.chapterId?t.chapterId+'/':'')+t.nodeId]),...contentCatalogue(project()).filter(t=>t.kind==='line').map(t=>[JSON.stringify({nodeId:t.nodeId,...(t.chapterId?{chapterId:t.chapterId}:{}),lineId:t.id}),t.nodeId+' / '+t.id])];}
 function targets(parent,group,item){
  const list=item.targets??[];for(const [i,t] of list.entries()){const row=controls(parent);row.append(action('定位 '+(t.lineId??t.nodeId),()=>ctx.navigate({kind:t.lineId?'line':'node',id:t.lineId??t.nodeId,nodeId:t.nodeId,chapterId:t.chapterId})),action('移除目标 '+(i+1),()=>put(group,item.id,{targets:list.filter((_,j)=>j!==i)})));}
  const options=targetOptions();let selected=options[0]?.[0];field(parent,'添加目标 '+item.id,selected,v=>selected=v,{choices:options.slice(0,500)});parent.append(action('绑定目标 '+item.id,()=>{if(!selected)throw Error('没有可绑定的节点');const t=JSON.parse(selected);if(!list.some(v=>equal(v,t)))put(group,item.id,{targets:[...list,t]});}));
 }
 function reviewFor(target){feedbackDraft={...feedbackDraft,id:'',target:JSON.stringify(target),comment:''};view='feedback';render();root.querySelector('[aria-label="反馈意见"]')?.focus();}
 function entityFields(parent,group,item,fields){
  field(parent,group+' ID '+item.id,item.id,newId=>edit({op:group+'.rename',id:item.id,newId}));
  for(const [key,label]of fields)field(parent,label+' '+item.id,item[key]??'',value=>put(group,item.id,{[key]:value}),{multiline:key!=='name'});
  controls(parent).append(action('反馈 '+item.id,()=>reviewFor({kind:group,id:item.id})),action('删除 '+item.id,()=>edit({op:group+'.remove',id:item.id}),'small-button danger'));
 }
 function contextView(){
  const p=project(),brief=card('制作简报');for(const [key,label]of [['premise','作品前提'],['tone','情绪基调'],['visualStyle','视觉方向'],['musicDirection','音乐方向'],['soundDirection','音效方向'],['writingStyle','文字风格'],['audience','目标读者']])field(brief,label,p.production?.brief?.[key]??'',value=>edit({op:'production.patch',value:{brief:{[key]:value}}}),{multiline:true});
  const bar=controls(root);bar.append(action('添加角色',()=>{const id=nextId('character',p.production?.characters);put('character',id,{name:'新角色',description:'角色说明'});}),action('添加节拍',()=>{const id=nextId('beat',p.production?.beats);put('beat',id,{summary:'新节拍',targets:[]});}));
  for(const item of p.production?.characters??[]){const box=card('角色 · '+item.name);entityFields(box,'character',item,[['name','角色名称'],['description','角色说明'],['visualPrompt','视觉提示'],['voiceNotes','声音备注']]);}
  for(const item of p.production?.beats??[]){const box=card('节拍 · '+item.id);entityFields(box,'beat',item,[['summary','节拍说明']]);targets(box,'beat',item);checked(box,'节拍角色 '+item.id,(p.production?.characters??[]).map(c=>[c.id,c.name]),item.characters,v=>put('beat',item.id,{characters:v}));checked(box,'节拍任务 '+item.id,(p.production?.tasks??[]).map(t=>[t.id,t.id]),item.tasks,v=>put('beat',item.id,{tasks:v}));}
 }
 function taskView(){
  const p=project(),filters=card('六类制作任务');field(filters,'任务搜索',query,v=>{query=v;render();});field(filters,'任务种类',kind,v=>{kind=v;render();},{choices:[['','全部'],...kinds]});field(filters,'任务状态',state,v=>{state=v;render();},{choices:[['','全部'],...states]});field(filters,'任务角色',character,v=>{character=v;render();},{choices:[['','全部'],...(p.production?.characters??[]).map(c=>[c.id,c.name])]});
  for(const [type,label]of kinds)controls(filters).append(action('添加'+label+'任务',()=>{const id=nextId(type,p.production?.tasks);put('task',id,{kind:type,brief:'新'+label+'任务',state:'planned'});}));
  const items=(p.production?.tasks??[]).filter(t=>(!kind||t.kind===kind)&&(!state||t.state===state)&&(!character||t.characters?.includes(character))&&(!query||(t.id+' '+t.brief+' '+t.prompt).toLowerCase().includes(query.toLowerCase())));
  root.append(e('p',`${items.length} 个任务；制作状态不代表人工终审。`,{class:'help'}));
  for(const item of items){const box=card(item.id+' · '+kinds.find(k=>k[0]===item.kind)?.[1]);entityFields(box,'task',item,[['brief','任务简报'],['prompt','任务提示']]);field(box,'任务种类 '+item.id,item.kind,v=>put('task',item.id,{kind:v}),{choices:kinds});field(box,'任务状态 '+item.id,item.state,v=>put('task',item.id,{state:v}),{choices:states});
   targets(box,'task',item);checked(box,'依赖任务 '+item.id,(p.production?.tasks??[]).filter(t=>t.id!==item.id).map(t=>[t.id,t.id]),item.dependsOn,v=>put('task',item.id,{dependsOn:v}));checked(box,'任务角色 '+item.id,(p.production?.characters??[]).map(c=>[c.id,c.name]),item.characters,v=>put('task',item.id,{characters:v}));checked(box,'输出素材 '+item.id,p.assets.map(a=>[a.id,a.id+' · '+a.kind]),item.assets,v=>put('task',item.id,{assets:v}));
   if(item.source)box.append(e('p','制作来源：'+item.source.method+' / '+item.source.tool+' / '+(item.source.notes??''),{class:'help'}));
  }
 }
 function stopMedia(){mediaEpoch++;if(media){media.pause();media.removeAttribute('src');media.load();media.remove();media=undefined;}if(font){document.fonts.delete(font);font=undefined;}root.querySelector('[data-audition-status]')?.replaceChildren(document.createTextNode('已停止'));}
 async function audition(asset,box){
  stopMedia();const token=mediaEpoch,node=e(asset.kind==='video'?'video':'audio',undefined,{controls:'',preload:'metadata','aria-label':'试听 '+asset.id,'data-audition':asset.id});media=node;node.src=ctx.assetURL(asset.src);box.append(node);const text=box.querySelector('[data-audition-status]');if(text)text.textContent='正在加载 '+asset.id;
  try{await node.play();if(token!==mediaEpoch||disposed){node.pause();return;}if(text)text.textContent='正在播放 '+asset.id;}catch(error){if(token===mediaEpoch)throw Error('试听未开始：'+error.message);}
 }
 async function previewFont(asset,box){
  stopMedia();const token=mediaEpoch,loaded=new FontFace('VNReviewFont'+token,'url('+JSON.stringify(ctx.assetURL(asset.src))+')');font=loaded;
  try{await loaded.load();if(token!==mediaEpoch||disposed)return;document.fonts.add(loaded);const text=e('p','雨停前再读一页 · The last returned book 123',{class:'font-preview'});text.style.fontFamily=loaded.family;box.append(text);}catch(error){if(token===mediaEpoch)throw Error('字体预览失败：'+error.message);}
 }
 function assetView(){
  const p=project(),filters=card('素材查看与试听');filters.append(action('核对素材实际哈希',async()=>{await currentBinding(true);render();}));field(filters,'素材搜索',query,v=>{query=v;render();});field(filters,'素材种类',kind,v=>{kind=v;render();},{choices:[['','全部'],...['background','portrait','cg','ui','audio','video','font'].map(v=>[v,v])]});field(filters,'素材状态',state,v=>{state=v;render();},{choices:[['','全部'],...['DRAFT','REVIEW','READY'].map(v=>[v,v])]});
  const list=p.assets.filter(a=>(!kind||a.kind===kind)&&(!state||a.status===state)&&(!query||(JSON.stringify(a)+' '+(binding?.assets.find(b=>b.id===a.id)?.sha256??'')).toLowerCase().includes(query.toLowerCase())));root.append(e('p',`${list.length} 个素材，最多显示前 100 项。实际文件哈希在审阅页重新核对。`,{class:'help'}));
  for(const a of list.slice(0,100)){const box=card(a.id+' · '+a.kind);box.dataset.assetId=a.id;box.append(e('p',(a.status??'UNVERIFIED')+' · '+a.src,{class:'help'}),e('p','清单 SHA-256：'+(a.sha256??'未声明'),{class:'help'}));box.append(e('p','实际 SHA-256：'+(bindingSource===source()?(binding?.assets.find(b=>b.id===a.id)?.sha256??'文件未核实'):'点击核对素材实际哈希'),{class:'help'}));if(a.provenance)box.append(e('p','来源：'+a.provenance.method+' / '+a.provenance.tool+' / '+(a.provenance.notes??'')+'\n'+(a.provenance.prompt??''),{class:'help'}));if(a.license)box.append(e('p','许可：'+a.license.name+' / '+a.license.src,{class:'help'}));
   if(['background','portrait','cg','ui'].includes(a.kind))box.append(e('img',undefined,{src:ctx.assetURL(a.src),alt:a.alt??a.id,class:'production-image',loading:'lazy'}));
   if(a.kind==='font')box.append(action('预览字体 '+a.id,()=>previewFont(a,box)));
   if(['audio','video'].includes(a.kind)){const row=controls(box);row.append(action('试听 '+a.id,()=>audition(a,box)),action('暂停 '+a.id,()=>media?.pause()),action('继续 '+a.id,()=>media?.play()),action('停止 '+a.id,stopMedia));box.append(e('p','已停止',{'data-audition-status':'',class:'help'}));}
   const catalogue=new Map(contentCatalogue(p).map(c=>[c.key,c])),refs=contentAssetReferences(p,a.id).map(r=>({...r,...catalogue.get(r.contentKey)}));box.append(e('p',`${refs.length} 个有效演出引用（动态前序继承仍需试玩）。`,{class:'help'}));for(const ref of refs.slice(0,20))box.append(action('定位 '+ref.id,()=>ctx.navigate({kind:ref.kind,id:ref.id,nodeId:ref.nodeId,chapterId:ref.chapterId})));box.append(action('反馈素材 '+a.id,()=>reviewFor({kind:'asset',id:a.id})));
  }
 }
 function themeView(){const p=project(),ui=p.ui??{schema:1},resolved=resolveProjectUI(ui),box=card('主题与实时预览'),change=value=>edit({op:'ui.set',value:{...ui,...value,schema:1}});field(box,'主题预设',ui.preset??'night',v=>change({preset:v}),{choices:[['night','夜色'],['paper','纸页'],['dusk','暮色']]});field(box,'界面密度',ui.density??'comfortable',v=>change({density:v}),{choices:[['comfortable','舒展'],['compact','紧凑']]});field(box,'对白底板',ui.dialogue??'glass',v=>change({dialogue:v}),{choices:[['glass','半透明'],['solid','实色']]});
  for(const [key,label]of [['surface','页面底色'],['panel','面板底色'],['text','正文颜色'],['muted','辅助文字'],['accent','强调颜色'],['border','边框颜色']]){const input=field(box,label,resolved.colors[key],v=>change({colors:{...ui.colors,[key]:v}}));input.type='color';}
  box.append(action('恢复预设颜色',()=>change({colors:{}})),e('p','下方调用当前播放器。玩家字号与高对比设置仍优先。',{class:'help'}),action('立即试玩',ctx.preview),action('反馈界面',()=>reviewFor({kind:'project',id:p.game})));
 }
 function feedbackTargets(){const p=project();return [{kind:'project',id:p.game},...creativeNodes(p).map(n=>({kind:'node',id:n.nodeId,...(n.chapterId?{chapterId:n.chapterId}:{})})),...contentCatalogue(p).map(c=>({kind:c.kind,id:c.id,nodeId:c.nodeId,...(c.chapterId?{chapterId:c.chapterId}:{})})),...['task','character','beat'].flatMap((kind,i)=>(p.production?.[['tasks','characters','beats'][i]]??[]).map(v=>({kind,id:v.id}))),...p.assets.map(v=>({kind:'asset',id:v.id}))];}
 async function currentBinding(force=false){
  const text=source();if(!force&&binding&&bindingSource===text)return binding;
  controller?.abort();const request=new AbortController();controller=request;const token=++generation;
  const result=await captureReviewBinding(project(),text,async relative=>{const response=await fetch(ctx.assetURL(relative),{signal:request.signal,cache:'no-store'});if(!response.ok)throw Error('缺少文件 '+relative);const reader=response.body?.getReader();if(!reader)throw Error('文件不可读');const chunks=[];let total=0;try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>67_108_864)throw Error('单文件超过 64 MiB');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;});
  if(disposed||token!==generation||text!==source())throw Error('工程或面板已改变，本次文件核对已取消');binding=result;bindingSource=text;return result;
 }
 function changeReview(next){past.push(review);if(past.length>32)past.shift();future=[];review=next;reviewEpoch++;ctx.changed();render();}
 async function feedbackEdit(operation){if(review.game!==project().game||review.storyVersion!==project().version)throw Error('审阅属于其他作品身份，请先保存并打开当前作品的审阅文档');const stamp=reviewEpoch,text=source(),bound=await currentBinding(true);if(stamp!==reviewEpoch||text!==source())throw Error('审阅内容已改变，请重试');changeReview(editAuthorReview(review,project(),bound,operation));ctx.status('审阅已记录；'+(operation.op==='put'?'待处理':'状态：'+stateName[operation.state]));}
 async function openReview(content){const next=readAuthorReview(content,project());changeReview(next);saved=JSON.stringify(next);ctx.changed();ctx.status('审阅文档已打开，正在核对源与实际文件');}
 function refreshBadges(bound){
  if(!root.isConnected||view!=='feedback')return;const report=assessAuthorReview(review,project(),bound),summary=root.querySelector('[data-review-summary]');if(summary)summary.textContent=`反馈 ${report.items.length} 条 · ${report.status} · 当前源 ${bound.sourceSha256} · 文件${bound.filesVerified?'已核实':'未核实'}；人工身份为自报，不产生发行批准。`;
  for(const item of report.items){const badge=[...root.querySelectorAll('[data-feedback-id]')].find(b=>b.dataset.feedbackId===item.id)?.querySelector('[data-freshness]');if(badge){badge.textContent=stateName[item.state]+' · '+freshName[item.freshness];badge.dataset.freshness=item.freshness;}}
 }
 function feedbackView(){
  const p=project(),matching=review.game===p.game&&review.storyVersion===p.version,bar=controls(root);if(!matching)root.append(e('p','此审阅属于 '+review.game+' / '+review.storyVersion+'。请单独保存，再打开当前作品的审阅；返回原身份后可继续处理。',{class:'help'}));bar.append(action('打开审阅文档',async()=>{if(nativeHost){const result=await nativeRequest('open-author-review');if(!result.cancelled)await openReview(result.content);}else{const input=root.querySelector('[data-review-file]');input.value='';input.click();}}),action('保存审阅文档',async()=>{const text=JSON.stringify(review,null,2)+'\n';if(nativeHost){const result=await nativeRequest('save-author-review',{content:text});if(result.cancelled)return;}else ctx.download(text,'review.json');saved=JSON.stringify(review);ctx.changed();ctx.status('审阅文档已保存；未修改运行数据');}),action('撤销审阅',()=>{if(past.length){future.push(review);review=past.pop();reviewEpoch++;ctx.changed();render();}}),action('重做审阅',()=>{if(future.length){past.push(review);review=future.pop();reviewEpoch++;ctx.changed();render();}}),action('重新核对文件',async()=>refreshBadges(await currentBinding(true))));
  bar.children[2].disabled=!past.length;bar.children[3].disabled=!future.length;
  const input=e('input',undefined,{type:'file',accept:'.json',hidden:'','data-review-file':''});input.addEventListener('change',()=>ctx.run(async()=>{const file=input.files[0];if(!file)return;if(file.size>8_000_000)throw Error('审阅超过 8 MB');await openReview(await file.text());}));root.append(input,e('p','正在核对当前源与素材…',{'data-review-summary':'',class:'help'}));
  const box=card('新增问题');const options=feedbackTargets().map(t=>[JSON.stringify(t),t.kind+' · '+(t.chapterId?t.chapterId+'/':'')+(t.nodeId?t.nodeId+'/':'')+t.id]);if(!options.some(o=>o[0]===feedbackDraft.target))feedbackDraft.target=options[0]?.[0]??'';
  field(box,'反馈 ID',feedbackDraft.id,v=>feedbackDraft.id=v);field(box,'反馈类别',feedbackDraft.category,v=>feedbackDraft.category=v,{choices:categories});field(box,'反馈目标',feedbackDraft.target,v=>feedbackDraft.target=v,{choices:options.slice(0,1000)});field(box,'反馈意见',feedbackDraft.comment,v=>feedbackDraft.comment=v,{multiline:true});field(box,'操作者（自报）',feedbackDraft.actor,v=>feedbackDraft.actor=v);
  box.append(action('记录问题',async()=>{const value={category:feedbackDraft.category,target:JSON.parse(feedbackDraft.target),comment:feedbackDraft.comment},id=feedbackDraft.id||nextId('feedback',review.items);await feedbackEdit({op:'put',id,actor:feedbackDraft.actor,value});feedbackDraft.id='';feedbackDraft.comment='';render();}));
  for(const item of review.items){const section=card(item.id+' · '+categories.find(c=>c[0]===item.category)?.[1]);section.dataset.feedbackId=item.id;section.append(e('p',stateName[item.state]+' · 正在核对',{'data-freshness':'',class:'review-state'}),e('p',item.target.kind+' · '+item.target.id+'\n'+item.comment,{class:'review-comment'}),e('p','绑定源：'+item.binding.sourceSha256,{class:'help'}));
   const n=notes.get(item.id)??{note:'',evidence:''};notes.set(item.id,n);field(section,'修复或重开说明 '+item.id,n.note,v=>n.note=v,{multiline:true});field(section,'复验声明 '+item.id,n.evidence,v=>n.evidence=v,{multiline:true});
   const buttons=controls(section);for(const [state,label]of [['addressed','记录修复'],['verified','确认复验'],['reopened','重开问题']])buttons.append(action(label+' '+item.id,()=>feedbackEdit({op:'transition',id:item.id,actor:feedbackDraft.actor,state,note:n.note||label,evidence:n.evidence||undefined})));buttons.append(action('定位问题 '+item.id,()=>locate(item.target)));
   const history=e('details');history.append(e('summary',`操作记录（${item.events.length}）`));for(const event of item.events)history.append(e('p',`${event.at} · ${event.actor} · ${stateName[event.state]}\n${event.note}${event.evidence?'\n复验声明：'+event.evidence:''}`,{class:'help'}));section.append(history);
  }
  currentBinding().then(refreshBadges).catch(error=>{if(active&&!disposed)ctx.status(error.message,true);});
 }
 function locate(target){if(['task','character','beat'].includes(target.kind)){view=target.kind==='task'?'tasks':'context';query='';kind='';state='';character='';render();const input=root.querySelector(`[aria-label="${target.kind} ID ${CSS.escape(target.id)}"]`);input?.scrollIntoView({block:'center'});input?.focus();}else if(target.kind==='asset'){view='assets';query=target.id;kind='';state='';render();root.querySelector('[data-asset-id]')?.scrollIntoView({block:'center'});}else if(target.kind==='project'){view='context';render();}else ctx.navigate(target);}
 function validationView(){
  const p=project(),mechanical=reviewCreativeProject(p),box=card('验证与审核状态');box.append(e('p','制作机械检查：'+mechanical.status),e('p','内容终审策略：AI 模拟审阅'),e('p','素材：'+p.assets.map(a=>a.id+'='+ (a.status??'UNVERIFIED')).join('，'),{class:'help'}),e('p','完整路线仍需全部复验；影响分析不批准跳过路线。AI 模拟终审使用独立文档和实际输入；问题反馈不能直接批准发行。',{class:'help'}));
  for(const issue of mechanical.issues.slice(0,64))box.append(e('p',issue.code+' · '+issue.message+' · '+JSON.stringify(issue.path),{class:'help'}));controls(box).append(action('查看路线测试',ctx.routes),action('实际试玩',ctx.preview),action('新增版本反馈',()=>reviewFor({kind:'project',id:p.game})));
  acceptance.render(root);
  if(impactError)root.append(e('p','修改影响尚未核实：'+impactError,{class:'help'}));
  if(impact){const report=card('最近一次修改影响');report.append(e('p',impact.beforeSha256+' → '+impact.afterSha256,{class:'help'}),e('p',`内容 ${impact.content.total} · 节点 ${impact.nodes.total} · 素材 ${impact.assets.total} · 任务 ${impact.tasks.total}`));for(const key of ['content','affectedContent','nodes','affectedNodes','assets','tasks','voiceWarnings'])report.append(e('p',key+'：'+JSON.stringify(impact[key]),{class:'help'}));report.append(e('p',impact.unknown.join('；'),{class:'help'}));}
 }
 function render(){
  if(disposed)return;acceptance.leave();active=true;stopMedia();const scroll=root.parentElement.scrollTop,focused=root.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;root.replaceChildren();
  const nav=controls(root);for(const [id,label]of [['context','简报与角色'],['tasks','六类任务'],['assets','素材与试听'],['theme','主题'],['feedback','问题与反馈'],['validation','验证状态']]){const button=action(label,()=>{if(view!==id){query='';kind='';state='';character='';}view=id;render();});button.setAttribute('aria-pressed',String(view===id));button.dataset.productionView=id;nav.append(button);}
  ({context:contextView,tasks:taskView,assets:assetView,theme:themeView,feedback:feedbackView,validation:validationView})[view]();root.parentElement.scrollTop=scroll;if(focused)root.querySelector('[aria-label='+JSON.stringify(focused)+']')?.focus({preventScroll:true});
 }
 return {render,changed(){acceptance.changed();if(!review.items.length&&(review.game!==project().game||review.storyVersion!==project().version))review=readAuthorReview(null,project());const text=source();if(previous?.text===text){if(active)render();return;}const prior=previous;previous={project:structuredClone(project()),text};controller?.abort();generation++;binding=undefined;stopMedia();if(prior){const current=previous;Promise.all([reviewSourceHash(prior.text),reviewSourceHash(text)]).then(([a,b])=>{if(previous===current){impact=analyseContentImpact(prior.project,current.project,a,b);impactError='';if(active&&view==='validation')render();}}).catch(error=>{if(previous===current){impact=undefined;impactError=error.message;if(active&&view==='validation')ctx.status('修改影响尚未核实：'+error.message,true);}});}if(active)render();},leave(){acceptance.leave();active=false;controller?.abort();generation++;stopMedia();},dispose(){disposed=true;this.leave();},reset(input,options={}){acceptance.reset();const declared=typeof input==='string'?JSON.parse(input):input;const next=readAuthorReview(input,options.detached&&declared?{...project(),game:declared.game,version:declared.storyVersion}:project());review=next;past=[];future=[];saved=JSON.stringify(next);reviewEpoch++;previous=undefined;impact=undefined;impactError='';notes.clear();controller?.abort();generation++;binding=undefined;feedbackDraft={id:'',category:'text',target:'',comment:'',actor:'作者（自报）'};stopMedia();},getReview:()=>structuredClone(review),get dirty(){return saved!==JSON.stringify(review);},stopMedia,reviewFor};
}
