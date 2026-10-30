import { createTextCompileTask } from './text-compile-task.mjs';

/** Author-only front end. Compilation, catalog checking and JSON formatting run off-thread. */
export function createTextScriptPanel(root,ports){
  const {element,action}=ports;
  let compiled,compiledText='',appliedText='',disposed=false,attempted=false,pending,checkedKey,syntaxOk=false,identity,formatted='';
  const message=element('p','载入示例或输入文本，再编译预览。',{role:'status','data-dsl-status':'true'});
  const input=element('textarea',undefined,{'aria-label':'文本 DSL 内容',spellcheck:'false',maxlength:1000000,'data-dsl-source':'true'});
  const diagnostics=element('ol',undefined,{'aria-label':'DSL 编译诊断',class:'dsl-diagnostics'});
  const result=element('pre',undefined,{'aria-label':'编译 JSON 预览',class:'dsl-output'});
  const controls=element('div',undefined,{class:'author-actions'});
  function state(value,text){root.dataset.dslState=value;if(text)message.textContent=text;}
  function snapshot(){
    const project=ports.project();
    const context={type:project.type,game:project.game,version:project.version,assets:project.assets.map(asset=>({id:asset?.id,kind:asset?.kind}))};
    return {context,key:JSON.stringify(context)};
  }
  function clearResult(){compiled=undefined;identity=undefined;syntaxOk=false;formatted='';checkedKey=undefined;diagnostics.replaceChildren();ranges.replaceChildren();result.textContent='';apply.disabled=true;}
  const task=createTextCompileTask({
    onBusy(busy){root.setAttribute('aria-busy',String(busy));cancel.disabled=!busy;},
    onFailure(error){if(disposed)return;pending=undefined;attempted=false;clearResult();state('error','后台编译未完成：'+error.message+'；当前 JSON 保留，可重试。');},
    onResult(data){
      if(disposed||!pending)return;
      const request=pending,current=snapshot();
      if(input.value!==request.source){invalidate();return;}
      if(current.key!==request.key){begin(false,current);return;}
      pending=undefined;compiled=data.result;syntaxOk=data.syntaxOk;identity=data.identity;formatted=data.output;checkedKey=request.key;draw(current.context);
      if(compiled.ok&&matches(current.context)&&request.preview){
        try{ports.preview(compiled.program);message.textContent='编译成功 · 正在预览候选；当前 JSON 尚未改变。';}
        catch(error){message.textContent='编译成功；候选预览未启动：'+error.message+'。当前 JSON 保留。';}
      }
    }
  });
  const example=action('载入语法示例',()=>{
    const project=ports.project();
    const resource=kind=>project.assets.find(asset=>asset?.kind===kind&&typeof asset.id==='string'&&asset.id.trim()&&asset.id.length<=256)?.id;
    const cues=[['background',resource('background')],['portrait',resource('portrait')],['music',resource('audio')]]
      .filter(([,id])=>id).map(([field,id])=>`cue block start ${field} ${JSON.stringify(id)}\n`).join('');
    input.value=`vn-script 1\ngame ${JSON.stringify(project.game)}\nversion ${JSON.stringify(project.version)}\nentry start\nvar trust number 0 min 0 max 10\n${cues}cue line hello pause 120\ncue line hello effect fade 150\nblock start "开场"\nline hello "旁白" "你好，这是受限文本 DSL。"\nchoice yes "继续" -> finish with add trust 1\nblock finish\nline final "旁白" "完成"\nend 完成\n`;
    invalidate();ports.changed();
  });example.dataset.dslCommand='example';
  const compile=action('编译并预览',()=>begin(true));compile.dataset.dslCommand='compile';
  const cancel=action('取消编译',()=>{task.cancel();pending=undefined;attempted=false;compiledText='';clearResult();state('cancelled','已取消编译；文本和当前 JSON 保留，可重新编译。');});cancel.dataset.dslCommand='cancel';cancel.disabled=true;
  const apply=action('应用编译结果',()=>{
    if(task.busy||pending)throw Error('后台检查尚未完成，请稍后应用');
    const current=snapshot();
    if(attempted&&current.key!==checkedKey){begin(false,current);throw Error('资源清单已变化，正在后台重新检查，请稍后应用');}
    if(!compiled?.ok||compiledText!==input.value)throw Error('请先成功编译当前文本');
    if(!matches(current.context))throw Error('文本 game/version 与当前工程不一致；请修改文本中的身份后重新编译');
    ports.apply(compiled.program);appliedText=input.value;ports.changed();message.textContent='已应用剧本 · 仅替换 program，可用一次撤销恢复。';
  });apply.dataset.dslCommand='apply';apply.disabled=true;
  controls.append(example,compile,cancel,apply);
  const rangeList=element('details'),rangeSummary=element('summary','编译来源位置');
  const ranges=element('ol',undefined,{class:'dsl-ranges'});rangeList.append(rangeSummary,ranges);
  root.replaceChildren(element('p','支持变量、对白、分支和选择效果；演出用 cue block 节点ID 或 cue line 台词ID。编译与资源清单检查在后台执行，可随时取消。应用只替换 program，可撤销。',{class:'help'}),controls,message,input,diagnostics,result,rangeList);
  state('idle');root.setAttribute('aria-busy','false');
  function matches(context){return context.type==='script'&&identity?.game===context.game&&identity?.version===context.version;}
  function locate(span){input.focus();input.setSelectionRange(span.start.offset,span.end.offset);}
  function draw(context){
    diagnostics.replaceChildren();ranges.replaceChildren();result.textContent='';
    if(!compiled){apply.disabled=true;return;}
    for(const item of compiled.diagnostics){
      const row=element('li'),jump=action(`${item.code} · ${item.span.start.line}:${item.span.start.column} · ${item.message}`,()=>locate(item.span));
      jump.dataset.dslDiagnostic='true';row.append(jump);diagnostics.append(row);
    }
    for(const item of compiled.sourceMap.slice(0,200)){
      const row=element('li'),jump=action(`${item.kind} ${item.id} · ${item.span.start.line}:${item.span.start.column}`,()=>locate(item.span));
      jump.dataset.dslRange='true';row.append(jump);ranges.append(row);
    }
    if(compiled.sourceMap.length>200)ranges.append(element('li','仅显示前 200 个位置；完整 source map 可由只读 Agent 编译获取。'));
    apply.disabled=!compiled.ok||!matches(context)||compiledText!==input.value||task.busy;
    if(compiled.ok)result.textContent=formatted;
    state(compiled.ok&&matches(context)?'success':'invalid',!syntaxOk?'编译失败 · 当前 JSON 保留。':!matches(context)?'文本 game/version 或工程类型不匹配；拒绝预览和应用。':!compiled.ok?'编译失败 · 当前资源清单检查未通过，当前 JSON 保留。':'编译成功 · 当前资源清单已核对；可显式应用，当前 JSON 尚未改变。');
  }
  function begin(preview,current=snapshot()){
    if(disposed)return;
    compiledText=input.value;attempted=true;pending={source:compiledText,key:current.key,preview};clearResult();
    state('running',preview?'正在后台编译，可随时取消；当前 JSON 保留。':'资源清单已变化，正在后台重新检查；当前 JSON 保留。');
    task.run({source:compiledText,fileName:'studio.vn',projectContext:current.context});
  }
  function invalidate(){task.cancel();pending=undefined;attempted=false;compiledText='';clearResult();state('stale','文本已更改，请重新编译。');}
  function changed(){if(disposed||!attempted)return;const current=snapshot();if(current.key!==(pending?.key??checkedKey))begin(false,current);}
  input.addEventListener('input',()=>{invalidate();ports.changed();});
  return {
    get dirty(){return input.value!==appliedText;},getDraft:()=>input.value,
    restore(value){if(typeof value==='string'&&value.length<=1000000){input.value=value;invalidate();}},
    render(){compile.disabled=ports.project().type!=='script';if(compile.disabled){invalidate();state('invalid','文本 DSL 只适用于条件剧本工程；当前工程保留。');}else changed();},
    changed,
    reset(){task.cancel();pending=undefined;attempted=false;compiledText='';appliedText='';input.value='';clearResult();state('idle','载入示例或输入文本，再编译预览。');},
    dispose(){disposed=true;task.dispose();pending=undefined;clearResult();}
  };
}
