import type { EngineProject } from '../runtime/project.js';
import type { TrueRoutePolicy } from './state.js';

/** Includes authored terminal outcomes, without guessing dynamic route reachability. */
export function projectEndings(project: EngineProject): string[] {
  const ids = new Set<string>();
  if (project.type === 'narrative') for (const scene of project.scenes) { if (scene.ending) ids.add(scene.ending); }
  if (project.type === 'script') for (const block of project.program.blocks) { if (block.exit.type === 'end') ids.add(block.exit.ending); }
  if (project.type === 'rain') for (const node of project.story.nodes) { if (node.ending) ids.add(node.ending); }
  if (project.type === 'investigation') for (const chapter of project.chapters) for (const node of Object.values(chapter.nodes)) {
    if (node.outcome) ids.add(`${chapter.id}:${node.outcome}`);
  }
  return [...ids].sort();
}

export function validateTrueRoutePolicy(policy: TrueRoutePolicy): void {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Invalid true-route policy');
  for (const ids of [policy.endings, policy.cgs]) if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)) throw new Error('Invalid true-route requirement IDs');
  if (policy.minPlaythroughs !== undefined && (!Number.isSafeInteger(policy.minPlaythroughs) || policy.minPlaythroughs < 1)) throw new Error('Invalid true-route playthrough count');
  if (!policy.endings?.length && !policy.cgs?.length && policy.minPlaythroughs === undefined) throw new Error('True-route policy requires at least one condition');
}
