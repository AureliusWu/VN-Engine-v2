import { createHealingEngine, createNetLoveEngine, createCircuitEngine, createHealingSaveCodec, createNetLoveSaveCodec,
  createStore, canRead, filterHistory, healingPresentationAt, netlovePresentationAt, cgAt } from './dist/index.js';

const $ = id => document.getElementById(id);
const fixtures = await Promise.all(['healing/story.json', 'netlove/story.json', 'circuit/chapters.json'].map(path => fetch('./examples/' + path).then(response => {
  if (!response.ok) throw new Error('样例资源缺失'); return response.json();
})));
let mode = 'healing', engine, state, codec, store, hidden = false, panel = false;
const conditions = () => ({ visible: !document.hidden, panelOpen: panel, interfaceHidden: hidden, manualPause: false });
const element = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
const button = (text, action, enabled = true) => { const item = element('button', text); item.disabled = !enabled; item.addEventListener('click', action); return item; };
const notify = text => { $('message').textContent = text; };
let storage; try { storage = localStorage; } catch { storage = null; }

function select(next) {
  mode = next; hidden = false; panel = false; $('history-panel').hidden = true; $('hide').textContent = '隐藏界面';
  document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.mode === mode)));
  if (mode === 'circuit') { engine = createCircuitEngine(fixtures[2].chapters); state = engine.newCampaign(); codec = { decode: raw => engine.restoreCampaign(JSON.parse(raw)) }; }
  else if (mode !== 'renpy') {
    engine = mode === 'healing' ? createHealingEngine(fixtures[0].scenes) : createNetLoveEngine(fixtures[1].scenes);
    codec = mode === 'healing' ? createHealingSaveCodec(engine) : createNetLoveSaveCodec(engine); state = engine.newGame();
  }
  if (mode !== 'renpy') store = createStore(`vn-engine-demo:${mode}:v1`, storage, codec);
  notify(''); render();
}
function act(action) { if (!canRead(conditions())) return; action(); notify(''); render(); }
function render() {
  const stage = $('stage'), status = $('state'), evidence = $('evidence'); stage.replaceChildren(); status.replaceChildren(); evidence.replaceChildren();
  for (const id of ['save', 'load', 'history', 'hide']) $(id).disabled = mode === 'renpy' || (id === 'history' && mode === 'circuit');
  $('save').disabled ||= panel || hidden; $('load').disabled ||= panel || hidden;
  $('history').disabled ||= hidden; $('hide').disabled ||= panel;
  if (mode === 'renpy') {
    stage.append(element('p', 'NATIVE REN’PY · BUILD ADAPTER', 'scene-label'), element('p', '保留原生运行时', 'speaker'),
      element('p', '结构化剧本编译为标准 Ren’Py DSL，存档、回滚与演出继续由 Ren’Py 管理。', 'dialogue'),
      element('code', 'python -m adapters.renpy --story examples/renpy/story.json --out examples/renpy/game'));
    status.append(element('p', '独立 Python 适配器与两条分支样例。运行命令后可用 Ren’Py SDK 打开 examples/renpy。')); return;
  }
  if (hidden) { stage.append(element('p', '阅读已暂停。使用下方“恢复界面”返回。', 'dialogue')); return; }
  const list = element('dl');
  const info = (label, value) => list.append(element('dt', label), element('dd', String(value ?? '—')));
  const choices = element('div', undefined, 'choices');
  if (mode === 'circuit') {
    const chapter = engine.getChapter(state.state.chapterId), node = chapter.nodes[state.state.nodeId];
    stage.append(element('p', chapter.title + ' / ' + node.kind, 'scene-label'), element('p', node.speaker ?? '调查记录', 'speaker'), element('p', node.text, 'dialogue'));
    for (const action of engine.actions(state.state)) choices.append(button(action.label, () => act(() => {
      const next = engine.transition(state.state, action.id); if (next) state = engine.complete({ ...state, state: next });
    }), canRead(conditions())));
    if (node.outcome === 'complete') for (const id of engine.unlocked(state.completed)) if (id !== chapter.id) choices.append(button('进入 ' + engine.getChapter(id).title, () => act(() => { state = engine.startChapter(state, id); })));
    info('章节', state.state.chapterId); info('节点', state.state.nodeId); info('完成章节', state.completed.join(', ') || '尚未完成');
    evidence.append(element('h2', '证据簿'));
    const items = element('ul'); for (const id of state.state.evidence) items.append(element('li', chapter.evidence[id].title)); evidence.append(items);
  } else {
    const scene = engine.getScene(state), line = scene.lines[state.line], presentation = mode === 'healing' ? healingPresentationAt(scene, state.line) : netlovePresentationAt(scene, state.line);
    stage.append(element('p', `${scene.title ?? scene.id} / ${line.medium ?? '现场'}`, 'scene-label'), element('p', line.speaker, 'speaker'), element('p', line.text, 'dialogue'));
    const last = state.line === scene.lines.length - 1;
    if (last && scene.choices) for (const choice of scene.choices) choices.append(button(choice.text, () => act(() => { state = engine.choose(state, choice.id); }), canRead(conditions())));
    else if (last && scene.continuation) choices.append(button('继续章节', () => act(() => { state = engine.continueStory(state); }), canRead(conditions())));
    else if (!(last && (scene.ending || scene.chapterEnd))) choices.append(button('下一段', () => act(() => { state = engine.advance(state); }), canRead(conditions())));
    else choices.append(element('span', '样例已完成'));
    info('位置', `${state.sceneId} · ${state.line + 1}/${scene.lines.length}`); info('在场角色', presentation.character ?? '无'); info('表情', presentation.expression); info('事件插图', cgAt(scene, state.line)); info('选择记录', state.decisions.length); info('状态', JSON.stringify(state.stats));
  }
  stage.append(choices); status.append(list);
}
$('save').onclick = () => {
  try { const value = mode === 'circuit' ? state : codec.encode(state); notify(store.write('1', value).status === 'saved' ? '已保存当前段落' : '存储暂不可用，可以继续游玩'); }
  catch { notify('存档未完成，可以继续游玩'); }
};
$('load').onclick = () => {
  const loaded = store.load('1');
  if (loaded.status === 'valid') { state = mode === 'circuit' ? loaded.value : loaded.value.state; render(); notify('已恢复存档'); }
  else notify(loaded.status === 'empty' ? '还没有存档' : loaded.reason);
};
$('restart').onclick = () => select(mode);
$('hide').onclick = () => { hidden = !hidden; $('hide').textContent = hidden ? '恢复界面' : '隐藏界面'; render(); };
function history() {
  const entries = filterHistory(engine.recordLine(state).history, $('query').value);
  $('records').replaceChildren(...entries.map(entry => {
    const row = button(entry.text, () => { state = engine.reread(state, entry); closeHistory(); notify('已恢复已读段落，可重新选择'); }); row.className = 'record'; row.prepend(element('small', entry.speaker + ' · ' + entry.sceneId)); return row;
  }));
}
function closeHistory() { panel = false; $('history-panel').hidden = true; render(); }
$('history').onclick = () => { panel = true; $('history-panel').hidden = false; $('query').value = ''; render(); history(); $('query').focus(); };
$('close-history').onclick = closeHistory; $('query').oninput = history;
document.addEventListener('visibilitychange', render);
document.querySelectorAll('[data-mode]').forEach(item => item.onclick = () => select(item.dataset.mode));
select(mode);
if ('serviceWorker' in navigator) {
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    const show = () => { $('offline-state').textContent = registration.active?.state === 'activated' ? '可离线运行' : '离线资源准备中'; };
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    worker?.addEventListener('statechange', show); show();
  } catch { $('offline-state').textContent = '离线准备失败，可联网重试'; }
} else $('offline-state').textContent = '浏览器未启用离线支持';
