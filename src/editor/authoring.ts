import type { EngineProject } from '../runtime/project.js';
import type { Condition, Scalar, Variable } from '../script/types.js';

export type ConditionTerm = { key: string; op: 'eq' | 'gte'; value: Scalar };
export type EvidenceReference = { path: (string | number)[]; node?: string; ambiguous?: boolean };
const safeID = (id: string) => !!id.trim() && id === id.trim() && !['__proto__', 'prototype', 'constructor'].includes(id);

/** Same data-only operators as ScriptEngine. A repeated variable may have eq AND gte. */
export function conditionFromTerms(variables: Readonly<Record<string, Variable>>, terms: readonly ConditionTerm[]): Condition {
  const condition: Condition = {};
  for (const { key, op, value } of terms) {
    if (typeof key !== 'string' || !key || ['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(variables, key)) throw new Error('条件变量不存在');
    if (!['eq', 'gte'].includes(op) || typeof value !== typeof variables[key].initial
      || (typeof value === 'number' && !Number.isFinite(value)) || (op === 'gte' && typeof value !== 'number')) throw new Error('条件运算或值类型无效');
    const rule = condition[key] as { eq?: Scalar; gte?: number } | undefined;
    if (rule && Object.hasOwn(rule, op)) throw new Error('相同变量的条件运算重复');
    condition[key] = { ...rule, [op]: value };
  }
  return condition;
}

/** Inspect exact schema fields, never replace matching prose, unrelated chapters, or opaque saves. */
export function evidenceReferences(project: EngineProject, chapterId: string, id: string): EvidenceReference[] {
  if (project.type !== 'investigation') throw new Error('当前工程不是调查类型');
  const index = project.chapters.findIndex(chapter => chapter.id === chapterId), chapter = project.chapters[index];
  if (!chapter) throw new Error('章节不存在');
  const result: EvidenceReference[] = [];
  const list = (values: readonly string[] | undefined, path: (string | number)[], node?: string) => {
    values?.forEach((value, i) => { if (value === id) result.push({ path: [...path, i], node }); });
  };
  list(chapter.requiredEvidence, ['chapters', index, 'requiredEvidence']);
  for (const [nodeId, node] of Object.entries(chapter.nodes)) {
    const key = JSON.stringify([chapterId, nodeId]), path = ['chapters', index, 'nodes', nodeId];
    for (const name of ['requiresEvidence', 'excludesEvidence'] as const) list(node[name], [...path, name], key);
    node.actions.forEach((action, i) => {
      const actionPath = [...path, 'actions', i];
      list(action.requiresEvidence, [...actionPath, 'requiresEvidence'], key);
      for (const name of ['collect', 'hidesWhenCollected'] as const) if (action[name] === id) result.push({ path: [...actionPath, name], node: key });
    });
  }
  project.routeTests?.cases.forEach((test, i) => {
    if (!test.expect.evidence?.includes(id)) return;
    let owner: string | undefined;
    if (test.expect.lineId !== undefined) {
      const owners = project.chapters.filter(c => Object.keys(c.nodes).some(node => `${c.id}/${node}` === test.expect.lineId));
      if (owners.length === 1) owner = owners[0].id;
    }
    if (!owner && test.expect.sceneId !== undefined) {
      const owners = project.chapters.filter(c => Object.hasOwn(c.nodes, test.expect.sceneId!));
      if (owners.length === 1) owner = owners[0].id;
    }
    owner ??= project.chapters.length === 1 ? chapterId : undefined;
    if (owner && owner !== chapterId) return;
    test.expect.evidence.forEach((value, j) => {
      if (value === id) result.push({ path: ['routeTests', 'cases', i, 'expect', 'evidence', j], ...(!owner ? { ambiguous: true } : {}) });
    });
  });
  return result;
}

export function assertAuthorID(id: string): void {
  if (typeof id !== 'string' || !safeID(id)) throw new Error('无效 ID');
}
