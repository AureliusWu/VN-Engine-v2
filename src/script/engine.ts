import { isRecord } from '../storage/save.js';
import { persistentCue } from '../stage/cues.js';
import type { Condition, Scalar, ScriptBlock, ScriptDecision, ScriptProgram, ScriptState } from './types.js';

/** Data-only instruction interpreter. Authored JSON never becomes JavaScript. */
export class ScriptEngine {
  readonly program: ScriptProgram;
  readonly blocks: ReadonlyMap<string, ScriptBlock>;
  constructor(program: ScriptProgram, readonly budget = 30000) {
    if (!isRecord(program) || program.schema !== 1 || !program.game || !program.version || !Array.isArray(program.blocks)
      || !isRecord(program.variables) || !Number.isSafeInteger(budget) || budget < 1 || budget > 100000) throw new Error('Invalid script program');
    this.program = structuredClone(program);
    const blocks = new Map<string, ScriptBlock>(), lines = new Set<string>();
    for (const [key, definition] of Object.entries(program.variables)) {
      if (!key || !isRecord(definition) || !['number', 'boolean'].includes(typeof definition.initial)) throw new Error('Invalid variable');
      this.checkValue(key, definition.initial);
    }
    for (const block of this.program.blocks) {
      if (!block.id || blocks.has(block.id) || !Array.isArray(block.lines) || !isRecord(block.exit)) throw new Error('Invalid or duplicate block');
      blocks.set(block.id, block);
      for (const line of block.lines) {
        if (!line.id || lines.has(line.id) || !line.speaker || !line.text?.trim()) throw new Error('Invalid or duplicate script line');
        lines.add(line.id);
      }
      if (!block.lines.length && !['jump', 'branch'].includes(block.exit.type)) throw new Error('Only routing blocks may omit dialogue');
    }
    if (!blocks.has(program.entry)) throw new Error('Missing script entry');
    this.blocks = blocks;
    for (const block of blocks.values()) {
      const exit = block.exit;
      let targets: string[] = [];
      if (exit.type === 'jump') targets = [exit.next];
      else if (exit.type === 'choice') {
        const ids = new Set<string>();
        if (!Array.isArray(exit.choices) || !exit.choices.length) throw new Error('Missing choices');
        for (const choice of exit.choices) {
          if (!choice.id || ids.has(choice.id) || !choice.text?.trim()) throw new Error('Invalid choice');
          ids.add(choice.id); targets.push(choice.next);
          for (const effect of choice.effects ?? []) {
            if (!Object.hasOwn(program.variables, effect.key) || !['add', 'set'].includes(effect.op)) throw new Error('Invalid effect');
            if (effect.op === 'add') {
              if (typeof program.variables[effect.key].initial !== 'number' || !Number.isFinite(effect.value)) throw new Error('Invalid numeric effect');
            } else this.checkValue(effect.key, effect.value);
          }
        }
      } else if (exit.type === 'branch') {
        if (!Array.isArray(exit.routes) || !exit.routes.length || Object.keys(exit.routes.at(-1)!.when ?? {}).length) throw new Error('Branch needs a final fallback');
        for (const [index, route] of exit.routes.entries()) {
          if (index < exit.routes.length - 1 && !Object.keys(route.when ?? {}).length) throw new Error('Early unconditional branch');
          this.validateCondition(route.when ?? {}); targets.push(route.next);
        }
      } else if (exit.type !== 'end' || !exit.ending) throw new Error('Unknown script instruction');
      if (targets.some(target => !blocks.has(target))) throw new Error(`Missing block target: ${block.id}`);
    }
    // Resolve the entry once to reject immediate routing loops during authoring.
    this.initial();
  }

  private checkValue(key: string, value: Scalar) {
    const definition = this.program.variables[key];
    if (!definition || typeof value !== typeof definition.initial || (typeof value === 'number' && (!Number.isFinite(value)
      || (definition.min !== undefined && (!Number.isFinite(definition.min) || value < definition.min))
      || (definition.max !== undefined && (!Number.isFinite(definition.max) || value > definition.max))))) throw new Error(`Variable outside declared type/bounds: ${key}`);
  }
  private validateCondition(condition: Condition) {
    if (!isRecord(condition)) throw new Error('Invalid condition');
    for (const [key, rule] of Object.entries(condition)) {
      if (!Object.hasOwn(this.program.variables, key)) throw new Error('Unknown condition variable');
      if (isRecord(rule)) {
        if (!Object.keys(rule).length || Object.keys(rule).some(op => !['gte', 'eq'].includes(op))) throw new Error('Unknown condition operator');
        if (Object.hasOwn(rule, 'gte') && (typeof this.program.variables[key].initial !== 'number' || typeof rule.gte !== 'number' || !Number.isFinite(rule.gte))) throw new Error('Invalid gte condition');
        if (Object.hasOwn(rule, 'eq') && (typeof rule.eq !== typeof this.program.variables[key].initial || (typeof rule.eq === 'number' && !Number.isFinite(rule.eq)))) throw new Error('Invalid eq condition');
      } else if (typeof rule !== typeof this.program.variables[key].initial || (typeof rule === 'number' && !Number.isFinite(rule))) throw new Error('Invalid condition value');
    }
  }
  private matches(condition: Condition, variables: Record<string, Scalar>): boolean {
    return Object.entries(condition).every(([key, rule]) => typeof rule === 'object'
      ? (rule.eq === undefined || variables[key] === rule.eq) && (rule.gte === undefined || (variables[key] as number) >= rule.gte)
      : variables[key] === rule);
  }
  private enter(state: ScriptState, blockId: string): ScriptState {
    const seen = new Set<string>();
    let stage = state.stage;
    for (let count = 0; count < this.budget; count++) {
      const block = this.blocks.get(blockId);
      if (!block) throw new Error('Unknown script block');
      stage = persistentCue(stage, block.cue);
      if (block.lines.length) return { ...state, blockId, line: 0, stage };
      if (seen.has(blockId)) throw new Error('Routing loop has no interaction');
      seen.add(blockId);
      if (block.exit.type === 'jump') blockId = block.exit.next;
      else if (block.exit.type === 'branch') blockId = block.exit.routes.find(route => this.matches(route.when ?? {}, state.variables))!.next;
      else throw new Error('Unrenderable script block');
    }
    throw new Error('Script routing budget exceeded');
  }
  initial(): ScriptState {
    const variables = Object.fromEntries(Object.entries(this.program.variables).map(([key, definition]) => [key, definition.initial]));
    return this.enter({ blockId: this.program.entry, line: 0, variables, decisions: [], history: [], stage: {} }, this.program.entry);
  }
  block(state: ScriptState): ScriptBlock {
    const block = this.blocks.get(state.blockId);
    if (!block || !Number.isSafeInteger(state.line) || state.line < 0 || state.line >= block.lines.length) throw new Error('Invalid script position');
    return block;
  }
  record(state: ScriptState): ScriptState {
    const line = this.block(state).lines[state.line], last = state.history.at(-1);
    if (last?.id === line.id && last.choiceCount === state.decisions.length) return state;
    return { ...state, stage: persistentCue(state.stage, line.cue), history: [...state.history, { ...line, blockId: state.blockId, line: state.line, choiceCount: state.decisions.length }].slice(-2000) };
  }
  advance(state: ScriptState): ScriptState {
    const block = this.block(state), recorded = this.record(state);
    if (state.line < block.lines.length - 1) return { ...recorded, line: state.line + 1 };
    const exit = block.exit;
    if (exit.type === 'jump') return this.enter(recorded, exit.next);
    if (exit.type === 'branch') return this.enter(recorded, exit.routes.find(route => this.matches(route.when ?? {}, state.variables))!.next);
    return recorded;
  }
  choose(state: ScriptState, choiceId: string): ScriptState {
    const block = this.block(state);
    if (state.line !== block.lines.length - 1 || block.exit.type !== 'choice') throw new Error('Choice is not available');
    const choice = block.exit.choices.find(item => item.id === choiceId);
    if (!choice) throw new Error('Unknown choice');
    const variables = { ...state.variables };
    for (const effect of choice.effects ?? []) {
      variables[effect.key] = effect.op === 'add' ? (variables[effect.key] as number) + effect.value : effect.value;
      this.checkValue(effect.key, variables[effect.key]);
    }
    return this.enter({ ...this.record(state), variables, decisions: [...state.decisions, { blockId: block.id, choiceId }] }, choice.next);
  }
  replay(decisions: readonly ScriptDecision[], blockId: string, line: number): ScriptState {
    let state = this.initial(), index = 0;
    for (let count = 0; count < this.budget; count++) {
      const block = this.block(state);
      if (index === decisions.length && state.blockId === blockId && state.line === line) return state;
      if (state.line === block.lines.length - 1 && block.exit.type === 'choice') {
        const decision = decisions[index++];
        if (!decision || decision.blockId !== block.id) throw new Error('Incomplete script route');
        state = this.choose(state, decision.choiceId);
      } else {
        const next = this.advance(state);
        if (next.blockId === state.blockId && next.line === state.line) break;
        state = next;
      }
    }
    throw new Error('Unreachable script position or replay budget exceeded');
  }
  decode(raw: string): ScriptState {
    if (raw.length > 2_000_000) throw new Error('Save is too large');
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.format !== 'vn-script-save' || value.schema !== 1 || value.game !== this.program.game || value.version !== this.program.version
      || !isRecord(value.state) || typeof value.state.blockId !== 'string' || !Number.isSafeInteger(value.state.line)
      || !Array.isArray(value.state.decisions) || value.state.decisions.length > 256) throw new Error('Incompatible script save');
    const decisions = value.state.decisions.map(decision => {
      if (!isRecord(decision) || typeof decision.blockId !== 'string' || typeof decision.choiceId !== 'string') throw new Error('Invalid script route');
      return { blockId: decision.blockId, choiceId: decision.choiceId };
    });
    return this.replay(decisions, value.state.blockId, value.state.line as number);
  }
  encode(state: ScriptState): unknown {
    const canonical = this.replay(state.decisions, state.blockId, state.line);
    return { format: 'vn-script-save', schema: 1, game: this.program.game, version: this.program.version,
      state: { blockId: canonical.blockId, line: canonical.line, decisions: canonical.decisions } };
  }
}
