import { NarrativeEngine } from '../narrative/engine.js';
import type { NarrativeState, Scene } from '../narrative/types.js';
import { InvestigationEngine } from '../investigation/engine.js';
import type { CampaignSession } from '../investigation/types.js';
import { ScriptEngine } from '../script/engine.js';
import type { ScriptState } from '../script/types.js';
import { createSaveCodec, isRecord } from '../storage/save.js';
import { cgAt, presentationAt } from '../presentation/frame.js';
import { currentCue, persistentCue } from '../stage/cues.js';
import type { ReadRecord, RuntimeAction, RuntimeDriver, RuntimeFrame, StageCue } from '../stage/types.js';

export type NarrativeStage = {
  defaults?: StageCue;
  scenes?: Record<string, StageCue>;
  lines?: Record<string, StageCue>;
  speakers?: Record<string, string>;
  presentation?: (scene: Scene, line: number) => { character?: string; expression: string };
};
export class NarrativeDriver implements RuntimeDriver {
  readonly supportsSkip = true;
  readonly supportsReread = true;
  private state: NarrativeState;
  private codec: ReturnType<typeof createSaveCodec>;
  readonly game: string;
  constructor(readonly engine: NarrativeEngine, readonly plan: NarrativeStage = {}, codec = createSaveCodec(engine)) {
    this.game = engine.config.game; this.state = engine.newGame(); this.codec = codec;
  }
  reset() { this.state = this.engine.newGame(); }
  frame(): RuntimeFrame {
    const scene = this.engine.getScene(this.state), line = scene.lines[this.state.line];
    const presentation = this.plan.presentation?.(scene, this.state.line) ?? presentationAt(scene, this.state.line, { speakers: this.plan.speakers ?? {} });
    let stage: StageCue = { ...this.plan.defaults, ...(scene.background ? { background: scene.background } : {}),
      portrait: presentation.character ? `${presentation.character}/${presentation.expression}` : null, cg: cgAt(scene, this.state.line) ?? null,
      ...(scene.music ? { music: scene.music } : {}) };
    stage = persistentCue(stage, this.plan.scenes?.[scene.id]);
    for (let index = 0; index < this.state.line; index++) stage = persistentCue(stage, this.plan.lines?.[scene.lines[index].id ?? `${scene.id}/${index}`]);
    const key = line.id ?? `${scene.id}/${this.state.line}`;
    const cue = { ...(this.state.line === 0 ? this.plan.scenes?.[scene.id] : undefined), ...this.plan.lines?.[key] };
    stage = currentCue(stage, cue);
    if (scene.noSprite) stage.portrait = null;
    const last = this.state.line === scene.lines.length - 1, actions: RuntimeAction[] = [];
    if (last && scene.choices) for (const choice of scene.choices) actions.push({ id: choice.id, label: choice.text, kind: 'choice' });
    if (last && scene.continuation) actions.push({ id: '@continue', label: '继续章节', kind: 'continue' });
    return { id: `${scene.id}/${this.state.line}`, lineId: key, sceneId: scene.id, line: this.state.line,
      title: scene.title ?? scene.id, speaker: line.speaker, text: line.text, mode: line.medium ?? 'vn', stage,
      actions, canAdvance: !last || !(scene.choices || scene.ending || scene.chapterEnd), ending: last ? scene.ending : undefined };
  }
  advance() {
    if (!this.frame().canAdvance) return false;
    const next = this.engine.advance(this.state), changed = next.sceneId !== this.state.sceneId || next.line !== this.state.line;
    if (changed) this.state = next; return changed;
  }
  act(id: string) {
    if (!this.frame().actions.some(action => action.id === id)) return false;
    this.state = id === '@continue' ? this.engine.continueStory(this.state) : this.engine.choose(this.state, id); return true;
  }
  history(includeCurrent = false): ReadRecord[] {
    const history = includeCurrent ? this.engine.recordLine(this.state).history : this.state.history;
    return history.map(record => ({ id: `${record.sceneId}/${record.line}`, lineId: record.id ?? `${record.sceneId}/${record.line}`,
      speaker: record.speaker, text: record.text, sceneId: record.sceneId, line: record.line }));
  }
  reread(id: string) {
    const record = this.history(true).find(item => item.id === id); if (!record) return false;
    this.state = this.engine.reread(this.state, record); return true;
  }
  save(): unknown { return this.codec.encode(this.state); }
  restore(value: unknown) { this.state = this.codec.decode(JSON.stringify(value)).state; }
}

export class ScriptDriver implements RuntimeDriver {
  readonly supportsSkip = true;
  readonly supportsReread = true;
  readonly game: string;
  private state: ScriptState;
  constructor(readonly engine: ScriptEngine, readonly defaults: StageCue = {}) { this.game = engine.program.game; this.state = engine.initial(); }
  reset() { this.state = this.engine.initial(); }
  frame(): RuntimeFrame {
    const block = this.engine.block(this.state), line = block.lines[this.state.line], last = this.state.line === block.lines.length - 1;
    const actions: RuntimeAction[] = last && block.exit.type === 'choice' ? block.exit.choices.map(choice => ({ id: choice.id, label: choice.text, kind: 'choice' })) : [];
    return { id: `${this.state.decisions.length}:${line.id}`, lineId: line.id, sceneId: block.id, line: this.state.line,
      title: block.title ?? block.id, speaker: line.speaker, text: line.text, mode: line.medium ?? 'vn',
      stage: currentCue(persistentCue(this.defaults, this.state.stage), { ...(this.state.line === 0 ? block.cue : undefined), ...line.cue }),
      actions, canAdvance: !last || !['choice', 'end'].includes(block.exit.type), ending: last && block.exit.type === 'end' ? block.exit.ending : undefined };
  }
  advance() {
    if (!this.frame().canAdvance) return false;
    const next = this.engine.advance(this.state), changed = next.blockId !== this.state.blockId || next.line !== this.state.line;
    if (changed) this.state = next; return changed;
  }
  act(id: string) {
    if (!this.frame().actions.some(action => action.id === id)) return false;
    this.state = this.engine.choose(this.state, id); return true;
  }
  history(includeCurrent = false): ReadRecord[] {
    const state = includeCurrent ? this.engine.record(this.state) : this.state;
    return state.history.map(record => ({ id: `${record.choiceCount}:${record.id}`, lineId: record.id, speaker: record.speaker, text: record.text, sceneId: record.blockId, line: record.line }));
  }
  reread(id: string) {
    const record = this.history(true).find(item => item.id === id); if (!record) return false;
    const count = Number(id.slice(0, id.indexOf(':')));
    this.state = this.engine.replay(this.state.decisions.slice(0, count), record.sceneId, record.line); return true;
  }
  save(): unknown { return this.engine.encode(this.state); }
  restore(value: unknown) { this.state = this.engine.decode(JSON.stringify(value)); }
}

type InvestigationCommand = { type: 'action' | 'chapter'; id: string };
export type InvestigationStage = { defaults?: StageCue; nodes?: Record<string, StageCue> };
export class InvestigationDriver implements RuntimeDriver {
  readonly supportsSkip = false;
  readonly supportsReread = false;
  private session: CampaignSession;
  private journal: InvestigationCommand[] = [];
  private records: ReadRecord[] = [];
  constructor(readonly game: string, readonly version: string, readonly engine: InvestigationEngine, readonly plan: InvestigationStage = {}) {
    if (!game || !version) throw new Error('Missing investigation identity'); this.session = engine.newCampaign();
  }
  reset() { this.session = this.engine.newCampaign(); this.journal = []; this.records = []; }
  frame(): RuntimeFrame {
    const state = this.session.state, chapter = this.engine.getChapter(state.chapterId), node = chapter.nodes[state.nodeId];
    const available = this.engine.actions(state), automatic = node.kind === 'dialogue' && available.length === 1 && !available[0].collect && !available[0].resetEvidence;
    const actions: RuntimeAction[] = automatic ? [] : available.map(action => ({ id: action.id, label: action.label, kind: 'action', tone: action.tone }));
    if (node.outcome === 'complete') for (const id of this.engine.unlocked(this.session.completed)) if (id !== chapter.id) actions.push({ id: '@chapter:' + id, label: '进入 ' + this.engine.getChapter(id).title, kind: 'chapter' });
    return { id: `${this.journal.length}:${chapter.id}/${state.nodeId}`, lineId: `${chapter.id}/${state.nodeId}`, sceneId: state.nodeId, line: 0,
      title: chapter.title, speaker: node.speaker ?? (node.kind === 'evidence' ? '证据记录' : '调查记录'), text: node.text,
      mode: ['investigation', 'puzzle', 'choice'].includes(node.kind) ? 'investigation' : node.kind === 'evidence' ? 'document' : 'vn',
      stage: currentCue(this.plan.defaults ?? {}, this.plan.nodes?.[`${chapter.id}/${state.nodeId}`]), actions, canAdvance: automatic,
      ending: node.outcome, hotspots: node.scene?.hotspots,
      evidence: state.evidence.map(id => ({ id, ...chapter.evidence[id] })) };
  }
  private command(command: InvestigationCommand): boolean {
    const frame = this.frame();
    if (command.type === 'chapter') {
      if (!frame.actions.some(action => action.id === '@chapter:' + command.id)) return false;
      this.session = this.engine.startChapter(this.session, command.id);
    } else {
      const next = this.engine.transition(this.session.state, command.id); if (!next) return false;
      this.records.push({ id: `${this.journal.length}:${frame.lineId}`, lineId: frame.lineId, sceneId: frame.sceneId, line: 0, speaker: frame.speaker, text: frame.text });
      this.records = this.records.slice(-200);
      const session = { ...this.session, state: next };
      this.session = this.engine.getChapter(next.chapterId).nodes[next.nodeId].outcome === 'complete' ? this.engine.complete(session) : session;
    }
    this.journal.push(command); return true;
  }
  advance() {
    if (!this.frame().canAdvance) return false;
    return this.command({ type: 'action', id: this.engine.actions(this.session.state)[0].id });
  }
  act(id: string) {
    if (!this.frame().actions.some(action => action.id === id)) return false;
    return id.startsWith('@chapter:') ? this.command({ type: 'chapter', id: id.slice(9) }) : this.command({ type: 'action', id });
  }
  history(includeCurrent = false): ReadRecord[] {
    const frame = this.frame();
    return includeCurrent ? [...this.records, { id: frame.id, lineId: frame.lineId, speaker: frame.speaker, text: frame.text, sceneId: frame.sceneId, line: 0 }] : [...this.records];
  }
  reread(_id: string) { return false; }
  save(): unknown { return { format: 'vn-investigation-save', schema: 1, game: this.game, version: this.version, journal: structuredClone(this.journal) }; }
  restore(value: unknown) {
    if (!isRecord(value) || value.format !== 'vn-investigation-save' || value.schema !== 1 || value.game !== this.game || value.version !== this.version
      || !Array.isArray(value.journal) || value.journal.length > 10000) throw new Error('Invalid investigation save');
    const candidate = new InvestigationDriver(this.game, this.version, this.engine, this.plan);
    for (const item of value.journal) {
      if (!isRecord(item) || !['action', 'chapter'].includes(String(item.type)) || typeof item.id !== 'string'
        || !candidate.command({ type: item.type as 'action' | 'chapter', id: item.id })) throw new Error('Unreachable investigation journal');
    }
    this.session = candidate.session; this.journal = candidate.journal; this.records = candidate.records;
  }
}
