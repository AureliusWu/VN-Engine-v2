import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Synthetic gate inputs only; never actual artistic, listening or physical-device evidence. */
export function qaFixture() {
  const picture = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>');
  const sha256 = createHash('sha256').update(picture).digest('hex');
  const review = { TECH_READY: 'PASS', ART_READY: 'PASS', reviewer: 'synthetic test reviewer', reviewedAt: '2026-10-27', source: 'synthetic fixture, not production acceptance', runtimeSha256: sha256,
    ...Object.fromEntries(['VISUAL_IDENTITY_PASS', 'COMPOSITION_PASS', 'STYLE_PASS', 'SCENE_INTEGRATION_PASS', 'MOBILE_PASS', 'DESKTOP_PASS', 'PROVENANCE_PASS'].map(key => [key, 'PASS'])),
    evidence: { desktop: 'test://synthetic', mobile: 'test://synthetic', provenance: 'test://synthetic' } };
  const project = { schema: 1, game: 'qa-fixture', version: 'v1', title: 'Synthetic QA fixture', type: 'narrative',
    assets: [{ id: 'room', kind: 'background', src: 'assets/room.svg', sha256, status: 'READY' }],
    scenes: [{ id: 'start', background: 'room', lines: [{ id: 'line', speaker: 'N', text: 'Synthetic test story' }], ending: 'done' }],
    releaseEvidence: { targets: { mobile: true, pwa: true, desktop: true }, keyVisual: { used: false }, art: { room: review },
      mobilePhysicalDevice: { status: 'PASS', kind: 'physical', device: 'synthetic test fixture', reviewer: 'synthetic test reviewer', reviewedAt: '2026-10-27', evidence: 'test://synthetic-device' },
      qa: Object.fromEntries(['story', 'text', 'visualIntegration', 'audio', 'accessibility', 'web', 'pwa', 'windows'].map(category => [category, { status: 'PASS', reviewer: 'synthetic test reviewer', reviewedAt: '2026-10-27', evidence: 'test://synthetic-qa' }])) } };
  return { project, picture };
}
export async function writeQaFixture(root, project, picture) {
  await mkdir(join(root, 'assets'), { recursive: true }); await writeFile(join(root, 'assets/room.svg'), picture);
  const filename = join(root, 'project.json'); await writeFile(filename, JSON.stringify(project)); return filename;
}
