export type StageCue = {
  background?: string | null; portrait?: string | null; cg?: string | null;
  music?: string | null; ambience?: string | null; sound?: string; voice?: string;
  effect?: { type: 'fade' | 'flash' | 'shake'; durationMs?: number };
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
