import type { VoiceClip } from './recorded-voice.js';

export type BoundClip = VoiceClip & { sceneId?: string; lineIndex?: number };
/** Stable ID + exact prose bind alternatives; coordinates support legacy Healing. */
export function voiceFor(clips: readonly BoundClip[], line: { id?: string; speaker: string; text: string }, position?: { sceneId: string; line: number }): BoundClip | undefined {
  const matches = clips.filter(clip => clip.speaker === line.speaker && clip.text === line.text
    && (line.id ? clip.lineId === line.id : !!position && clip.sceneId === position.sceneId && clip.lineIndex === position.line));
  return matches.length === 1 ? matches[0] : undefined;
}
