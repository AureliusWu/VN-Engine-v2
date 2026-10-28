import type { EngineProject } from '../runtime/project.js';
import type { Effect, Variable } from '../script/types.js';
import { isRecord } from '../storage/save.js';

export type AuthorReference = { path: (string | number)[]; key?: string; node?: string };

export function validateVariable(definition: Variable): void {
  if (!isRecord(definition) || !['number', 'boolean'].includes(typeof definition.initial)) throw new Error('变量初值必须是数值或布尔值');
  if (typeof definition.initial === 'boolean') {
    if (definition.min !== undefined || definition.max !== undefined) throw new Error('布尔变量不能设置数值边界');
    return;
  }
  if (!Number.isFinite(definition.initial) || [definition.min, definition.max].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
    || (definition.min !== undefined && definition.initial < definition.min) || (definition.max !== undefined && definition.initial > definition.max)
    || (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max)) throw new Error('变量初值或数值边界无效');
}

export function validateEffects(variables: Readonly<Record<string, Variable>>, effects: readonly Effect[]): void {
  if (!Array.isArray(effects)) throw new Error('选择效果必须是列表');
  for (const effect of effects) {
    if (!isRecord(effect) || typeof effect.key !== 'string' || !Object.hasOwn(variables, effect.key)) throw new Error('效果引用不存在的变量');
    const definition = variables[effect.key]; validateVariable(definition);
    if (effect.op === 'add') {
      if (typeof definition.initial !== 'number' || typeof effect.value !== 'number' || !Number.isFinite(effect.value)) throw new Error('累加只接受有限数值变量');
    } else if (effect.op === 'set') {
      if ((typeof effect.value !== 'number' && typeof effect.value !== 'boolean') || typeof effect.value !== typeof definition.initial) throw new Error('赋值与变量类型不符');
      validateVariable({ ...definition, initial: effect.value });
    } else throw new Error('不支持的选择效果');
  }
}

export function variableReferences(project: EngineProject, id: string): AuthorReference[] {
  if (project.type !== 'script') throw new Error('当前工程不是条件剧本');
  const refs: AuthorReference[] = [];
  project.program.blocks.forEach((block, i) => {
    const path = ['program', 'blocks', i, 'exit'], node = JSON.stringify([block.id]);
    if (block.exit.type === 'choice') block.exit.choices.forEach((choice, j) => choice.effects?.forEach((effect, k) => {
      if (effect.key === id) refs.push({ path: [...path, 'choices', j, 'effects', k, 'key'], node });
    }));
    if (block.exit.type === 'branch') block.exit.routes.forEach((route, j) => {
      if (route.when && Object.hasOwn(route.when, id)) refs.push({ path: [...path, 'routes', j, 'when'], key: id, node });
    });
  });
  project.routeTests?.cases.forEach((test, i) => {
    if (test.expect.variables && Object.hasOwn(test.expect.variables, id)) refs.push({ path: ['routeTests', 'cases', i, 'expect', 'variables'], key: id });
  });
  return refs;
}

/** Identity/order changes cannot infer implicit starting chapters from stored replay journals. */
export function hasAuthoredReplay(project: EngineProject): boolean {
  return [...(project.collections?.cgs ?? []), ...(project.collections?.endings ?? [])].some(entry => entry.replay !== undefined);
}

export function chapterReferences(project: EngineProject, id: string): AuthorReference[] {
  if (project.type !== 'investigation') throw new Error('当前工程不是调查类型');
  const chapter = project.chapters.find(chapter => chapter.id === id); if (!chapter) throw new Error('章节不存在');
  const refs: AuthorReference[] = [], lineIds = new Set(Object.keys(chapter.nodes).map(node => `${id}/${node}`));
  const endingIds = new Set(['complete', 'failure'].map(outcome => `${id}:${outcome}`));
  project.routeTests?.cases.forEach((test, i) => {
    test.steps.forEach((step, j) => { if (step.type === 'action' && step.id === `@chapter:${id}`) refs.push({ path: ['routeTests', 'cases', i, 'steps', j, 'id'] }); });
    if (test.expect.lineId && lineIds.has(test.expect.lineId)) refs.push({ path: ['routeTests', 'cases', i, 'expect', 'lineId'] });
    if (test.expect.sceneId && Object.hasOwn(chapter.nodes, test.expect.sceneId)
      && project.chapters.filter(chapter => Object.hasOwn(chapter.nodes, test.expect.sceneId!)).length === 1) refs.push({ path: ['routeTests', 'cases', i, 'expect', 'sceneId'] });
    if (test.expect.ending && endingIds.has(test.expect.ending)) refs.push({ path: ['routeTests', 'cases', i, 'expect', 'ending'] });
  });
  project.collections?.endings?.forEach((entry, i) => { if (endingIds.has(entry.id)) refs.push({ path: ['collections', 'endings', i, 'id'] }); });
  project.collections?.trueRoute?.endings?.forEach((value, i) => { if (endingIds.has(value)) refs.push({ path: ['collections', 'trueRoute', 'endings', i] }); });
  const cue = (value: unknown, path: (string | number)[]) => {
    if (!isRecord(value) || !isRecord(value.miniGame) || !isRecord(value.miniGame.results)) return;
    for (const [result, action] of Object.entries(value.miniGame.results)) if (action === `@chapter:${id}`) refs.push({ path: [...path, 'miniGame', 'results', result] });
  };
  cue(project.stage?.defaults, ['stage', 'defaults']);
  for (const [key, value] of Object.entries(project.stage?.nodes ?? {})) if (!lineIds.has(key)) cue(value, ['stage', 'nodes', key]);
  return refs;
}
