import type { EditorModel } from '../editor/model.js';
import type { EngineProject } from '../runtime/project.js';
import { creativeReferences, type ProductionPlan } from '../creative/project.js';
import { AgentError } from './protocol.js';
/** Metadata commands use the same owned author transaction as runtime edits. */
export function applyCreativeOperation(model:EditorModel,o:Record<string,any>) {
  if(o.op==='ui.set'){model.set(['ui'],o.value);return;}
  if(o.op==='production.patch'){model.transact(p=>{const previous=p.production;p.production={schema:1,...previous,...o.value,...(o.value.brief?{brief:{...previous?.brief,...o.value.brief}}:{})} as ProductionPlan;});return;}
  const group=o.op.startsWith('character.')?'characters':o.op.startsWith('beat.')?'beats':'tasks';
  const type=group==='characters'?'character':'task',p=model.getView().project as EngineProject,items=p.production?.[group]??[],index=items.findIndex(v=>v.id===o.id);
  if(o.op.endsWith('.remove')) {
    if(index<0)throw new AgentError('NOT_FOUND','Creative entity does not exist');
    if(group!=='beats'&&creativeReferences(p,type,o.id).length)throw new AgentError('CREATIVE_REFERENCED','Creative entity still has incoming references');
  }
  if(o.op.endsWith('.rename')) {
    if(index<0)throw new AgentError('NOT_FOUND','Creative entity does not exist');
    if(items.some(v=>v.id===o.newId)&&o.id!==o.newId)throw new AgentError('CREATIVE_DUPLICATE','Creative target ID exists');
  }
  model.transact(project=>{
    project.production??={schema:1};const list=(project.production[group]??=[]) as any[];
    if(o.op.endsWith('.remove')){list.splice(index,1);return;}
    if(o.op.endsWith('.rename')){
      list[index].id=o.newId;
      if(group==='characters')for(const item of [...project.production.beats??[],...project.production.tasks??[]])if(item.characters)item.characters=item.characters.map(id=>id===o.id?o.newId:id);
      if(group==='tasks'){for(const task of project.production.tasks??[])if(task.dependsOn)task.dependsOn=task.dependsOn.map(id=>id===o.id?o.newId:id);for(const beat of project.production.beats??[])if(beat.tasks)beat.tasks=beat.tasks.map(id=>id===o.id?o.newId:id);}return;
    }
    if(o.value.id!==undefined&&o.value.id!==o.id)throw new AgentError('INVALID_OPERATION','Payload ID differs from target');
    const value={...(index<0?{}:list[index]),...structuredClone(o.value),id:o.id};if(index<0)list.push(value);else list[index]=value;
  });
}
