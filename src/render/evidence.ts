import type { RuntimeSession, RuntimeView } from '../runtime/session.js';
import type { RuntimeEffectPhase } from '../runtime/evidence.js';

export type VisualEvidenceAttempt = { effect: string; effectId: string; attempt: number; assetId?: string; view: RuntimeView };

/** Renderer-owned evidence identities; no callbacks, timers, DOM or persistence. */
export class VisualEvidence {
  private serial = 0;
  constructor(private session: RuntimeSession) {}
  begin(effect: string, view: RuntimeView, assetId?: string): VisualEvidenceAttempt | undefined {
    if (!this.session.evidence) return;
    const value = { effect, effectId: `visual-${++this.serial}`, attempt: 0, ...(assetId ? { assetId } : {}), view };
    this.record(value, 'scheduled'); return value;
  }
  record(value: VisualEvidenceAttempt | undefined, phase: RuntimeEffectPhase, code?: string, view = value?.view) {
    if (!value || !view) return;
    this.session.recordEffect({ effect: value.effect, effectId: value.effectId, attempt: value.attempt,
      ...(value.assetId ? { assetId: value.assetId } : {}), phase, ...(code ? { code } : {}) }, view);
  }
}
