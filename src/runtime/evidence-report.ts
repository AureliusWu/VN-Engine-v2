import type { EngineProject } from './project.js';
import { RUNTIME_EVIDENCE_CONTRACT, RUNTIME_EVIDENCE_LIMITS, type RuntimeEvidenceEvent, type RuntimeEvidenceReport } from './evidence.js';
import { freezeData, type DeepReadonly } from './readonly.js';
import { createSourceResolver, type SourceOrigin } from '../source/origin.js';

export const MAX_RUNTIME_EVIDENCE_DOCUMENT_BYTES = 4_000_000;
export type RuntimeEvidenceScope = { runtime: boolean; media: boolean; audioDevice: boolean; persistenceWrites: false; exhaustive: false };
export type RuntimeEvidenceDocument = Omit<RuntimeEvidenceReport, 'events'> & {
  schema: 1; game: string; storyVersion: string; scope: RuntimeEvidenceScope;
  events: readonly (RuntimeEvidenceEvent & { origin?: SourceOrigin })[];
};
const hash = /^[a-f0-9]{64}$/;
const eventFields = new Set(['type','visit','sceneId','lineId','reason','input','outcome','actionId','index','effect','phase','effectId','attempt','assetId','code','sequence','sessionId','sourceSha256','origin']);
const phases = new Set(['scheduled','started','settled','cancelled','failed','suppressed','paused','resumed','retained','blocked']);
const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Own JSON data only: importing diagnostics must never invoke accessors/toJSON. */
function copyData(input: unknown, depth = 0, budget = { nodes: 500_000, chars: MAX_RUNTIME_EVIDENCE_DOCUMENT_BYTES }): any {
  if (--budget.nodes < 0 || depth > 20) throw Error('Evidence exceeds structural budget');
  if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string') { budget.chars -= input.length; if (budget.chars < 0) throw Error('Evidence exceeds text budget'); return input; }
  if (!input || typeof input !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(input))) throw Error('Evidence must be JSON data');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.values(descriptors).some(d => !Object.hasOwn(d, 'value')) || Reflect.ownKeys(input).some(key => typeof key !== 'string')) throw Error('Evidence accessors are not data');
  if (Array.isArray(input)) {
    if (input.length > 10_000 || Object.keys(descriptors).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) throw Error('Invalid evidence array');
    return Array.from({ length: input.length }, (_, i) => {
      if (!descriptors[i]) throw Error('Sparse evidence array');
      return copyData(descriptors[i].value, depth + 1, budget);
    });
  }
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (['__proto__','prototype','constructor'].includes(key) || key.length > 512) throw Error('Invalid evidence field');
    output[key] = copyData(descriptor.value, depth + 1, budget);
  }
  return output;
}
function validate(input: unknown): RuntimeEvidenceDocument {
  const value = copyData(input);
  if (!record(value) || value.schema !== 1 || value.contract !== RUNTIME_EVIDENCE_CONTRACT || !text(value.game) || !text(value.storyVersion)
    || !text(value.sessionId, 128) || (value.sourceSha256 !== undefined && !hash.test(value.sourceSha256))
    || !integer(value.maxEvents, 1, RUNTIME_EVIDENCE_LIMITS.maxEvents) || !integer(value.maxBytes, 256, RUNTIME_EVIDENCE_LIMITS.maxBytes)
    || !Array.isArray(value.events) || value.events.length > value.maxEvents || !integer(value.bytes, 0, value.maxBytes)
    || !integer(value.dropped) || value.truncated !== (value.dropped > 0) || !integer(value.firstSequence, 1) || !integer(value.nextSequence, 1)) throw Error('Invalid runtime evidence report');
  const topFields = new Set(['schema','contract','game','storyVersion','sessionId','sourceSha256','maxEvents','maxBytes','events','bytes','dropped','truncated','firstSequence','nextSequence','scope']);
  if (Object.keys(value).some(key => !topFields.has(key))) throw Error('Unknown evidence report field');
  const scope = value.scope;
  if (!record(scope) || Object.keys(scope).some(key => !['runtime','media','audioDevice','persistenceWrites','exhaustive'].includes(key))
    || ['runtime','media','audioDevice'].some(key => typeof scope[key] !== 'boolean') || scope.persistenceWrites !== false || scope.exhaustive !== false
    || scope.audioDevice && !scope.media) throw Error('Invalid evidence scope');
  let previous = 0, bytes = 0;
  for (const event of value.events) {
    if (!record(event) || Object.keys(event).some(key => !eventFields.has(key)) || !['input','navigation','effect','lifecycle'].includes(event.type)
      || !integer(event.visit) || !integer(event.sequence, 1) || event.sequence <= previous || event.sequence >= value.nextSequence
      || event.sessionId !== value.sessionId || event.sourceSha256 !== undefined && event.sourceSha256 !== value.sourceSha256) throw Error('Invalid evidence event identity');
    for (const [key, item] of Object.entries(event)) {
      if (['origin','visit','sequence','sessionId','sourceSha256','type'].includes(key)) continue;
      if (['index','attempt'].includes(key) ? !integer(item) : !text(item)) throw Error('Invalid evidence event field');
    }
    if (event.phase !== undefined && !phases.has(event.phase)) throw Error('Invalid effect phase');
    if (event.origin !== undefined) {
      if (!record(event.origin) || Object.keys(event.origin).some(key => !['game','storyVersion','nodeId','lineId','chapterId','assetId','path','sourceSha256'].includes(key))) throw Error('Invalid event origin');
      for (const [key, item] of Object.entries(event.origin)) {
        if (key === 'path') {
          if (!Array.isArray(item) || item.length > 60 || item.some(part => !text(part) && !integer(part))) throw Error('Invalid source path');
        } else if (!text(item)) throw Error('Invalid source origin');
      }
    }
    const { origin: _origin, ...raw } = event;
    bytes += utf8(raw); previous = event.sequence;
  }
  if (bytes !== value.bytes || value.firstSequence !== (value.events[0]?.sequence ?? value.nextSequence)
    || utf8(value) > MAX_RUNTIME_EVIDENCE_DOCUMENT_BYTES) throw Error('Evidence byte/sequence budget mismatch');
  return value as RuntimeEvidenceDocument;
}

/** A data report is a claim, never a trusted acceptance or a save payload. */
export function readRuntimeEvidenceReport(value: unknown): DeepReadonly<RuntimeEvidenceDocument> {
  return freezeData(validate(value));
}
function locateReport(snapshot: DeepReadonly<RuntimeEvidenceReport>, game: string, storyVersion: string, sha: string | undefined,
  scope: Partial<Pick<RuntimeEvidenceScope, 'runtime' | 'media' | 'audioDevice'>>, resolveOrigin: (event: RuntimeEvidenceEvent) => SourceOrigin) {
  const header = { ...snapshot, schema: 1, game, storyVersion,
    ...(sha ? { sourceSha256: sha } : {}), events: [] as (RuntimeEvidenceEvent & { origin: SourceOrigin })[], bytes: 0,
    scope: { runtime: scope.runtime ?? true, media: scope.media ?? false, audioDevice: scope.audioDevice ?? false, persistenceWrites: false as const, exhaustive: false as const } };
  // Origins can be larger than the original event. Keep a contiguous latest window,
  // including a visible loss count, instead of rejecting a legitimate full buffer.
  let available = MAX_RUNTIME_EVIDENCE_DOCUMENT_BYTES - utf8(header) - 128;
  for (let i = snapshot.events.length - 1; i >= 0; i--) {
    const { origin: _origin, ...raw } = snapshot.events[i] as RuntimeEvidenceEvent & { origin?: SourceOrigin };
    const event = { ...raw, origin: resolveOrigin(raw) }, size = utf8(event) + 1;
    if (size > available) break;
    available -= size; header.events.push(event); header.bytes += utf8(raw);
  }
  header.events.reverse(); header.dropped += snapshot.events.length - header.events.length;
  header.truncated = header.dropped > 0; header.firstSequence = header.events[0]?.sequence ?? header.nextSequence;
  return readRuntimeEvidenceReport(header);
}
export function createRuntimeEvidenceReport(project: EngineProject, snapshot: DeepReadonly<RuntimeEvidenceReport>, sourceSha256?: string,
  scope: Partial<Pick<RuntimeEvidenceScope, 'runtime' | 'media' | 'audioDevice'>> = {}): DeepReadonly<RuntimeEvidenceDocument> {
  if (sourceSha256 !== undefined && !hash.test(sourceSha256)) throw Error('Invalid source SHA');
  if (sourceSha256 && snapshot.sourceSha256 && sourceSha256 !== snapshot.sourceSha256) throw Error('Evidence source binding changed');
  const sha = snapshot.sourceSha256 ?? sourceSha256;
  return locateReport(snapshot, project.game, project.version, sha, scope, createSourceResolver(project, sha));
}
export function assessRuntimeEvidenceReport(project: EngineProject, sourceSha256: string, input: unknown) {
  if (!hash.test(sourceSha256)) throw Error('Invalid current source SHA');
  const imported = readRuntimeEvidenceReport(input);
  const binding = imported.game !== project.game || imported.storyVersion !== project.version ? 'stale'
    : !imported.sourceSha256 ? 'unbound' : imported.sourceSha256 === sourceSha256 ? 'current' : 'stale';
  const resolveOrigin = binding === 'current' ? createSourceResolver(project, imported.sourceSha256) : undefined;
  const report = locateReport(imported, imported.game, imported.storyVersion, imported.sourceSha256, imported.scope, event =>
    resolveOrigin ? resolveOrigin(event) : {
      game: imported.game, storyVersion: imported.storyVersion,
      ...(event.sceneId ? { nodeId: event.sceneId } : {}), ...(event.lineId ? { lineId: event.lineId } : {}),
      ...(event.assetId ? { assetId: event.assetId } : {}), ...(imported.sourceSha256 ? { sourceSha256: imported.sourceSha256 } : {})
    });
  return { binding, current: binding === 'current', externalClaim: true as const, report, scope: imported.scope };
}
