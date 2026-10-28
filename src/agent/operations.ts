import { applyCreativeOperation } from './creative.js';
import { EditorModel } from '../editor/model.js';
import { validateVariable } from '../editor/catalogs.js';
import { AgentError } from './protocol.js';
import { atPath, selectNode, renameAgentNode, checkedId } from './project.js';
import { creativeReferences } from '../creative/project.js';
import { hasAuthoredReplay } from '../editor/catalogs.js';

const copy = (value: any) => structuredClone(value);
export function applyAgentOperation(model: EditorModel, operation: Record<string, any>): void {
  const o = operation, p = model.getView().project;
  if (o.id !== undefined) checkedId(o.id);
  if(o.newId!==undefined)checkedId(o.newId);
  if(/^(ui\.set|production\.patch|character\.|beat\.|task\.)/.test(o.op)){applyCreativeOperation(model,o);return;}
  const node = () => selectNode(model, o.nodeId ?? o.id, o.chapterId);
  const chapter = () => {
    if (p.type !== 'investigation') throw new AgentError('OPERATION_UNSUPPORTED', 'Operation requires investigation project');
    const index = p.chapters.findIndex(c => c.id === (o.chapterId ?? o.id));
    if (index < 0) throw new AgentError('NOT_FOUND', 'Chapter does not exist'); return { index, value: p.chapters[index] };
  };
  const indexed = (path: (string | number)[], values: readonly any[], value: any) => {
    if (value?.id !== undefined && value.id !== o.id) throw new AgentError('INVALID_OPERATION', 'Payload ID differs from target ID');
    const next = copy(values), index = next.findIndex((item: any) => item.id === o.id);
    if (o.op.endsWith('.remove')) { if (index < 0) throw new AgentError('NOT_FOUND', 'Item does not exist'); next.splice(index, 1); }
    else {
      const item = { ...(index < 0 ? {} : next[index]), ...copy(value), id: o.id };
      if (o.afterId !== undefined) {
        if (o.afterId === o.id) throw new AgentError('INVALID_OPERATION', 'Item cannot be placed after itself');
        if (index >= 0) next.splice(index, 1); const after = next.findIndex((item: any) => item.id === o.afterId);
        if (after < 0) throw new AgentError('NOT_FOUND', 'afterId does not exist'); next.splice(after + 1, 0, item);
      } else if (index < 0) next.push(item); else next[index] = item;
    } model.set(path, next);
  };
  switch (o.op) {
    case 'project.patch': for (const [key, value] of Object.entries(o.value)) {
      if (key === 'stats' && p.type !== 'narrative') throw new AgentError('OPERATION_UNSUPPORTED', 'stats belongs to narrative projects'); model.set([key], value);
    } break;
    case 'entry.set':
      if (p.type === 'script') model.set(['program', 'entry'], o.id);
      else if (p.type === 'narrative' && !p.adapter) model.set(['entry'], o.id);
      else if (p.type === 'investigation') model.set(['chapters', chapter().index, 'entryNode'], o.id);
      else throw new AgentError('OPERATION_UNSUPPORTED', 'Entry is controlled by this compatibility adapter');
      break;
    case 'node.put': case 'node.patch': {
      if (p.type === 'rain') throw new AgentError('OPERATION_UNSUPPORTED', 'Rain keeps its native story format; use its existing authoring path');
      const existing = model.graph().nodes.find(n => n.id === o.id && n.chapter === o.chapterId);
      if (o.value.id !== undefined && o.value.id !== o.id) throw new AgentError('INVALID_OPERATION', 'Node payload ID differs from target');
      if (o.op === 'node.patch' && !existing) throw new AgentError('NOT_FOUND', 'Cannot patch a missing node');
      const value = { ...(o.op === 'node.patch' ? copy(atPath(p, existing!.path)) : {}), ...copy(o.value) };
      if (p.type !== 'investigation') value.id = o.id;
      if (existing) model.set(existing.path, value);
      else if (p.type === 'investigation') model.set(['chapters', chapter().index, 'nodes', o.id], value);
      else { const path = p.type === 'script' ? ['program', 'blocks'] : ['scenes']; model.set(path, [...copy(atPath(p, path)), value]); }
      break;
    }
    case 'node.rename': renameAgentNode(model, node(), checkedId(o.newId)); break;
    case 'node.remove': model.removeNode(node().key); break;
    case 'line.rename': {
      const n=node(),value=atPath(p,n.path);
      if(!Array.isArray(value.lines))throw new AgentError('OPERATION_UNSUPPORTED','Node has no line array');
      if(!value.lines.some((l:any)=>l.id===o.id))throw new AgentError('NOT_FOUND','Explicit stable line ID does not exist');
      if(o.id===o.newId)break;
      if(hasAuthoredReplay(p as any))throw new AgentError('REPLAY_RECAPTURE_REQUIRED','Recapture authored replay before renaming lines');
      const all=p.type==='script'?p.program.blocks:p.type==='narrative'?p.scenes:[];
      if(all.some(b=>b.lines.some(l=>l.id===o.newId)))throw new AgentError('INVALID_OPERATION','Line ID already exists');
      model.transact(project=>{
        atPath(project,n.path).lines.find((l:any)=>l.id===o.id).id=o.newId;
        if(project.type==='narrative'&&project.stage?.lines&&Object.hasOwn(project.stage.lines,o.id)){project.stage.lines[o.newId]=project.stage.lines[o.id];delete project.stage.lines[o.id];}
        for(const group of [project.production?.beats??[],project.production?.tasks??[]])for(const item of group)for(const target of item.targets??[])if(target.lineId===o.id&&target.nodeId===n.id)target.lineId=o.newId;
        for(const test of project.routeTests?.cases??[])if(test.expect.lineId===o.id)test.expect.lineId=o.newId;
      });break;
    }
    case 'line.put': case 'line.remove': {
      const n = node(), value = atPath(p, n.path); if (!Array.isArray(value.lines)) throw new AgentError('OPERATION_UNSUPPORTED', 'Node has no line array');
      if(o.op==='line.remove'&&creativeReferences(p as any,'line',o.id).length)throw new AgentError('CREATIVE_REFERENCED','Line still has production references');
      indexed([...n.path, 'lines'], value.lines, o.value); break;
    }
    case 'choice.put': case 'choice.remove': {
      const n = node(), value = atPath(p, n.path);
      if (p.type === 'script' && value.exit.type === 'choice') indexed([...n.path, 'exit', 'choices'], value.exit.choices, o.value);
      else if (p.type === 'narrative') indexed([...n.path, 'choices'], value.choices ?? [], o.value);
      else throw new AgentError('OPERATION_UNSUPPORTED', 'Node must have a choice exit'); break;
    }
    case 'exit.set': {
      const n = node(); if (p.type !== 'script') throw new AgentError('OPERATION_UNSUPPORTED', 'exit.set requires Script project'); model.set([...n.path, 'exit'], o.value); break;
    }
    case 'variable.put': {
      if (p.type !== 'script') throw new AgentError('OPERATION_UNSUPPORTED', 'Variable catalogs require Script project'); validateVariable(o.value);
      if (Object.hasOwn(p.program.variables, o.id)) model.updateVariable(o.id, o.value); else model.set(['program', 'variables', o.id], o.value); break;
    }
    case 'variable.rename': model.renameVariable(o.id, checkedId(o.newId)); break;
    case 'variable.remove': model.removeVariable(o.id); break;
    case 'chapter.add': model.addChapter({ id: o.id, title: o.title }); break;
    case 'chapter.patch': { const c = chapter(); for (const [key, value] of Object.entries(o.value)) model.set(['chapters', c.index, key], value); break; }
    case 'chapter.rename': model.renameChapter(o.id, checkedId(o.newId)); break;
    case 'chapter.move': model.moveChapter(o.id, o.direction); break;
    case 'chapter.remove': model.removeChapter(o.id); break;
    case 'evidence.put': { const c = chapter(); model.set(['chapters', c.index, 'evidence', o.id], { ...copy(c.value.evidence[o.id] ?? {}), ...o.value }); break; }
    case 'evidence.rename': model.renameEvidence(o.chapterId, o.id, checkedId(o.newId)); break;
    case 'evidence.remove': model.removeEvidence(o.chapterId, o.id); break;
    case 'action.put': case 'action.remove': { const n = node(), value = atPath(p, n.path); if (!Array.isArray(value.actions)) throw new AgentError('OPERATION_UNSUPPORTED', 'Node has no investigation actions'); indexed([...n.path, 'actions'], value.actions, o.value); break; }
    case 'asset.put': case 'asset.remove':
      if(o.op==='asset.remove'&&creativeReferences(p as any,'asset',o.id).length)throw new AgentError('CREATIVE_REFERENCED','Asset still has production references');
      indexed(['assets'], p.assets, o.value); break;
    case 'route.put': case 'route.remove': indexed(['routeTests', 'cases'], p.routeTests?.cases ?? [], o.value); model.set(['routeTests', 'schema'], 1); break;
    case 'stage.set': case 'stage.remove': {
      let path: (string | number)[];
      if (o.scope === 'defaults') path = p.type === 'script' || p.type === 'rain' ? ['defaults'] : ['stage', 'defaults'];
      else if (o.scope === 'line') {
        if (!o.id) throw new AgentError('INVALID_OPERATION', 'line stage requires id');
        if (p.type === 'script') {
          const matches = p.program.blocks.flatMap((block, i) => block.lines.flatMap((line, j) => line.id === o.id ? [['program', 'blocks', i, 'lines', j, 'cue'] as (string | number)[]] : []));
          if (matches.length !== 1) throw new AgentError('NOT_FOUND', 'Line ID is missing or ambiguous'); path = matches[0];
        } else if (p.type === 'narrative') path = ['stage', 'lines', o.id];
        else throw new AgentError('OPERATION_UNSUPPORTED', 'Line cue is not supported by this project');
      } else if (o.op === 'stage.remove' && (p.type === 'narrative' || p.type === 'investigation')) {
        if (!o.nodeId || p.type === 'investigation' && !o.chapterId) throw new AgentError('INVALID_OPERATION', 'Removing a node cue requires nodeId and investigation chapterId');
        path = p.type === 'narrative' ? ['stage','scenes',o.nodeId] : ['stage','nodes',`${o.chapterId}/${o.nodeId}`];
      } else {
        const n = node(); path = p.type === 'script' ? [...n.path, 'cue'] : p.type === 'investigation' ? ['stage', 'nodes', `${n.chapter}/${n.id}`] : ['stage', 'scenes', n.id];
      }
      if (o.op === 'stage.remove') model.transact(project => { const parent = atPath(project, path.slice(0,-1)), key = path.at(-1)!; if (!parent || !Object.hasOwn(parent,key)) throw new AgentError('NOT_FOUND','Presentation binding does not exist'); delete parent[key]; });
      else model.set(path, o.value); break;
    }
    default: throw new AgentError('INVALID_OPERATION', 'Operation is not implemented');
  }
}
