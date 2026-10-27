import type { StageCue, StageLayer, StagePresentationState } from './types.js';
import { settlePresentationTimeline } from './timeline.js';

/** Durable scene state can be reconstructed; one-shot effects never persist. */
export function persistentCue(base: StageCue, cue?: StageCue): StageCue {
  const next = { ...base };
  delete next.keyVisual;
  let state: StagePresentationState | undefined = base.presentationState ? {
    ...base.presentationState, layers: { ...base.presentationState.layers }
  } : undefined;
  const clearLayer = (layer: StageLayer) => { if (state?.layers) delete state.layers[layer]; };
  if (cue) for (const key of ['background', 'portrait', 'cg', 'music', 'ambience', 'document'] as const) {
    if (cue[key] !== undefined) {
      if (cue[key] !== base[key]) {
        if (key === 'background') clearLayer('background');
        if (key === 'portrait') clearLayer('character');
        if (key === 'cg') clearLayer('cg');
      }
      Object.assign(next, { [key]: cue[key] });
    }
  }
  if (cue?.layers) {
    for (const [layer, asset] of Object.entries(cue.layers)) if (JSON.stringify(asset) !== JSON.stringify(base.layers?.[layer as keyof NonNullable<StageCue['layers']>])) clearLayer(layer as StageLayer);
    next.layers = { ...base.layers, ...cue.layers };
  }
  if (cue?.timeline) {
    const resolved = settlePresentationTimeline(cue.timeline);
    state ??= { layers: {} }; state.layers ??= {};
    const chosen = new Map<StageLayer, { start: number; index: number }>();
    for (const [index, track] of (cue.timeline.animations ?? []).entries()) {
      const prior = chosen.get(track.layer), start = track.startMs ?? 0;
      if (!prior || start >= prior.start) chosen.set(track.layer, { start, index });
    }
    for (const [layer, choice] of chosen) {
      const item = resolved.animations[choice.index]; state.layers[layer] = { target: item.target, transform: item.transform };
    }
    if (cue.timeline.camera?.length) state.camera = resolved.camera;
  }
  if (state) next.presentationState = state;
  return next;
}
export function currentCue(base: StageCue, cue?: StageCue): StageCue {
  const durable = cue ? { ...cue, timeline: undefined, video: undefined } : undefined;
  return { ...persistentCue(base, durable), ...(cue?.sound ? { sound: cue.sound } : {}), ...(cue?.voice ? { voice: cue.voice } : {}),
    ...(cue?.effect ? { effect: cue.effect } : {}), ...(cue?.timeline ? { timeline: cue.timeline } : {}),
    ...(cue?.video ? { video: cue.video } : {}), ...(cue?.keyVisual ? { keyVisual: cue.keyVisual } : {}), ...(cue?.pauseMs !== undefined ? { pauseMs: cue.pauseMs } : {}) };
}
