import { ScriptEngine } from '../script/engine.js';
import type { Condition, ScriptBlock, ScriptChoice, ScriptLine, ScriptProgram, Scalar } from '../script/types.js';
import type { StageCue } from '../stage/types.js';

export type RainLine = { id: string; speaker: string; text: string; background?: string; bgm?: string; sound?: string; stop_ambient?: boolean; expression?: string; voice?: string };
export type RainStory = {
  schema_version: 1; entry: string; initial_state: Record<string, Scalar>;
  state_definitions: Record<string, { type: string; min?: number; max?: number }>;
  nodes: readonly {
    id: string; chapter?: string; lines?: readonly RainLine[]; background?: string; bgm?: string; ambient?: string; sprite?: string; clear_scene?: boolean;
    next?: string; ending?: string; ending_title?: string;
    routes?: readonly { when?: Condition; next: string }[];
    choices?: readonly { id: string; text: string; next: string; effects: Record<string, Scalar>; response?: readonly RainLine[] }[];
  }[];
};
export type RainRuntimeOptions = { game: string; version: string; speakers?: Record<string, string>; portraitPrefix?: string };

/** Compile Rain data to our own interpreter; requires no RenPy SDK or WASM. */
export function compileRainProgram(story: RainStory, options: RainRuntimeOptions): ScriptProgram {
  if (story.schema_version !== 1 || !Array.isArray(story.nodes as unknown)) throw new Error('Unsupported Rain schema');
  const speakers = options.speakers ?? { n: '旁白', h: '许澄', p: '我' }, blocks: ScriptBlock[] = [];
  const portrait = (expression: string) => `${options.portraitPrefix ?? 'heroine'}/${expression}`;
  const lines = (authored: readonly RainLine[] = []): ScriptLine[] => authored.map(line => {
    const cue: StageCue = {};
    if (line.background) cue.background = line.background;
    if (line.bgm) cue.music = line.bgm;
    if (line.sound) cue.sound = line.sound;
    if (line.stop_ambient) cue.ambience = null;
    if (line.expression) cue.portrait = portrait(line.expression);
    if (line.voice) cue.voice = line.voice;
    if (!Object.hasOwn(speakers, line.speaker)) throw new Error('Unknown Rain speaker');
    return { id: line.id, speaker: speakers[line.speaker], text: line.text, cue };
  });
  for (const node of story.nodes) {
    if ([node.next !== undefined, node.ending !== undefined, node.routes !== undefined, node.choices !== undefined].filter(Boolean).length !== 1) throw new Error('Rain node needs exactly one transition');
    const cue: StageCue = { ...(node.clear_scene ? { background: null, portrait: null, cg: null } : {}),
      ...(node.background ? { background: node.background } : {}), ...(node.bgm ? { music: node.bgm } : {}),
      ...(node.ambient ? { ambience: node.ambient } : {}), ...(node.sprite ? { portrait: portrait(node.sprite) } : {}) };
    let exit: ScriptBlock['exit'];
    if (node.choices) {
      const choices: ScriptChoice[] = node.choices.map(choice => {
        const responseId = `@response/${node.id}/${choice.id}`;
        if (choice.response?.length) blocks.push({ id: responseId, lines: lines(choice.response), exit: { type: 'jump', next: choice.next } });
        return { id: choice.id, text: choice.text, next: choice.response?.length ? responseId : choice.next,
          effects: Object.entries(choice.effects).map(([key, value]) => typeof value === 'boolean' ? { op: 'set', key, value } : { op: 'add', key, value }) };
      });
      exit = { type: 'choice', choices };
    } else if (node.routes) exit = { type: 'branch', routes: node.routes };
    else if (node.ending) exit = { type: 'end', ending: node.ending };
    else exit = { type: 'jump', next: node.next! };
    blocks.push({ id: node.id, title: node.ending_title ?? node.chapter, lines: lines(node.lines), cue, exit });
  }
  const variables = Object.fromEntries(Object.entries(story.initial_state).map(([key, initial]) => {
    const definition = story.state_definitions[key];
    if (!definition || definition.type !== (typeof initial === 'boolean' ? 'bool' : 'int')) throw new Error('Invalid Rain state definition');
    return [key, { initial, min: definition.min, max: definition.max }];
  }));
  return { schema: 1, game: options.game, version: options.version, entry: story.entry, variables, blocks };
}
export const createRainRuntime = (story: RainStory, options: RainRuntimeOptions) => new ScriptEngine(compileRainProgram(story, options));
