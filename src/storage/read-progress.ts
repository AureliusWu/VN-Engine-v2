import { isRecord } from './save.js';
import { writeBatch, type StoragePort, type WriteResult, type LoadResult } from './store.js';
import { validReadSignature } from '../runtime/read.js';

export const MAX_READ_RECORDS = 10_000;
export const MAX_READ_PROGRESS_BYTES = 2_000_000;
const TEXT_BUDGET = 450_000;
export type ReadFlushResult = WriteResult | { status: 'clean' } | { status: 'invalid'; reason: string };

/** Bounded, versioned read markers. No save payload or Meta data is imported into this store. */
export function createReadProgress(game: string, storyVersion: string, storage?: StoragePort | null) {
  if (!game.trim() || !storyVersion.trim()) throw new Error('Read progress requires game and story version');
  const key = `vn-engine:${game}:read:${encodeURIComponent(storyVersion)}`;
  const read = (): LoadResult<string[]> => {
    let raw: string | null;
    try { if (!storage) throw new Error(); raw = storage.getItem(key); }
    catch { return { status: 'unavailable', reason: 'Read progress storage unavailable' }; }
    if (raw === null) return { status: 'empty' };
    try {
      if (raw.length > MAX_READ_PROGRESS_BYTES || new TextEncoder().encode(raw).byteLength > MAX_READ_PROGRESS_BYTES) throw new Error();
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || value.schema !== 1 || value.game !== game || value.storyVersion !== storyVersion
        || !Array.isArray(value.records) || value.records.length > MAX_READ_RECORDS || !value.records.every(validReadSignature)
        || new Set(value.records).size !== value.records.length) throw new Error();
      return { status: 'valid', value: value.records };
    } catch { return { status: 'invalid', reason: 'Invalid read progress retained without modification' }; }
  };
  const initial = read(), records = new Set(initial.status === 'valid' ? initial.value : []), pending = new Set<string>();
  let status: LoadResult<string[]>['status'] = initial.status;
  const compact = (values: Set<string>) => {
    let length = [...values].reduce((sum, item) => sum + item.length, 0);
    while (values.size > MAX_READ_RECORDS || length > TEXT_BUDGET) { const oldest = values.values().next().value!; values.delete(oldest); length -= oldest.length; }
  };
  compact(records);
  return {
    key,
    get count() { return records.size; },
    get dirty() { return pending.size > 0; },
    get status() { return status; },
    has(signature: string) { return records.has(signature); },
    mark(signature: string) {
      if (records.has(signature) || !validReadSignature(signature)) return;
      records.add(signature); pending.add(signature); compact(records); compact(pending);
    },
    flush(): ReadFlushResult {
      if (!pending.size) return { status: 'clean' };
      const incoming = read(); status = incoming.status;
      if (incoming.status === 'invalid') return incoming;
      if (incoming.status === 'unavailable') return { ...incoming, rollbackFailed: false };
      const merged = new Set(incoming.status === 'valid' ? incoming.value : []);
      for (const entry of pending) merged.add(entry); compact(merged);
      const raw = JSON.stringify({ schema: 1, game, storyVersion, records: [...merged] });
      if (new TextEncoder().encode(raw).byteLength > MAX_READ_PROGRESS_BYTES) return { status: 'unavailable', reason: 'Read progress exceeds its byte budget', rollbackFailed: false };
      const result = writeBatch(storage, [[key, raw]]);
      if (result.status === 'saved') { records.clear(); for (const entry of merged) records.add(entry); pending.clear(); status = 'valid'; }
      return result;
    }
  };
}
