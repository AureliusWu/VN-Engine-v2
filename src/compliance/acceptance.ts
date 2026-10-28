import type { EngineProject } from '../runtime/project.js';
import { schemaErrors } from '../schema/validate.js';
import { REVIEW_BINDING_SCHEMA, captureReviewBinding, reviewSourceHash, type ReviewBinding } from '../creative/feedback.js';
import { ENGINE_VERSION } from '../version.js';

export const AI_ACCEPTANCE_CONTRACT = 'vn-ai-acceptance-v1' as const;
export const AI_REVIEW_RUBRIC = 'r4-1' as const;
export const ACCEPTANCE_CATEGORIES = ['story', 'text', 'visualIntegration', 'audio', 'accessibility', 'web', 'pwa', 'windows', 'art', 'master'] as const;
export type AcceptanceCategory = typeof ACCEPTANCE_CATEGORIES[number];
export type AcceptanceStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type AcceptanceInput = { id: string; kind: 'project' | 'image' | 'audio' | 'screenshot' | 'routes' | 'test-report';
  src: string; sha256: string; assetId?: string; width?: number; height?: number };
export type AcceptanceReview = { id: string; category: AcceptanceCategory; target?: string; status: AcceptanceStatus;
  mode: 'ai-simulated' | 'automated'; model: string; modalities: ('text' | 'image' | 'audio')[];
  reviewedAt: string; coverage: 'full' | 'sampled'; rationale: string; evidenceIds: string[];
  findings: { severity: 'error' | 'warning' | 'info'; location: string; message: string; resolved: boolean }[] };
export type AiAcceptanceDocument = { contract: typeof AI_ACCEPTANCE_CONTRACT; schema: 1; game: string; storyVersion: string;
  engineVersion: string; rubricVersion: typeof AI_REVIEW_RUBRIC; binding: ReviewBinding; inputs: AcceptanceInput[];
  reviews: AcceptanceReview[]; supersedesSha256?: string; fixture?: boolean };
export type AcceptanceContext = { sourceText: string; binding: ReviewBinding;
  verifiedInputs: (AcceptanceInput & { status?: AcceptanceStatus; categories?: string[]; platform?: string })[] };
export type AcceptanceOptions = { acceptance?: unknown; acceptanceContext?: AcceptanceContext };
export type AcceptanceCheck = { key: string; status: AcceptanceStatus; reason: string;
  mode?: string; model?: string; reviewedAt?: string };
export type AcceptanceAssessment = { contract: typeof AI_ACCEPTANCE_CONTRACT; policy: 'ai-simulated'; status: 'PASS' | 'BLOCKED';
  checks: AcceptanceCheck[]; issues: string[]; scope: { sourceBound: boolean; actualFiles: boolean; evidenceBound: boolean;
    modelIdentityAuthenticated: false; fixture: boolean } };

const string = { type: 'string', minLength: 1, maxLength: 4096 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const shape = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const inputSchema = shape({ id: string, kind: { enum: ['project', 'image', 'audio', 'screenshot', 'routes', 'test-report'] },
  src: string, sha256: hash, assetId: string, width: { type: 'integer', minimum: 1, maximum: 16384 },
  height: { type: 'integer', minimum: 1, maximum: 16384 } }, ['id', 'kind', 'src', 'sha256']);
const reviewSchema = shape({ id: string, category: { enum: ACCEPTANCE_CATEGORIES }, target: string,
  status: { enum: ['PASS', 'FAIL', 'UNVERIFIED'] }, mode: { enum: ['ai-simulated', 'automated'] }, model: string,
  modalities: { type: 'array', maxItems: 3, items: { enum: ['text', 'image', 'audio'] } },
  reviewedAt: string, coverage: { enum: ['full', 'sampled'] }, rationale: { type: 'string', minLength: 16, maxLength: 8000 },
  evidenceIds: { type: 'array', minItems: 1, maxItems: 2048, items: string },
  findings: { type: 'array', maxItems: 500, items: shape({ severity: { enum: ['error', 'warning', 'info'] },
    location: string, message: string, resolved: { type: 'boolean' } }, ['severity', 'location', 'message', 'resolved']) }
}, ['id', 'category', 'status', 'mode', 'model', 'modalities', 'reviewedAt', 'coverage', 'rationale', 'evidenceIds', 'findings']);
export const AI_ACCEPTANCE_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:vn-ai-acceptance-v1:document',
  ...shape({ contract: { const: AI_ACCEPTANCE_CONTRACT }, schema: { const: 1 }, game: string, storyVersion: string,
    engineVersion: string, rubricVersion: { const: AI_REVIEW_RUBRIC }, binding: REVIEW_BINDING_SCHEMA,
    inputs: { type: 'array', minItems: 1, maxItems: 2048, items: inputSchema },
    reviews: { type: 'array', maxItems: 1024, items: reviewSchema }, supersedesSha256: hash, fixture: { type: 'boolean' }
  }, ['contract', 'schema', 'game', 'storyVersion', 'engineVersion', 'rubricVersion', 'binding', 'inputs', 'reviews']) };

/** Host-injected reads only. Failed or changed inputs remain unverified; no model claims are manufactured. */
export async function captureAcceptanceContext(project: EngineProject, sourceText: string, input: unknown,
  readAsset?: (src: string) => Promise<Uint8Array>, readEvidence?: (input: AcceptanceInput) => Promise<Uint8Array>): Promise<AcceptanceContext> {
  const binding = await captureReviewBinding(project, sourceText, readAsset), verifiedInputs: AcceptanceContext['verifiedInputs'] = [];
  const context = { sourceText, binding, verifiedInputs };
  if (input === undefined || input === null) return context;
  const doc = readAiAcceptance(input);
  let total = 0;
  for (const item of doc.inputs) {
    try {
      const bytes = item.kind === 'project' && item.src === '$source' ? new TextEncoder().encode(sourceText)
        : await readEvidence?.(item);
      if (!bytes) continue;
      total += bytes.byteLength;
      if (bytes.byteLength > 67_108_864 || total > 268_435_456) throw new Error('ACCEPTANCE_BUDGET_EXCEEDED');
      if (await reviewSourceHash(bytes) !== item.sha256) continue;
      let status: AcceptanceStatus | undefined, categories: string[] | undefined, platform: string | undefined;
      if (item.kind === 'screenshot') {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a
          || view.getUint32(16) !== item.width || view.getUint32(20) !== item.height) continue;
      }
      if (item.kind === 'routes' || item.kind === 'test-report') {
        const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        categories=Array.isArray(report.categories)?report.categories.filter((v:unknown)=>typeof v==='string'):[];platform=typeof report.platform==='string'?report.platform:undefined;
        status = report.sourceSha256 === binding.sourceSha256 && ['PASS', 'FAIL', 'UNVERIFIED'].includes(report.status) ? report.status : 'UNVERIFIED';
      }
      verifiedInputs.push({ ...item, ...(status ? { status, categories, platform } : {}) });
    } catch (error) {
      if (error instanceof Error && /BUDGET|TIMEOUT|ABORTED/.test(error.message)) throw error;
    }
  }
  return context;
}

export function acceptanceKey(review: Pick<AcceptanceReview, 'category' | 'target'>): string {
  return review.category + (review.target ? ':' + review.target : '');
}
export function readAiAcceptance(input: unknown): AiAcceptanceDocument {
  const value = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  const errors = schemaErrors(AI_ACCEPTANCE_SCHEMA, value);
  if (errors.length) throw new Error('INVALID_ACCEPTANCE: ' + JSON.stringify(errors[0]));
  const doc = value as AiAcceptanceDocument;
  for (const values of [doc.inputs.map(v => v.id), doc.reviews.map(v => v.id), doc.reviews.map(acceptanceKey)]) {
    if (new Set(values).size !== values.length) throw new Error('INVALID_ACCEPTANCE: Duplicate input, review ID or scope');
  }
  for (const review of doc.reviews) {
    if (!Number.isFinite(Date.parse(review.reviewedAt))) throw new Error('INVALID_ACCEPTANCE: Invalid review date');
    if (['art', 'master'].includes(review.category) !== !!review.target) throw new Error('INVALID_ACCEPTANCE: Invalid review target');
    if (new Set(review.evidenceIds).size !== review.evidenceIds.length || review.evidenceIds.some(id => !doc.inputs.some(i => i.id === id)))
      throw new Error('INVALID_ACCEPTANCE: Missing or duplicate evidence reference');
  }
  return doc;
}

export function requiredAcceptanceKeys(project: EngineProject, requiresPwa = false): string[] {
  const targets = project.releaseEvidence?.targets, known = !!targets && ['mobile', 'pwa', 'desktop'].every(k => typeof (targets as any)[k] === 'boolean');
  const keys = ['story', 'text', 'visualIntegration', 'accessibility'];
  if (project.assets.some(a => a.kind === 'audio' || a.kind === 'video')) keys.push('audio');
  if (!known || targets.mobile || targets.pwa || !targets.desktop) keys.push('web');
  if (!known || targets.pwa || requiresPwa) keys.push('pwa');
  if (!known || targets.desktop) keys.push('windows');
  for (const asset of project.assets) if (['background', 'portrait', 'cg', 'ui'].includes(asset.kind)) keys.push('art:' + asset.id);
  for (const id of Object.keys(project.releaseEvidence?.characterMasters ?? {})) keys.push('master:' + id);
  return keys;
}

/** Checks the submitted AI observations and their inputs. It does not impersonate or invoke a model. */
export function assessAiAcceptance(project: EngineProject, options: AcceptanceOptions & { requiresPwa?: boolean } = {}): AcceptanceAssessment {
  const keys = requiredAcceptanceKeys(project, options.requiresPwa), context = options.acceptanceContext;
  let doc: AiAcceptanceDocument | undefined, common = '', sourceBound = false, evidenceBound = false;
  try {
    if (options.acceptance === undefined || options.acceptance === null) throw new Error('AI acceptance is missing');
    doc = readAiAcceptance(options.acceptance);
    if (doc.game !== project.game || doc.storyVersion !== project.version || doc.engineVersion !== ENGINE_VERSION)
      throw new Error('Acceptance game, story or engine identity is stale');
    if (!context) throw new Error('Current source and actual evidence must be verified by the host');
    const raw = JSON.parse(context.sourceText), sourceProject = raw.format === 'vn-engine-editor' ? raw.project : raw;
    if (JSON.stringify(sourceProject) !== JSON.stringify(project)) throw new Error('Acceptance context differs from current project');
    if (doc.binding.sourceSha256 !== context.binding.sourceSha256
      || JSON.stringify(doc.binding.assets) !== JSON.stringify(context.binding.assets))
      throw new Error('Acceptance source or actual asset identity is stale');
    sourceBound = true;
    if (!doc.binding.filesVerified || !context.binding.filesVerified) throw new Error('Actual asset bytes are unverified');
    if (!doc.inputs.some(i => i.kind === 'project' && i.src === '$source' && i.sha256 === context.binding.sourceSha256))
      throw new Error('Acceptance must include the exact source input');
    if (doc.inputs.some(input => !context.verifiedInputs.some(v => JSON.stringify({ ...v, status: undefined, categories: undefined, platform: undefined }) === JSON.stringify(input))))
      throw new Error('Acceptance evidence bytes or metadata are missing or changed');
    evidenceBound = true;
  } catch (error) { common = error instanceof Error ? error.message : String(error); }
  const checks = keys.map(key => {
    const review = doc?.reviews.find(r => acceptanceKey(r) === key);
    let reason = common, status: AcceptanceStatus = 'UNVERIFIED';
    if (!reason && !review) reason = 'Review for this scope is missing';
    if (!reason && review && context && doc) {
      const inputs = review.evidenceIds.map(id => doc!.inputs.find(i => i.id === id)!);
      const isTechnical = ['accessibility', 'web', 'pwa', 'windows'].includes(review.category);
      if (/^(unverified|unknown|未知|待核实)$/i.test(review.model.trim())) reason = 'Review model or runner identity is unverified';
      else if (review.mode !== (isTechnical ? 'automated' : 'ai-simulated')) reason = 'Review mode does not match content or technical scope';
      else if (!inputs.some(i => i.kind === 'project')) reason = 'Review did not include current project input';
      else if (review.coverage !== 'full') reason = 'Sampled or incomplete review cannot approve the full scope';
      else if (isTechnical && !inputs.some(i => i.kind === 'test-report' && context.verifiedInputs.some(v => v.id === i.id && v.status === 'PASS' && v.categories?.includes(review.category) && (review.category!=='windows'||v.platform==='win32'))))
        reason = 'Technical acceptance needs a passed actual test report';
      else if (!isTechnical && !review.modalities.includes('text')) reason = 'Project context was not observed';
      else if (key === 'story' && !inputs.some(i => i.kind === 'routes' && context.verifiedInputs.some(v => v.id === i.id && v.status === 'PASS')))
        reason = 'Story review needs current executed routes';
      else if (key === 'visualIntegration' && (!review.modalities.includes('image') || ![1280, 390].every(width => inputs.some(i => i.kind === 'screenshot' && i.width === width))))
        reason = 'Visual review needs actual 1280px and 390px runtime images';
      else if (key === 'audio' && (!review.modalities.includes('audio') || project.assets.filter(a => a.kind === 'audio' || a.kind === 'video').some(a =>
        !inputs.some(i => i.kind === 'audio' && i.assetId === a.id && i.sha256 === context.binding.assets.find(b => b.id === a.id)?.sha256))))
        reason = 'Listening review needs actual audio for every applicable asset';
      else if (key.startsWith('art:') && (!review.modalities.includes('image') || !inputs.some(i => i.kind === 'image' && i.assetId === review.target
        && i.sha256 === context.binding.assets.find(b => b.id === review.target)?.sha256)))
        reason = 'Art review needs the actual target image';
      else if (key.startsWith('master:') && (!review.modalities.includes('image') || !inputs.some(i => i.kind === 'image'
        && i.sha256 === project.releaseEvidence?.characterMasters?.[review.target!]?.masterSha256)))
        reason = 'Master review needs the exact master image';
      else {
        status = review.findings.some(f => f.severity === 'error' && !f.resolved) ? 'FAIL' : review.status;
        reason = status === 'PASS' ? 'Current inputs reviewed' : status === 'FAIL' ? 'Review failed or has unresolved blocking findings' : 'Reviewer did not complete this scope';
      }
    }
    return { key, status, reason, ...(review ? { mode: review.mode, model: review.model, reviewedAt: review.reviewedAt } : {}) };
  });
  const issues = checks.filter(c => c.status !== 'PASS').map(c => c.key + ': ' + c.reason);
  return { contract: AI_ACCEPTANCE_CONTRACT, policy: 'ai-simulated', status: issues.length ? 'BLOCKED' : 'PASS', checks, issues,
    scope: { sourceBound, actualFiles: !!context?.binding.filesVerified, evidenceBound, modelIdentityAuthenticated: false, fixture: !!doc?.fixture } };
}
