import type { NarrativeState, Decision } from '../narrative/types.js';
import type { NarrativeEngine } from '../narrative/engine.js';

export type Save = { schema: 1; game: string; savedAt: string; state: NarrativeState };
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Native Healing/NetLove envelope. Imported derived fields are never trusted. */
export function createSaveCodec(engine: NarrativeEngine, maxDecisions = 128) {
  const decode = (raw: string): Save => {
    if (raw.length > 2_000_000) throw new Error('Save is too large');
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schema !== 1 || value.game !== engine.config.game || typeof value.savedAt !== 'string'
      || !Number.isFinite(Date.parse(value.savedAt))) throw new Error('Save belongs to another game or schema');
    const state = value.state;
    if (!isRecord(state) || state.schema !== 1 || ![engine.config.storyVersion, ...(engine.config.legacyStoryVersions ?? [])].includes(String(state.storyVersion))
      || typeof state.sceneId !== 'string' || typeof state.line !== 'number' || !Number.isInteger(state.line)
      || !Array.isArray(state.decisions) || state.decisions.length > maxDecisions) throw new Error('Invalid save position or story version');
    const scene = engine.scenes.get(state.sceneId);
    if (!scene || (engine.config.acceptsSavePosition && !engine.config.acceptsSavePosition(String(state.storyVersion), scene))) throw new Error('Story version cannot contain this chapter');
    const decisions: Decision[] = state.decisions.map(item => {
      if (!isRecord(item) || typeof item.sceneId !== 'string' || typeof item.choiceId !== 'string') throw new Error('Invalid route');
      return { sceneId: item.sceneId, choiceId: item.choiceId };
    });
    return { schema: 1, game: engine.config.game, savedAt: value.savedAt,
      state: engine.replay(decisions, state.sceneId, state.line) };
  };
  const encode = (state: NarrativeState, date = new Date()): Save => decode(JSON.stringify({
    schema: 1, game: engine.config.game, savedAt: date.toISOString(), state
  }));
  return { encode, decode };
}
