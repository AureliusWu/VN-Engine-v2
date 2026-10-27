import type { Asset } from '../assets/catalog.js';
import type { EngineProject } from '../runtime/project.js';
import { isRecord } from '../storage/save.js';

export type EvidenceStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type VisualReview = {
  TECH_READY: EvidenceStatus; ART_READY: EvidenceStatus;
  VISUAL_IDENTITY_PASS: EvidenceStatus; COMPOSITION_PASS: EvidenceStatus; STYLE_PASS: EvidenceStatus;
  SCENE_INTEGRATION_PASS: EvidenceStatus; MOBILE_PASS: EvidenceStatus; DESKTOP_PASS: EvidenceStatus; PROVENANCE_PASS: EvidenceStatus;
  reviewer: string; reviewedAt: string; source: string; runtimeSha256: string; masterSha256?: string;
  evidence: { desktop: string; mobile: string; provenance: string };
};
export type ReleaseEvidence = {
  targets: { mobile: boolean; pwa: boolean; desktop: boolean };
  mobilePhysicalDevice?: { status: EvidenceStatus; kind: 'physical'; device: string; reviewer: string; reviewedAt: string; evidence: string };
  dynamicPresentation?: { status: EvidenceStatus; reviewer: string; reviewedAt: string; evidence: string };
  keyVisual: { used: boolean; status?: EvidenceStatus; reviewer?: string; reviewedAt?: string; evidence?: string };
  art: Record<string, VisualReview>;
};
export type ArtGateResult = {
  contract: 'GALGAME_SPEC-v0.2-art-draft';
  TECH_READY: 'PASS' | 'FAIL' | 'N/A'; ART_READY: 'PASS' | 'FAIL' | 'N/A';
  MOBILE_PHYSICAL_DEVICE: 'PASS' | 'FAIL' | 'UNVERIFIED' | 'N/A';
  KEY_VISUAL_LIFECYCLE: 'PASS' | 'FAIL' | 'UNVERIFIED' | 'N/A';
  PLACEHOLDER_SCAN: 'PASS' | 'FAIL';
  release: 'PASS' | 'BLOCKED';
  assets: readonly { id: string; TECH_READY: 'PASS' | 'FAIL'; ART_READY: 'PASS' | 'FAIL'; issues: readonly string[] }[];
  issues: readonly string[];
  warnings: readonly string[];
  limitations: readonly string[];
};

const visualKinds = new Set(['background', 'portrait', 'cg', 'ui']);
const gates = ['VISUAL_IDENTITY_PASS', 'COMPOSITION_PASS', 'STYLE_PASS', 'SCENE_INTEGRATION_PASS', 'MOBILE_PASS', 'DESKTOP_PASS', 'PROVENANCE_PASS'] as const;
const known = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/^(?:unverified|unknown|未知|待核实)$/i.test(value.trim());
const dated = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Checks human-declared evidence, never infers artistic quality from technical success. */
export function assessProductionArt(project: EngineProject, referencedIds: readonly string[], options: { requiresPwa?: boolean; keyVisualUsed?: boolean } = {}): ArtGateResult {
  const evidence: unknown = project.releaseEvidence, root = isRecord(evidence) ? evidence : {};
  const targets = isRecord(root.targets) ? root.targets : {};
  const targetKnown = ['mobile', 'pwa', 'desktop'].every(key => typeof targets[key] === 'boolean');
  const needsMobile = targets.mobile === true || targets.pwa === true || options.requiresPwa === true;
  const issues: string[] = [];
  const warnings: string[] = [];
  if (!targetKnown) issues.push('Release targets are UNVERIFIED; declare mobile, PWA and desktop support.');
  if (targetKnown && !targets.mobile && !targets.pwa && !targets.desktop) issues.push('At least one release target must be declared.');
  if (options.requiresPwa && targets.pwa !== true) issues.push('This package includes a PWA; declare PWA support and its physical-device evidence.');
  const placeholders = project.assets.filter(asset => asset.status === 'PLACEHOLDER');
  for (const asset of placeholders) issues.push(`PLACEHOLDER asset is included in the release manifest: ${asset.id}`);
  for (const asset of project.assets) if (/placeholder|占位/i.test(`${asset.id} ${asset.src} ${asset.alt ?? ''}`)) warnings.push(`Potential placeholder requires human review: ${asset.id}`);
  const keyVisual = isRecord(root.keyVisual) ? root.keyVisual : {};
  let keyVisualStatus: ArtGateResult['KEY_VISUAL_LIFECYCLE'] = 'UNVERIFIED';
  if (keyVisual.used === false) keyVisualStatus = 'N/A';
  else if (keyVisual.used === true && keyVisual.status === 'FAIL') keyVisualStatus = 'FAIL';
  else if (keyVisual.used === true && keyVisual.status === 'PASS' && known(keyVisual.reviewer) && dated(keyVisual.reviewedAt) && known(keyVisual.evidence)) keyVisualStatus = 'PASS';
  if (keyVisualStatus === 'UNVERIFIED' || keyVisualStatus === 'FAIL') issues.push('Key Visual use and lifecycle require an explicit declaration and, when used, human evidence.');
  if (options.keyVisualUsed && keyVisual.used !== true) { keyVisualStatus = 'FAIL'; issues.push('Key Visual is authored in runtime cues but declared unused.'); }
  let mobile: ArtGateResult['MOBILE_PHYSICAL_DEVICE'] = targetKnown && !needsMobile ? 'N/A' : 'UNVERIFIED';
  if (targetKnown && needsMobile) {
    const device = isRecord(root.mobilePhysicalDevice) ? root.mobilePhysicalDevice : {};
    if (device.status === 'FAIL') mobile = 'FAIL';
    else if (device.status === 'PASS' && device.kind === 'physical' && known(device.device)
      && !/(?:\bemulator\b|\bemulation\b|\bviewport\b|模拟器|浏览器缩放)/i.test(device.device)
      && known(device.reviewer) && dated(device.reviewedAt) && known(device.evidence)) mobile = 'PASS';
    if (mobile !== 'PASS') issues.push('MOBILE_PHYSICAL_DEVICE requires a passed human review, device, reviewer, date and evidence.');
  }
  const byId = new Map(project.assets.map(asset => [asset.id, asset]));
  const required = new Set(referencedIds.filter(id => visualKinds.has(byId.get(id)?.kind ?? '')));
  // UI key visuals and dynamically selected adapter assets cannot be proven unused statically.
  const dynamicVisuals = project.type === 'narrative' && (!!project.adapter || !!project.stage?.presentation
    || !!Object.keys(project.stage?.speakers ?? {}).length || project.scenes.some(scene => !!scene.character));
  if (dynamicVisuals) {
    const dynamic = isRecord(root.dynamicPresentation) ? root.dynamicPresentation : {};
    if (dynamic.status !== 'PASS' || !known(dynamic.reviewer) || !dated(dynamic.reviewedAt) || !known(dynamic.evidence))
      issues.push('Dynamic presentation references require passed human runtime evidence.');
  }
  for (const asset of project.assets) if (asset.kind === 'ui' || (dynamicVisuals && visualKinds.has(asset.kind))) required.add(asset.id);
  const records = isRecord(root.art) ? root.art : {};
  const assets = [...required].sort().map(id => {
    const asset = byId.get(id) as Asset, value = isRecord(records[id]) ? records[id] : {};
    const itemIssues: string[] = [];
    if (asset.status !== 'READY') itemIssues.push('Asset status must be READY.');
    if (value.TECH_READY !== 'PASS') itemIssues.push('TECH_READY is not explicitly PASS.');
    if (!digest(asset.sha256) || value.runtimeSha256 !== asset.sha256) itemIssues.push('Runtime SHA256 is missing or differs from the asset manifest.');
    const tech = itemIssues.length === 0 ? 'PASS' : 'FAIL';
    const artStart = itemIssues.length;
    if (asset.status === 'PLACEHOLDER') itemIssues.push('PLACEHOLDER cannot be ART_READY.');
    if (value.ART_READY !== 'PASS') itemIssues.push('ART_READY is not explicitly PASS.');
    for (const gate of gates) if (value[gate] !== 'PASS') itemIssues.push(`${gate} is not PASS.`);
    if (!known(value.reviewer) || !dated(value.reviewedAt)) itemIssues.push('Human reviewer or review date is missing.');
    if (!known(value.source)) itemIssues.push('Asset source is UNVERIFIED.');
    if (typeof value.source === 'string' && /procedural|generator|template|程序化|模板/i.test(value.source)) warnings.push(`Procedural or template source requires final-style review: ${id}`);
    const links = isRecord(value.evidence) ? value.evidence : {};
    if (!known(links.desktop) || !known(links.mobile) || !known(links.provenance)) itemIssues.push('Desktop, mobile or provenance evidence is missing.');
    if (value.masterSha256 !== undefined && !digest(value.masterSha256)) itemIssues.push('Master SHA256 is malformed.');
    const art = itemIssues.length === artStart ? 'PASS' : 'FAIL';
    return { id, TECH_READY: tech, ART_READY: art, issues: Object.freeze(itemIssues) } as const;
  });
  const techReady = assets.length ? (assets.every(asset => asset.TECH_READY === 'PASS') ? 'PASS' : 'FAIL') : 'N/A';
  const artReady = assets.length ? (assets.every(asset => asset.ART_READY === 'PASS') ? 'PASS' : 'FAIL') : 'N/A';
  if (techReady === 'FAIL') issues.push('One or more production art assets are not TECH_READY.');
  if (artReady === 'FAIL') issues.push('One or more production art assets are not ART_READY.');
  return Object.freeze({ contract: 'GALGAME_SPEC-v0.2-art-draft', TECH_READY: techReady, ART_READY: artReady,
    MOBILE_PHYSICAL_DEVICE: mobile, KEY_VISUAL_LIFECYCLE: keyVisualStatus, PLACEHOLDER_SCAN: placeholders.length ? 'FAIL' : 'PASS', release: issues.length ? 'BLOCKED' : 'PASS', assets: Object.freeze(assets), issues: Object.freeze(issues), warnings: Object.freeze(warnings),
    limitations: Object.freeze(['Human declarations and evidence links are not automatically authenticated.', 'The in-memory validator checks declared hashes; the release CLI and packager separately check actual bytes, not decoding or visual quality.']) });
}

export class ReleaseArtGateError extends Error {
  constructor(readonly report: ArtGateResult) { super('Release blocked by GALGAME SPEC v0.2 art or physical-device evidence gate'); this.name = 'ReleaseArtGateError'; }
}
