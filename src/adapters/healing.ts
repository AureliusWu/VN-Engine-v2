import { NarrativeEngine } from '../narrative/engine.js';
import type { Scene, Stats } from '../narrative/types.js';
import { presentationAt } from '../presentation/frame.js';
import { createSaveCodec } from '../storage/save.js';

export function healingEndingFor(stats: Readonly<Stats>): string {
  if (stats.honesty >= 3 && stats.lin >= 2 && stats.chen >= 2) return 'together';
  if (stats.honesty >= 2 || stats.lin >= 3 || stats.chen >= 3) return 'letter';
  return 'quiet';
}

/** Retains the original state/version identity, resolver and bridge semantics. */
export function createHealingEngine(scenes: readonly Scene[]): NarrativeEngine {
  return new NarrativeEngine({ game: 'moist-healing', storyVersion: 'moist-healing-v1',
    legacyStoryVersions: ['chapter1-v1'], entry: 'arrival', stats: { honesty: 0, lin: 0, chen: 0 }, scenes,
    replayLimit: 4000, acceptsSavePosition: (version, scene) => version !== 'chapter1-v1' || scene.chapter === 1,
    nextFor: (scene, stats) => scene.resolve ? `end-${healingEndingFor(stats)}` : scene.bridge ? `c2-from-${healingEndingFor(stats)}` : scene.next });
}
export const createHealingSaveCodec = (engine: NarrativeEngine) => createSaveCodec(engine, 24);

const speakers = { 林见夏: 'lin', 陈知遥: 'chen', 许棠: 'tang', 贺川: 'hechuan', 班主任: 'teacher', 同学: 'classmate', 母亲: 'mother', 妈妈: 'mother', 文印老师: 'printteacher', 林父: 'linfather', 陈母: 'chenmother', 许母: 'xumother' };
export function healingPresentationAt(scene: Scene, line: number) {
  return presentationAt(scene, line, { speakers, canAppear: (character, _line, node) =>
    !(character === 'mother' && !['c2-home', 'c2-home-plan'].includes(node.id)) && !(character === 'chen' && node.id === 'c2-home-plan') });
}
