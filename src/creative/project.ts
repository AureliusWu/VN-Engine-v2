import type { EngineProject } from '../runtime/project.js';
import { PRODUCTION_SCHEMA } from './schema.js';
import { schemaErrors } from '../schema/validate.js';
import { uiContrast } from '../ui/theme.js';
import { contentCatalogue } from './content.js';
export type CreativeTarget={nodeId:string;chapterId?:string;lineId?:string};
export type CreativeSource={method:'generated'|'composed'|'procedural'|'licensed'|'recorded'|'authored';tool:string;prompt?:string;sourceSha256?:string;notes?:string;text?:string;speaker?:string};
export type CreativeCharacter={id:string;name:string;description:string;visualPrompt?:string;voiceNotes?:string};
export type CreativeBeat={id:string;summary:string;targets:CreativeTarget[];characters?:string[];tasks?:string[]};
export type CreativeTask={id:string;kind:'art'|'music'|'ui'|'sfx'|'text'|'story';brief:string;prompt?:string;state:'planned'|'draft'|'review';dependsOn?:string[];characters?:string[];targets?:CreativeTarget[];assets?:string[];source?:CreativeSource};
export type ProductionPlan={schema:1;brief?:{premise?:string;tone?:string;visualStyle?:string;musicDirection?:string;soundDirection?:string;writingStyle?:string;audience?:string};characters?:CreativeCharacter[];beats?:CreativeBeat[];tasks?:CreativeTask[]};
export type CreativeDiagnostic={code:string;severity:'error'|'warning';message:string;path:(string|number)[]};
export type TextEntry={id:string;nodeId:string;chapterId?:string;speaker:string;text:string;medium?:string;path:(string|number)[];voice?:string};
export function textCatalogue(p:EngineProject):TextEntry[] {
  return contentCatalogue(p).filter(c=>c.kind==='line').map(c=>({id:c.id,nodeId:c.nodeId,...(c.chapterId?{chapterId:c.chapterId}:{}),speaker:c.speaker,text:c.text,medium:c.medium,path:c.path,voice:c.voice}));
}
export function creativeNodes(p:EngineProject):CreativeTarget[] {
  return p.type==='script'?p.program.blocks.map(b=>({nodeId:b.id})):p.type==='narrative'?p.scenes.map(s=>({nodeId:s.id})):p.type==='investigation'?p.chapters.flatMap(c=>Object.keys(c.nodes).map(nodeId=>({nodeId,chapterId:c.id}))):p.story.nodes.map(n=>({nodeId:n.id}));
}
export function creativeDiagnostics(p:EngineProject):CreativeDiagnostic[] {
  if(p.production===undefined)return [];const errors=schemaErrors(PRODUCTION_SCHEMA,p.production,['production']);
  if(errors.length)return errors.slice(0,64).map(e=>({code:'CREATIVE_SCHEMA',severity:'error',message:e.message,path:e.path}));
  const plan=p.production,issues:CreativeDiagnostic[]=[],add=(code:string,message:string,path:(string|number)[])=>issues.push({code,severity:'error',message,path});
  const chars=new Set<string>(),tasks=new Set<string>(),beats=new Set<string>();
  for(const [kind,set]of [['characters',chars],['tasks',tasks],['beats',beats]]as const)(plan[kind]??[]).forEach((item,i)=>{if(set.has(item.id))add('CREATIVE_DUPLICATE','Duplicate '+kind+' ID: '+item.id,['production',kind,i,'id']);set.add(item.id);});
  const nodes=creativeNodes(p),lines=textCatalogue(p),assets=new Set(p.assets.map(a=>a.id));
  const targets=(values:CreativeTarget[]|undefined,path:(string|number)[])=>values?.forEach((target,i)=>{
    const matches=nodes.filter(n=>n.nodeId===target.nodeId&&n.chapterId===target.chapterId);
    if(matches.length!==1)add('CREATIVE_TARGET','Missing or ambiguous target node: '+target.nodeId,[...path,i,'nodeId']);
    if(target.lineId&&!lines.some(l=>l.id===target.lineId&&l.nodeId===target.nodeId&&l.chapterId===target.chapterId))add('CREATIVE_TARGET','Missing target line: '+target.lineId,[...path,i,'lineId']);
  });
  plan.beats?.forEach((b,i)=>{targets(b.targets,['production','beats',i,'targets']);for(const [key,valid]of [['characters',chars],['tasks',tasks]]as const)b[key]?.forEach((id,j)=>{if(!valid.has(id))add('CREATIVE_REFERENCE','Missing '+key+' ID: '+id,['production','beats',i,key,j]);});});
  plan.tasks?.forEach((t,i)=>{targets(t.targets,['production','tasks',i,'targets']);t.dependsOn?.forEach((id,j)=>{if(!tasks.has(id))add('CREATIVE_REFERENCE','Missing task: '+id,['production','tasks',i,'dependsOn',j]);});t.assets?.forEach((id,j)=>{if(!assets.has(id))add('CREATIVE_REFERENCE','Missing output asset: '+id,['production','tasks',i,'assets',j]);});});
  plan.tasks?.forEach((t,i)=>t.characters?.forEach((id,j)=>{if(!chars.has(id))add('CREATIVE_REFERENCE','Missing character: '+id,['production','tasks',i,'characters',j]);}));
  const visited=new Set<string>(),active=new Set<string>();let cycle=false;
  const visit=(id:string)=>{if(active.has(id)){cycle=true;return;}if(visited.has(id))return;active.add(id);for(const dep of plan.tasks?.find(t=>t.id===id)?.dependsOn??[])visit(dep);active.delete(id);visited.add(id);};
  for(const id of tasks)visit(id);if(cycle)add('CREATIVE_CYCLE','Task dependencies contain a cycle',['production','tasks']);
  return issues;
}
export function validateCreativeProject(p:EngineProject) {const issue=creativeDiagnostics(p).find(i=>i.severity==='error');if(issue)throw Error(issue.code+': '+issue.message+' at '+JSON.stringify(issue.path));}
export function creativeReferences(p:EngineProject,kind:'task'|'character'|'asset'|'node'|'chapter'|'line',id:string,chapterId?:string) {
  const refs:{path:(string|number)[];role:string}[]=[];const add=(path:(string|number)[],role:string)=>refs.push({path,role});
  const plan=p.production;if(!plan)return refs;
  for(const key of ['beats','tasks']as const)(plan[key]??[]).forEach((item,i)=>{
    if(kind==='task'){if(key==='beats')(item as CreativeBeat).tasks?.forEach((v,j)=>{if(v===id)add(['production',key,i,'tasks',j],'task');});else(item as CreativeTask).dependsOn?.forEach((v,j)=>{if(v===id)add(['production',key,i,'dependsOn',j],'dependency');});}
    if(kind==='character')item.characters?.forEach((v,j)=>{if(v===id)add(['production',key,i,'characters',j],'character');});
    if(kind==='asset'&&key==='tasks')(item as CreativeTask).assets?.forEach((v,j)=>{if(v===id)add(['production',key,i,'assets',j],'output');});
    item.targets?.forEach((t,j)=>{if(kind==='node'&&t.nodeId===id&&t.chapterId===chapterId)add(['production',key,i,'targets',j,'nodeId'],'target');if(kind==='chapter'&&t.chapterId===id)add(['production',key,i,'targets',j,'chapterId'],'target');if(kind==='line'&&t.lineId===id)add(['production',key,i,'targets',j,'lineId'],'target');});
  });return refs;
}
/** Mechanical editorial checks; never a claim of literary quality or approval. */
export function reviewCreativeProject(p:EngineProject) {
  const issues:CreativeDiagnostic[]=[...creativeDiagnostics(p)],texts=contentCatalogue(p),plan=p.production;
  const add=(code:string,message:string,path:(string|number)[])=>issues.push({code,severity:'warning',message,path});
  if(!plan)add('CREATIVE_PLAN_MISSING','No creative brief or production tasks',['production']);
  if(!plan?.brief?.premise)add('CREATIVE_BRIEF_MISSING','Creative premise is not recorded',['production','brief','premise']);
  for(const line of texts){if(!line.text.trim())add('TEXT_EMPTY','Empty authored text',[...line.path,'text']);if([...line.text].length>280)add('TEXT_LONG','Text exceeds 280 code points; review pacing and narrow layout',[...line.path,'text']);if(/\b(?:TODO|FIXME|PLACEHOLDER)\b/i.test(line.text))add('TEXT_PLACEHOLDER','Placeholder marker in authored text',[...line.path,'text']);}
  for (const line of texts) if (line.voice && !plan?.tasks?.some(task=>task.assets?.includes(line.voice!) && task.targets?.some(t=>t.lineId===line.lineId&&t.nodeId===line.nodeId&&t.chapterId===line.chapterId) && task.source?.text===line.text && task.source?.speaker===line.speaker)) add('VOICE_REVIEW_REQUIRED','Voice has no matching recorded text / speaker source',[...line.path,'text']);
  plan?.tasks?.forEach((task,i)=>{if(task.state!=='review')add('TASK_UNFINISHED','Task still needs review: '+task.id,['production','tasks',i,'state']);if(!task.targets?.length&&!task.assets?.length&&task.kind!=='ui')add('TASK_OUTPUT_MISSING','Task has no bound target or asset: '+task.id,['production','tasks',i]);});
  plan?.beats?.forEach((beat,i)=>{if(!beat.targets.length)add('BEAT_UNBOUND','Beat has no runtime target: '+beat.id,['production','beats',i,'targets']);});
  if(p.ui&&uiContrast(p.ui)<4.5)add('UI_CONTRAST','Theme text/panel contrast is below 4.5:1',['ui','colors']);
  return {status:issues.some(i=>i.severity==='error')?'FAIL':issues.length?'UNVERIFIED':'PASS',issues,summary:{lines:texts.length,characters:plan?.characters?.length??0,beats:plan?.beats?.length??0,tasks:plan?.tasks?.length??0},scope:{mechanical:true,literaryQuality:'UNVERIFIED',humanAcceptance:'UNVERIFIED'}};
}

/** Atomic identity rewrites shared by Studio and Agent author commands. */
export function rewriteCreativeTargets(p:EngineProject,kind:'node'|'chapter',oldId:string,newId:string,chapterId?:string) {
  for(const group of [p.production?.beats??[],p.production?.tasks??[]])for(const item of group)for(const target of item.targets??[]) {
    if(kind==='chapter'&&target.chapterId===oldId){target.chapterId=newId;if(target.lineId?.startsWith(oldId+'/'))target.lineId=newId+target.lineId.slice(oldId.length);}
    if(kind==='node'&&target.nodeId===oldId&&target.chapterId===chapterId){target.nodeId=newId;if(p.type==='investigation'&&target.lineId===`${chapterId}/${oldId}`)target.lineId=`${chapterId}/${newId}`;if(p.type==='narrative'&&p.scenes.find(s=>s.id===oldId)?.lines.some((l,i)=>!l.id&&target.lineId===`${oldId}/${i}`))target.lineId=newId+target.lineId!.slice(oldId.length);}
  }
}
