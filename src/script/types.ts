import type { StageCue } from '../stage/types.js';
export type Scalar = number | boolean;
export type Variable = { initial: Scalar; min?: number; max?: number };
export type Condition = Record<string, Scalar | { gte?: number; eq?: Scalar }>;
export type Effect = { op: 'add'; key: string; value: number } | { op: 'set'; key: string; value: Scalar };
export type ScriptLine = { id: string; speaker: string; text: string; medium?: 'chat' | 'call'; cue?: StageCue };
export type ScriptChoice = { id: string; text: string; next: string; effects?: readonly Effect[] };
export type ScriptExit = { type: 'jump'; next: string } | { type: 'choice'; choices: readonly ScriptChoice[] }
  | { type: 'branch'; routes: readonly { when?: Condition; next: string }[] }
  | { type: 'end'; ending: string };
export type ScriptBlock = { id: string; title?: string; lines: readonly ScriptLine[]; cue?: StageCue; exit: ScriptExit };
export type ScriptProgram = { schema: 1; game: string; version: string; entry: string; variables: Record<string, Variable>; blocks: readonly ScriptBlock[] };
export type ScriptDecision = { blockId: string; choiceId: string };
export type ScriptRecord = ScriptLine & { blockId: string; line: number; choiceCount: number };
export type ScriptState = { blockId: string; line: number; variables: Record<string, Scalar>; decisions: ScriptDecision[]; history: ScriptRecord[]; stage: StageCue };
