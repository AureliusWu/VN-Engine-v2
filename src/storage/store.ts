export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type LoadResult<T> = { status: 'empty' } | { status: 'valid'; value: T }
  | { status: 'invalid'; reason: string } | { status: 'unavailable'; reason: string };
export type WriteResult = { status: 'saved' } | { status: 'unavailable'; reason: string; rollbackFailed: boolean };

/** Adapted from Circuit save failures and Healing/NetLove backup rollback. */
export function createStore<T>(namespace: string, storage: StoragePort | null | undefined, codec: { decode(raw: string): T }) {
  if (!namespace.trim()) throw new Error('Explicit per-game storage namespace is required');
  const keyFor = (slot: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(slot)) throw new Error('Invalid slot');
    return `${namespace}:save:${slot}`;
  };
  return {
    load(slot: string): LoadResult<T> {
      const key = keyFor(slot);
      let raw: string | null;
      try { if (!storage) throw new Error(); raw = storage.getItem(key); }
      catch { return { status: 'unavailable', reason: 'Storage is unavailable; play can continue' }; }
      if (raw === null) return { status: 'empty' };
      try { return { status: 'valid', value: codec.decode(raw) }; }
      catch { return { status: 'invalid', reason: 'Invalid save retained without modification' }; }
    },
    write(slot: string, value: T): WriteResult {
      const raw = JSON.stringify(value);
      codec.decode(raw);
      return writeBatch(storage, [[keyFor(slot), raw]]);
    },
    keyFor
  };
}

/** Best effort rollback is explicit: storage can also reject rollback writes. */
export function writeBatch(storage: StoragePort | null | undefined, writes: readonly (readonly [string, string])[]): WriteResult {
  const previous = new Map<string, string | null>(), changed: string[] = [];
  if (new Set(writes.map(([key]) => key)).size !== writes.length) throw new Error('Duplicate write key');
  try {
    if (!storage) throw new Error();
    for (const [key] of writes) previous.set(key, storage.getItem(key));
    for (const [key, raw] of writes) {
      if (previous.get(key) === raw) continue;
      storage.setItem(key, raw);
      changed.push(key);
    }
    return { status: 'saved' };
  } catch {
    let rollbackFailed = false;
    if (storage) {
      // Free new bytes before restoring old records when the quota is full.
      for (const key of changed) { try { storage.removeItem(key); } catch { rollbackFailed = true; } }
      for (const key of changed) {
        const old = previous.get(key);
        if (old !== null && old !== undefined) try { storage.setItem(key, old); } catch { rollbackFailed = true; }
      }
    }
    return { status: 'unavailable', reason: 'Storage write failed; play can continue', rollbackFailed };
  }
}
