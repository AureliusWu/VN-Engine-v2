import { AssetCatalog, type AssetKind } from '../assets/catalog.js';
import type { RainLine } from '../adapters/rain-runtime.js';
import { createProject, type EngineProject } from '../runtime/project.js';
import type { StageCue } from '../stage/types.js';
import { validatePresentationTimeline } from '../stage/timeline.js';

export const GALGAME_SPEC_CONTRACT = 'GALGAME_SPEC-v0.1';
export type ComplianceMode = 'development' | 'release';
export type ProjectComplianceReport = {
  contract: string;
  mode: ComplianceMode;
  game: string;
  version: string;
  type: EngineProject['type'];
  assets: number;
  references: number;
  lines: number;
  endings: readonly string[];
  warnings: readonly string[];
};

const PLACEHOLDER_TEXT = /\b(?:TODO|FIXME|PLACEHOLDER|lorem ipsum)\b/i;
const ASSET_STATUSES = new Set(['PLACEHOLDER', 'DRAFT', 'REVIEW', 'READY', 'DEPRECATED']);

type AssetReference = { id: string; kind: AssetKind; context: string };

function cueReferences(cue: StageCue | undefined, context: string): AssetReference[] {
  if (!cue) return [];
  const result: AssetReference[] = [];
  const add = (id: string | null | undefined, kind: AssetKind, field: string) => {
    if (id) result.push({ id, kind, context: `${context}.${field}` });
  };
  add(cue.background, 'background', 'background');
  add(cue.portrait, 'portrait', 'portrait');
  add(cue.cg, 'cg', 'cg');
  add(cue.music, 'audio', 'music');
  add(cue.ambience, 'audio', 'ambience');
  add(cue.sound, 'audio', 'sound');
  add(cue.voice, 'audio', 'voice');
  if (cue.timeline) validatePresentationTimeline(cue.timeline);
  if (cue.video) {
    add(cue.video.asset, 'video', 'video.asset');
    if (cue.video.fallback) add(cue.video.fallback.asset, cue.video.fallback.kind, 'video.fallback');
  }
  return result;
}

/**
 * Project-level GALGAME SPEC gate.
 *
 * This deliberately validates engine-facing facts only. Narrative quality, art
 * composition, performance feel and other human QA remain outside this API.
 */
export function validateProjectCompliance(
  project: EngineProject,
  options: { mode?: ComplianceMode } = {},
): ProjectComplianceReport {
  const mode = options.mode ?? 'development';
  const runtime = createProject(project, 'https://vn-engine.invalid/');
  runtime.session.dispose();

  const catalog = new AssetCatalog(project.assets, 'https://vn-engine.invalid/');
  const references: AssetReference[] = [];
  const warnings: string[] = [];
  const endings = new Set<string>();
  let lines = 0;

  const inspectText = (text: string, context: string) => {
    if (!text.trim()) throw new Error(`Empty formal text: ${context}`);
    if (!PLACEHOLDER_TEXT.test(text)) return;
    const message = `Placeholder text: ${context}`;
    if (mode === 'release') throw new Error(message);
    warnings.push(message);
  };
  const inspectCue = (cue: StageCue | undefined, context: string) => references.push(...cueReferences(cue, context));

  for (const asset of project.assets) {
    const status = (asset as typeof asset & { status?: unknown }).status;
    if (status !== undefined && !ASSET_STATUSES.has(String(status))) throw new Error(`Invalid asset status: ${asset.id}`);
    if (mode === 'release' && status === 'PLACEHOLDER') throw new Error(`Release references PLACEHOLDER asset: ${asset.id}`);
  }
  if (project.font) references.push({ id: project.font, kind: 'font', context: 'project.font' });
  for (const item of project.collections?.cgs ?? []) references.push({ id: item.id, kind: 'cg', context: 'collections.cgs' });

  if (project.type === 'narrative') {
    for (const scene of project.scenes) {
      if (scene.background) references.push({ id: scene.background, kind: 'background', context: `scene:${scene.id}.background` });
      if (scene.cg) references.push({ id: scene.cg, kind: 'cg', context: `scene:${scene.id}.cg` });
      if (scene.music) references.push({ id: scene.music, kind: 'audio', context: `scene:${scene.id}.music` });
      if (scene.ending) endings.add(scene.ending);
      for (const [index, line] of scene.lines.entries()) {
        lines++;
        inspectText(line.text, `scene:${scene.id}.line:${line.id ?? index}`);
      }
      for (const choice of scene.choices ?? []) inspectText(choice.text, `scene:${scene.id}.choice:${choice.id}`);
    }
    inspectCue(project.stage?.defaults, 'stage.defaults');
    for (const [id, cue] of Object.entries(project.stage?.scenes ?? {})) inspectCue(cue, `stage.scenes.${id}`);
    for (const [id, cue] of Object.entries(project.stage?.lines ?? {})) inspectCue(cue, `stage.lines.${id}`);
    if (project.stage?.presentation) warnings.push('Dynamic presentation asset references require runtime QA evidence');
  } else if (project.type === 'script') {
    inspectCue(project.defaults, 'defaults');
    for (const block of project.program.blocks) {
      inspectCue(block.cue, `block:${block.id}.cue`);
      if (block.exit.type === 'end') endings.add(block.exit.ending);
      for (const line of block.lines) {
        lines++;
        inspectText(line.text, `block:${block.id}.line:${line.id}`);
        inspectCue(line.cue, `block:${block.id}.line:${line.id}.cue`);
      }
      if (block.exit.type === 'choice') for (const choice of block.exit.choices) inspectText(choice.text, `block:${block.id}.choice:${choice.id}`);
    }
  } else if (project.type === 'rain') {
    inspectCue(project.defaults, 'defaults');
    const portrait = (expression: string) => `heroine/${expression}`;
    const inspectRainLine = (line: RainLine, context: string) => {
      lines++;
      inspectText(line.text, context);
      if (line.background) references.push({ id: line.background, kind: 'background', context: `${context}.background` });
      if (line.bgm) references.push({ id: line.bgm, kind: 'audio', context: `${context}.bgm` });
      if (line.sound) references.push({ id: line.sound, kind: 'audio', context: `${context}.sound` });
      if (line.voice) references.push({ id: line.voice, kind: 'audio', context: `${context}.voice` });
      if (line.expression) references.push({ id: portrait(line.expression), kind: 'portrait', context: `${context}.expression` });
    };
    for (const node of project.story.nodes) {
      if (node.background) references.push({ id: node.background, kind: 'background', context: `rain:${node.id}.background` });
      if (node.bgm) references.push({ id: node.bgm, kind: 'audio', context: `rain:${node.id}.bgm` });
      if (node.ambient) references.push({ id: node.ambient, kind: 'audio', context: `rain:${node.id}.ambient` });
      if (node.sprite) references.push({ id: portrait(node.sprite), kind: 'portrait', context: `rain:${node.id}.sprite` });
      if (node.ending) endings.add(node.ending);
      for (const line of node.lines ?? []) inspectRainLine(line, `rain:${node.id}.line:${line.id}`);
      for (const choice of node.choices ?? []) {
        inspectText(choice.text, `rain:${node.id}.choice:${choice.id}`);
        for (const line of choice.response ?? []) inspectRainLine(line, `rain:${node.id}.choice:${choice.id}.response:${line.id}`);
      }
    }
  } else if (project.type === 'investigation') {
    inspectCue(project.stage?.defaults, 'stage.defaults');
    for (const [id, cue] of Object.entries(project.stage?.nodes ?? {})) inspectCue(cue, `stage.nodes.${id}`);
    for (const chapter of project.chapters) {
      for (const [id, node] of Object.entries(chapter.nodes)) {
        lines++;
        inspectText(node.text, `chapter:${chapter.id}.node:${id}`);
        for (const action of node.actions) inspectText(action.label, `chapter:${chapter.id}.node:${id}.action:${action.id}`);
        if (node.outcome) endings.add(`${chapter.id}:${node.outcome}`);
      }
    }
  }

  for (const reference of references) {
    try { catalog.get(reference.id, reference.kind); }
    catch { throw new Error(`Missing or mismatched asset reference: ${reference.context} -> ${reference.id} (${reference.kind})`); }
  }

  return Object.freeze({
    contract: GALGAME_SPEC_CONTRACT,
    mode,
    game: project.game,
    version: project.version,
    type: project.type,
    assets: project.assets.length,
    references: references.length,
    lines,
    endings: Object.freeze([...endings].sort()),
    warnings: Object.freeze(warnings),
  });
}
