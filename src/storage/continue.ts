import type { RuntimeSession } from '../runtime/session.js';
import type { createSaveContract, SaveEnvelope } from './contract.js';
import type { LoadResult } from './store.js';

/** Find an actually restorable save without touching the current session or any storage key. */
export function createContinuation<T>(session: RuntimeSession, contract: ReturnType<typeof createSaveContract<T>>, validatePayload: (value: unknown) => T) {
  const latest = (): LoadResult<SaveEnvelope<T>> => {
    const loaded = [contract.loadAuto(), contract.loadQuick(), ...Array.from({ length: contract.manualSlots }, (_, i) => contract.loadManual(i + 1))];
    const slots = ['auto', 'quick', ...Array.from({ length: contract.manualSlots }, (_, i) => `manual-${i + 1}`)];
    let invalid = loaded.some(result => result.status === 'invalid');
    const candidates: SaveEnvelope<T>[] = [];
    loaded.forEach((result, index) => {
      if (result.status !== 'valid') return;
      if (result.value.slot !== slots[index]) { invalid = true; return; }
      candidates.push(result.value);
    });
    candidates.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    for (const candidate of candidates) try {
      return { status: 'valid', value: { ...candidate, payload: validatePayload(structuredClone(candidate.payload)) } };
    } catch { invalid = true; }
    if (loaded.some(result => result.status === 'unavailable')) return { status: 'unavailable', reason: 'Save storage is unavailable' };
    return invalid ? { status: 'invalid', reason: 'No restorable save; original bytes retained' } : { status: 'empty' };
  };
  return {
    latest,
    resume(): LoadResult<SaveEnvelope<T>> {
      const found = latest(); if (found.status === 'valid') session.restore(found.value.payload); return found;
    }
  };
}
