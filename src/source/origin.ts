import type { EngineProject } from '../runtime/project.js';

export type SourceOrigin = {
  game: string; storyVersion: string; nodeId?: string; lineId?: string; chapterId?: string;
  assetId?: string; path?: (string | number)[]; sourceSha256?: string;
};
export type SourceSelector = {
  sceneId?: string; nodeId?: string; lineId?: string; chapterId?: string;
  assetId?: string; path?: readonly (string | number)[];
};
type Position = Omit<SourceOrigin, 'game' | 'storyVersion' | 'sourceSha256'> & {
  kind: 'root' | 'chapter' | 'node' | 'line' | 'asset'; path: (string | number)[]; runtimeNodeId?: string;
};
const present = (value: string | undefined): value is string => typeof value === 'string' && value.length > 0;
const prefix = (path: readonly (string | number)[], start: readonly (string | number)[]) =>
  start.length <= path.length && start.every((part, index) => part === path[index]);

function authoredPath(project: EngineProject, path: readonly (string | number)[]): boolean {
  if (path.length > 60) return false;
  let value: unknown = project;
  for (const part of path) {
    if ((typeof part !== 'string' && typeof part !== 'number')
      || ['__proto__', 'constructor', 'prototype'].includes(String(part))
      || (typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))
      || value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return false;
    value = (value as Record<string | number, unknown>)[part];
  }
  return true;
}

/** Index stable authored identity, without interpreting story code or allocating runtime state. */
function sourcePositions(project: EngineProject): Position[] {
  const positions: Position[] = [{ kind: 'root', path: [] }];
  project.assets.forEach((asset, index) => positions.push({ kind: 'asset', assetId: asset.id, path: ['assets', index] }));
  if (project.type === 'narrative') project.scenes.forEach((scene, index) => {
    const path = ['scenes', index];
    positions.push({ kind: 'node', nodeId: scene.id, path });
    scene.lines.forEach((line, lineIndex) => positions.push({ kind: 'line', nodeId: scene.id,
      lineId: line.id ?? `${scene.id}/${lineIndex}`, path: [...path, 'lines', lineIndex] }));
  });
  else if (project.type === 'script') project.program.blocks.forEach((block, index) => {
    const path = ['program', 'blocks', index];
    positions.push({ kind: 'node', nodeId: block.id, path });
    block.lines.forEach((line, lineIndex) => positions.push({ kind: 'line', nodeId: block.id,
      lineId: line.id, path: [...path, 'lines', lineIndex] }));
  });
  else if (project.type === 'investigation') project.chapters.forEach((chapter, index) => {
    const path = ['chapters', index];
    positions.push({ kind: 'chapter', chapterId: chapter.id, path });
    for (const nodeId of Object.keys(chapter.nodes)) positions.push({ kind: 'node', chapterId: chapter.id,
      nodeId, lineId: `${chapter.id}/${nodeId}`, path: [...path, 'nodes', nodeId] });
  });
  else project.story.nodes.forEach((node, index) => {
    const path = ['story', 'nodes', index];
    positions.push({ kind: 'node', nodeId: node.id, path });
    node.lines?.forEach((line, lineIndex) => positions.push({ kind: 'line', nodeId: node.id,
      lineId: line.id, path: [...path, 'lines', lineIndex] }));
    node.choices?.forEach((choice, choiceIndex) => choice.response?.forEach((line, lineIndex) => positions.push({
      kind: 'line', nodeId: node.id, runtimeNodeId: `@response/${node.id}/${choice.id}`, lineId: line.id,
      path: [...path, 'choices', choiceIndex, 'response', lineIndex]
    })));
  });
  return positions;
}

/**
 * Build once for an owned project revision; recreate after author edits. No source map is persisted.
 * Missing or ambiguous identity keeps its requested IDs but never fabricates a JSON path.
 */
export function createSourceResolver(project: EngineProject, sourceSha256?: string): (selector?: SourceSelector) => SourceOrigin {
  if (sourceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Invalid source SHA256');
  const game = project.game, storyVersion = project.version, positions = sourcePositions(project);
  const byLine = new Map<string, Position[]>(), byNode = new Map<string, Position[]>(), byChapter = new Map<string, Position[]>(), byAsset = new Map<string, Position[]>();
  const index = (map: Map<string, Position[]>, key: string | undefined, position: Position) => {
    if (key !== undefined) { const bucket = map.get(key); if (bucket) bucket.push(position); else map.set(key, [position]); }
  };
  for (const position of positions) {
    index(byLine, position.lineId, position);
    if (position.kind === 'node') index(byNode, position.nodeId, position);
    if (position.kind === 'chapter') index(byChapter, position.chapterId, position);
    if (position.kind === 'asset') index(byAsset, position.assetId, position);
  }
  return (selector: SourceSelector = {}): SourceOrigin => {
    const nodeId = present(selector.nodeId) ? selector.nodeId : present(selector.sceneId) ? selector.sceneId : undefined;
    const lineId = present(selector.lineId) ? selector.lineId : undefined;
    const chapterId = present(selector.chapterId) ? selector.chapterId : undefined;
    const assetId = present(selector.assetId) ? selector.assetId : undefined;
    const origin: SourceOrigin = { game, storyVersion, ...(nodeId ? { nodeId } : {}), ...(lineId ? { lineId } : {}),
      ...(chapterId ? { chapterId } : {}), ...(assetId ? { assetId } : {}), ...(sourceSha256 ? { sourceSha256 } : {}) };
    const nodeMatches = (position: Position, wanted?: string) => !present(wanted) || position.nodeId === wanted || position.runtimeNodeId === wanted;
    const matches = (position: Position) => nodeMatches(position, selector.nodeId) && nodeMatches(position, selector.sceneId)
      && (!lineId || position.lineId === lineId) && (!chapterId || position.chapterId === chapterId);
    let candidates: Position[];
    if (selector.path !== undefined) {
      if (!authoredPath(project, selector.path)) return origin;
      candidates = positions.filter(position => prefix(selector.path!, position.path) && matches(position)
        && (!(assetId && !nodeId && !lineId && !chapterId) || position.assetId === assetId));
      const longest = Math.max(-1, ...candidates.map(position => position.path.length));
      candidates = candidates.filter(position => position.path.length === longest);
    } else if (lineId) candidates = (byLine.get(lineId) ?? []).filter(matches);
    else if (nodeId) candidates = (byNode.get(nodeId) ?? []).filter(matches);
    else if (chapterId) candidates = (byChapter.get(chapterId) ?? []).filter(matches);
    else if (assetId) candidates = byAsset.get(assetId) ?? [];
    else candidates = positions.filter(position => position.kind === 'root');
    if (candidates.length !== 1) return origin;
    const match = candidates[0];
    return { ...origin, ...(match.nodeId ? { nodeId: match.nodeId } : {}), ...(match.lineId ? { lineId: match.lineId } : {}),
      ...(match.chapterId ? { chapterId: match.chapterId } : {}), ...(match.assetId ? { assetId: match.assetId } : {}),
      path: [...(selector.path ?? match.path)] };
  };
}

/** One-off lookup for tools. Runtime hosts can reuse createSourceResolver for an owned revision. */
export function resolveSourceOrigin(project: EngineProject, selector: SourceSelector = {}, sourceSha256?: string): SourceOrigin {
  return createSourceResolver(project, sourceSha256)(selector);
}
