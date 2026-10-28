import { EditorModel, projectGraph, type EditorDocument, type EditorNode } from '../editor/model.js';
import { variableReferences, chapterReferences, hasAuthoredReplay } from '../editor/catalogs.js';
import { evidenceReferences, assertAuthorID } from '../editor/authoring.js';
import { projectEndings } from '../meta/project.js';
import type { EngineProject } from '../runtime/project.js';
import { AgentError, type AgentDiagnostic } from './protocol.js';

export const atPath = (root: any, path: readonly (string | number)[]): any => path.reduce((value, key) => value?.[key], root);
export function selectNode(model: EditorModel, id: string, chapterId?: string): EditorNode {
  const matches = model.graph().nodes.filter(node => node.id === id && (chapterId === undefined || node.chapter === chapterId));
  if (!matches.length) throw new AgentError('NOT_FOUND', 'Node does not exist', { nodeId: id, ...(chapterId ? { chapterId } : {}) });
  if (matches.length !== 1) throw new AgentError('REFERENCE_AMBIGUOUS', 'Specify chapterId for this node', { nodeId: id });
  return matches[0];
}
export function presentationEntries(project: EngineProject): { id: string; path: (string | number)[]; value: unknown }[] {
  const items: { id: string; path: (string | number)[]; value: unknown }[] = [];
  const add = (id: string, path: (string | number)[], value: unknown) => { if (value !== undefined) items.push({ id, path, value }); };
  if (project.type === 'script') {
    add('defaults', ['defaults'], project.defaults);
    project.program.blocks.forEach((block, i) => { add(block.id, ['program', 'blocks', i, 'cue'], block.cue); block.lines.forEach((line, j) => add(line.id, ['program', 'blocks', i, 'lines', j, 'cue'], line.cue)); });
  } else if (project.type === 'rain') add('defaults', ['defaults'], project.defaults);
  else {
    add('defaults', ['stage', 'defaults'], project.stage?.defaults);
    const plans = project.type === 'narrative' ? ['scenes', 'lines'] : ['nodes'];
    for (const name of plans) for (const [id, value] of Object.entries((project.stage as any)?.[name] ?? {})) add(id, ['stage', name, id], value);
  } return items;
}
export function inspectItems(project: EngineProject, kind: string, id?: string, chapterId?: string): any[] {
  let items: any[] = [];
  if (kind === 'overview') items = [{ id: project.game, game: project.game, storyVersion: project.version, title: project.title, type: project.type,
    nodes: project.type === 'rain' ? project.story.nodes.length : projectGraph(project).nodes.length, assets: project.assets.length,
    chapters: project.type === 'investigation' ? project.chapters.map(c => ({ id: c.id, title: c.title, order: c.order, entryNode: c.entryNode })) : [], endings: projectEndings(project), routeCases: project.routeTests?.cases.map(c => c.id) ?? [] }];
  else if (kind === 'nodes') {
    if (project.type === 'rain') items = project.story.nodes.map(node => ({ id: node.id, value: node }));
    else items = projectGraph(project).nodes.filter(node => !chapterId || node.chapter === chapterId).map(node => ({ id: node.id, ...(node.chapter ? { chapterId: node.chapter } : {}), value: atPath(project, node.path) }));
  } else if (kind === 'chapters') items = project.type === 'investigation' ? [...project.chapters].sort((a,b) => a.order-b.order).map(c => ({ id: c.id, title: c.title, order: c.order, entryNode: c.entryNode, nodes: Object.keys(c.nodes), requiredEvidence: c.requiredEvidence, evidence: c.evidence })) : [];
  else if (kind === 'variables') items = Object.entries(project.type === 'script' ? project.program.variables : project.type === 'narrative' ? project.stats ?? {} : {}).map(([id, value]) => ({ id, value }));
  else if (kind === 'assets') items = project.assets.map(value => ({ id: value.id, value }));
  else if (kind === 'presentation') items = presentationEntries(project);
  else if (kind === 'routes') items = (project.routeTests?.cases ?? []).map(value => ({ id: value.id, value }));
  return id === undefined ? items : items.filter(item => item.id === id);
}
export function referenceItems(document: EditorDocument, kind: string, id: string, chapterId?: string): any[] {
  const project = document.project, model = new EditorModel(document, 1);
  if (kind === 'variable') return variableReferences(project, id).map(ref => ({ direction: 'incoming', ...ref }));
  if (kind === 'chapter') return [...chapterReferences(project, id).map(ref => ({ direction: 'incoming', ...ref })), ...projectGraph(project).nodes.filter(n => n.chapter === id).map(n => ({ direction: 'owns', id: n.id, path: n.path }))];
  if (kind === 'evidence') {
    if (!chapterId) throw new AgentError('REFERENCE_AMBIGUOUS', 'Evidence requires chapterId');
    return evidenceReferences(project, chapterId, id).map(ref => ({ direction: 'incoming', ...ref }));
  }
  if (kind === 'node') {
    const node = selectNode(model, id, chapterId), graph = model.graph();
    return graph.edges.filter(edge => edge.to === node.key || edge.from === node.key).map(edge => ({ direction: edge.to === node.key ? 'incoming' : 'outgoing', ...edge }));
  }
  if (!project.assets.some(asset => asset.id === id)) throw new AgentError('NOT_FOUND', 'Asset does not exist', { assetId: id });
  const refs: any[] = [], add = (value: unknown, path: (string | number)[]) => { if (value === id) refs.push({ direction: 'incoming', path }); };
  add(project.font, ['font']);
  if (project.type === 'narrative') project.scenes.forEach((scene, i) => { for (const name of ['background', 'cg', 'music'] as const) add(scene[name], ['scenes', i, name]); });
  project.collections?.cgs?.forEach((entry, i) => add(entry.id, ['collections', 'cgs', i, 'id']));
  project.collections?.trueRoute?.cgs?.forEach((entry, i) => add(entry, ['collections', 'trueRoute', 'cgs', i]));
  for (const entry of presentationEntries(project)) {
    const cue: any = entry.value;
    for (const name of ['background','portrait','cg','music','ambience','sound','voice']) add(cue?.[name], [...entry.path, name]);
    add(cue?.video?.asset, [...entry.path, 'video', 'asset']); add(cue?.video?.fallback?.asset, [...entry.path, 'video', 'fallback', 'asset']); add(cue?.keyVisual?.asset, [...entry.path, 'keyVisual', 'asset']);
    for (const [layer, asset] of Object.entries(cue?.layers ?? {}) as [string, any][]) add(asset?.asset, [...entry.path, 'layers', layer, 'asset']);
    cue?.timeline?.animations?.forEach((track: any, i: number) => add(track.target, [...entry.path, 'timeline', 'animations', i, 'target']));
  } return refs;
}

export function agentProjectDiagnostics(model: EditorModel): AgentDiagnostic[] {
  const p = model.getView().project as EngineProject, diagnostics: AgentDiagnostic[] = [];
  try {
    for (const item of model.diagnostics()) {
      let node: EditorNode | undefined; if (item.node) node = model.graph().nodes.find(n => n.key === item.node);
      diagnostics.push({ code: 'PROJECT_' + item.code.toUpperCase().replace(/-/g, '_'), severity: item.severity, message: item.message,
        ...(node ? { nodeId: node.id, path: node.path, ...(node.chapter ? { chapterId: node.chapter } : {}) } : {}) });
    }
    if (p.type !== 'rain') {
      const nodes = model.graph().nodes, endings = new Set(projectEndings(p)), lines = new Set<string>();
      for (const node of nodes) {
        const value = atPath(p, node.path);
        if (p.type === 'investigation') lines.add(`${node.chapter}/${node.id}`);
        else value.lines.forEach((line: any, index: number) => lines.add(line.id ?? `${node.id}/${index}`));
      }
      p.routeTests?.cases.forEach((test, index) => {
        for (const [key, valid] of [['sceneId', new Set(nodes.map(n => n.id))], ['lineId', lines], ['ending', endings]] as const) {
          if (test.expect[key] !== undefined && !valid.has(test.expect[key]!)) diagnostics.push({ code: 'ROUTE_REFERENCE_MISSING', severity: 'error', message: `Route ${test.id} references missing ${key}: ${test.expect[key]}`, path: ['routeTests', 'cases', index, 'expect', key] });
        }
      });
    }
  } catch (error) { diagnostics.push({ code: 'PROJECT_SHAPE', severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
  return diagnostics;
}

/** Refuse opaque replay rewrites; all other changes reuse the existing authoring model. */
export function renameAgentNode(model: EditorModel, node: EditorNode, id: string) {
  if (node.id === id) return;
  const p = model.getView().project as EngineProject;
  if (hasAuthoredReplay(p)) throw new AgentError('REPLAY_RECAPTURE_REQUIRED', 'Recapture authored replay after changing node identity', { nodeId: node.id });
  const updates: { path: (string | number)[]; value: string }[] = [];
  p.routeTests?.cases.forEach((test, i) => {
    const path = ['routeTests', 'cases', i, 'expect'], oldLine = p.type === 'investigation' ? `${node.chapter}/${node.id}` : undefined;
    const own = p.type !== 'investigation' || test.expect.lineId === oldLine || model.graph().nodes.filter(n => n.id === node.id).length === 1;
    if (test.expect.sceneId === node.id) {
      if (!own && test.expect.lineId === undefined) throw new AgentError('REFERENCE_AMBIGUOUS', 'Route scene expectation needs chapter-qualified lineId');
      if (own) updates.push({ path: [...path, 'sceneId'], value: id });
    }
    if (oldLine && test.expect.lineId === oldLine) updates.push({ path: [...path, 'lineId'], value: `${node.chapter}/${id}` });
    if (p.type === 'narrative') {
      const scene = atPath(p, node.path); scene.lines.forEach((line: any, index: number) => {
        if (!line.id && test.expect.lineId === `${node.id}/${index}`) updates.push({ path: [...path, 'lineId'], value: `${id}/${index}` });
      });
    }
  });
  const legacyCues = p.type === 'narrative' ? Object.entries(p.stage?.lines ?? {}).filter(([key]) => atPath(p, node.path).lines.some((line: any, index: number) => !line.id && key === `${node.id}/${index}`)) : [];
  model.rename(node.key, id);
  for (const update of updates) model.set(update.path, update.value);
  if (legacyCues.length) model.transact(project => { if (project.type === 'narrative' && project.stage?.lines) for (const [key, value] of legacyCues) { project.stage.lines[id + key.slice(node.id.length)] = structuredClone(value); delete project.stage.lines[key]; } });
}
export function checkedId(value: string) { try { assertAuthorID(value); } catch { throw new AgentError('INVALID_OPERATION', 'Invalid stable ID'); } return value; }
