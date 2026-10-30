import type { AssetKind } from './catalog.js';
import type { EngineProject } from '../runtime/project.js';
import type { RuntimeFrame, StageCue } from '../stage/types.js';
import type { SourceOrigin } from '../source/origin.js';
import { freezeData, type DeepReadonly } from '../runtime/readonly.js';
import { persistentCue, currentCue } from '../stage/cues.js';

export const RESOURCE_PLAN_VERSION = 'vn-resource-plan-v1';
export type ResourcePosition = Partial<Pick<RuntimeFrame, 'sceneId' | 'lineId' | 'line' | 'stage'>> & { chapterId?: string };
export type ResourcePlanOptions = { maxDepth?: number; maxVisits?: number; maxAssets?: number;
  estimates?: Readonly<Record<string, number>>; sourceSha256?: string };
export type ResourcePlanAsset = { assetId: string; kind: AssetKind; src: string; owners: string[]; dependencies: string[];
  origins: SourceOrigin[]; distance: number; estimatedBytes: number | null };
export type ResourcePlan = DeepReadonly<{ contract: typeof RESOURCE_PLAN_VERSION; game: string; storyVersion: string;
  position: { sceneId?: string; lineId?: string; line?: number; chapterId?: string };
  active: ResourcePlanAsset[]; candidates: ResourcePlanAsset[];
  unknown: { assetId?: string; owner: string; reason: string; origin: SourceOrigin }[];
  estimates: { knownBytes: number; unknownAssets: number };
  budget: { maxDepth: number; maxVisits: number; maxAssets: number }; visits: number; truncated: boolean }>;
type Ref = { id: string; kind: AssetKind; path: (string | number)[]; dependencies?: string[] };
type PlannedLine = { id: string; cue?: StageCue; cuePath?: (string | number)[]; refs?: Ref[]; path: (string | number)[] };
type Lines = { length: number; at: (index: number) => PlannedLine | undefined; findId: (id: string) => number };
type Node = { key: string; id: string; chapterId?: string; path: (string | number)[]; cue?: StageCue; cuePath?: (string | number)[];
  lines: Lines; refs?: Ref[]; next: Iterable<string> };

const limit = (value: number | undefined, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw Error('Invalid resource plan budget');
  return value;
};
function cueRefs(cue: StageCue | undefined, path: (string | number)[]): Ref[] {
  if (!cue) return [];
  const refs: Ref[] = [];
  for (const [key, kind] of [['background', 'background'], ['portrait', 'portrait'], ['cg', 'cg'],
    ['music', 'audio'], ['ambience', 'audio'], ['sound', 'audio'], ['voice', 'audio']] as const) {
    const id = cue[key]; if (id) refs.push({ id, kind, path: [...path, key] });
  }
  for (const [key, value] of Object.entries(cue.layers ?? {})) if (value) refs.push({ id: value.asset, kind: value.kind, path: [...path, 'layers', key, 'asset'] });
  if (cue.video) {
    refs.push({ id: cue.video.asset, kind: 'video', path: [...path, 'video', 'asset'], dependencies: cue.video.fallback ? [cue.video.fallback.asset] : [] });
    if (cue.video.fallback) refs.push({ id: cue.video.fallback.asset, kind: cue.video.fallback.kind, path: [...path, 'video', 'fallback', 'asset'] });
  }
  if (cue.keyVisual) refs.push({ id: cue.keyVisual.asset, kind: 'ui', path: [...path, 'keyVisual', 'asset'] });
  return refs;
}

function lazyLines<T>(source: readonly T[], id: (line: T, index: number) => string, make: (line: T, index: number) => PlannedLine): Lines {
  return { length: source.length, at: index => source[index] === undefined ? undefined : make(source[index], index),
    findId: wanted => source.findIndex((line, index) => id(line, index) === wanted) };
}

/** Lazy static graph: normalize only visited nodes/lines, never the full author project. */
function graph(project: EngineProject): { get: (key: string) => Node | undefined; entry: string; defaults?: StageCue } {
  const cache = new Map<string, Node>();
  const make = (key: string): Node | undefined => {
    if (project.type === 'script') {
      const index = project.program.blocks.findIndex(block => block.id === key), block = project.program.blocks[index]; if (!block) return;
      const path = ['program', 'blocks', index], exit = block.exit;
      return { key, id: key, path, cue: block.cue, cuePath: [...path, 'cue'],
        lines: lazyLines(block.lines, line => line.id, (line, i) => ({ id: line.id, cue: line.cue, cuePath: [...path, 'lines', i, 'cue'], path: [...path, 'lines', i] })),
        next: (function* () { if (exit.type === 'jump') yield exit.next;
          else if (exit.type === 'choice') for (const choice of exit.choices) yield choice.next;
          else if (exit.type === 'branch') for (const route of exit.routes) yield route.next; })() };
    }
    if (project.type === 'narrative') {
      const index = project.scenes.findIndex(scene => scene.id === key), scene = project.scenes[index]; if (!scene) return;
      const path = ['scenes', index], refs: Ref[] = [];
      if (scene.background) refs.push({ id: scene.background, kind: 'background', path: [...path, 'background'] });
      if (scene.music) refs.push({ id: scene.music, kind: 'audio', path: [...path, 'music'] });
      return { key, id: key, path, cue: project.stage?.scenes?.[key], cuePath: ['stage', 'scenes', key], refs,
        lines: lazyLines(scene.lines, (line, i) => line.id ?? `${key}/${i}`, (line, i) => {
          const id = line.id ?? `${key}/${i}`, lineRefs: Ref[] = [];
          if (scene.cg && i >= (scene.cgFrom ?? 0)) lineRefs.push({ id: scene.cg, kind: 'cg', path: [...path, 'cg'] });
          const character = project.stage?.speakers?.[line.speaker] ?? scene.character;
          if (character && !scene.noSprite) lineRefs.push({ id: `${character}/${line.expression ?? 'neutral'}`, kind: 'portrait', path: [...path, 'lines', i] });
          return { id, cue: project.stage?.lines?.[id], cuePath: ['stage', 'lines', id], refs: lineRefs, path: [...path, 'lines', i] };
        }), next: (function* () { if (scene.next) yield scene.next; if (scene.continuation) yield scene.continuation;
          for (const choice of scene.choices ?? []) yield choice.next; })() };
    }
    if (project.type === 'investigation') {
      const index = project.chapters.findIndex(chapter => key.startsWith(`${chapter.id}/`)), chapter = project.chapters[index]; if (!chapter) return;
      const id = key.slice(chapter.id.length + 1), node = Object.hasOwn(chapter.nodes, id) ? chapter.nodes[id] : undefined; if (!node) return;
      const path = ['chapters', index, 'nodes', id];
      return { key, id, chapterId: chapter.id, path, cue: project.stage?.nodes?.[key], cuePath: ['stage', 'nodes', key],
        lines: lazyLines([id], () => key, () => ({ id: key, path })),
        next: (function* () { for (const action of node.actions) yield `${chapter.id}/${action.next}`;
          if (node.outcome === 'complete') for (const next of project.chapters) if (next.order > chapter.order) yield `${next.id}/${next.entryNode}`; })() };
    }
    const index = project.story.nodes.findIndex(node => node.id === key || (key.startsWith('@response/') && node.choices?.some(choice => `@response/${node.id}/${choice.id}` === key)));
    const node = project.story.nodes[index]; if (!node) return;
    const path = ['story', 'nodes', index];
    const rainLines = (source: NonNullable<typeof node.lines>, linePath: (string | number)[]) => lazyLines(source, line => line.id, (line, i) => ({
      id: line.id, path: [...linePath, i], refs: [
        ...(line.background ? [{ id: line.background, kind: 'background' as const, path: [...linePath, i, 'background'] }] : []),
        ...(line.bgm ? [{ id: line.bgm, kind: 'audio' as const, path: [...linePath, i, 'bgm'] }] : []),
        ...(line.sound ? [{ id: line.sound, kind: 'audio' as const, path: [...linePath, i, 'sound'] }] : []),
        ...(line.voice ? [{ id: line.voice, kind: 'audio' as const, path: [...linePath, i, 'voice'] }] : []),
        ...(line.expression ? [{ id: `heroine/${line.expression}`, kind: 'portrait' as const, path: [...linePath, i, 'expression'] }] : []) ],
      cue: { ...(line.background ? { background: line.background } : {}), ...(line.bgm ? { music: line.bgm } : {}),
        ...(line.sound ? { sound: line.sound } : {}), ...(line.voice ? { voice: line.voice } : {}),
        ...(line.expression ? { portrait: `heroine/${line.expression}` } : {}), ...(line.stop_ambient ? { ambience: null } : {}) } }));
    if (key !== node.id) {
      const i = node.choices!.findIndex(choice => `@response/${node.id}/${choice.id}` === key), choice = node.choices![i];
      return { key, id: node.id, path: [...path, 'choices', i], lines: rainLines(choice.response ?? [], [...path, 'choices', i, 'response']), next: [choice.next] };
    }
    return { key, id: key, path, lines: rainLines(node.lines ?? [], [...path, 'lines']),
      next: (function* () { if (node.choices) for (const choice of node.choices) yield choice.response?.length ? `@response/${node.id}/${choice.id}` : choice.next;
        else if (node.routes) for (const route of node.routes) yield route.next; else if (node.next) yield node.next; })(),
      refs: [ ...(node.background ? [{ id: node.background, kind: 'background', path: [...path, 'background'] }] : []),
        ...(node.bgm ? [{ id: node.bgm, kind: 'audio', path: [...path, 'bgm'] }] : []),
        ...(node.ambient ? [{ id: node.ambient, kind: 'audio', path: [...path, 'ambient'] }] : []),
        ...(node.sprite ? [{ id: `heroine/${node.sprite}`, kind: 'portrait', path: [...path, 'sprite'] }] : []) ] as Ref[],
      cue: { ...(node.clear_scene ? { background: null, portrait: null, cg: null } : {}),
        ...(node.background ? { background: node.background } : {}), ...(node.bgm ? { music: node.bgm } : {}),
        ...(node.ambient ? { ambience: node.ambient } : {}), ...(node.sprite ? { portrait: `heroine/${node.sprite}` } : {}) } };
  };
  const firstChapter = project.type === 'investigation' ? project.chapters.reduce<(typeof project.chapters)[number] | undefined>((first, chapter) => !first || chapter.order < first.order ? chapter : first, undefined) : undefined;
  return { get: key => { let node = cache.get(key); if (!node) { node = make(key); if (node) cache.set(key, node); } return node; },
    entry: project.type === 'script' ? project.program.entry : project.type === 'rain' ? project.story.entry : project.type === 'narrative'
      ? project.entry ?? (project.adapter ? 'arrival' : project.scenes[0]?.id ?? '') : firstChapter ? `${firstChapter.id}/${firstChapter.entryNode}` : '',
    defaults: project.type === 'script' || project.type === 'rain' ? project.defaults : project.stage?.defaults };
}

/** The plan is advisory, immutable author/runtime evidence; it is never part of a save or the JSON IR. */
export function createResourcePlan(project: EngineProject, position: ResourcePosition = {}, options: ResourcePlanOptions = {}): ResourcePlan {
  const budget = { maxDepth: limit(options.maxDepth, 2, 32), maxVisits: limit(options.maxVisits, 64, 4096), maxAssets: limit(options.maxAssets, 32, 512) };
  if (options.sourceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.sourceSha256)) throw Error('Invalid source SHA256');
  const { get: getNode, entry, defaults } = graph(project);
  const active = new Map<string, ResourcePlanAsset>(), candidates = new Map<string, ResourcePlanAsset>();
  const references = new WeakMap<ResourcePlanAsset, { owners: Set<string>; origins: Set<string> }>();
  const unknown: { assetId?: string; owner: string; reason: string; origin: SourceOrigin }[] = [];
  let truncated = false, visits = 0;
  const origin = (node?: Node, line?: PlannedLine, path?: (string | number)[], assetId?: string): SourceOrigin => ({
    game: project.game, storyVersion: project.version, ...(node ? { nodeId: node.id } : {}), ...(line ? { lineId: line.id } : {}),
    ...(node?.chapterId ? { chapterId: node.chapterId } : {}), ...(assetId ? { assetId } : {}), ...(path ? { path: [...path] } : {}),
    ...(options.sourceSha256 ? { sourceSha256: options.sourceSha256 } : {}) });
  const add = (refs: Ref[], node: Node | undefined, line: PlannedLine | undefined, distance: number, target: Map<string, ResourcePlanAsset>) => {
    const owner = line ? `line:${node?.key}/${line.id}` : node ? `node:${node.key}` : 'project';
    for (const ref of refs) {
      const itemOrigin = origin(node, line, ref.path, ref.id), asset = project.assets.find(asset => asset.id === ref.id);
      if (!asset || asset.kind !== ref.kind) {
        if (unknown.length < budget.maxAssets) unknown.push({ assetId: ref.id, owner, reason: asset ? 'asset-kind-mismatch' : 'missing-asset', origin: itemOrigin });
        else truncated = true;
        continue;
      }
      if (target === candidates && active.has(ref.id)) continue;
      const previous = target.get(ref.id);
      if (previous) {
        const seen = references.get(previous)!, key = JSON.stringify(itemOrigin);
        if (!seen.owners.has(owner)) { seen.owners.add(owner); previous.owners.push(owner); }
        for (const dependency of ref.dependencies ?? []) if (!previous.dependencies.includes(dependency)) previous.dependencies.push(dependency);
        if (!seen.origins.has(key)) { seen.origins.add(key); previous.origins.push(itemOrigin); }
        continue;
      }
      if (target === candidates && candidates.size >= budget.maxAssets) { truncated = true; continue; }
      const estimate = options.estimates?.[asset.id];
      const item: ResourcePlanAsset = { assetId: asset.id, kind: asset.kind, src: asset.src, owners: [owner], dependencies: [...(ref.dependencies ?? [])], origins: [itemOrigin], distance,
        estimatedBytes: Number.isSafeInteger(estimate) && estimate! >= 0 ? estimate! : null };
      references.set(item, { owners: new Set([owner]), origins: new Set([JSON.stringify(itemOrigin)]) });
      target.set(asset.id, item);
    }
  };
  let startKey = position.chapterId && position.sceneId ? `${position.chapterId}/${position.sceneId}` : position.sceneId ?? entry;
  if (project.type === 'investigation' && !getNode(startKey) && position.lineId) startKey = position.lineId;
  let start = getNode(startKey);
  const lineIndex = start && position.lineId ? start.lines.findId(position.lineId) : position.line ?? 0;
  if (!Number.isSafeInteger(lineIndex) || lineIndex < 0 || (start && start.lines.length > 0 && lineIndex >= start.lines.length)) start = undefined;
  const startLine = Math.max(0, lineIndex), current = start?.lines.at(startLine);
  if (project.font) add([{ id: project.font, kind: 'font', path: ['font'] }], undefined, undefined, 0, active);
  if (position.stage) add(cueRefs(position.stage, []).map(ref => ({ ...ref, path: current?.path ?? start?.path ?? [] })), start, current, 0, active);
  if (start) {
    if (!position.stage) {
      let cue = persistentCue(defaults ?? {}, start.cue);
      if (startLine <= budget.maxVisits) for (let i = 0; i < startLine; i++) cue = persistentCue(cue, start.lines.at(i)?.cue);
      else { truncated = true; unknown.push({ owner: `node:${start.key}`, reason: 'active-prefix-exceeds-visit-budget', origin: origin(start, current) }); }
      add(cueRefs(currentCue(cue, { ...(startLine === 0 ? start.cue : {}), ...current?.cue }), []).map(ref => ({ ...ref, path: current?.path ?? start.path })), start, current, 0, active);
      add([...(start.refs ?? []), ...(current?.refs ?? [])], start, current, 0, active);
      if (position.sceneId) unknown.push({ owner: `node:${start.key}`, reason: 'active-stage-unavailable; earlier-route-persistence-unknown', origin: origin(start, current) });
    }
  } else unknown.push({ owner: 'project', reason: 'unknown-position', origin: origin() });
  if (project.type === 'narrative' && (project.stage?.presentation || project.adapter || project.scenes.some(scene => scene.resolve || scene.bridge))) {
    unknown.push({ owner: 'project', reason: 'dynamic-narrative-presentation-or-route-not-evaluated', origin: origin() });
  }
  const queue: { key: string; line: number; depth: number; distance: number }[] = [], seen = new Set<string>();
  const enqueue = (key: string, line: number, depth: number, distance: number) => {
    if (depth > budget.maxDepth || visits + queue.length >= budget.maxVisits) { truncated = true; return false; }
    const identity = `${key}\u0000${line}`;
    if (!seen.has(identity)) { seen.add(identity); queue.push({ key, line, depth, distance }); }
    return true;
  };
  if (start) {
    if (startLine + 1 < start.lines.length) enqueue(start.key, startLine + 1, 0, 1);
    else for (const key of start.next) if (!enqueue(key, 0, 1, 1)) break;
  }
  while (queue.length && visits < budget.maxVisits) {
    const step = queue.shift()!, node = getNode(step.key); visits++;
    if (!node) { if (unknown.length < budget.maxAssets) unknown.push({ owner: `node:${step.key}`, reason: 'missing-target', origin: origin() }); continue; }
    const line = node.lines.at(step.line);
    if (step.line === 0) {
      if (node.cuePath) add(cueRefs(node.cue, node.cuePath), node, undefined, step.distance, candidates);
      add(node.refs ?? [], node, undefined, step.distance, candidates);
      add(cueRefs(defaults, project.type === 'narrative' || project.type === 'investigation' ? ['stage', 'defaults'] : ['defaults']), node, undefined, step.distance, candidates);
    }
    if (line) { if (line.cuePath) add(cueRefs(line.cue, line.cuePath), node, line, step.distance, candidates); add(line.refs ?? [], node, line, step.distance, candidates); }
    if (step.line + 1 < node.lines.length) enqueue(node.key, step.line + 1, step.depth, step.distance + 1);
    else for (const key of node.next) if (!enqueue(key, 0, step.depth + 1, step.distance + 1)) break;
  }
  const listed = [...active.values(), ...candidates.values()];
  return freezeData({ contract: RESOURCE_PLAN_VERSION, game: project.game, storyVersion: project.version,
    position: { ...(position.sceneId ? { sceneId: position.sceneId } : {}), ...(position.lineId ? { lineId: position.lineId } : {}),
      ...(position.line !== undefined ? { line: position.line } : {}), ...(position.chapterId ? { chapterId: position.chapterId } : {}) },
    active: [...active.values()], candidates: [...candidates.values()], unknown,
    estimates: { knownBytes: listed.reduce((sum, asset) => sum + (asset.estimatedBytes ?? 0), 0), unknownAssets: listed.filter(asset => asset.estimatedBytes === null).length },
    budget, visits, truncated });
}
