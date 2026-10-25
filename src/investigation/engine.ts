import { isRecord } from '../storage/save.js';
import type { CampaignSession, InvestigationChapter, InvestigationState, StoryAction, StoryNode } from './types.js';

const owns = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
const matches = (node: StoryNode, evidence: readonly string[]) =>
  (node.requiresEvidence ?? []).every(id => evidence.includes(id)) && !(node.excludesEvidence ?? []).some(id => evidence.includes(id));
const actionsFor = (node: StoryNode, evidence: readonly string[]) => node.actions.filter(action =>
  (action.requiresEvidence ?? []).every(id => evidence.includes(id)) && (!action.hidesWhenCollected || !evidence.includes(action.hidesWhenCollected)));
const apply = (state: InvestigationState, action: StoryAction): InvestigationState => {
  const evidence = action.resetEvidence ? [] : [...state.evidence];
  if (action.collect && !evidence.includes(action.collect)) evidence.push(action.collect);
  return { chapterId: state.chapterId, nodeId: action.next, evidence };
};
const stateKey = (state: InvestigationState) => JSON.stringify([state.nodeId, [...state.evidence].sort()]);

/** Circuit's inventory-aware state machine; cycles are valid investigation loops. */
export class InvestigationEngine {
  readonly chapters: ReadonlyMap<string, InvestigationChapter>;
  readonly order: readonly string[];
  constructor(chapters: readonly InvestigationChapter[], readonly stateBudget = 20000) {
    const map = new Map(chapters.map(chapter => [chapter.id, structuredClone(chapter)]));
    if (!chapters.length || map.size !== chapters.length || !Number.isSafeInteger(stateBudget) || stateBudget < 1) throw new Error('Invalid chapter catalog');
    const sorted = [...chapters].sort((a, b) => a.order - b.order);
    if (sorted.some((chapter, index) => !chapter.id || chapter.order !== index)) throw new Error('Chapters must have contiguous unique order');
    this.chapters = map;
    this.order = sorted.map(chapter => chapter.id);
    for (const chapter of chapters) {
      const errors = this.validateChapter(chapter.id);
      if (errors.length) throw new Error(errors.join('\n'));
    }
  }

  getChapter(id: string): InvestigationChapter {
    const chapter = this.chapters.get(id);
    if (!chapter) throw new Error('Unknown chapter');
    return chapter;
  }
  initial(chapterId = this.order[0]): InvestigationState {
    return { chapterId, nodeId: this.getChapter(chapterId).entryNode, evidence: [] };
  }
  isState(value: unknown): value is InvestigationState {
    if (!isRecord(value) || typeof value.chapterId !== 'string' || typeof value.nodeId !== 'string' || !Array.isArray(value.evidence)) return false;
    const chapter = this.chapters.get(value.chapterId);
    if (!chapter || !owns(chapter.nodes, value.nodeId) || new Set(value.evidence).size !== value.evidence.length) return false;
    if (!value.evidence.every(id => typeof id === 'string' && owns(chapter.evidence, id))) return false;
    return matches(chapter.nodes[value.nodeId], value.evidence as string[]);
  }
  actions(state: InvestigationState): readonly StoryAction[] {
    if (!this.isState(state)) return [];
    return actionsFor(this.getChapter(state.chapterId).nodes[state.nodeId], state.evidence);
  }
  transition(state: InvestigationState, actionId: string): InvestigationState | null {
    const action = this.actions(state).find(item => item.id === actionId);
    if (!action) return null;
    const next = apply(state, action);
    return this.isState(next) ? next : null;
  }

  /** Explore (node, inventory), never just nodes. A revisit can be meaningful. */
  explore(chapterId: string): InvestigationState[] {
    const pending = [this.initial(chapterId)], visited = new Map<string, InvestigationState>();
    while (pending.length) {
      const state = pending.pop()!, key = stateKey(state);
      if (visited.has(key)) continue;
      if (visited.size >= this.stateBudget) throw new Error('Investigation state budget exceeded');
      visited.set(key, state);
      for (const action of this.actions(state)) {
        const next = this.transition(state, action.id);
        if (next) pending.push(next);
      }
    }
    return [...visited.values()];
  }
  reachable(value: unknown): value is InvestigationState {
    return this.isState(value) && this.explore(value.chapterId).some(state => stateKey(state) === stateKey(value));
  }

  validateChapter(chapterId: string): string[] {
    const chapter = this.getChapter(chapterId), errors: string[] = [];
    const hasEvidence = (id: string) => owns(chapter.evidence, id);
    if (!owns(chapter.nodes, chapter.entryNode)) errors.push('Missing chapter entry');
    if (new Set(chapter.requiredEvidence).size !== chapter.requiredEvidence.length) errors.push('Duplicate required evidence');
    if (chapter.requiredEvidence.some(id => !hasEvidence(id))) errors.push('Unknown required evidence');
    for (const [id, node] of Object.entries(chapter.nodes)) {
      if (!node.text?.trim() || !Number.isFinite(node.progress) || node.progress < 0 || node.progress > 100) errors.push(`${id}: invalid node`);
      if (node.outcome && node.kind !== 'ending') errors.push(`${id}: outcome must be an ending`);
      if (node.outcome === 'complete' && !chapter.requiredEvidence.every(item => node.requiresEvidence?.includes(item))) errors.push(`${id}: completion misses required evidence`);
      if (node.kind === 'puzzle' && (!node.puzzle?.prompt.trim() || !node.puzzle?.hint.trim() || node.actions.length < 2)) errors.push(`${id}: invalid puzzle`);
      const constraints = [...(node.requiresEvidence ?? []), ...(node.excludesEvidence ?? [])];
      if (constraints.some(item => !hasEvidence(item))) errors.push(`${id}: unknown evidence constraint`);
      if ((node.requiresEvidence ?? []).some(item => node.excludesEvidence?.includes(item))) errors.push(`${id}: conflicting evidence constraints`);
      const ids = new Set<string>();
      for (const action of node.actions) {
        if (!action.id || ids.has(action.id) || !action.label?.trim()) errors.push(`${id}: invalid action`);
        ids.add(action.id);
        if (!owns(chapter.nodes, action.next)) errors.push(`${id}/${action.id}: missing target`);
        if ([...(action.requiresEvidence ?? []), action.collect, action.hidesWhenCollected].some(item => item !== undefined && !hasEvidence(item))) errors.push(`${id}/${action.id}: unknown evidence`);
        if (action.resetEvidence && action.collect) errors.push(`${id}/${action.id}: reset cannot collect`);
      }
      const hotspots = new Set<string>();
      for (const hotspot of node.scene?.hotspots ?? []) {
        if (!hotspot.id || hotspots.has(hotspot.id) || !ids.has(hotspot.actionId) || !hotspot.label.trim()
          || ![hotspot.x, hotspot.y].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) errors.push(`${id}: invalid hotspot`);
        hotspots.add(hotspot.id);
      }
    }
    if (errors.length) return errors;
    try {
      const states = this.explore(chapterId), visited = new Set(states.map(state => state.nodeId));
      for (const state of states) {
        const node = chapter.nodes[state.nodeId], actions = this.actions(state);
        if (!actions.length && !node.outcome) errors.push(`${state.nodeId}: investigation dead end`);
        for (const action of actions) if (!this.transition(state, action.id)) errors.push(`${state.nodeId}/${action.id}: target inventory gate is violated`);
      }
      for (const [id, node] of Object.entries(chapter.nodes)) if (node.kind !== 'title' && !visited.has(id)) errors.push(`${id}: unreachable node`);
      if (!states.some(state => chapter.nodes[state.nodeId].outcome === 'complete')) errors.push('No reachable complete ending');
    } catch (error) { errors.push(String(error)); }
    return [...new Set(errors)];
  }

  newCampaign(): CampaignSession { return { state: this.initial(), completed: [], archive: {} }; }
  unlocked(completed: readonly string[]): readonly string[] {
    let prefix = 0;
    while (prefix < this.order.length && completed.includes(this.order[prefix])) prefix++;
    return this.order.slice(0, Math.min(prefix + 1, this.order.length));
  }
  /** Completed chapters must form an ordered prefix with reachable evidence proof. */
  restoreCampaign(value: unknown, allowPendingCompletion = false): CampaignSession {
    if (!isRecord(value) || !this.reachable(value.state) || !Array.isArray(value.completed) || value.completed.length > this.order.length
      || value.completed.some((id, index) => id !== this.order[index]) || !isRecord(value.archive)) throw new Error('Invalid campaign');
    const completed = value.completed as string[], archive: Record<string, string[]> = {};
    if (this.order.indexOf(value.state.chapterId) > completed.length) throw new Error('Chapter is locked');
    for (const id of Object.keys(value.archive)) if (!completed.includes(id)) throw new Error('Unknown archive chapter');
    for (const id of completed) {
      const items = value.archive[id];
      if (!Array.isArray(items) || new Set(items).size !== items.length || !items.every(item => typeof item === 'string')) throw new Error('Invalid evidence archive');
      const chapter = this.getChapter(id);
      if (!this.explore(id).some(state => chapter.nodes[state.nodeId].outcome === 'complete'
        && state.evidence.length === items.length && items.every(item => state.evidence.includes(item)))) throw new Error('Archive has no reachable completion proof');
      archive[id] = [...items] as string[];
    }
    const node = this.getChapter(value.state.chapterId).nodes[value.state.nodeId];
    if (!allowPendingCompletion && node.outcome === 'complete' && !completed.includes(value.state.chapterId)) throw new Error('Unrecorded chapter completion');
    return { state: structuredClone(value.state), completed: [...completed], archive };
  }
  complete(session: CampaignSession): CampaignSession {
    const valid = this.restoreCampaign(session, true), chapter = this.getChapter(valid.state.chapterId);
    if (chapter.nodes[valid.state.nodeId].outcome !== 'complete' || !chapter.requiredEvidence.every(id => valid.state.evidence.includes(id))) return valid;
    if (this.order[valid.completed.length] === chapter.id) valid.completed.push(chapter.id);
    // Archive a single reachable inventory, rather than manufacturing a union.
    valid.archive[chapter.id] = [...valid.state.evidence];
    return valid;
  }
  startChapter(session: CampaignSession, id: string): CampaignSession {
    const valid = this.restoreCampaign(session);
    if (!this.unlocked(valid.completed).includes(id)) throw new Error('Chapter is locked');
    return { ...valid, state: this.initial(id) };
  }
}
