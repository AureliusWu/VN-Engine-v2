import { conditionFromTerms, evidenceReferences } from '../lib/editor/index.js';

export function guardedFields(field) {
  return (parent, label, value, change, options) => {
    const input = field(parent, label, value, next => {
      try { change(next); } catch (error) { input.value = value ?? ''; throw error; }
    }, options);
    return input;
  };
}
export function numeric(text) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) || !Number.isFinite(Number(text))) throw Error('请输入有限数值');
  return Number(text);
}
function termsFor(condition = {}) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw Error('条件结构无效，请使用高级 JSON 修复');
  return Object.entries(condition).flatMap(([key, rule]) => {
    if (typeof rule === 'number' || typeof rule === 'boolean') return [{ key, op: 'eq', value: rule }];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !Object.keys(rule).length || Object.keys(rule).some(op => !['eq', 'gte'].includes(op))) throw Error('条件运算无法用表单表示，请使用高级 JSON 修复');
    return Object.entries(rule).map(([op, value]) => ({ key, op, value }));
  });
}

export function renderBranchEditor(parent, path, api) {
  const { element, action, valueAt, set, project } = api, field = guardedFields(api.field);
  const variables = project.program.variables, routes = valueAt(path), targets = project.program.blocks.map(block => [block.id, block.title ?? block.id]);
  const keys = Object.keys(variables);
  const write = (index, terms) => {
    if (!terms.length && index !== routes.length - 1) throw Error('条件路由至少保留一个条件；无条件兜底必须放在最后');
    set([...path, index, 'when'], conditionFromTerms(variables, terms), true);
  };
  const firstAvailable = terms => {
    for (const key of keys) for (const op of typeof variables[key].initial === 'number' ? ['eq', 'gte'] : ['eq']) {
      if (!terms.some(term => term.key === key && term.op === op)) return { key, op, value: variables[key].initial };
    }
  };
  if (!Array.isArray(routes)) { parent.append(element('p', '路由列表无效，请使用高级 JSON 修复。', { class: 'help' })); return; }
  routes.forEach((route, index) => {
    const prefix = `路由 ${index + 1}`, card = element('div', undefined, { class: 'line-card', 'data-author-route': index }); parent.append(card);
    const fallback = index === routes.length - 1 && !Object.keys(route.when ?? {}).length;
    card.append(element('h3', fallback ? `${prefix} · 最后兜底` : `${prefix} · 条件全部满足`));
    const choices = targets.some(([id]) => id === route.next) ? targets : [[route.next, `${route.next}（缺失）`], ...targets];
    field(card, `${prefix} 目标`, route.next, value => set([...path, index, 'next'], value, true), { choices });
    if (fallback) { card.append(element('p', '前面的条件均不满足时进入此节点。兜底固定在最后。', { class: 'help' })); return; }
    let terms;
    try { terms = termsFor(route.when); }
    catch (error) { card.append(element('p', error.message, { class: 'help' })); return; }
    terms.forEach((term, termIndex) => {
      const name = `${prefix} 条件 ${termIndex + 1}`, row = element('div', undefined, { class: 'condition-term' }); card.append(row);
      const change = patch => { const next = terms.map(term => ({ ...term })); next[termIndex] = { ...next[termIndex], ...patch }; write(index, next); };
      const variableChoices = keys.includes(term.key) ? keys : [term.key, ...keys];
      field(row, `${name} 变量`, term.key, key => {
        const value = variables[key]?.initial; if (value === undefined) throw Error('条件变量不存在');
        change({ key, op: typeof value === 'boolean' ? 'eq' : term.op, value });
      }, { choices: variableChoices });
      const isBoolean = typeof variables[term.key]?.initial === 'boolean';
      field(row, `${name} 运算`, term.op, op => change({ op }), { choices: isBoolean ? [['eq', '等于']] : [['eq', '等于'], ['gte', '大于等于']] });
      field(row, `${name} 值`, String(term.value), text => change({ value: isBoolean ? text === 'true' : numeric(text) }), isBoolean ? { choices: [['true', '是'], ['false', '否']] } : {});
      row.append(action(`${name} 移除`, () => write(index, terms.filter((_, i) => i !== termIndex)), 'small-button danger'));
    });
    const add = action(`${prefix} 添加条件`, () => { const term = firstAvailable(terms); if (!term) throw Error('没有可添加的条件'); write(index, [...terms, term]); });
    add.disabled = !firstAvailable(terms); card.append(add);
    const move = direction => { const next = structuredClone(routes); [next[index], next[index + direction]] = [next[index + direction], next[index]]; set(path, next, true); };
    const up = action(`${prefix} 上移`, () => move(-1)); up.disabled = index === 0;
    const down = action(`${prefix} 下移`, () => move(1)); down.disabled = index >= routes.length - 2;
    card.append(up, down, action(`${prefix} 删除`, () => set(path, routes.filter((_, i) => i !== index), true), 'small-button danger'));
  });
  const add = action('添加条件路由', () => {
    const term = firstAvailable([]); if (!term) throw Error('请先声明至少一个变量');
    const last = routes.at(-1); if (!last || Object.keys(last.when ?? {}).length) throw Error('请先通过高级 JSON 补齐最后兜底');
    const next = structuredClone(routes); next.splice(next.length - 1, 0, { when: conditionFromTerms(variables, [term]), next: last.next }); set(path, next, true);
  });
  add.disabled = !keys.length; parent.append(add);
  if (!keys.length) parent.append(element('p', '先在变量声明中定义数值或布尔变量，再添加条件路由。', { class: 'help' }));
}

export function evidenceChecklist(parent, label, path, chapter, api) {
  const { element, valueAt, set } = api, values = valueAt(path) ?? [];
  const root = element('fieldset', undefined, { class: 'evidence-checklist', 'aria-label': label }); root.append(element('legend', label)); parent.append(root);
  if (!Array.isArray(values) || values.some(id => typeof id !== 'string')) { root.append(element('p', '证据列表无效，请使用高级 JSON 修复。', { class: 'help' })); return; }
  const ids = [...new Set([...Object.keys(chapter.evidence), ...values])];
  if (!ids.length) root.append(element('p', '本章尚无证据。', { class: 'help' }));
  for (const id of ids) {
    const wrap = element('label', undefined, { class: 'check evidence-option' }), input = element('input', undefined, { type: 'checkbox', 'aria-label': `${label} ${id}` });
    input.checked = values.includes(id); input.addEventListener('change', () => {
      const next = values.filter(value => value !== id); if (input.checked) next.push(id); api.run(() => set(path, next, true));
    });
    wrap.append(input, element('span', chapter.evidence[id] ? `${chapter.evidence[id].title} · ${id}` : `${id}（缺失）`)); root.append(wrap);
  }
}

export function renderEvidenceCatalog(parent, chapter, index, api) {
  const { element, action, valueAt, set, project, mutate, model } = api, field = guardedFields(api.field), path = ['chapters', index];
  evidenceChecklist(parent, '本章完成所需证据', [...path, 'requiredEvidence'], chapter, api);
  for (const [id, evidence] of Object.entries(chapter.evidence)) {
    const card = element('div', undefined, { class: 'line-card', 'data-evidence-entry': id }), prefix = `证据 ${id}`; parent.append(card);
    field(card, `${prefix} ID`, id, next => mutate(() => model.renameEvidence(chapter.id, id, next), true));
    for (const [key, label] of [['title', '标题'], ['detail', '内容']]) field(card, `${prefix} ${label}`, evidence[key], value => set([...path, 'evidence', id], { ...valueAt([...path, 'evidence', id]), [key]: value }, true), { multiline: key === 'detail' });
    const refs = evidenceReferences(project, chapter.id, id), remove = action(`删除证据 ${id}`, () => mutate(() => model.removeEvidence(chapter.id, id), true), 'small-button danger');
    remove.disabled = !!refs.length; card.append(element('p', `${refs.length} 处引用${refs.some(ref => ref.ambiguous) ? '，含章节待确认的路线断言' : ''}`, { class: 'help' }), remove);
  }
  parent.append(action('添加证据', () => mutate(() => model.addEvidence(chapter.id), true)));
  parent.append(element('p', '重命名同步同章引用和明确归属的路线断言。已有发行作品修改 ID 前需安排存档兼容。', { class: 'help' }));
}

export function renderEffectsEditor(parent, blockId, choice, prefix, api) {
  const { element, action, model, mutate, project } = api, field = guardedFields(api.field);
  const effects = choice.effects ?? [], variables = project.program.variables, keys = Object.keys(variables);
  if (!Array.isArray(effects)) { parent.append(element('p', '效果列表无效，请使用高级 JSON 修复。', { class: 'help' })); return; }
  const write = next => mutate(() => model.setChoiceEffects(blockId, choice.id, next), true);
  effects.forEach((effect, index) => {
    const row = element('div', undefined, { class: 'condition-term' }), label = `${prefix} 效果 ${index + 1}`; parent.append(row);
    const change = patch => { const next = structuredClone(effects); next[index] = { ...next[index], ...patch }; write(next); };
    field(row, `${label} 变量`, effect.key, key => {
      const definition = variables[key]; if (!definition) throw Error('效果变量不存在');
      const op = typeof definition.initial === 'boolean' ? 'set' : effect.op;
      change({ key, op, value: op === 'add' ? 0 : definition.initial });
    }, { choices: keys.includes(effect.key) ? keys : [effect.key, ...keys] });
    const boolean = typeof variables[effect.key]?.initial === 'boolean';
    field(row, `${label} 运算`, effect.op, op => change({ op }), { choices: boolean ? [['set', '赋值']] : [['add', '累加'], ['set', '赋值']] });
    field(row, `${label} 值`, String(effect.value), value => change({ value: boolean ? value === 'true' : numeric(value) }), boolean ? { choices: [['true', '是'], ['false', '否']] } : {});
    const move = delta => { const next = structuredClone(effects); [next[index], next[index + delta]] = [next[index + delta], next[index]]; write(next); };
    const up = action(`${label} 上移`, () => move(-1)), down = action(`${label} 下移`, () => move(1)); up.disabled = !index; down.disabled = index === effects.length - 1;
    row.append(up, down, action(`${label} 删除`, () => write(effects.filter((_, i) => i !== index)), 'small-button danger'));
  });
  const add = action(`${prefix} 添加效果`, () => { const key = keys[0], definition = variables[key]; write([...effects, { key, op: typeof definition.initial === 'number' ? 'add' : 'set', value: typeof definition.initial === 'number' ? 0 : definition.initial }]); });
  add.disabled = !keys.length; parent.append(add);
  parent.append(element('p', '效果按列表顺序执行。边界和类型即时检查；整条路线仍需实际回归。', { class: 'help' }));
}
