import { variableReferences, chapterReferences, hasAuthoredReplay } from '../lib/editor/index.js';
import { guardedFields, numeric } from './logic.mjs';

export function renderStructureEditor(parent, api) {
  const { element, action, project, model, mutate, set, navigate } = api, field = guardedFields(api.field);
  parent.replaceChildren();
  if (project.type === 'script') {
    parent.append(element('h2', '变量目录'), element('p', '先声明变量，再通过节点的效果与条件表单编写剧情。改名会同步引用，已引用变量不能直接删除或改类型。', { class: 'help' }));
    for (const [id, definition] of Object.entries(project.program.variables)) {
      const card = element('article', undefined, { class: 'asset-card', 'data-variable-id': id }), prefix = `变量 ${id}`; parent.append(card);
      card.append(element('h3', id));
      field(card, `${prefix} ID`, id, next => mutate(() => model.renameVariable(id, next), true));
      const boolean = typeof definition.initial === 'boolean';
      field(card, `${prefix} 类型`, boolean ? 'boolean' : 'number', kind => mutate(() => model.updateVariable(id, { initial: kind === 'boolean' ? false : 0 }), true), { choices: [['number', '数值'], ['boolean', '布尔']] });
      field(card, `${prefix} 初值`, String(definition.initial), value => mutate(() => model.updateVariable(id, { ...definition, initial: boolean ? value === 'true' : numeric(value) }), true), boolean ? { choices: [['true', '是'], ['false', '否']] } : {});
      if (!boolean) for (const [name, label] of [['min', '最小值'], ['max', '最大值']]) field(card, `${prefix} ${label}`, definition[name] ?? '', value => {
        const next = { ...definition }; if (!value.trim()) delete next[name]; else next[name] = numeric(value);
        mutate(() => model.updateVariable(id, next), true);
      }, { placeholder: '留空表示不限制' });
      const refs = variableReferences(project, id), remove = action(`删除变量 ${id}`, () => mutate(() => model.removeVariable(id), true), 'small-button danger'); remove.disabled = !!refs.length;
      card.append(element('p', `${refs.length} 处引用`, { class: 'help' }), remove);
      const nodes = [...new Set(refs.map(ref => ref.node).filter(Boolean))];
      nodes.forEach((key, i) => card.append(action(`定位 ${id} 引用 ${i + 1}`, () => navigate(key))));
    }
    parent.append(action('添加数值变量', () => mutate(() => model.addVariable('number'), true)), action('添加布尔变量', () => mutate(() => model.addVariable('boolean'), true)));
    return;
  }
  if (project.type === 'investigation') {
    parent.append(element('h2', '调查章节'), element('p', '章节顺序决定开场与解锁次序；排序后请重新运行路线测试。重命名同步章节动作、结局、演出与定位，含引用的章节禁止直接删除。', { class: 'help' }));
    const chapters = [...project.chapters].sort((a, b) => a.order - b.order), replay = hasAuthoredReplay(project);
    if (replay) parent.append(element('p', '工程含剧情回看存档。修改章节 ID、顺序或删除前，请先移除回看点，修改后重新录制。', { class: 'help' }));
    chapters.forEach((chapter, order) => {
      const card = element('article', undefined, { class: 'asset-card', 'data-chapter-id': chapter.id }), prefix = `章节 ${chapter.id}`, index = project.chapters.findIndex(item => item.id === chapter.id); parent.append(card);
      card.append(element('h3', `第 ${order + 1} 章 · ${chapter.title}`));
      const identity = field(card, `${prefix} ID`, chapter.id, id => mutate(() => api.renameChapter(chapter.id, id), true)); identity.disabled = replay;
      field(card, `${prefix} 标题`, chapter.title, title => { if (!title.trim()) throw Error('章节标题不能为空'); set(['chapters', index, 'title'], title, true); });
      field(card, `${prefix} 入口`, chapter.entryNode, value => {
        if (!Object.hasOwn(chapter.nodes, value)) throw Error('章节入口不存在'); set(['chapters', index, 'entryNode'], value, true);
      }, { choices: Object.keys(chapter.nodes) });
      const refs = chapterReferences(project, chapter.id), up = action(`${prefix} 上移`, () => mutate(() => model.moveChapter(chapter.id, -1), true));
      const down = action(`${prefix} 下移`, () => mutate(() => model.moveChapter(chapter.id, 1), true)); up.disabled = !order || replay; down.disabled = order === chapters.length - 1 || replay;
      const remove = action(`删除章节 ${chapter.id}`, () => { if (confirm('删除此章节及其节点、演出和布局？可以撤销。')) mutate(() => model.removeChapter(chapter.id), true); }, 'small-button danger'); remove.disabled = chapters.length === 1 || refs.length > 0 || replay;
      card.append(element('p', `${Object.keys(chapter.nodes).length} 节点 · ${refs.length} 处外部引用`, { class: 'help' }), action(`编辑 ${chapter.id} 入口`, () => navigate(JSON.stringify([chapter.id, chapter.entryNode]))), up, down, remove);
    });
    parent.append(action('添加章节', () => mutate(() => model.addChapter(), true)));
    return;
  }
  parent.append(element('p', '本工作台管理条件剧本变量和调查章节。当前类型的原始数据继续保留在工程 JSON 中。', { class: 'help' }));
}
