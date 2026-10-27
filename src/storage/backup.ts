import { isRecord } from './save.js';
import { writeBatch, type StoragePort, type WriteResult } from './store.js';
import type { createSaveContract, SaveEnvelope, SaveSummary } from './contract.js';
import { freezeData, type DeepReadonly } from '../runtime/readonly.js';

export const MAX_SAVE_BACKUP_SIZE = 16_000_000;
const oversized = (raw: string) => raw.length > MAX_SAVE_BACKUP_SIZE || new TextEncoder().encode(raw).byteLength > MAX_SAVE_BACKUP_SIZE;
export type SaveBackupPreview = DeepReadonly<{
  game: string; createdAt: string;
  slots: { slot: string; savedAt: string; gameVersion: string; summary?: SaveSummary; replaces: 'empty' | 'valid' | 'invalid' }[];
}>;
export type BackupWriteResult = WriteResult | { status: 'conflict'; reason: string };

/** Only explicit game slots enter an archive. Meta/settings/other storage keys are never enumerated. */
export function createSaveBackup<T>(contract: ReturnType<typeof createSaveContract<T>>, storage: StoragePort | null | undefined,
  validatePayload: (value: unknown) => T) {
  const slots = [...Array.from({ length: contract.manualSlots }, (_, index) => `manual-${index + 1}`), 'quick', 'auto'];
  const allowed = new Set(slots);
  type Plan = { writes: [string, string][]; previous: [string, string | null][] };
  const prepared = new WeakMap<SaveBackupPreview, Plan>();
  const read = (slot: string) => {
    if (!storage) throw new Error('Save storage is unavailable');
    return storage.getItem(contract.keyFor(slot));
  };
  const verified = (value: unknown): SaveEnvelope<T> => {
    const envelope = contract.decode(JSON.stringify(value));
    if (!allowed.has(envelope.slot)) throw new Error('Backup contains an unsupported slot');
    // The validator must replay in an isolated runtime, never the current player.
    const payload = validatePayload(structuredClone(envelope.payload));
    return contract.decode(JSON.stringify({ ...envelope, payload }));
  };
  return {
    export(date = new Date()): string {
      const entries: SaveEnvelope<T>[] = [];
      for (const slot of slots) {
        const raw = read(slot); if (raw === null) continue;
        if (raw.length > 4_000_000) throw new Error(`Cannot export oversized slot: ${slot}`);
        const envelope = verified(JSON.parse(raw));
        if (envelope.slot !== slot) throw new Error('Stored envelope does not match its slot');
        entries.push(envelope);
      }
      if (!entries.length) throw new Error('No saved slots to export');
      const raw = JSON.stringify({ format: 'VN_ENGINE_SAVE_BACKUP', version: 1, game: contract.game, createdAt: date.toISOString(), slots: entries });
      if (oversized(raw)) throw new Error('Save backup is too large');
      return raw;
    },
    preview(raw: string): SaveBackupPreview {
      if (oversized(raw)) throw new Error('Save backup is too large');
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || value.format !== 'VN_ENGINE_SAVE_BACKUP' || value.version !== 1 || value.game !== contract.game
        || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
        || !Array.isArray(value.slots) || !value.slots.length || value.slots.length > slots.length) throw new Error('Invalid or incompatible save backup');
      const found = new Set<string>(), plan: Plan = { writes: [], previous: [] };
      const descriptions = value.slots.map(item => {
        const envelope = verified(item), slot = envelope.slot;
        if (found.has(slot)) throw new Error('Duplicate backup slot'); found.add(slot);
        const key = contract.keyFor(slot), previous = read(slot);
        let replaces: 'empty' | 'valid' | 'invalid' = 'empty';
        if (previous !== null) {
          try { contract.decode(previous); const old = verified(JSON.parse(previous)); replaces = old.slot === slot ? 'valid' : 'invalid'; }
          catch { replaces = 'invalid'; }
        }
        plan.writes.push([key, JSON.stringify(envelope)]); plan.previous.push([key, previous]);
        return { slot, savedAt: envelope.savedAt, gameVersion: envelope.game_version, summary: envelope.summary, replaces };
      });
      const preview = freezeData({ game: contract.game, createdAt: value.createdAt, slots: descriptions });
      prepared.set(preview, plan); return preview;
    },
    commit(preview: SaveBackupPreview): BackupWriteResult {
      const plan = prepared.get(preview);
      if (!plan) throw new Error('Unknown or already consumed backup preview');
      prepared.delete(preview);
      // Detect changes between preview and confirmation. StoragePort cannot provide cross-tab atomic transactions.
      try {
        if (!storage) throw new Error();
        for (const [key, previous] of plan.previous) if (storage.getItem(key) !== previous) return { status: 'conflict', reason: 'A slot changed after preview; preview the backup again' };
      } catch { return { status: 'unavailable', reason: 'Storage is unavailable', rollbackFailed: false }; }
      return writeBatch(storage, plan.writes);
    }
  };
}
