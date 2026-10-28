import type { EngineProject } from '../runtime/project.js';
import { contentCatalogue } from './content.js';

export function analyseContentImpact(before:EngineProject,after:EngineProject,beforeSha256:string,afterSha256:string,limit=20) {
  const old=new Map(contentCatalogue(before).map(c=>[c.key,c])),next=new Map(contentCatalogue(after).map(c=>[c.key,c]));
  const changed=[...new Set([...old.keys(),...next.keys()])].filter(key=>JSON.stringify(old.get(key))!==JSON.stringify(next.get(key)));
  const changedAssets=[...new Set([...before.assets,...after.assets].map(a=>a.id))].filter(id=>JSON.stringify(before.assets.find(a=>a.id===id))!==JSON.stringify(after.assets.find(a=>a.id===id)));
  const nodes=new Set(changed.flatMap(key=>[old.get(key)?.nodeId,next.get(key)?.nodeId].filter((v):v is string=>!!v)));
  const nodeMap=(p:EngineProject)=>new Map<string,unknown>(p.type==='script'?p.program.blocks.map(n=>[n.id,n]):p.type==='narrative'?p.scenes.map(n=>[n.id,n]):p.type==='rain'?p.story.nodes.map(n=>[n.id,n]):p.chapters.flatMap(c=>Object.entries(c.nodes).map(([id,n])=>[`${c.id}/${id}`,n] as [string,unknown])));
  const aNodes=nodeMap(before),bNodes=nodeMap(after),changedNodes=[...new Set([...aNodes.keys(),...bNodes.keys()])].filter(id=>JSON.stringify(aNodes.get(id))!==JSON.stringify(bNodes.get(id)));
  for(const id of changedNodes)nodes.add(id.includes('/')?id.slice(id.indexOf('/')+1):id);
  const globals=['ui','defaults','stage','settings','font','stats','collections'].filter(key=>JSON.stringify((before as any)[key])!==JSON.stringify((after as any)[key]));
  if(before.type==='script'&&after.type==='script'&&JSON.stringify(before.program.variables)!==JSON.stringify(after.program.variables))globals.push('program.variables');
  const tasks=new Set<string>();
  for(const task of [...before.production?.tasks??[],...after.production?.tasks??[]]){
    if(JSON.stringify(before.production?.tasks?.find(t=>t.id===task.id))!==JSON.stringify(after.production?.tasks?.find(t=>t.id===task.id))
      ||globals.length||task.targets?.some(t=>nodes.has(t.nodeId))||task.assets?.some(id=>changedAssets.includes(id)))tasks.add(task.id);
  }
  for(let pass=0;pass<128;pass++){const count=tasks.size;for(const task of after.production?.tasks??[])if(task.dependsOn?.some(id=>tasks.has(id)))tasks.add(task.id);if(count===tasks.size)break;}
  const voiceWarnings=changed.flatMap(key=>{const a=old.get(key),b=next.get(key);return a?.voice||b?.voice?[{key,voiceBefore:a?.voice??null,voiceAfter:b?.voice??null,reason:'Changed voiced content requires text/speaker and playback review'}]:[];});
  const bounded=<T>(items:T[])=>({total:items.length,items:items.slice(0,limit),truncated:items.length>limit});
  return {contract:'vn-content-impact-v1',beforeSha256,afterSha256,changed:beforeSha256!==afterSha256,
    content:bounded(changed.map(key=>({key,kind:next.get(key)?.kind??old.get(key)!.kind,nodeId:next.get(key)?.nodeId??old.get(key)!.nodeId,path:next.get(key)?.path??old.get(key)!.path,change:!old.has(key)?'added':!next.has(key)?'removed':'changed'}))),
    nodes:bounded(changedNodes),globalChanges:globals,assets:bounded(changedAssets),tasks:bounded([...tasks]),voiceWarnings:bounded(voiceWarnings),
    previousResultsInvalidated:beforeSha256!==afterSha256,fullRouteSuiteRequired:true,
    routes:bounded((after.routeTests?.cases??[]).map(c=>c.id)),
    unknown:['Static analysis does not prove complete route reachability or persistent stage inherited across prior nodes.',...(after.type==='narrative'&&(after.adapter||after.stage?.presentation)?['Adapter/dynamic presentation needs actual runtime preview.']:[])],
    scope:{staticReferences:true,selectiveReleaseApproval:false,literaryQuality:'UNVERIFIED',humanAcceptance:'UNVERIFIED'}};
}
