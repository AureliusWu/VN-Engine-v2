import type { StageKeyVisual } from './types.js';

export const KEY_VISUAL_SCENES = ['story', 'title', 'cg', 'transition', 'interstitial', 'special_presentation'] as const;
export function validateKeyVisual(cue: StageKeyVisual): void {
  if (!cue || typeof cue !== 'object' || typeof cue.asset !== 'string' || !cue.asset.trim()
    || !['banner', 'fullscreen'].includes(cue.scope) || !KEY_VISUAL_SCENES.includes(cue.sceneType)
    || !Number.isFinite(cue.durationMs) || cue.durationMs < 100 || cue.durationMs > 30000) throw new Error('Invalid Key Visual scope, scene type or lifetime (100–30000 ms)');
  if (cue.scope === 'fullscreen' && cue.sceneType === 'story') throw new Error('Fullscreen Key Visual requires an explicitly declared presentation scene');
}
