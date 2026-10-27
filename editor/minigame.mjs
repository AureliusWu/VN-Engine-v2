export function renderMiniGameEditor(parent, cue, { field, action, element, changeCue, actions }) {
  parent.append(element('p', '小游戏绑定在带选择的最后一句。结果写回已有剧情操作；当前内置开关谜题。', { class: 'help' }));
  const game = cue.miniGame;
  if (!game) {
    const button = action('配置小游戏', () => changeCue(next => { next.miniGame = { id: 'puzzle-1', kind: 'switches', initial: [false, false, false], target: [true, true, true], maxMoves: 6,
      results: { success: actions[0], failure: actions[1] ?? actions[0], abort: actions[1] ?? actions[0], skip: actions[0] } }; }));
    button.disabled = !actions.length; parent.append(button); return;
  }
  const edit = change => changeCue(next => change(next.miniGame));
  field(parent, '小游戏 ID', game.id, value => edit(next => { next.id = value; }));
  for (const [key, label] of [['initial', '初始开关'], ['target', '目标开关']]) field(parent, label, Array.isArray(game[key]) ? game[key].map(value => value ? '1' : '0').join('') : '', value => edit(next => {
    if (!/^[01]{1,9}$/.test(value.trim())) throw new Error('开关请输入 1–9 位的 0 或 1'); next[key] = [...value.trim()].map(value => value === '1');
  }));
  field(parent, '小游戏最多操作数', game.maxMoves, value => edit(next => { next.maxMoves = Number(value); }));
  for (const [key, label] of [['success', '成功结果'], ['failure', '失败结果'], ['abort', '退出结果'], ['skip', '跳过结果']]) {
    const choices = [...(key === 'skip' ? [['', '禁止跳过']] : []), ...actions.map(id => [id, id])];
    const current = game.results?.[key] ?? ''; if (current && !choices.some(([id]) => id === current)) choices.push([current, '当前引用（缺失）']);
    field(parent, label, current, value => edit(next => { next.results ??= {}; if (value) next.results[key] = value; else delete next.results[key]; }), { choices });
  }
  parent.append(action('移除小游戏', () => changeCue(next => { delete next.miniGame; }), 'small-button danger'));
}
