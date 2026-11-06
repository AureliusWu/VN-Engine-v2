import { validateCreativeProject, type ProductionPlan } from '../creative/project.js';
import { validateProjectUI, type ProjectUI } from '../ui/theme.js';
import { AssetCatalog, type Asset } from '../assets/catalog.js';
import { NarrativeEngine } from '../narrative/engine.js';
import type { NarrativeConfig, Scene } from '../narrative/types.js';
import { createHealingEngine, healingPresentationAt } from '../adapters/healing.js';
import { createNetLoveEngine, netlovePresentationAt } from '../adapters/netlove.js';
import { InvestigationEngine } from '../investigation/engine.js';
import type { InvestigationChapter } from '../investigation/types.js';
import { ScriptEngine } from '../script/engine.js';
import type { ScriptProgram } from '../script/types.js';
import { createRainRuntime, type RainStory } from '../adapters/rain-runtime.js';
import type { StageCue } from '../stage/types.js';
import { NarrativeDriver, ScriptDriver, InvestigationDriver, type NarrativeStage, type InvestigationStage } from './drivers.js';
import { RuntimeSession, type RuntimeSettings, type Clock } from './session.js';
import type { ProjectCollections } from '../meta/state.js';
import { isRecord } from '../storage/save.js';
import type { ReleaseEvidence } from '../compliance/art.js';
import { projectEndings, validateTrueRoutePolicy } from '../meta/project.js';
import type { RollbackOptions } from './rollback.js';
import { validateProjectMiniGames } from '../minigame/project.js';
import type { ReadProgressPort } from './read.js';
import type { RouteSuite } from '../regression/types.js';
import { validateRouteSuite } from '../regression/schema.js';
import type { RuntimeEvidence } from './evidence.js';

type ProjectBase = { production?: ProductionPlan; ui?: ProjectUI; schema: 1; game: string; version: string; title: string; titleScreen?: boolean; routeTests?: RouteSuite; assets: readonly Asset[]; font?: string; settings?: Partial<RuntimeSettings>; rollback?: RollbackOptions; collections?: ProjectCollections; releaseEvidence?: ReleaseEvidence };
export type EngineProject = ProjectBase & (
  { type: 'narrative'; adapter?: 'healing' | 'netlove'; entry?: string; stats?: Record<string, number>; scenes: readonly Scene[]; stage?: NarrativeStage }
  | { type: 'script'; program: ScriptProgram; defaults?: StageCue }
  | { type: 'rain'; story: RainStory; defaults?: StageCue }
  | { type: 'investigation'; chapters: readonly InvestigationChapter[]; stage?: InvestigationStage }
);
type ProjectOptions = { clock?: Clock; settings?: Partial<RuntimeSettings>; assetURL?: (path: string) => string; assetCacheURL?: (assetId: string) => string | undefined; initialPause?: string; readProgress?: ReadProgressPort; evidence?: RuntimeEvidence };

function createDriverFactory(project: EngineProject) {
  if (project.type === 'narrative') {
    let config: NarrativeConfig, presentation = project.stage?.presentation;
    if (project.adapter === 'healing') { config = createHealingEngine(project.scenes).config; presentation = healingPresentationAt; }
    else if (project.adapter === 'netlove') { config = createNetLoveEngine(project.scenes).config; presentation = netlovePresentationAt; }
    else config = { game: project.game, storyVersion: project.version, entry: project.entry ?? project.scenes[0]?.id, stats: project.stats ?? {}, scenes: project.scenes };
    const engine = new NarrativeEngine({ ...config, game: project.game, storyVersion: project.version, legacyStoryVersions: [] });
    const stage = { ...project.stage, presentation };
    return () => new NarrativeDriver(engine, stage);
  }
  if (project.type === 'investigation') {
    const engine = new InvestigationEngine(project.chapters);
    return () => new InvestigationDriver(project.game, project.version, engine, project.stage);
  }
  if (project.type === 'script' || project.type === 'rain') {
    const engine = project.type === 'script'
      ? new ScriptEngine({ ...project.program, game: project.game, version: project.version })
      : createRainRuntime(project.story, { game: project.game, version: project.version });
    return () => new ScriptDriver(engine, project.defaults);
  }
  throw new Error('Unknown project runtime');
}

function prepareProject(project: EngineProject, baseURL: string | URL, options: ProjectOptions) {
  if (project.schema !== 1 || !project.game || !project.version || !project.title || !Array.isArray(project.assets)) throw new Error('Invalid engine project');
  validateProjectUI(project.ui); validateCreativeProject(project);
  if (project.titleScreen !== undefined && typeof project.titleScreen !== 'boolean') throw new Error('titleScreen must be boolean');
  if (project.routeTests !== undefined) validateRouteSuite(project.routeTests);
  const assets = new AssetCatalog(project.assets, baseURL, options.assetURL, options.assetCacheURL);
  if (project.collections !== undefined) {
    if (!isRecord(project.collections)) throw new Error('Invalid collection metadata');
    const endings = new Set(projectEndings(project));
    for (const [kind, entries] of [['cg', project.collections.cgs], ['ending', project.collections.endings]] as const) {
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) throw new Error('Invalid collection entries');
      const ids = new Set<string>();
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)
          || (entry.title !== undefined && typeof entry.title !== 'string')
          || ('trueEnding' in entry && typeof entry.trueEnding !== 'boolean')) throw new Error('Invalid or duplicate collection entry');
        ids.add(entry.id);
        if (kind === 'cg') assets.get(entry.id, 'cg');
        else if (!endings.has(entry.id)) throw new Error(`Unknown collection ending: ${entry.id}`);
      }
    }
    const policy = project.collections.trueRoute;
    if (policy !== undefined) {
      validateTrueRoutePolicy(policy);
      for (const id of policy.endings ?? []) if (!endings.has(id)) throw new Error(`Unknown true-route ending: ${id}`);
      for (const id of policy.cgs ?? []) assets.get(id, 'cg');
    }
  }
  const createDriver = createDriverFactory(project);
  const driver = createDriver();
  if (project.rollback !== undefined && !isRecord(project.rollback)) throw new Error('Invalid rollback options');
  validateProjectMiniGames(project);
  const sessionOptions = { clock: options.clock, settings: { ...project.settings, ...options.settings }, rollback: project.rollback, initialPause: options.initialPause, readProgress: options.readProgress, evidence: options.evidence };
  return { assets, session: new RuntimeSession(driver, sessionOptions), createSession: () => new RuntimeSession(createDriver(), sessionOptions) };
}

export function createProject(project: EngineProject, baseURL: string | URL, options: ProjectOptions = {}) {
  const { session, assets } = prepareProject(project, baseURL, options);
  return { session, assets };
}

/** Internal authoring check. Share validated definitions within a diagnostic pass. */
export function createCollectionReplayCheck(project: EngineProject, baseURL: string | URL) {
  let createSession: (() => RuntimeSession) | undefined;
  return (replay: unknown) => {
    let session: RuntimeSession;
    if (createSession) session = createSession();
    else {
      // An injected presentation callback can observe or modify its story data.
      const canReuse = project.type !== 'narrative' || project.stage?.presentation === undefined;
      const prepared = prepareProject({ ...project, collections: undefined }, baseURL, {});
      session = prepared.session;
      if (canReuse) createSession = prepared.createSession;
    }
    try { session.restore(replay); }
    finally { session.dispose(); }
  };
}
