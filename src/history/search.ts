/** Search a supplied, already-read record set. Never look up the story graph here. */
export type ReplayEntry = { speaker?: string | null; text: string; context?: string };

export function normalizeHistoryText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function historySpeakers(entries: readonly ReplayEntry[]): string[] {
  return Array.from(new Set(entries.map(entry => entry.speaker || '旁白')));
}

/** Preserve order, repeated visits and original record identities for voice replay. */
export function filterHistory<T extends ReplayEntry>(entries: readonly T[], query = '', speaker = ''): T[] {
  const terms = normalizeHistoryText(query).split(' ').filter(Boolean);
  return entries.filter(entry => {
    const who = entry.speaker || '旁白';
    if (speaker && who !== speaker) return false;
    const text = normalizeHistoryText(`${who} ${entry.text} ${entry.context || ''}`);
    return terms.every(term => text.includes(term));
  });
}
