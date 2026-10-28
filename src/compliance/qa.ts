import { assessAiAcceptance, type AcceptanceOptions, type AcceptanceAssessment } from './acceptance.js';
import type { EngineProject } from '../runtime/project.js';
import { isRecord } from '../storage/save.js';

export const QA_CATEGORIES = ['story', 'text', 'visualIntegration', 'audio', 'accessibility', 'web', 'pwa', 'windows'] as const;
export type QaCategory = typeof QA_CATEGORIES[number];
export type QaReview = { status: 'PASS' | 'FAIL' | 'UNVERIFIED'; reviewer: string; reviewedAt: string; evidence: string };
export type QaEvidence = Partial<Record<QaCategory, QaReview>>;
export type QaGateReport = { contract: 'GALGAME_SPEC-v0.2-qa-draft'; release: 'PASS' | 'BLOCKED';
  acceptance?: AcceptanceAssessment; reviewMode?: 'ai-simulated';
  checks: readonly { category: QaCategory; required: boolean; status: 'PASS' | 'FAIL' | 'UNVERIFIED' | 'N/A'; review?: QaReview }[]; issues: readonly string[] };
const known = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/^(?:unverified|unknown|未知|待核实)$/i.test(value.trim());

/** Declared human acceptance, kept separate from file checks and browser probes. */
export function assessDeclaredQaEvidence(project: EngineProject, options: { requiresPwa?: boolean } = {}): QaGateReport {
  const evidence = isRecord(project.releaseEvidence?.qa) ? project.releaseEvidence.qa : {}, targets = project.releaseEvidence?.targets;
  const targetKnown = !!targets && ['mobile', 'pwa', 'desktop'].every(key => typeof (targets as any)[key] === 'boolean');
  const required: Record<QaCategory, boolean> = { story: true, text: true, visualIntegration: true, accessibility: true,
    audio: project.assets.some(asset => asset.kind === 'audio' || asset.kind === 'video'),
    web: !targetKnown || !!targets?.mobile || !!targets?.pwa || !targets?.desktop,
    pwa: !targetKnown || !!targets?.pwa || options.requiresPwa === true, windows: !targetKnown || !!targets?.desktop };
  const issues: string[] = [];
  const checks = QA_CATEGORIES.map(category => {
    const value = evidence[category]; let status: QaGateReport['checks'][number]['status'] = required[category] ? 'UNVERIFIED' : 'N/A';
    if (required[category] && isRecord(value)) {
      if (value.status === 'FAIL') status = 'FAIL';
      else if (value.status === 'PASS' && known(value.reviewer) && known(value.evidence)
        && typeof value.reviewedAt === 'string' && Number.isFinite(Date.parse(value.reviewedAt))) status = 'PASS';
    }
    if (required[category] && status !== 'PASS') issues.push(`Human QA ${category} is ${status}; reviewer, date and evidence are required.`);
    return Object.freeze({ category, required: required[category], status, ...(isRecord(value) ? { review: structuredClone(value) as QaReview } : {}) });
  });
  return Object.freeze({ contract: 'GALGAME_SPEC-v0.2-qa-draft', release: issues.length ? 'BLOCKED' : 'PASS', checks: Object.freeze(checks), issues: Object.freeze(issues) });
}
export class ReleaseQaGateError extends Error {
  constructor(readonly report: QaGateReport) { super('Release blocked by source-bound AI content or technical QA gate'); this.name = 'ReleaseQaGateError'; }
}

/** Current release policy. Historical human declarations remain readable, but cannot approve new content. */
export function assessQaEvidence(project: EngineProject, options: AcceptanceOptions & { requiresPwa?: boolean } = {}): QaGateReport {
  const acceptance = assessAiAcceptance(project, options);
  const checks = QA_CATEGORIES.map(category => {
    const result = acceptance.checks.find(c => c.key === category);
    return { category, required: !!result, status: result?.status ?? 'N/A' } as const;
  });
  return { contract: 'GALGAME_SPEC-v0.2-qa-draft', reviewMode: 'ai-simulated', release: acceptance.status,
    checks, acceptance, issues: acceptance.issues };
}
