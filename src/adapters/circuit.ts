import { InvestigationEngine } from '../investigation/engine.js';
import type { InvestigationChapter } from '../investigation/types.js';
import { isRecord } from '../storage/save.js';

export const createCircuitEngine = (chapters: readonly InvestigationChapter[]) => new InvestigationEngine(chapters);

/** Read-only bridge for Circuit v1 node saves and v2 campaign saves. No storage write. */
export function decodeCircuitSave(engine: InvestigationEngine, raw: string) {
  if (raw.length > 2_000_000) throw new Error('Save is too large');
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || typeof value.savedAt !== 'string'
    || !Number.isFinite(Date.parse(value.savedAt))) throw new Error('Invalid Circuit save');
  const state = { chapterId: value.chapterId, nodeId: value.nodeId, evidence: value.evidence };
  if (!engine.reachable(state)) throw new Error('Unreachable investigation state');
  const chapter = engine.getChapter(state.chapterId);
  if (chapter.nodes[state.nodeId].kind === 'title' || !Array.isArray(value.history) || !value.history.length || value.history.length > 200
    || value.history.some(id => typeof id !== 'string' || !Object.hasOwn(chapter.nodes, id) || chapter.nodes[id].kind === 'title')
    || value.history.at(-1) !== state.nodeId) throw new Error('Invalid reading history');
  const session = value.version === 2 ? engine.restoreCampaign({ state, completed: value.completed, archive: value.archive }) : undefined;
  return { state, history: [...value.history] as string[], savedAt: value.savedAt, session };
}
