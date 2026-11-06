import { readRecovery } from '../lib/editor/index.js';

const LEGACY_DRAFT_KEY = 'vn-engine-studio:draft:v1';
export const LEGACY_DRAFT_ID = 'legacy';
export const DRAFT_LIBRARY_PREFIX = 'vn-engine-studio:draft:v2:';
const WORKSPACE_ID = /^[a-f0-9]{32}$/;

function storageKey(id) {
  if (id === LEGACY_DRAFT_ID) return LEGACY_DRAFT_KEY;
  if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw new Error('无效的草稿标识');
  return DRAFT_LIBRARY_PREFIX + id;
}

export function createDraftLibrary(accessStorage) {
  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function put(id, raw) {
    if (id === LEGACY_DRAFT_ID) throw new Error('旧版本草稿只能读取或删除');
    if (typeof raw !== 'string') throw new Error('草稿必须是恢复文本');
    accessStorage().setItem(storageKey(id), raw);
  }

  function list(excludeId) {
    const storage = accessStorage();
    const ids = new Set([LEGACY_DRAFT_ID]);
    const length = storage.length;
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(DRAFT_LIBRARY_PREFIX)) continue;
      const id = key.slice(DRAFT_LIBRARY_PREFIX.length);
      if (WORKSPACE_ID.test(id)) ids.add(id);
    }

    let corruptCount = 0;
    const ranked = [];
    for (const id of ids) {
      if (id === excludeId) continue;
      const raw = storage.getItem(storageKey(id));
      if (raw === null) continue;
      try {
        const snapshot = readRecovery(raw);
        ranked.push({ entry: { id, raw, snapshot }, time: snapshot.at === undefined ? -Infinity : Date.parse(snapshot.at) });
      } catch {
        corruptCount++;
      }
    }
    ranked.sort((left, right) => (right.time - left.time) || left.entry.id.localeCompare(right.entry.id));
    return { entries: ranked.map(row => row.entry), corruptCount };
  }

  function get(id) {
    return accessStorage().getItem(storageKey(id));
  }

  function remove(id, expectedRaw) {
    if (typeof expectedRaw !== 'string') return false;
    const storage = accessStorage(), key = storageKey(id);
    if (storage.getItem(key) !== expectedRaw) return false;
    storage.removeItem(key);
    return true;
  }

  return { newId, put, list, get, remove };
}
