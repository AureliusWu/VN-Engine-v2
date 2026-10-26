export const STAGE_LAYERS = ['background', 'character-back', 'character', 'character-front', 'cg', 'effect', 'ui'] as const;
export type StageLayer = typeof STAGE_LAYERS[number];
export type StageTransform = { x?: number; y?: number; scale?: number; opacity?: number };
export type StageAnimation = {
  id: string;
  layer: StageLayer;
  target?: string;
  from?: StageTransform;
  to: StageTransform;
  startMs?: number;
  durationMs: number;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
};
export type CameraKeyframe = { atMs: number; x?: number; y?: number; scale?: number };
export type StageVideo = {
  asset: string;
  fallback?: { asset: string; kind: 'background' | 'cg' };
  loop?: boolean;
  muted?: boolean;
};
export type PresentationTimeline = {
  durationMs: number;
  animations?: readonly StageAnimation[];
  camera?: readonly CameraKeyframe[];
};
export type StageCue = {
  background?: string | null; portrait?: string | null; cg?: string | null;
  music?: string | null; ambience?: string | null; sound?: string; voice?: string;
  effect?: { type: 'fade' | 'flash' | 'shake'; durationMs?: number };
  timeline?: PresentationTimeline;
  video?: StageVideo;
  pauseMs?: number;
  document?: { title: string; lines: readonly string[] };
};
export type RuntimeAction = { id: string; label: string; kind: 'choice' | 'continue' | 'action' | 'chapter'; tone?: 'danger' };
export type RuntimeFrame = {
  id: string; lineId: string; sceneId: string; line: number;
  title: string; speaker: string; text: string;
  mode: 'vn' | 'chat' | 'call' | 'investigation' | 'document';
  stage: StageCue; actions: readonly RuntimeAction[]; canAdvance: boolean; ending?: string;
  hotspots?: readonly { id: string; actionId: string; label: string; x: number; y: number }[];
  evidence?: readonly { id: string; title: string; detail: string }[];
};
export type ReadRecord = { id: string; lineId: string; speaker: string; text: string; sceneId: string; line: number };
export interface RuntimeDriver {
  readonly game: string;
  readonly supportsSkip: boolean;
  readonly supportsReread: boolean;
  reset(): void;
  frame(): RuntimeFrame;
  advance(): boolean;
  act(id: string): boolean;
  history(includeCurrent?: boolean): readonly ReadRecord[];
  reread(id: string): boolean;
  save(): unknown;
  restore(value: unknown): void;
}
