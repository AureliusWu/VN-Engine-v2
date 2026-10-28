import { ENGINE_VERSION } from '../version.js';
import type { EditorDocument } from '../editor/model.js';

export const AGENT_PROTOCOL = 'vn-agent-v1' as const;
export const AGENT_LIMITS = Object.freeze({ inputBytes: 8_000_000, operations: 128, outputBytes: 65_536, defaultOutputBytes: 16_384,
  routeOperations: 20_000, requestMs: 60_000, previewMs: 30_000, assetBytes: 67_108_864, assetTotalBytes: 268_435_456, imports:32, probeFiles:16,probeMs:30000,probePixels:16777216,probeSamples:28800000 });
export type AgentStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED';
export type AgentDiagnostic = { code: string; severity: 'error' | 'warning' | 'info'; message: string; path?: (string | number)[];
  nodeId?: string; chapterId?: string; assetId?: string; operation?: number; expected?: unknown; actual?: unknown };
export type AgentRequest = { protocol: typeof AGENT_PROTOCOL; requestId: string; command: string; project?: string; params: Record<string, any> };
export type AgentIdentity = { game: string; storyVersion: string; sourceSha256: string };
export type AgentArtifact = { kind: string; path: string; sha256?: string };
export type AgentResponse = { protocol: typeof AGENT_PROTOCOL; engineVersion: string; requestId: string; command: string; ok: boolean;
  status: AgentStatus; project: AgentIdentity | null; data: any; diagnostics: AgentDiagnostic[]; artifacts: AgentArtifact[] };
export type AgentCandidate = { document: EditorDocument; sourceText: string; beforeSha256: string | null; afterSha256: string };
export type AgentResult = { response: AgentResponse; candidate?: AgentCandidate; report?: unknown };
export type AgentContext = { source?: string | unknown; signal?: AbortSignal; now?: () => number;
  readAsset?: (path: string) => Promise<Uint8Array>; importsPrepared?: boolean;
  probe?: (request:AgentRequest)=>Promise<{data:any;artifacts:AgentArtifact[];status:AgentStatus;diagnostics:AgentDiagnostic[]}>;
  preview?: (document: EditorDocument, request: AgentRequest, identity: AgentIdentity) => Promise<{ data: any; artifacts: AgentArtifact[] }>;
  build?: (document: EditorDocument, request: AgentRequest, identity: AgentIdentity) => Promise<{ data: any; artifacts: AgentArtifact[] }> };

export class AgentError extends Error {
  constructor(readonly code: string, message: string, readonly details: Partial<AgentDiagnostic> = {}, readonly status: AgentStatus = 'FAIL') { super(message); }
}
export function agentResponse(command = 'unknown', requestId = 'unknown'): AgentResponse {
  return { protocol: AGENT_PROTOCOL, engineVersion: ENGINE_VERSION, command, requestId, ok: true, status: 'PASS', project: null, data: null, diagnostics: [], artifacts: [] };
}
export function failAgent(response: AgentResponse, error: unknown): AgentResponse {
  const failure = error instanceof AgentError ? error : new AgentError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
  response.ok = false; response.status = failure.status;
  response.diagnostics.push({ ...failure.details, code: failure.code, severity: 'error', message: failure.message.slice(0, 2000) }); return response;
}
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export async function sourceHash(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text);
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export const exitCodeFor = (status: AgentStatus) => ({ PASS: 0, FAIL: 1, BLOCKED: 2, UNVERIFIED: 3 })[status];
