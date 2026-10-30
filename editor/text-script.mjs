import { compileTextScript } from '../lib/script/text.js';

/** Author-only front end. Text/ranges never enter the player project. */
export function createTextScriptPanel(root,ports){
  const {element,action}=ports;
  let compiled,compiledText='',appliedText='',disposed=false;
  const message=element('p','载入示例或输入文本，再编译预览。',{role:'status','data-dsl-status':'true'});
  const input=element('textarea',undefined,{'aria-label':'文本 DSL 内容',spellcheck:'false',maxlength:1000000,'data-dsl-source':'true'});
  const diagnostics=element('ol',undefined,{'aria-label':'DSL 编译诊断',class:'dsl-diagnostics'});
  const result=element('pre',undefined,{'aria-label':'编译 JSON 预览',class:'dsl-output'});
  const controls=element('div',undefined,{class:'author-actions'});
  const example=action('载入语法示例',()=>{
    const project=ports.project();
    input.value=`vn-script 1\ngame ${JSON.stringify(project.game)}\nversion ${JSON.stringify(project.version)}\nentry start\nvar trust number 0 min 0 max 10\nblock start "开场"\nline hello "旁白" "你好，这是受限文本 DSL。"\nchoice yes "继续" -> finish with add trust 1\nblock finish\nline final "旁白" "完成"\nend 完成\n`;
    invalidate();ports.changed();
  });example.dataset.dslCommand='example';
  const compile=action('编译并预览',()=>{
    compiledText=input.value;compiled=compileTextScript(compiledText,{fileName:'studio.vn'});draw();
    if(compiled.ok&&identity()){
      ports.preview(compiled.program);message.textContent='编译成功 · 正在预览候选；当前 JSON 尚未改变。';
    }
  });compile.dataset.dslCommand='compile';
  const apply=action('应用编译结果',()=>{
    if(!compiled?.ok||compiledText!==input.value)throw Error('请先成功编译当前文本');
    if(!identity())throw Error('文本 game/version 与当前工程不一致；请修改文本中的身份后重新编译');
    ports.apply(compiled.program);appliedText=input.value;ports.changed();message.textContent='已应用剧本 · 仅替换 program，可用一次撤销恢复。';
  });apply.dataset.dslCommand='apply';apply.disabled=true;
  controls.append(example,compile,apply);
  const rangeList=element('details'),rangeSummary=element('summary','编译来源位置');
  const ranges=element('ol',undefined,{class:'dsl-ranges'});rangeList.append(rangeSummary,ranges);
  root.replaceChildren(element('p','只支持当前 ScriptProgram 的变量、对白、分支和选择效果。没有任意代码；JSON 编辑后不承诺反写文本。应用会保留作品身份、资源、UI 与元数据。',{class:'help'}),controls,message,input,diagnostics,result,rangeList);
  function identity(){const p=ports.project();return p.type==='script'&&compiled?.program?.game===p.game&&compiled.program.version===p.version;}
  function locate(span){input.focus();input.setSelectionRange(span.start.offset,span.end.offset);}
  function draw(){
    diagnostics.replaceChildren();ranges.replaceChildren();result.textContent='';
    if(!compiled){apply.disabled=true;return;}
    for(const item of compiled.diagnostics){
      const row=element('li'),jump=action(`${item.code} · ${item.span.start.line}:${item.span.start.column} · ${item.message}`,()=>locate(item.span));
      jump.dataset.dslDiagnostic='true';row.append(jump);diagnostics.append(row);
    }
    // A bounded list avoids a large source map monopolising the Studio DOM.
    for(const item of compiled.sourceMap.slice(0,200)){
      const row=element('li'),jump=action(`${item.kind} ${item.id} · ${item.span.start.line}:${item.span.start.column}`,()=>locate(item.span));
      jump.dataset.dslRange='true';row.append(jump);ranges.append(row);
    }
    if(compiled.sourceMap.length>200)ranges.append(element('li','仅显示前 200 个位置；完整 source map 可由只读 Agent 编译获取。'));
    apply.disabled=!compiled.ok||!identity()||compiledText!==input.value;
    if(compiled.ok){const text=JSON.stringify(compiled.program,null,2);result.textContent=text.slice(0,100000)+(text.length>100000?'\n…预览已截断':'');}
    message.textContent=!compiled.ok?'编译失败 · 当前 JSON 保留。':!identity()?'编译成功，但文本 game/version 或工程类型不匹配；拒绝预览和应用。':'编译成功 · 可预览并显式应用，当前 JSON 尚未改变。';
  }
  function invalidate(){compiled=undefined;compiledText='';draw();message.textContent='文本已更改，请重新编译。';}
  input.addEventListener('input',()=>{invalidate();ports.changed();});
  return {
    get dirty(){return input.value!==appliedText;},
    getDraft:()=>input.value,
    restore(value){if(typeof value==='string'&&value.length<=1000000){input.value=value;invalidate();}},
    render(){compile.disabled=ports.project().type!=='script';if(compile.disabled)message.textContent='文本 DSL 只适用于条件剧本工程；当前工程保留。';else if(compiled)draw();},
    changed(){if(compiled&&!disposed)draw();},
    reset(){compiled=undefined;compiledText='';appliedText='';input.value='';draw();message.textContent='载入示例或输入文本，再编译预览。';},
    dispose(){disposed=true;}
  };
}
