export interface ReadProgressPort { has(signature: string): boolean; mark(signature: string): void }

/** Exact identity includes the actual speaker and resolved conditional text, not only a line ID. */
export const readSignature = (line: { lineId: string; speaker: string; text: string }) => JSON.stringify([line.lineId, line.speaker, line.text]);

export function validReadSignature(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 450_000) return false;
  try { const fields: unknown = JSON.parse(value); return Array.isArray(fields) && fields.length === 3
    && fields.every(field => typeof field === 'string') && !!fields[0] && JSON.stringify(fields) === value; }
  catch { return false; }
}
