import type { EngineProject } from '../runtime/project.js';
import type { StageCue } from '../stage/types.js';
import { currentCue, persistentCue } from '../stage/cues.js';
import { presentationAt, cgAt } from '../presentation/frame.js';
import { compileRainProgram } from '../adapters/rain-runtime.js';

export type ContentKind = 'line' | 'variant' | 'choice' | 'action';
export type ContentEntry = { key:string; id:string; kind:ContentKind; nodeId:string; chapterId?:string; lineId?:string;
  speaker:string; text:string; medium?:string; path:(string|number)[]; derived:boolean; voice?:string; assets:string[]; stage?:StageCue };
export const contentKey = (kind:string,id:string,nodeId?:string,chapterId?:string) => JSON.stringify([kind,chapterId??null,nodeId??null,id]);
export function cueAssets(cue?:StageCue):string[] {
  if(!cue)return [];
  return [...new Set([cue.background,cue.portrait,cue.cg,cue.music,cue.ambience,cue.sound,cue.voice,cue.video?.asset,
    cue.video?.fallback?.asset,cue.keyVisual?.asset,...Object.values(cue.layers??{}).map(v=>v?.asset),...(cue.timeline?.animations??[]).map(t=>t.target)]
    .filter((v):v is string=>typeof v==='string'&&!!v))];
}
/** Static authored positions, with the same one-shot/durable cue rules as the drivers. */
export function contentCatalogue(p:EngineProject):ContentEntry[] {
  const result:ContentEntry[]=[];
  const add=(kind:ContentKind,id:string,nodeId:string,text:string,speaker:string,path:(string|number)[],stage?:StageCue,chapterId?:string,derived=false,lineId?:string)=>{
    result.push({key:contentKey(kind,id,nodeId,chapterId),id,kind,nodeId,...(chapterId?{chapterId}:{}),...(lineId?{lineId}:{}),speaker,text,path,derived,
      ...(stage?.voice?{voice:stage.voice}:{}),assets:cueAssets(stage),...(stage?{stage:structuredClone(stage)}:{})});
  };
  if(p.type==='narrative')p.scenes.forEach((s,i)=>{
    let durable:StageCue={};
    s.lines.forEach((l,j)=>{
      const id=l.id??`${s.id}/${j}`,presentation=presentationAt(s,j,{speakers:p.stage?.speakers??{}});
      const base=persistentCue(persistentCue({...p.stage?.defaults,...(s.background?{background:s.background}:{}),...(s.music?{music:s.music}:{}),portrait:presentation.character?`${presentation.character}/${presentation.expression}`:null,cg:cgAt(s,j)??null},p.stage?.scenes?.[s.id]),durable);
      const cue={...(j===0?p.stage?.scenes?.[s.id]:{}),...p.stage?.lines?.[id]},stage=currentCue(base,cue);
      if(s.noSprite)stage.portrait=null;
      add('line',id,s.id,l.text,l.speaker,['scenes',i,'lines',j],stage,undefined,!l.id,id);
      if(l.variant)add('variant',id,s.id,l.variant.text,l.speaker,['scenes',i,'lines',j,'variant'],stage,undefined,true,id);
      durable=persistentCue(durable,p.stage?.lines?.[id]);
    });
    s.choices?.forEach((c,j)=>add('choice',c.id,s.id,c.text,'',['scenes',i,'choices',j]));
  });
  else if(p.type==='script')p.program.blocks.forEach((b,i)=>{
    let durable=persistentCue(p.defaults??{},b.cue);
    b.lines.forEach((l,j)=>{
      const cue={...(j===0?b.cue:{}),...l.cue};add('line',l.id,b.id,l.text,l.speaker,['program','blocks',i,'lines',j],currentCue(durable,cue),undefined,false,l.id);
      durable=persistentCue(durable,l.cue);
    });
    if(b.exit.type==='choice')b.exit.choices.forEach((c,j)=>add('choice',c.id,b.id,c.text,'',['program','blocks',i,'exit','choices',j]));
  });
  else if(p.type==='investigation')p.chapters.forEach((c,i)=>Object.entries(c.nodes).forEach(([id,n])=>{
    add('line',`${c.id}/${id}`,id,n.text,n.speaker??(n.kind==='evidence'?'证据记录':'调查记录'),['chapters',i,'nodes',id],currentCue(p.stage?.defaults??{},p.stage?.nodes?.[`${c.id}/${id}`]),c.id,true,`${c.id}/${id}`);
    n.actions?.forEach((a,j)=>add('action',a.id,id,a.label,'',['chapters',i,'nodes',id,'actions',j],undefined,c.id));
  }));
  else {
    const program=compileRainProgram(p.story,{game:p.game,version:p.version});
    p.story.nodes.forEach((n,i)=>{
      const block=program.blocks.find(b=>b.id===n.id)!;let durable=persistentCue(p.defaults??{},block.cue);
      n.lines?.forEach((l,j)=>{const compiled=block.lines[j];add('line',l.id,n.id,l.text,compiled.speaker,['story','nodes',i,'lines',j],currentCue(durable,{...(j===0?block.cue:{}),...compiled.cue}),undefined,false,l.id);durable=persistentCue(durable,compiled.cue);});
      n.choices?.forEach((c,j)=>{
        add('choice',c.id,n.id,c.text,'',['story','nodes',i,'choices',j]);
        const response=program.blocks.find(b=>b.id===`@response/${n.id}/${c.id}`);let prior=p.defaults??{};
        c.response?.forEach((l,k)=>{const line=response!.lines[k];add('line',l.id,n.id,l.text,line.speaker,['story','nodes',i,'choices',j,'response',k],currentCue(prior,line.cue),undefined,false,l.id);prior=persistentCue(prior,line.cue);});
      });
    });
  }
  for(const entry of result){let value:any=p;for(const part of entry.kind==='variant'?entry.path.slice(0,-1):entry.path)value=value?.[part];if(value?.medium)entry.medium=value.medium;}
  return result;
}

export function contentAssetReferences(p:EngineProject,id:string) {
  return contentCatalogue(p).filter(c=>c.assets.includes(id)).map(c=>({direction:'incoming',role:'effective-stage',contentKey:c.key,path:c.path,nodeId:c.nodeId,...(c.chapterId?{chapterId:c.chapterId}:{})}));
}
