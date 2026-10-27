import { projectEndings } from '../lib/index.js';

export function renderCollectionsEditor(root, { project, element, field, action, set, captureReplay }) {
  root.replaceChildren();
  const metadata = project.collections ?? {}, change = edit => { const next = structuredClone(project.collections ?? {}); edit(next); set(['collections'], next, true); };
  for (const [kind, title, ids] of [['cgs', 'CG', project.assets.filter(a => a.kind === 'cg').map(a => a.id)], ['endings', '结局', projectEndings(project)]]) {
    const group = element('section'); group.append(element('h2', title)); root.append(group);
    const entries = Array.isArray(metadata[kind]) ? metadata[kind] : [];
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') { group.append(element('p', '条目格式错误，请在工程 JSON 中修复。')); return; }
      const card = element('article', undefined, { class: 'asset-card' }), label = `${title} ${index + 1}`;
      card.append(element('h3', label)); group.append(card);
      const edit = fn => change(next => fn(next[kind][index]));
      const choices = ids.map(id => [id, id]); if (!ids.includes(entry.id)) choices.push([entry.id ?? '', '当前引用（缺失）']);
      field(card, `${label} ID`, entry.id, id => edit(next => { next.id = id; }), { choices });
      field(card, `${label} 标题`, entry.title ?? '', value => edit(next => { if (value) next.title = value; else delete next.title; }));
      if (kind === 'endings') field(card, `${label} 真结局`, entry.trueEnding ? 'true' : 'false', value => edit(next => { next.trueEnding = value === 'true'; }), { choices: [['false', '普通结局'], ['true', 'True Ending']] });
      field(card, `${label} 回看数据`, entry.replay === undefined ? '' : JSON.stringify(entry.replay, null, 2), value => edit(next => {
        if (value.trim()) next.replay = JSON.parse(value); else delete next.replay;
      }), { multiline: true });
      card.append(action('使用当前预览作为回看起点', async () => {
        const saved = await captureReplay(); edit(next => { next.replay = saved; });
      }), action(`删除${title} ${index + 1}`, () => change(next => { next[kind].splice(index, 1); }), 'small-button danger'));
    });
    const unused = ids.find(id => !entries.some(entry => entry?.id === id));
    const add = action(`添加${title}`, () => change(next => { next[kind] ??= []; next[kind].push({ id: unused }); }));
    add.disabled = unused === undefined; group.append(add);
  }
  const policy = element('section'); root.append(policy); policy.append(element('h2', '真路线解锁条件'), element('p', '全部条件满足后解锁，只写入独立 Meta；回看不计入条件，也不会修改剧情变量。', { class: 'help' }));
  if (!metadata.trueRoute) { policy.append(action('启用真路线规则', () => change(next => { next.trueRoute = { minPlaythroughs: 1 }; }))); return; }
  for (const [key, label] of [['endings', '需要看过的结局 ID'], ['cgs', '需要解锁的 CG ID']]) field(policy, label, (metadata.trueRoute[key] ?? []).join(', '), value => change(next => {
    const ids = value.split(/[\s,，]+/).filter(Boolean); if (ids.length) next.trueRoute[key] = ids; else delete next.trueRoute[key];
  }));
  field(policy, '最少完成周目数', metadata.trueRoute.minPlaythroughs ?? '', value => change(next => {
    if (value.trim()) next.trueRoute.minPlaythroughs = Number(value); else delete next.trueRoute.minPlaythroughs;
  }));
  policy.append(action('移除真路线规则', () => change(next => { delete next.trueRoute; }), 'small-button danger'));
}
