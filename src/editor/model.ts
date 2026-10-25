import type { EngineProject } from '../runtime/project.js';
import { createProject } from '../runtime/project.js';
import { isRecord } from '../storage/save.js';
import { localAssetPath } from '../assets/catalog.js';
import { freezeData, type DeepReadonly } from '../runtime/readonly.js';

type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };
export type AuthorProject = Mutable<EngineProject>;
export type Position = { x: number; y: number };
export type EditorDocument = { format: 'vn-engine-editor'; schema: 1; project: EngineProject; positions: Record<string, Position> };
export type EditorNode = { key: string; id: string; title: string; text: string; path: (string | number)[]; chapter?: string; entry: boolean; ending: boolean };
export type EditorEdge = { from: string; to: string; label: string; path: (string | number)[] };
export type Diagnostic = { severity: 'error' | 'warning'; code: string; message: string; node?: string };
const keyFor = (id: string, chapter?: string) => JSON.stringify(chapter ? [chapter, id] : [id]);
const record = (value: unknown): value is Record<string, any> => isRecord(value); // JSON authoring boundary, checked before use.

function assertJSON(value: unknown, depth = 0): void {
  if (depth > 60) throw new Error('工程嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) assertJSON(item, depth + 1); return; }
  if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('工程必须是 JSON 数据');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('工程包含不安全的字段名');
    assertJSON(item, depth + 1);
  }
}

/** Accept broken links for repair; never accept executable data or an unrecognised root. */
export function readDocument(input: string | unknown): EditorDocument {
  if (typeof input === 'string' && input.length > 8_000_000) throw new Error('工程超过 8 MB');
  const value = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  assertJSON(value);
  if (!record(value)) throw new Error('工程根节点必须是对象');
  const wrapped = value.format === 'vn-engine-editor';
  if (wrapped && value.schema !== 1) throw new Error('不支持的编辑器工程版本');
  const project = wrapped ? value.project : value;
  if (!record(project) || project.schema !== 1 || typeof project.game !== 'string' || !project.game.trim()
    || typeof project.version !== 'string' || !project.version.trim() || typeof project.title !== 'string'
    || !Array.isArray(project.assets) || !['narrative', 'script', 'investigation', 'rain'].includes(project.type)) throw new Error('不是有效的引擎工程');
  if (project.type === 'narrative' && (!Array.isArray(project.scenes) || project.scenes.some((s: unknown) => !record(s) || typeof s.id !== 'string' || !Array.isArray(s.lines)))) throw new Error('缺少场景列表');
  if (project.type === 'script' && (!record(project.program) || !Array.isArray(project.program.blocks) || project.program.blocks.some((b: unknown) => !record(b) || typeof b.id !== 'string' || !Array.isArray(b.lines) || !record(b.exit)))) throw new Error('缺少脚本块');
  if (project.type === 'investigation' && (!Array.isArray(project.chapters) || project.chapters.some((c: unknown) => !record(c) || typeof c.id !== 'string' || !record(c.nodes)))) throw new Error('缺少调查章节');
  if (project.type === 'rain' && !record(project.story)) throw new Error('缺少兼容剧本');
  const positions: Record<string, Position> = {};
  if (wrapped && record(value.positions)) for (const [key, point] of Object.entries(value.positions)) {
    if (record(point) && [point.x, point.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000)) positions[key] = { x: point.x, y: point.y };
  }
  return { format: 'vn-engine-editor', schema: 1, project: project as EngineProject, positions };
}

export function projectGraph(project: EngineProject): { nodes: EditorNode[]; edges: EditorEdge[] } {
  const nodes: EditorNode[] = [], edges: EditorEdge[] = [];
  const edge = (from: string, to: unknown, label: unknown, path: (string | number)[], chapter?: string) => {
    if (typeof to === 'string' && to) edges.push({ from, to: keyFor(to, chapter), label: String(label ?? ''), path });
  };
  if (project.type === 'narrative') project.scenes.forEach((scene, i) => {
    const key = keyFor(scene.id), path = ['scenes', i];
    nodes.push({ key, id: scene.id, path, title: scene.title ?? scene.id, text: scene.lines[0]?.text ?? '', entry: scene.id === (project.entry ?? project.scenes[0]?.id), ending: !!scene.ending });
    edge(key, scene.next, '继续', [...path, 'next']); edge(key, scene.continuation, '跨章', [...path, 'continuation']);
    scene.choices?.forEach((c, j) => edge(key, c.next, c.text, [...path, 'choices', j, 'next']));
  });
  if (project.type === 'script') project.program.blocks.forEach((block, i) => {
    const key = keyFor(block.id), path = ['program', 'blocks', i], exit = block.exit;
    nodes.push({ key, id: block.id, path, title: block.title ?? block.id, text: block.lines[0]?.text ?? '路由块', entry: block.id === project.program.entry, ending: exit.type === 'end' });
    if (exit.type === 'jump') edge(key, exit.next, '继续', [...path, 'exit', 'next']);
    if (exit.type === 'choice') exit.choices?.forEach((c, j) => edge(key, c.next, c.text, [...path, 'exit', 'choices', j, 'next']));
    if (exit.type === 'branch') exit.routes?.forEach((r, j) => edge(key, r.next, Object.keys(r.when ?? {}).length ? JSON.stringify(r.when) : '兜底', [...path, 'exit', 'routes', j, 'next']));
  });
  if (project.type === 'investigation') project.chapters.forEach((chapter, i) => {
    for (const [id, node] of Object.entries(chapter.nodes)) {
      const key = keyFor(id, chapter.id), path = ['chapters', i, 'nodes', id];
      nodes.push({ key, id, path, chapter: chapter.id, title: `${chapter.title} · ${id}`, text: node?.text ?? '', entry: id === chapter.entryNode, ending: !!node?.outcome });
      node?.actions?.forEach((a, j) => edge(key, a.next, a.label, [...path, 'actions', j, 'next'], chapter.id));
    }
  });
  return { nodes, edges };
}

/** Structural reachability is a warning; inventory semantics stay with InvestigationEngine. */
export function diagnoseProject(project: EngineProject, availableFiles?: ReadonlySet<string>): Diagnostic[] {
  const result: Diagnostic[] = [], add = (severity: Diagnostic['severity'], code: string, message: string, node?: string) => result.push({ severity, code, message, ...(node ? { node } : {}) });
  let graph: ReturnType<typeof projectGraph>;
  try { graph = projectGraph(project); } catch (error) { add('error', 'shape', '数据结构不完整：' + String(error)); return result; }
  const keys = new Set<string>();
  for (const node of graph.nodes) { if (keys.has(node.key)) add('error', 'duplicate', '节点 ID 重复：' + node.id, node.key); keys.add(node.key); }
  for (const edge of graph.edges) if (!keys.has(edge.to)) add('error', 'target', '连线目标不存在：' + edge.label, edge.from);
  const visited = new Set<string>(), pending = graph.nodes.filter(n => n.entry).map(n => n.key);
  while (pending.length) { const key = pending.pop()!; if (visited.has(key)) continue; visited.add(key); for (const edge of graph.edges) if (edge.from === key && keys.has(edge.to)) pending.push(edge.to); }
  const dynamicRouting = project.type === 'narrative' && !!project.adapter && project.scenes.some(scene => scene.resolve);
  if (dynamicRouting) add('warning', 'dynamic-routing', '兼容适配器按数值解析动态结局；静态图不推断这些连线，请通过试玩核对。');
  else for (const node of graph.nodes) if (!visited.has(node.key)) add('warning', 'unreachable', '没有从入口连到此节点：' + node.id, node.key);
  const assets = new Map(project.assets.filter(record).map(a => [a.id, a]));
  const binding = (id: unknown, kind: string, label: string, node?: string) => {
    if (id === undefined || id === null || id === '') return;
    if (typeof id !== 'string' || !assets.has(id) || assets.get(id)!.kind !== kind) add('error', 'asset-binding', `${label}引用了缺少或类型不符的资源：${String(id)}`, node);
  };
  const cue = (value: unknown, node?: string) => {
    if (!record(value)) return;
    for (const name of ['background', 'portrait', 'cg', 'music', 'ambience', 'sound', 'voice']) binding(value[name], ['background', 'portrait', 'cg'].includes(name) ? name : 'audio', name, node);
  };
  binding(project.font, 'font', '字体');
  for (const asset of project.assets) {
    if (!record(asset)) { add('error', 'asset', '资源条目必须是对象'); continue; }
    if (!localAssetPath(asset.src)) add('error', 'asset-path', '资源路径不安全：' + String(asset.src));
    if (asset.kind === 'font' && !asset.license) add('error', 'font-license', '字体需要许可记录：' + asset.id);
    for (const path of [asset.src, asset.license?.src].filter((p): p is string => !!p)) if (availableFiles && !availableFiles.has(path)) add('error', 'asset-file', '资源目录缺少文件：' + path);
  }
  if (project.type === 'script') { cue(project.defaults); for (const block of project.program.blocks) { const key = keyFor(block.id); cue(block.cue, key); for (const line of block.lines) cue(line.cue, key); } }
  if (project.type === 'rain') cue(project.defaults);
  if (project.type === 'narrative' || project.type === 'investigation') {
    cue(project.stage?.defaults);
    const plans = project.type === 'narrative' ? [project.stage?.scenes, project.stage?.lines] : [project.stage?.nodes];
    for (const plan of plans) if (plan) for (const value of Object.values(plan)) cue(value);
    if (project.type === 'narrative') for (const scene of project.scenes) {
      const key = keyFor(scene.id); binding(scene.background, 'background', '背景', key); binding(scene.cg, 'cg', 'CG', key); binding(scene.music, 'audio', '音乐', key);
    }
  }
  try { const instance = createProject(project, 'https://preview.invalid/'); instance.session.dispose(); }
  catch (error) { add('error', 'runtime', '运行校验：' + (error instanceof Error ? error.message : String(error))); }
  return result;
}

function locate(root: unknown, path: readonly (string | number)[]): any {
  let value = root;
  for (const key of path) { if ((!record(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) throw new Error('字段路径不存在'); value = (value as any)[key]; }
  return value;
}

/** Owned immutable documents, atomic commands, bounded undo, and a save-point independent of history. */
export class EditorModel {
  private document: EditorDocument;
  private past: EditorDocument[] = [];
  private future: EditorDocument[] = [];
  private saved: string;
  private view?: DeepReadonly<EditorDocument>;
  constructor(input: string | unknown, readonly historyLimit = 80) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 500) throw new Error('无效的撤销上限');
    this.document = readDocument(input); this.saved = JSON.stringify(this.document);
  }
  getView(): DeepReadonly<EditorDocument> { return this.view ??= freezeData(structuredClone(this.document)); }
  get dirty() { return JSON.stringify(this.document) !== this.saved; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  markSaved() { this.saved = JSON.stringify(this.document); }
  markUnsaved() { this.saved = ''; }
  serialize(projectOnly = false) { return JSON.stringify(projectOnly ? this.document.project : this.document, null, 2) + '\n'; }
  graph() { return projectGraph(this.document.project); }
  diagnostics(files?: ReadonlySet<string>) { return diagnoseProject(this.document.project, files); }
  transact(edit: (project: AuthorProject, positions: Record<string, Position>) => void) {
    const next = structuredClone(this.document); edit(next.project as AuthorProject, next.positions);
    const checked = readDocument(next);
    if (JSON.stringify(checked) === JSON.stringify(this.document)) return false;
    this.past.push(this.document); if (this.past.length > this.historyLimit) this.past.shift();
    this.document = checked; this.future = []; this.view = undefined; return true;
  }
  undo() { const previous = this.past.pop(); if (!previous) return false; this.future.push(this.document); this.document = previous; this.view = undefined; return true; }
  redo() { const next = this.future.pop(); if (!next) return false; this.past.push(this.document); this.document = next; this.view = undefined; return true; }
  set(path: readonly (string | number)[], value: unknown) {
    if (!path.length || path.length > 60 || path.some(k => ['__proto__', 'constructor', 'prototype'].includes(String(k)) || (typeof k === 'number' && (!Number.isInteger(k) || k < 0 || k > 10000)))) throw new Error('无效字段路径');
    return this.transact(project => {
      let parent: any = project;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]; if (!record(parent) && !Array.isArray(parent)) throw new Error('无效字段父节点');
        if (!Object.hasOwn(parent, key)) (parent as any)[key] = typeof path[i + 1] === 'number' ? [] : {};
        parent = (parent as any)[key];
      }
      if (!record(parent) && !Array.isArray(parent)) throw new Error('无效字段父节点');
      (parent as any)[path.at(-1)!] = structuredClone(value);
    });
  }
  replaceProject(project: unknown) {
    const next = readDocument(project).project;
    return this.transact(current => { for (const key of Object.keys(current)) delete (current as any)[key]; Object.assign(current, next); });
  }
  move(key: string, position: Position) {
    if (!this.graph().nodes.some(n => n.key === key)) throw new Error('节点不存在');
    return this.transact((_p, positions) => { positions[key] = position; });
  }
  rename(key: string, id: string) {
    if (!id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('无效节点 ID');
    const graph = this.graph(), node = graph.nodes.find(n => n.key === key);
    if (!node || graph.nodes.some(n => n.id === id && n.chapter === node.chapter)) throw new Error('节点不存在或 ID 已使用');
    const nextKey = keyFor(id, node.chapter);
    this.transact((project, positions) => {
      for (const edge of graph.edges.filter(e => e.to === key)) { const parent = locate(project, edge.path.slice(0, -1)); parent[edge.path.at(-1)!] = id; }
      if (project.type === 'investigation') {
        const chapter = project.chapters.find(c => c.id === node.chapter)!;
        chapter.nodes[id] = chapter.nodes[node.id]; delete chapter.nodes[node.id]; if (chapter.entryNode === node.id) chapter.entryNode = id;
        const oldStage = `${chapter.id}/${node.id}`, nextStage = `${chapter.id}/${id}`;
        if (project.stage?.nodes?.[oldStage]) { project.stage.nodes[nextStage] = project.stage.nodes[oldStage]; delete project.stage.nodes[oldStage]; }
      } else {
        locate(project, node.path).id = id;
        if (project.type === 'script' && project.program.entry === node.id) project.program.entry = id;
        if (project.type === 'narrative') {
          if ((project.entry ?? project.scenes[0]?.id) === node.id) project.entry = id;
          if (project.stage?.scenes?.[node.id]) { project.stage.scenes[id] = project.stage.scenes[node.id]; delete project.stage.scenes[node.id]; }
        }
      }
      if (positions[key]) { positions[nextKey] = positions[key]; delete positions[key]; }
    });
    return nextKey;
  }
  addNode(chapterId?: string) {
    const project = this.document.project;
    if (project.type === 'investigation') chapterId ??= project.chapters[0]?.id;
    const ids = new Set(this.graph().nodes.filter(n => n.chapter === chapterId).map(n => n.id));
    let id = 'scene-1'; for (let i = 2; ids.has(id); i++) id = 'scene-' + i;
    this.transact(p => {
      if (p.type === 'narrative') p.scenes.push({ id, title: '新场景', lines: [{ id: id + '-line-1', speaker: '旁白', text: '请在这里填写台词。' }], ending: '待命名结局' });
      else if (p.type === 'script') p.program.blocks.push({ id, title: '新场景', lines: [{ id: id + '-line-1', speaker: '旁白', text: '请在这里填写台词。' }], exit: { type: 'end', ending: '待命名结局' } });
      else if (p.type === 'investigation') {
        const chapter = p.chapters.find(c => c.id === chapterId) ?? p.chapters[0];
        if (!chapter) throw new Error('请先创建章节');
        chapter.nodes[id] = { kind: 'ending', text: '请在这里填写台词。', location: '', time: '', progress: 100, actions: [], outcome: 'failure' };
      } else throw new Error('Rain 兼容数据请通过 JSON 面板编辑');
    });
    return keyFor(id, project.type === 'investigation' ? (chapterId ?? project.chapters[0].id) : undefined);
  }
  removeNode(key: string) {
    const node = this.graph().nodes.find(n => n.key === key); if (!node) throw new Error('节点不存在');
    // Incoming links stay visible as diagnostics; deleting a node must not silently erase choices.
    this.transact((project, positions) => {
      if (project.type === 'narrative') project.scenes.splice(Number(node.path[1]), 1);
      if (project.type === 'script') project.program.blocks.splice(Number(node.path[2]), 1);
      if (project.type === 'investigation') delete project.chapters.find(c => c.id === node.chapter)!.nodes[node.id];
      delete positions[key];
    });
  }
}

export function newProject(kind: 'vn' | 'chat' | 'script' | 'investigation'): EngineProject {
  const base = { schema: 1 as const, game: 'my-' + kind, version: '1', title: '未命名作品', assets: [] };
  if (kind === 'vn' || kind === 'chat') return { ...base, type: 'narrative', entry: 'start', stats: {}, scenes: [
    { id: 'start', title: '开场', lines: [{ id: 'start-1', speaker: '作者', text: '从一个选择开始。', ...(kind === 'chat' ? { medium: 'chat' as const } : {}) }], choices: [{ id: 'continue', text: '继续', next: 'end' }] },
    { id: 'end', title: '结局', lines: [{ id: 'end-1', speaker: '作者', text: '这里等待你的故事。', ...(kind === 'chat' ? { medium: 'chat' as const } : {}) }], ending: '完成' }
  ] };
  if (kind === 'script') return { ...base, type: 'script', program: { schema: 1, game: base.game, version: base.version, entry: 'start', variables: { trust: { initial: 0, min: 0, max: 10 } }, blocks: [
    { id: 'start', title: '开场', lines: [{ id: 'start-1', speaker: '作者', text: '选择将改变变量。' }], exit: { type: 'choice', choices: [{ id: 'yes', text: '保留信任', next: 'end', effects: [{ op: 'add', key: 'trust', value: 1 }] }] } },
    { id: 'end', title: '结局', lines: [{ id: 'end-1', speaker: '作者', text: '这里等待你的故事。' }], exit: { type: 'end', ending: '完成' } }
  ] } };
  return { ...base, type: 'investigation', chapters: [{ id: 'chapter-1', order: 0, title: '第一章', entryNode: 'room', requiredEvidence: ['note'], evidence: { note: { title: '便笺', detail: '一条等待核对的记录。' } }, nodes: {
    room: { kind: 'investigation', text: '桌上有一张便笺。', location: '房间', time: '', progress: 0, actions: [{ id: 'read', label: '查看便笺', next: 'note', collect: 'note', hidesWhenCollected: 'note' }, { id: 'reason', label: '核对记录', next: 'end', requiresEvidence: ['note'] }] },
    note: { kind: 'evidence', text: '你记下了便笺上的文字。', location: '房间', time: '', progress: 50, actions: [{ id: 'back', label: '返回', next: 'room' }] },
    end: { kind: 'ending', text: '记录已核对。', location: '房间', time: '', progress: 100, actions: [], requiresEvidence: ['note'], outcome: 'complete' }
  } }] };
}
