import type { Decision, NarrativeConfig, NarrativeState, Scene } from './types.js';

/** Extracted from Healing/NetLove engine + reread; authored graphs are injected. */
export class NarrativeEngine {
  readonly scenes: ReadonlyMap<string, Scene>;
  readonly config: NarrativeConfig;

  constructor(config: NarrativeConfig) {
    this.config = { ...config, stats: { ...config.stats } };
    const scenes = new Map<string, Scene>();
    for (const scene of config.scenes) {
      if (!scene.id || scenes.has(scene.id) || !scene.lines.length) throw new Error('Duplicate scene or empty dialogue');
      if (scene.lines.some(line => !line.text?.trim())) throw new Error('Empty dialogue');
      if (scene.choices && (!scene.choices.length || new Set(scene.choices.map(c => c.id)).size !== scene.choices.length)) throw new Error('Invalid choices');
      if (scene.choices && (scene.next || scene.ending || scene.chapterEnd || scene.continuation)) throw new Error('Ambiguous choice transition');
      if (scene.ending && scene.next) throw new Error('Ending has an automatic successor');
      scenes.set(scene.id, structuredClone(scene));
    }
    if (!config.game || !config.storyVersion || !scenes.has(config.entry)) throw new Error('Missing game identity or entry');
    for (const scene of scenes.values()) {
      for (const target of [scene.next, scene.continuation, ...(scene.choices ?? []).map(choice => choice.next)]) {
        if (target && !scenes.has(target)) throw new Error(`Missing scene: ${target}`);
      }
      for (const choice of scene.choices ?? []) {
        if (!choice.id || !choice.text?.trim()) throw new Error('Invalid choice');
        for (const [key, amount] of Object.entries(choice.effect ?? {})) {
          if (!Object.hasOwn(config.stats, key) || !Number.isFinite(amount)) throw new Error(`Invalid stat effect: ${key}`);
        }
      }
    }
    if (Object.values(config.stats).some(value => !Number.isFinite(value))) throw new Error('Invalid initial stats');
    for (const limit of [config.historyLimit ?? 1500, config.replayLimit ?? 10000]) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new Error('Invalid runtime budget');
    }
    this.scenes = scenes;
  }

  newGame(): NarrativeState {
    return { schema: 1, storyVersion: this.config.storyVersion, sceneId: this.config.entry,
      line: 0, stats: { ...this.config.stats }, decisions: [], history: [] };
  }

  getScene(state: NarrativeState): Scene {
    const scene = this.scenes.get(state.sceneId);
    if (!scene || !Number.isInteger(state.line) || state.line < 0 || state.line >= scene.lines.length) throw new Error('Invalid story position');
    return { ...scene, lines: scene.lines.map(line => line.variant && state.stats[line.variant.stat] >= line.variant.min
      ? { ...line, text: line.variant.text } : { ...line }) };
  }

  recordLine(state: NarrativeState): NarrativeState {
    const scene = this.getScene(state), last = state.history.at(-1);
    if (last?.sceneId === scene.id && last.line === state.line) return state;
    return { ...state, history: [...state.history, { ...scene.lines[state.line], sceneId: scene.id, line: state.line }]
      .slice(-(this.config.historyLimit ?? 1500)) };
  }

  advance(state: NarrativeState): NarrativeState {
    const scene = this.getScene(state), recorded = this.recordLine(state);
    if (state.line < scene.lines.length - 1) return { ...recorded, line: state.line + 1 };
    if (scene.choices || scene.ending || scene.chapterEnd) return recorded;
    const target = this.config.nextFor ? this.config.nextFor(scene, state.stats) : scene.next;
    if (target && !this.scenes.has(target)) throw new Error(`Missing resolved scene: ${target}`);
    return target ? { ...recorded, sceneId: target, line: 0 } : recorded;
  }

  choose(state: NarrativeState, choiceId: string): NarrativeState {
    const scene = this.getScene(state);
    if (state.line !== scene.lines.length - 1) throw new Error('Choice has not appeared');
    const choice = scene.choices?.find(item => item.id === choiceId);
    if (!choice) throw new Error('Invalid choice');
    const stats = { ...state.stats };
    for (const [key, value] of Object.entries(choice.effect ?? {})) stats[key] += value;
    return { ...this.recordLine(state), sceneId: choice.next, line: 0, stats,
      decisions: [...state.decisions, { sceneId: scene.id, choiceId }] };
  }

  continueStory(state: NarrativeState): NarrativeState {
    const scene = this.getScene(state);
    if (!scene.continuation || state.line !== scene.lines.length - 1 || (!scene.ending && !scene.chapterEnd)) throw new Error('Chapter is not complete');
    return { ...this.recordLine(state), storyVersion: this.config.storyVersion, sceneId: scene.continuation, line: 0 };
  }

  /** Ignore imported history and scores; only declared choices prove a position. */
  replay(decisions: readonly Decision[], sceneId: string, line: number): NarrativeState {
    let state = this.newGame(), index = 0;
    for (let steps = 0; steps < (this.config.replayLimit ?? 10000); steps++) {
      const scene = this.getScene(state);
      if (state.sceneId === sceneId && state.line === line && index === decisions.length) return state;
      if (state.line === scene.lines.length - 1 && scene.choices) {
        const decision = decisions[index++];
        if (!decision || decision.sceneId !== scene.id) throw new Error('Incomplete route');
        state = this.choose(state, decision.choiceId);
      } else {
        const next = scene.continuation && state.line === scene.lines.length - 1 ? this.continueStory(state) : this.advance(state);
        if (next.sceneId === state.sceneId && next.line === state.line) break;
        state = next;
      }
    }
    throw new Error('Unreachable save position or replay budget exceeded');
  }

  reread(state: NarrativeState, target: { sceneId: string; line: number }): NarrativeState {
    const current = this.replay(state.decisions, state.sceneId, state.line);
    if (!this.recordLine(current).history.some(entry => entry.sceneId === target.sceneId && entry.line === target.line)) throw new Error('Paragraph has not been read on this route');
    for (let count = 0; count <= current.decisions.length; count++) {
      try { return this.replay(current.decisions.slice(0, count), target.sceneId, target.line); }
      catch { /* A later choice prefix may be necessary. */ }
    }
    throw new Error('Cannot restore paragraph');
  }
}
