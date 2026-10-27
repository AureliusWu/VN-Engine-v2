import { isRecord } from '../storage/save.js';
import { writeBatch, type LoadResult, type StoragePort, type WriteResult } from '../storage/store.js';
import { validateTrueRoutePolicy } from './project.js';

export type MetaState = {
  schema: 1;
  game: string;
  updatedAt: string;
  ending_seen: readonly string[];
  cg_unlocked: readonly string[];
  playthrough_count: number;
  true_route_unlocked: boolean;
};
export type CollectionEntry = { id: string; unlocked: boolean };
export type CollectionProgress = { unlocked: number; total: number; entries: readonly CollectionEntry[] };
export type ReplayContext = { mode: 'replay'; game: string; kind: 'ending' | 'cg'; id: string; startedAt: string };
/** Authored collection metadata; replay is a normal driver save, restored in an isolated session. */
export type CollectionCg = { id: string; title?: string; replay?: unknown };
export type CollectionEnding = { id: string; title?: string; trueEnding?: boolean; replay?: unknown };
/** All declared conditions must hold; unlocking is monotonic and belongs only to Meta. */
export type TrueRoutePolicy = { endings?: readonly string[]; cgs?: readonly string[]; minPlaythroughs?: number };
export type ProjectCollections = { cgs?: readonly CollectionCg[]; endings?: readonly CollectionEnding[]; trueRoute?: TrueRoutePolicy };
export type MetaMutationResult = WriteResult | { status: 'invalid'; reason: string };

function iso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error('Invalid meta collection');
  return [...new Set(value)].sort();
}
function decodeMeta(raw: string, game: string): MetaState {
  if (raw.length > 1_000_000) throw new Error('Meta state is too large');
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.schema !== 1 || value.game !== game || !iso(value.updatedAt)
    || typeof value.playthrough_count !== 'number' || !Number.isInteger(value.playthrough_count) || value.playthrough_count < 0
    || typeof value.true_route_unlocked !== 'boolean') throw new Error('Invalid meta state');
  return Object.freeze({ schema: 1, game, updatedAt: value.updatedAt,
    ending_seen: Object.freeze(uniqueIds(value.ending_seen)), cg_unlocked: Object.freeze(uniqueIds(value.cg_unlocked)),
    playthrough_count: value.playthrough_count, true_route_unlocked: value.true_route_unlocked });
}
function initialMeta(game: string, date = new Date()): MetaState {
  return Object.freeze({ schema: 1, game, updatedAt: date.toISOString(), ending_seen: Object.freeze([]), cg_unlocked: Object.freeze([]), playthrough_count: 0, true_route_unlocked: false });
}
function progress(ids: readonly string[], unlocked: readonly string[]): CollectionProgress {
  const known = [...new Set(ids)].filter(Boolean), have = new Set(unlocked);
  const entries = known.map(id => Object.freeze({ id, unlocked: have.has(id) }));
  return Object.freeze({ unlocked: entries.filter(entry => entry.unlocked).length, total: entries.length, entries: Object.freeze(entries) });
}

export function createMetaStateStore(gameId: string, storage?: StoragePort | null, options: { namespace?: string; endings?: readonly string[]; cgs?: readonly string[]; trueRoute?: TrueRoutePolicy } = {}) {
  const game = gameId.trim();
  if (!game) throw new Error('Meta state requires a game ID');
  const policy = options.trueRoute ? structuredClone(options.trueRoute) : undefined;
  if (policy) validateTrueRoutePolicy(policy);
  const key = `${options.namespace?.trim() || `vn-engine:${game}:v2`}:meta`;
  const read = (): LoadResult<MetaState> => {
    let raw: string | null;
    try { if (!storage) throw new Error(); raw = storage.getItem(key); }
    catch { return { status: 'unavailable', reason: 'Storage is unavailable; meta progress is not persisted' }; }
    if (raw === null) return { status: 'empty' };
    try { return { status: 'valid', value: decodeMeta(raw, game) }; }
    catch { return { status: 'invalid', reason: 'Invalid meta state retained without modification' }; }
  };
  const write = (state: MetaState): WriteResult => {
    const normalized = decodeMeta(JSON.stringify(state), game);
    return writeBatch(storage, [[key, JSON.stringify(normalized)]]);
  };
  const mutate = (change: (state: MetaState) => MetaState): MetaMutationResult => {
    const loaded = read();
    if (loaded.status === 'invalid') return loaded;
    if (loaded.status === 'unavailable') return { status: 'unavailable', reason: loaded.reason, rollbackFailed: false };
    const base = loaded.status === 'valid' ? loaded.value : initialMeta(game);
    let next = change(base);
    if (policy && !next.true_route_unlocked && (policy.endings ?? []).every(id => next.ending_seen.includes(id))
      && (policy.cgs ?? []).every(id => next.cg_unlocked.includes(id)) && next.playthrough_count >= (policy.minPlaythroughs ?? 0)) next = { ...next, true_route_unlocked: true };
    return write(next);
  };
  const next = (state: MetaState, patch: Partial<Pick<MetaState, 'ending_seen' | 'cg_unlocked' | 'playthrough_count' | 'true_route_unlocked'>>): MetaState => decodeMeta(JSON.stringify({
    ...state, ...patch, schema: 1, game, updatedAt: new Date().toISOString()
  }), game);
  return {
    key,
    read,
    reset(): WriteResult { return write(initialMeta(game)); },
    markEndingSeen(id: string): MetaMutationResult {
      if (!id.trim()) throw new Error('Ending ID is required');
      return mutate(state => next(state, { ending_seen: [...state.ending_seen, id] }));
    },
    unlockCg(id: string): MetaMutationResult {
      if (!id.trim()) throw new Error('CG ID is required');
      return mutate(state => next(state, { cg_unlocked: [...state.cg_unlocked, id] }));
    },
    recordPlaythrough(): MetaMutationResult { return mutate(state => next(state, { playthrough_count: state.playthrough_count + 1 })); },
    unlockTrueRoute(): MetaMutationResult { return mutate(state => next(state, { true_route_unlocked: true })); },
    evaluateTrueRoute(): MetaMutationResult { return mutate(state => state); },
    collections(state?: MetaState) {
      const current = state ?? (read().status === 'valid' ? (read() as { status: 'valid'; value: MetaState }).value : initialMeta(game));
      return Object.freeze({ endings: progress(options.endings ?? [], current.ending_seen), cgs: progress(options.cgs ?? [], current.cg_unlocked) });
    },
    replay(kind: 'ending' | 'cg', id: string, date = new Date()): ReplayContext {
      const loaded = read();
      if (loaded.status !== 'valid') throw new Error('Meta state is unavailable for replay');
      const unlocked = kind === 'ending' ? loaded.value.ending_seen : loaded.value.cg_unlocked;
      if (!unlocked.includes(id)) throw new Error('Replay item is locked');
      return Object.freeze({ mode: 'replay', game, kind, id, startedAt: date.toISOString() });
    }
  };
}
