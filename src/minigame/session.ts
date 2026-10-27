import { isRecord } from '../storage/save.js';
import { freezeData, type DeepReadonly } from '../runtime/readonly.js';

export type MiniGameResult = 'success' | 'failure' | 'skip' | 'abort';
export type MiniGameDefinition = {
  id: string; kind: 'switches'; initial: readonly boolean[]; target: readonly boolean[]; maxMoves: number;
  results: { success: string; failure: string; abort: string; skip?: string };
};
export type MiniGameSnapshot = { id: string; phase: 'idle' | 'active' | 'complete'; board: readonly boolean[];
  target: readonly boolean[]; moves: number; maxMoves: number; result?: MiniGameResult; canSkip: boolean; revision: number };

export function validateMiniGame(definition: MiniGameDefinition, actionIds?: readonly string[]): void {
  if (!isRecord(definition) || typeof definition.id !== 'string' || !definition.id.trim() || definition.id.length > 128 || definition.kind !== 'switches'
    || !Array.isArray(definition.initial) || !Array.isArray(definition.target) || definition.initial.length < 1 || definition.initial.length > 9
    || definition.initial.length !== definition.target.length || [...definition.initial, ...definition.target].some(value => typeof value !== 'boolean')
    || definition.initial.every((value, index) => value === definition.target[index])
    || !Number.isSafeInteger(definition.maxMoves) || definition.maxMoves < 1 || definition.maxMoves > 100 || !isRecord(definition.results)) throw new Error('Invalid mini-game definition');
  for (const key of ['success', 'failure', 'abort', 'skip'] as const) {
    const action = definition.results[key]; if (key === 'skip' && action === undefined) continue;
    if (typeof action !== 'string' || !action.trim() || (actionIds && !actionIds.includes(action))) throw new Error(`Mini-game ${key} must map to an available story action`);
  }
}

/** Deterministic v1 adapter: all outcomes are replayed from a bounded input journal. */
export class MiniGameSession {
  private readonly definition: MiniGameDefinition;
  private readonly signature: string;
  private board: boolean[];
  private journal: number[] = [];
  private phase: MiniGameSnapshot['phase'] = 'idle';
  private result?: MiniGameResult;
  private revision = 0;
  private view?: DeepReadonly<MiniGameSnapshot>;
  constructor(definition: MiniGameDefinition) {
    validateMiniGame(definition); this.definition = structuredClone(definition); this.board = [...definition.initial];
    this.signature = JSON.stringify([definition.id, definition.kind, definition.initial, definition.target, definition.maxMoves,
      definition.results.success, definition.results.failure, definition.results.abort, definition.results.skip ?? null]);
  }
  getView(): DeepReadonly<MiniGameSnapshot> { return this.view ??= freezeData({ id: this.definition.id, phase: this.phase, board: [...this.board],
    target: [...this.definition.target], moves: this.journal.length, maxMoves: this.definition.maxMoves, result: this.result, canSkip: !!this.definition.results.skip, revision: this.revision }); }
  private changed() { this.revision++; this.view = undefined; return true; }
  start() { if (this.phase !== 'idle') return false; this.phase = 'active'; return this.changed(); }
  play(index: number) {
    if (this.phase !== 'active' || !Number.isSafeInteger(index) || index < 0 || index >= this.board.length) return false;
    this.board[index] = !this.board[index]; this.journal.push(index);
    if (this.board.every((value, i) => value === this.definition.target[i])) { this.phase = 'complete'; this.result = 'success'; }
    else if (this.journal.length === this.definition.maxMoves) { this.phase = 'complete'; this.result = 'failure'; }
    return this.changed();
  }
  skip() { if (this.phase !== 'active' || !this.definition.results.skip) return false; this.phase = 'complete'; this.result = 'skip'; return this.changed(); }
  abort() { if (this.phase !== 'active') return false; this.phase = 'complete'; this.result = 'abort'; return this.changed(); }
  resultAction() { return this.result ? this.definition.results[this.result] : undefined; }
  save(): unknown { return { format: 'vn-minigame-save', schema: 1, id: this.definition.id, signature: this.signature,
    journal: [...this.journal], phase: this.phase, ...(this.result ? { result: this.result } : {}) }; }
  restore(value: unknown) {
    if (!isRecord(value) || value.format !== 'vn-minigame-save' || value.schema !== 1 || value.id !== this.definition.id || value.signature !== this.signature
      || !Array.isArray(value.journal) || value.journal.length > this.definition.maxMoves || !['idle', 'active', 'complete'].includes(String(value.phase))) throw new Error('Invalid mini-game save');
    const candidate = new MiniGameSession(this.definition);
    if (value.phase !== 'idle') candidate.start();
    for (const input of value.journal) if (typeof input !== 'number' || !candidate.play(input)) throw new Error('Unreachable mini-game input journal');
    if (value.result === 'skip' && !candidate.skip()) throw new Error('Mini-game skip is forbidden');
    if (value.result === 'abort' && !candidate.abort()) throw new Error('Mini-game abort is unavailable');
    if (candidate.phase !== value.phase || candidate.result !== value.result) throw new Error('Forged mini-game outcome');
    this.board = candidate.board; this.journal = candidate.journal; this.phase = candidate.phase; this.result = candidate.result; this.changed();
  }
}
