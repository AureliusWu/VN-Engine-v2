import type { StageCue } from './types.js';

/** Durable scene state can be reconstructed; one-shot effects never persist. */
export function persistentCue(base: StageCue, cue?: StageCue): StageCue {
  const next = { ...base };
  if (cue) for (const key of ['background', 'portrait', 'cg', 'music', 'ambience', 'document'] as const) {
    if (cue[key] !== undefined) Object.assign(next, { [key]: cue[key] });
  }
  return next;
}
export function currentCue(base: StageCue, cue?: StageCue): StageCue {
  return { ...persistentCue(base, cue), ...(cue?.sound ? { sound: cue.sound } : {}), ...(cue?.voice ? { voice: cue.voice } : {}),
    ...(cue?.effect ? { effect: cue.effect } : {}), ...(cue?.pauseMs !== undefined ? { pauseMs: cue.pauseMs } : {}) };
}
