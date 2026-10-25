export type Stats = Record<string, number>;
export type Line = {
  id?: string; speaker: string; text: string; expression?: string;
  medium?: 'chat' | 'call';
  variant?: { stat: string; min: number; text: string };
};
export type Choice = { id: string; text: string; next: string; effect?: Stats };
export type Scene = {
  id: string; lines: readonly Line[]; title?: string; location?: string; time?: string;
  choices?: readonly Choice[]; next?: string; ending?: string; chapterEnd?: boolean;
  continuation?: string; resolve?: boolean; bridge?: boolean;
  character?: string; noSprite?: boolean; background?: string;
  cg?: string; cgFrom?: number; music?: string; chapter?: number;
};
export type Decision = { sceneId: string; choiceId: string };
export type HistoryEntry = Line & { sceneId: string; line: number };
export type NarrativeState = {
  schema: 1; storyVersion: string; sceneId: string; line: number;
  stats: Stats; decisions: Decision[]; history: HistoryEntry[];
};
export type NarrativeConfig = {
  game: string; storyVersion: string; legacyStoryVersions?: readonly string[];
  entry: string; stats: Stats; scenes: readonly Scene[];
  nextFor?: (scene: Scene, stats: Readonly<Stats>) => string | undefined;
  historyLimit?: number; replayLimit?: number;
  acceptsSavePosition?: (version: string, scene: Scene) => boolean;
};
