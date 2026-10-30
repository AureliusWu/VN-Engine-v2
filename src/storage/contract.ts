import type { RuntimeSession } from '../runtime/session.js';
import { isRecord } from './save.js';
import { createStore, type LoadResult, type StoragePort, type WriteResult } from './store.js';

export type SaveSummary = { title?: string; sceneId?: string; lineId?: string; label?: string };
export type SaveEnvelope<T = unknown> = {
  schema: 2;
  save_version: number;
  game: string;
  game_version: string;
  slot: string;
  savedAt: string;
  payload: T;
  summary?: SaveSummary;
};
export type SaveMigration = { from: number; to: number; migrate(value: unknown): unknown };
export type SaveContractOptions<T> = {
  game: string;
  gameVersion: string;
  storage?: StoragePort | null;
  namespace?: string;
  manualSlots?: number;
  saveVersion?: number;
  legacyGameVersions?: readonly string[];
  migrations?: readonly SaveMigration[];
  validatePayload?: (value: unknown) => T;
};

function integer(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value); }
function iso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function summary(value: unknown): SaveSummary | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Invalid save summary');
  const result: SaveSummary = {};
  for (const key of ['title', 'sceneId', 'lineId', 'label'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('Invalid save summary');
    if (typeof value[key] === 'string') result[key] = value[key];
  }
  return result;
}

export function createSaveMigrationRegistry(currentVersion: number, migrations: readonly SaveMigration[] = []) {
  if (!integer(currentVersion) || currentVersion < 1) throw new Error('Invalid current save version');
  const steps = new Map<number, SaveMigration>();
  for (const migration of migrations) {
    if (!integer(migration.from) || !integer(migration.to) || migration.from < 1 || migration.to !== migration.from + 1 || migration.to > currentVersion)
      throw new Error('Save migrations must advance exactly one version');
    if (steps.has(migration.from)) throw new Error(`Duplicate save migration from v${migration.from}`);
    steps.set(migration.from, migration);
  }
  return {
    currentVersion,
    upgrade(value: unknown): unknown {
      let current = value;
      if (!isRecord(current)) throw new Error('Invalid save envelope');
      let version = integer(current.save_version) ? current.save_version : current.schema === 1 ? 1 : NaN;
      if (!integer(version) || version < 1 || version > currentVersion) throw new Error('Unsupported save version');
      while (version < currentVersion) {
        const migration = steps.get(version);
        if (!migration) throw new Error(`Missing save migration v${version} -> v${version + 1}`);
        current = migration.migrate(structuredClone(current));
        if (!isRecord(current) || current.save_version !== migration.to) throw new Error('Save migration returned an invalid version');
        version = migration.to;
      }
      return current;
    }
  };
}

export function createSaveContract<T = unknown>(options: SaveContractOptions<T>) {
  const game = options.game.trim(), gameVersion = options.gameVersion.trim();
  if (!game || !gameVersion) throw new Error('Save contract requires game and gameVersion');
  const manualSlots = options.manualSlots ?? 6;
  if (!integer(manualSlots) || manualSlots < 1 || manualSlots > 99) throw new Error('manualSlots must be between 1 and 99');
  const saveVersion = options.saveVersion ?? 2;
  const migrations = createSaveMigrationRegistry(saveVersion, options.migrations);
  const acceptedGameVersions = new Set([gameVersion, ...(options.legacyGameVersions ?? [])]);
  const validatePayload = options.validatePayload ?? ((value: unknown) => value as T);
  const namespace = options.namespace?.trim() || `vn-engine:${game}:v2`;

  const decode = (raw: string): SaveEnvelope<T> => {
    if (raw.length > 4_000_000) throw new Error('Save is too large');
    let value: unknown = JSON.parse(raw);
    value = migrations.upgrade(value);
    if (!isRecord(value) || value.schema !== 2 || value.save_version !== saveVersion || value.game !== game
      || typeof value.game_version !== 'string' || !acceptedGameVersions.has(value.game_version)
      || typeof value.slot !== 'string' || !/^(manual-[1-9][0-9]?|quick|auto)$/.test(value.slot) || !iso(value.savedAt))
      throw new Error('Save belongs to another game, version, slot, or schema');
    const payload = validatePayload(value.payload);
    return { schema: 2, save_version: saveVersion, game, game_version: value.game_version, slot: value.slot,
      savedAt: value.savedAt, payload, summary: summary(value.summary) };
  };
  const store = createStore<SaveEnvelope<T>>(namespace, options.storage, { decode });
  const manualSlot = (index: number) => {
    if (!integer(index) || index < 1 || index > manualSlots) throw new Error(`Manual slot must be between 1 and ${manualSlots}`);
    return `manual-${index}`;
  };
  const envelope = (slot: string, payload: T, saveSummary?: SaveSummary, date = new Date()): SaveEnvelope<T> => decode(JSON.stringify({
    schema: 2, save_version: saveVersion, game, game_version: gameVersion, slot, savedAt: date.toISOString(), payload, summary: saveSummary
  }));
  const write = (slot: string, payload: T, saveSummary?: SaveSummary, date?: Date): WriteResult => store.write(slot, envelope(slot, payload, saveSummary, date));
  const load = (slot: string): LoadResult<SaveEnvelope<T>> => {
    const result = store.load(slot);
    // A structurally valid envelope may still be misplaced or migrated into another slot.
    return result.status === 'valid' && result.value.slot !== slot
      ? { status: 'invalid', reason: 'Stored envelope does not match its slot; original bytes retained' }
      : result;
  };

  return {
    game, gameVersion, saveVersion, manualSlots, namespace,
    decode, envelope,
    keyFor: store.keyFor,
    saveManual(index: number, payload: T, saveSummary?: SaveSummary, date?: Date) { return write(manualSlot(index), payload, saveSummary, date); },
    loadManual(index: number): LoadResult<SaveEnvelope<T>> { return load(manualSlot(index)); },
    saveQuick(payload: T, saveSummary?: SaveSummary, date?: Date) { return write('quick', payload, saveSummary, date); },
    loadQuick(): LoadResult<SaveEnvelope<T>> { return load('quick'); },
    saveAuto(payload: T, saveSummary?: SaveSummary, date?: Date) { return write('auto', payload, saveSummary, date); },
    loadAuto(): LoadResult<SaveEnvelope<T>> { return load('auto'); }
  };
}

export function bindSessionPersistence<T = unknown>(session: RuntimeSession, contract: ReturnType<typeof createSaveContract<T>>) {
  const capture = () => session.save() as T;
  const restore = (result: LoadResult<SaveEnvelope<T>>) => {
    if (result.status === 'valid') session.restore(result.value.payload);
    return result;
  };
  const frameSummary = (): SaveSummary => {
    const frame = session.getView().frame;
    return { title: frame.title, sceneId: frame.sceneId, lineId: frame.lineId };
  };
  return {
    saveManual(index: number) { return contract.saveManual(index, capture(), frameSummary()); },
    loadManual(index: number) { return restore(contract.loadManual(index)); },
    quickSave() { return contract.saveQuick(capture(), frameSummary()); },
    quickLoad() { return restore(contract.loadQuick()); },
    autoSave() { return contract.saveAuto(capture(), frameSummary()); },
    autoLoad() { return restore(contract.loadAuto()); },
    contract
  };
}
