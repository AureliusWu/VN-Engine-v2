import { NarrativeEngine } from '../narrative/engine.js';
import type { Scene } from '../narrative/types.js';
import { presentationAt } from '../presentation/frame.js';
import { createSaveCodec } from '../storage/save.js';

/** JSON scenes, stable line IDs, chat/call and noSprite keep their native meaning. */
export function createNetLoveEngine(scenes: readonly Scene[]): NarrativeEngine {
  return new NarrativeEngine({ game: 'netlove', storyVersion: 'netlove-v1', entry: 'arrival',
    stats: { honesty: 0, tinghe: 0, xumi: 0 }, scenes });
}
export const createNetLoveSaveCodec = (engine: NarrativeEngine) => createSaveCodec(engine, 24);
export function netlovePresentationAt(scene: Scene, line: number) {
  if (scene.noSprite) return { expression: 'neutral' };
  return presentationAt(scene, line, { speakers: { 谢听禾: 'tinghe', 许弥: 'xumi' } });
}
