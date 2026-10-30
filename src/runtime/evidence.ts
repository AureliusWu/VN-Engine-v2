import { freezeData, type DeepReadonly } from './readonly.js';

export const RUNTIME_EVIDENCE_CONTRACT = 'vn-runtime-evidence-v1' as const;
export const RUNTIME_EVIDENCE_LIMITS = Object.freeze({ defaultEvents: 512, maxEvents: 4096,
  defaultBytes: 131072, maxBytes: 1048576, maxString: 512 });
export type RuntimeEvidenceOptions = { sessionId: string; sourceSha256?: string; maxEvents?: number; maxBytes?: number };
export type RuntimeEffectPhase = 'scheduled' | 'started' | 'settled' | 'cancelled' | 'failed' | 'suppressed'
  | 'paused' | 'resumed' | 'retained' | 'blocked';
export type RuntimeEvidenceInput = {
  type: 'input' | 'navigation' | 'effect' | 'lifecycle'; visit: number;
  sceneId?: string; lineId?: string; reason?: string;
  input?: string; outcome?: string; actionId?: string; index?: number;
  effect?: string; phase?: RuntimeEffectPhase; effectId?: string; attempt?: number; assetId?: string; code?: string;
};
export type RuntimeEvidenceEvent = RuntimeEvidenceInput & { sequence: number; sessionId: string; sourceSha256?: string };
export type RuntimeEvidenceReport = { contract: typeof RUNTIME_EVIDENCE_CONTRACT; sessionId: string; sourceSha256?: string;
  maxEvents: number; maxBytes: number; events: readonly RuntimeEvidenceEvent[]; bytes: number; dropped: number;
  truncated: boolean; firstSequence: number; nextSequence: number };
export type RuntimeEffectContext = Omit<RuntimeEvidenceInput, 'type' | 'phase'> & { collector?: RuntimeEvidence };

type BufferState = { sessionId: string; sourceSha256?: string; maxEvents: number; maxBytes: number;
  events: { value: RuntimeEvidenceEvent; bytes: number }[]; bytes: number; dropped: number; nextSequence: number };
const buffers = new WeakMap<RuntimeEvidence, BufferState>();
const strings = ['sceneId', 'lineId', 'reason', 'input', 'outcome', 'actionId', 'effect', 'effectId', 'assetId', 'code'] as const;
const phases: readonly string[] = ['scheduled','started','settled','cancelled','failed','suppressed','paused','resumed','retained','blocked'];
const allowed = new Set<string>(['type', 'visit', 'phase', 'index', 'attempt', ...strings]);
const encoder = new TextEncoder();

/** Read data properties only. A diagnostic input cannot invoke getters or toJSON. */
function dataProperties(value: unknown): Record<string, PropertyDescriptor> | undefined {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Object.values(properties).some(property => !Object.hasOwn(property, 'value'))) return;
  return properties;
}
function text(value: unknown, limit: number = RUNTIME_EVIDENCE_LIMITS.maxString): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}
function normalized(input: unknown): RuntimeEvidenceInput | undefined {
  const properties = dataProperties(input); if (!properties || Object.keys(properties).some(key => !allowed.has(key))) return;
  const type = properties.type?.value, visit = properties.visit?.value;
  if (!['input','navigation','effect','lifecycle'].includes(type) || !Number.isSafeInteger(visit) || visit < 0) return;
  const result: RuntimeEvidenceInput = { type, visit };
  for (const key of strings) {
    const value = properties[key]?.value;
    if (value !== undefined) { if (!text(value)) return; result[key] = value; }
  }
  for (const key of ['index','attempt'] as const) {
    const value = properties[key]?.value;
    if (value !== undefined) { if (!Number.isSafeInteger(value) || value < 0) return; result[key] = value; }
  }
  const phase = properties.phase?.value;
  if (phase !== undefined) { if (!phases.includes(phase)) return; result.phase = phase; }
  return result;
}

/** Core writers use this function, never a caller-overridden instance callback. */
export function appendRuntimeEvidence(collector: RuntimeEvidence | undefined, input: RuntimeEvidenceInput): boolean {
  if (!collector) return false;
  const state = buffers.get(collector); if (!state) return false;
  try {
    const sequence = state.nextSequence++;
    const data = normalized(input);
    if (!data) { state.dropped++; return false; }
    const value: RuntimeEvidenceEvent = { ...data, sequence, sessionId: state.sessionId,
      ...(state.sourceSha256 ? { sourceSha256: state.sourceSha256 } : {}) };
    const bytes = encoder.encode(JSON.stringify(value)).byteLength;
    if (bytes > state.maxBytes) { state.dropped++; return false; }
    while (state.events.length >= state.maxEvents || state.bytes + bytes > state.maxBytes) {
      state.bytes -= state.events.shift()!.bytes; state.dropped++;
    }
    Object.freeze(value); state.events.push({ value, bytes }); state.bytes += bytes; return true;
  } catch { state.dropped++; return false; }
}
export function appendRuntimeEffect(context: RuntimeEffectContext | undefined, phase: RuntimeEffectPhase, code?: string): boolean {
  if (!context?.collector) return false;
  const { collector, ...identity } = context;
  return appendRuntimeEvidence(collector, { ...identity, type: 'effect', phase, ...(code ? { code } : {}) });
}

/** Optional bounded pull/drain buffer. It is evidence, never story or save authority. */
export class RuntimeEvidence {
  constructor(options: RuntimeEvidenceOptions) {
    const properties = dataProperties(options);
    if (!properties || Object.keys(properties).some(key => !['sessionId','sourceSha256','maxEvents','maxBytes'].includes(key))) throw Error('Invalid evidence options');
    const sessionId = properties.sessionId?.value, sourceSha256 = properties.sourceSha256?.value;
    const maxEvents = properties.maxEvents?.value ?? RUNTIME_EVIDENCE_LIMITS.defaultEvents;
    const maxBytes = properties.maxBytes?.value ?? RUNTIME_EVIDENCE_LIMITS.defaultBytes;
    if (!text(sessionId, 128) || (sourceSha256 !== undefined && (typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)))
      || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > RUNTIME_EVIDENCE_LIMITS.maxEvents
      || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > RUNTIME_EVIDENCE_LIMITS.maxBytes) throw Error('Invalid evidence identity or budget');
    buffers.set(this, { sessionId, sourceSha256, maxEvents, maxBytes, events: [], bytes: 0, dropped: 0, nextSequence: 1 });
  }
  append(input: RuntimeEvidenceInput): boolean { return appendRuntimeEvidence(this, input); }
  snapshot(): DeepReadonly<RuntimeEvidenceReport> {
    const state = buffers.get(this)!;
    return freezeData({ contract: RUNTIME_EVIDENCE_CONTRACT, sessionId: state.sessionId,
      ...(state.sourceSha256 ? { sourceSha256: state.sourceSha256 } : {}), maxEvents: state.maxEvents, maxBytes: state.maxBytes,
      events: state.events.map(item => ({ ...item.value })), bytes: state.bytes, dropped: state.dropped,
      truncated: state.dropped > 0, firstSequence: state.events[0]?.value.sequence ?? state.nextSequence, nextSequence: state.nextSequence });
  }
  drain(): DeepReadonly<RuntimeEvidenceReport> {
    const report = this.snapshot(), state = buffers.get(this)!;
    state.events = []; state.bytes = 0; return report;
  }
}
