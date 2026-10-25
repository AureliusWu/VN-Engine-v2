import type { Line, Scene } from '../narrative/types.js';
export type PresentationPolicy = {
  speakers: Readonly<Record<string, string>>;
  canAppear?: (character: string, line: Line, scene: Scene) => boolean;
};

/** Recompute presentation from the authored prefix after load/skip/history. */
export function presentationAt(scene: Scene, lineIndex: number, policy: PresentationPolicy) {
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= scene.lines.length) throw new Error('Invalid presentation position');
  let character = scene.noSprite ? undefined : scene.character;
  const expressions = new Map<string, string>();
  if (!scene.noSprite) for (const line of scene.lines.slice(0, lineIndex + 1)) {
    const speaker = Object.hasOwn(policy.speakers, line.speaker) ? policy.speakers[line.speaker] : undefined;
    if (speaker && (!policy.canAppear || policy.canAppear(speaker, line, scene))) {
      character = speaker;
      if (line.expression) expressions.set(speaker, line.expression);
    }
  }
  return { character, expression: character ? expressions.get(character) ?? 'neutral' : 'neutral' };
}

export function cgAt(scene: Scene, line: number): string | undefined {
  return scene.cg && line >= (scene.cgFrom ?? 0) ? scene.cg : undefined;
}

export function reachedCg(scene: Scene, history: readonly { sceneId: string; line: number }[], current?: number) {
  const reached = Math.max(current ?? -1, ...history.filter(item => item.sceneId === scene.id).map(item => item.line));
  return cgAt(scene, reached);
}
