import { EditorModel, newProject } from '../lib/editor/index.js';
import { renderPresentationEditor } from './presentation.mjs';
import { renderCollectionsEditor } from './collections.mjs';
import { createRoutesPanel } from './routes.mjs';
import { renderBranchEditor, renderEvidenceCatalog, evidenceChecklist, renderEffectsEditor } from './logic.mjs';
import { renderStructureEditor } from './structure.mjs';
import { ENGINE_VERSION } from '../lib/index.js';
import { nativeHost, nativeRequest } from './native.mjs';

const $ = id => document.getElementById(id);
const DRAFT_KEY = 'vn-engine-studio:draft:v1';
let model = new EditorModel(newProject('script')), selected, tab = 'story', draft, draftTimer, previewTimer;
let baseURL = new URL('../samples/', location.href).href, resourceURLs = new Map(), resourceFiles, previewReady = false, revision = 0, savedSource = '';
let nativeHidden = false;
let replayRequest;
let routeRequest;
const openInspectorSections = new Set();
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
function element(tag, text, attrs = {}) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) { if (key === 'class') node.className = value; else node.setAttribute(key, value); }
  return node;
}
function action(label, callback, className = 'small-button') {
  const button = element('button', label, { type: 'button', class: className });
  button.addEventListener('click', () => run(callback)); return button;
}
async function run(fn) { try { await fn(); } catch (error) { status(error.message, true); } }
function field(parent, label, value, callback, options = {}) {
  const wrap = element('label', undefined, { class: 'field' }), caption = element('span', label);
  let input;
  if (options.choices) {
    input = element('select'); for (const choice of options.choices) { const [id, title] = Array.isArray(choice) ? choice : [choice, choice]; input.append(element('option', title, { value: id })); }
  } else input = element(options.multiline ? 'textarea' : 'input');
  input.setAttribute('aria-label', label); input.value = value ?? ''; if (options.placeholder) input.placeholder = options.placeholder;
  input.addEventListener('change', () => run(() => callback(input.value)));
  wrap.append(caption, input); parent.append(wrap); return input;
}
const valueAt = path => path.reduce((v, key) => v?.[key], model.getView().project);
const graphNode = () => model.graph().nodes.find(n => n.key === selected);
const unappliedSource = () => tab === 'source' && $('source').value !== savedSource;
const routes = createRoutesPanel($('route-list'), {element,action,field,project:()=>model.getView().project,set:value=>set(['routeTests'],value,true),
  record:()=>preview({recordRoute:true}),capture:id=>{
    if(!routes.active)throw Error('录制已中断或工程已更改，请从头录制');
    if(!previewReady||Number(document.body.dataset.previewRevision)!==revision)throw Error('预览尚未就绪');if(routeRequest)throw Error('正在获取录制结果');
    const current=revision,documentSource=model.serialize(true);return new Promise((resolve,reject)=>{
      routeRequest={revision:current,resolve:test=>{if(documentSource!==model.serialize(true))reject(Error('工程已改变，请重新录制'));else resolve(test);},reject,
        timer:setTimeout(()=>{routeRequest=undefined;reject(Error('录制预览未响应，请重新录制'));},5000)};
      $('preview').contentWindow.postMessage({source:'vn-engine-studio',type:'capture-route',revision:current,id},location.origin);
    });
  },download,navigate:state=>{const node=model.graph().nodes.find(n=>n.id===state.sceneId&&(!n.chapter||state.lineId.startsWith(n.chapter+'/')));if(!node)throw Error('此运行节点没有对应的可编辑节点');selected=node.key;switchTab('story');renderGraph(model.graph());renderInspector();}});
function mutate(fn, inspector = false) { fn(); update(inspector); status('更改已记录，可撤销'); }
function set(path, value, inspector = false) { mutate(() => model.set(path, value), inspector); }
function scheduleDraft() {
  clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 350);
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ schema: 1, document: JSON.parse(model.serialize()), source: unappliedSource() ? $('source').value : undefined, baseURL: baseURL.startsWith(location.origin + '/') ? baseURL : undefined, at: new Date().toISOString() })); }
  catch { status('本地草稿无法保存，请使用“保存工程”保留更改', true); }
}
function clearResources(nextBase = new URL('./', location.href).href) {
  for (const url of resourceURLs.values()) URL.revokeObjectURL(url);
  resourceURLs.clear(); resourceFiles = undefined; baseURL = nextBase; $('asset-state').textContent = '未绑定目录；资源路径相对于工程文件。';
}
function replace(input, options = {}) {
  const next = new EditorModel(input); // Fully parse before touching the current editor or its resources.
  clearResources(options.baseURL); if (options.files) resourceFiles = new Set(options.files); model = next; selected = model.graph().nodes[0]?.key;
  savedSource = ''; tab = 'story'; renderProject(); update(true); switchTab('story');
  if (options.draft) { model.markUnsaved(); document.body.dataset.dirty = 'true'; $('save-state').textContent = '● 未保存'; status('草稿已恢复；请重新绑定本地资源目录'); }
  else status('工程已打开');
}
function canReplace() { return (!model.dirty && !unappliedSource()) || confirm('当前更改尚未保存。仍要替换当前工程吗？本地草稿只保留一份。'); }
function renderProject() {
  const root = $('project-fields'); root.replaceChildren();
  const project = model.getView().project;
  for (const [key, label] of [['title', '作品名称'], ['game', '作品 ID'], ['version', '故事版本']]) field(root, label, project[key], value => set([key], value));
  field(root, '启动界面', project.titleScreen ? 'title' : 'story', value => set(['titleScreen'], value === 'title', true), { choices: [['story', '直接阅读'], ['title', '标题菜单']] });
  field(root, '允许回退', project.rollback?.enabled === false ? 'false' : 'true', value => { set(['rollback'], { ...model.getView().project.rollback, enabled: value === 'true' }, true); renderProject(); }, { choices: [['true', '允许'], ['false', '关闭']] });
  field(root, '回退保留步数', project.rollback?.limit ?? 80, value => set(['rollback'], { ...model.getView().project.rollback, limit: Number(value) }, true));
}
function update(inspector = false) {
  routes.changed();
  const startup = document.querySelector('#project-fields [aria-label="启动界面"]'); if (startup) startup.value = model.getView().project.titleScreen ? 'title' : 'story';
  const graph = model.graph(); if (!graph.nodes.some(n => n.key === selected)) selected = graph.nodes[0]?.key;
  $('project-name').textContent = model.getView().project.title || '未命名作品'; $('save-state').textContent = model.dirty ? '● 未保存' : '已保存';
  document.body.dataset.dirty = String(model.dirty || unappliedSource()); document.body.dataset.projectType = model.getView().project.type;
  document.querySelector('[data-command=undo]').disabled = !model.canUndo; document.querySelector('[data-command=redo]').disabled = !model.canRedo;
  document.querySelector('[data-command=add-node]').disabled = model.getView().project.type === 'rain';
  $('graph-count').textContent = `${graph.nodes.length} 节点 · ${graph.edges.length} 连线`;
  renderGraph(graph); renderDiagnostics();
  if (inspector) {
    const panel = $('inspector').parentElement, scrollTop = panel.scrollTop;
    renderInspector(); panel.scrollTop = scrollTop;
  }
  if (tab === 'assets' && inspector) renderAssets();
  if (tab === 'collections' && inspector) renderCollections();
  if (tab === 'structure' && inspector) renderStructure();
  if (tab === 'routes') routes.render();
  if (tab === 'source' && savedSource === $('source').value) { $('source').value = model.serialize(true); savedSource = $('source').value; }
  if (model.dirty) scheduleDraft();
  if ($('auto-preview').checked) { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 300); } else $('preview-state').textContent = '更改后点击“从头试玩”';
}
function positionFor(node, index) { return model.getView().positions[node.key] ?? { x: 36 + (index % 3) * 255, y: 38 + Math.floor(index / 3) * 175 }; }
function renderGraph(graph) {
  const points = new Map(graph.nodes.map((node, i) => [node.key, positionFor(node, i)]));
  const width = Math.max(780, ...[...points.values()].map(p => p.x + 245)), height = Math.max(370, ...[...points.values()].map(p => p.y + 160));
  $('graph').style.width = width + 'px'; $('graph').style.height = height + 'px'; $('edges').replaceChildren(); $('nodes').replaceChildren();
  const svg = (name, attrs, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text) e.textContent = text; return e; };
  const defs = svg('defs', {}), marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', style: 'fill:#8ab4ba;stroke:none' })); defs.append(marker); $('edges').append(defs);
  const totals = new Map(), seen = new Map();
  for (const edge of graph.edges) { const pair = JSON.stringify([edge.from, edge.to]); totals.set(pair, (totals.get(pair) ?? 0) + 1); }
  for (const edge of graph.edges) {
    const a = points.get(edge.from), b = points.get(edge.to); if (!a || !b) continue;
    const pair = JSON.stringify([edge.from, edge.to]), index = seen.get(pair) ?? 0; seen.set(pair, index + 1);
    const offset = (index - (totals.get(pair) - 1) / 2) * 25;
    const x1 = a.x + 205, y1 = a.y + 54 + offset, x2 = b.x, y2 = b.y + 54 + offset, bend = Math.max(50, Math.abs(x2 - x1) / 2);
    const path = svg('path', { d: `M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}`, 'marker-end': 'url(#arrow)' });
    $('edges').append(path, svg('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 12, 'text-anchor': 'middle' }, edge.label.slice(0, 20)));
  }
  for (const node of graph.nodes) {
    const point = points.get(node.key), button = element('button', undefined, { class: 'node', type: 'button', 'aria-pressed': String(selected === node.key), 'aria-label': '编辑节点 ' + node.id });
    button.dataset.key = node.key; button.style.left = point.x + 'px'; button.style.top = point.y + 'px';
    button.append(element('small', node.entry ? 'ENTRY / 入口' : node.ending ? 'ENDING / 结局' : 'SCENE / 场景'), element('strong', node.title), element('p', node.text), element('div', node.id, { class: 'node-id' }));
    let drag;
    button.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, point }; button.setPointerCapture(event.pointerId); });
    button.addEventListener('pointermove', event => { if (!drag) return; const x = Math.max(0, point.x + event.clientX - drag.x), y = Math.max(0, point.y + event.clientY - drag.y); button.style.left = x + 'px'; button.style.top = y + 'px'; });
    button.addEventListener('pointerup', event => {
      if (!drag) return; const moved = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 5;
      const next = { x: Math.max(0, Math.min(100000, point.x + event.clientX - drag.x)), y: Math.max(0, Math.min(100000, point.y + event.clientY - drag.y)) }; drag = undefined;
      if (moved) { selected = node.key; mutate(() => model.move(node.key, next), true); }
    });
    button.addEventListener('pointercancel', () => { drag = undefined; button.style.left = point.x + 'px'; button.style.top = point.y + 'px'; });
    button.addEventListener('click', () => { selected = node.key; renderGraph(model.graph()); renderInspector(); });
    button.addEventListener('keydown', event => {
      if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); mutate(() => model.move(node.key, { x: Math.max(0, point.x + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0)), y: Math.max(0, point.y + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0)) }), true);
        [...document.querySelectorAll('.node')].find(b => b.dataset.key === node.key)?.focus();
      }
    });
    $('nodes').append(button);
  }
  if (!graph.nodes.length) $('nodes').append(element('p', '此格式使用 JSON 面板编辑；可直接在下方试玩。', { class: 'help' }));
}
function renderDiagnostics() {
  const diagnostics = model.diagnostics(resourceFiles), errors = diagnostics.filter(d => d.severity === 'error').length;
  $('diagnostic-count').textContent = errors ? `${errors} 错误` : diagnostics.length ? `${diagnostics.length} 提醒` : '通过';
  $('diagnostics').replaceChildren();
  if (!diagnostics.length) $('diagnostics').append(element('li', '结构与运行校验通过', { class: 'good' }));
  for (const diagnostic of diagnostics) {
    const li = element('li', undefined, { class: diagnostic.severity });
    if (diagnostic.node) li.append(action(diagnostic.message, () => { selected = diagnostic.node; switchTab('story'); renderGraph(model.graph()); renderInspector(); })); else li.textContent = diagnostic.message;
    $('diagnostics').append(li);
  }
  document.querySelector('[data-command=export]').disabled = errors > 0;
}
function nodeField(parent, label, path, options) { field(parent, label, valueAt(path), value => set(path, value), options); }
function jsonField(parent, label, path, fallback) { field(parent, label, JSON.stringify(valueAt(path) ?? fallback, null, 2), value => set(path, JSON.parse(value)), { multiline: true }); }
function inspectorSection(parent, key, title) {
  const details = element('details', undefined, { 'data-inspector-section': key }); details.open = openInspectorSections.has(key);
  details.append(element('summary', title)); details.addEventListener('toggle', () => {
    if (!details.isConnected) return; if (details.open) openInspectorSections.add(key); else openInspectorSections.delete(key);
  }); parent.append(details); return details;
}
function assetField(parent, label, cuePath, name, kind) {
  const assets = model.getView().project.assets.filter(a => a.kind === kind), cue = valueAt(cuePath) ?? {}, current = cue[name];
  const choices = [['', '未设置'], ['@clear', '清除当前图层'], ...assets.map(a => [a.id, a.id])];
  if (current && !assets.some(a => a.id === current)) choices.push([current, current + '（缺失）']);
  field(parent, label, current === null ? '@clear' : current ?? '', value => {
    const next = { ...(valueAt(cuePath) ?? {}) }; if (!value) delete next[name]; else next[name] = value === '@clear' ? null : value;
    set(cuePath, next);
  }, { choices: kind === 'audio' ? choices.filter(c => c[0] !== '@clear' || ['music', 'ambience'].includes(name)) : choices });
}
function renderCue(parent, path) {
  const details = inspectorSection(parent, JSON.stringify(path) + ':media', '画面与声音绑定');
  for (const [name, label, kind] of [['background', '背景', 'background'], ['portrait', '立绘', 'portrait'], ['cg', 'CG', 'cg'], ['music', '背景音乐', 'audio'], ['voice', '录音', 'audio'], ['sound', '动作音效', 'audio']]) assetField(details, label, path, name, kind);
  const cue = valueAt(path) ?? {}, video = cue.video, assets = model.getView().project.assets;
  const updateVideo = change => {
    const next = { ...(valueAt(path) ?? {}) }; next.video = { ...(next.video ?? {}) };
    for (const [key, value] of Object.entries(change)) { if (value === undefined) delete next.video[key]; else next.video[key] = value; }
    if (!next.video.asset) delete next.video; set(path, next, true);
  };
  field(details, '视频', video?.asset ?? '', value => updateVideo({ asset: value }), { choices: [['', '未设置'], ...assets.filter(a => a.kind === 'video').map(a => [a.id, a.id])] });
  const fallbackChoices = [['', '无'], ...assets.filter(a => a.kind === 'cg' || a.kind === 'background').map(a => [JSON.stringify({ asset: a.id, kind: a.kind }), `${a.kind}: ${a.id}`])];
  const fallback = field(details, '视频回退画面', video?.fallback ? JSON.stringify({ asset: video.fallback.asset, kind: video.fallback.kind }) : '', value => updateVideo({ fallback: value ? JSON.parse(value) : undefined }), { choices: fallbackChoices });
  fallback.disabled = !video?.asset;
  const muted = field(details, '视频静音', video?.muted === false ? 'false' : 'true', value => updateVideo({ muted: value === 'true' }), { choices: [['true', '静音'], ['false', '有声']] });
  muted.disabled = !video?.asset;
  const loop = field(details, '视频循环', video?.loop ? 'true' : 'false', value => updateVideo({ loop: value === 'true' }), { choices: [['false', '播放一次'], ['true', '循环']] });
  loop.disabled = !video?.asset;
  const node = graphNode(), data = node ? valueAt(node.path) : {}, project = model.getView().project;
  const choices = project.type === 'script' ? (data.exit?.type === 'choice' ? data.exit.choices : []) : project.type === 'narrative' ? data.choices ?? [] : data.actions ?? [];
  const miniGameActions = choices.map(choice => choice.id); if (data.continuation) miniGameActions.push('@continue');
  renderPresentationEditor(parent, path, { element, field, action, valueAt, set, assets, section: inspectorSection, miniGameActions });
}
function renderInspector() {
  const root = $('inspector'), node = graphNode();
  for (const details of root.querySelectorAll('details[data-inspector-section]')) {
    if (details.open) openInspectorSections.add(details.dataset.inspectorSection); else openInspectorSections.delete(details.dataset.inspectorSection);
  }
  root.replaceChildren();
  if (!node) { root.append(element('p', '选择场景节点以编辑。兼容剧本可通过 JSON 面板保留原格式。', { class: 'help' })); return; }
  const project = model.getView().project, path = node.path, data = valueAt(path);
  field(root, '节点 ID', node.id, id => mutate(() => { selected = model.rename(selected, id); }, true));
  if (project.type !== 'investigation') nodeField(root, '节点标题', [...path, 'title']);
  root.append(action('删除节点', () => { if (confirm('删除此节点？现有入站分支会保留并提示断链，可撤销。')) mutate(() => model.removeNode(selected), true); }, 'small-button danger'));
  if (project.type === 'investigation') {
    nodeField(root, '正文', [...path, 'text'], { multiline: true }); nodeField(root, '发言人', [...path, 'speaker']);
    nodeField(root, '节点类型', [...path, 'kind'], { choices: ['title', 'dialogue', 'investigation', 'evidence', 'choice', 'ending', 'puzzle'] });
    nodeField(root, '地点', [...path, 'location']); nodeField(root, '时间', [...path, 'time']);
    field(root, '进度 0–100', data.progress, value => set([...path, 'progress'], Number(value)));
    field(root, '节点结果', data.outcome ?? '', value => { const next = structuredClone(valueAt(path)); if (!value) delete next.outcome; else { next.kind = 'ending'; next.outcome = value; } set(path, next, true); }, { choices: [['', '继续调查'], ['failure', '失败可重试'], ['complete', '本章完成']] });
    root.append(element('h3', '调查动作'));
    const chapter = project.chapters.find(c => c.id === node.chapter), targets = Object.keys(chapter.nodes).map(id => [id, id]);
    const logic = { element, field, action, valueAt, set, project, model, mutate, run };
    for (let i = 0; i < data.actions.length; i++) {
      const card = element('div', undefined, { class: 'line-card' }), actionPath = [...path, 'actions', i]; root.append(card);
      nodeField(card, `动作 ${i + 1} ID`, [...actionPath, 'id']); nodeField(card, `动作 ${i + 1} 名称`, [...actionPath, 'label']); nodeField(card, `动作 ${i + 1} 目标`, [...actionPath, 'next'], { choices: targets });
      field(card, `动作 ${i + 1} 收集证据`, data.actions[i].collect ?? '', value => { const next = structuredClone(valueAt(actionPath)); if (value) next.collect = value; else delete next.collect; set(actionPath, next); }, { choices: [['', '不收集'], ...Object.keys(chapter.evidence).map(id => [id, chapter.evidence[id].title])] });
      evidenceChecklist(card, `动作 ${i + 1} 所需证据`, [...actionPath, 'requiresEvidence'], chapter, logic);
      const hidden = data.actions[i].hidesWhenCollected ?? '', evidenceChoices = [['', '始终显示'], ...Object.keys(chapter.evidence).map(id => [id, chapter.evidence[id].title])];
      if (hidden && !Object.hasOwn(chapter.evidence, hidden)) evidenceChoices.push([hidden, hidden + '（缺失）']);
      field(card, `动作 ${i + 1} 持有时隐藏`, hidden, value => { const next = structuredClone(valueAt(actionPath)); if (value) next.hidesWhenCollected = value; else delete next.hidesWhenCollected; set(actionPath, next, true); }, { choices: evidenceChoices });
      field(card, `动作 ${i + 1} 清空证据`, data.actions[i].resetEvidence ? 'true' : 'false', value => set([...actionPath, 'resetEvidence'], value === 'true', true), { choices: [['false', '保留证据'], ['true', '清空证据（不能同时收集）']] });
      card.append(action('删除动作', () => { const actions = structuredClone(valueAt([...path, 'actions'])); actions.splice(i, 1); set([...path, 'actions'], actions, true); }, 'small-button danger'));
    }
    root.append(action('添加调查动作', () => { const actions = structuredClone(valueAt([...path, 'actions'])), ids = new Set(actions.map(a => a.id)); let id = 'action-1'; for (let i = 2; ids.has(id); i++) id = 'action-' + i; actions.push({ id, label: '新的调查动作', next: node.id }); set([...path, 'actions'], actions, true); }));
    jsonField(root, '完整动作字段（隐藏与重置证据）', [...path, 'actions'], []);
    evidenceChecklist(root, '节点所需证据', [...path, 'requiresEvidence'], chapter, logic);
    evidenceChecklist(root, '节点排除证据', [...path, 'excludesEvidence'], chapter, logic);
    const chapterIndex = path[1], catalog = inspectorSection(root, `evidence:${chapter.id}`, '本章证据目录');
    renderEvidenceCatalog(catalog, chapter, chapterIndex, logic);
    const advanced = inspectorSection(root, `evidence:${chapter.id}:json`, '高级证据 JSON');
    jsonField(advanced, '本章证据目录 JSON', ['chapters', chapterIndex, 'evidence'], {});
    jsonField(advanced, '节点所需证据 JSON', [...path, 'requiresEvidence'], []);
    jsonField(advanced, '节点排除证据 JSON', [...path, 'excludesEvidence'], []);
    renderCue(root, ['stage', 'nodes', `${node.chapter}/${node.id}`]);
    root.append(element('p', '调查动作中的 next 连接同章节点。证据联合可达性由原调查状态机校验，允许返回调查。', { class: 'help' }));
    return;
  }
  root.append(element('h3', '台词'));
  for (let i = 0; i < data.lines.length; i++) {
    const card = element('div', undefined, { class: 'line-card' }), linePath = [...path, 'lines', i], line = data.lines[i]; root.append(card);
    nodeField(card, `台词 ${i + 1} ID`, [...linePath, 'id']); nodeField(card, `台词 ${i + 1} 发言人`, [...linePath, 'speaker']);
    nodeField(card, `台词 ${i + 1} 正文`, [...linePath, 'text'], { multiline: true });
    field(card, `台词 ${i + 1} 呈现`, line.medium ?? '', value => {
      const next = structuredClone(valueAt(linePath)); if (value) next.medium = value; else delete next.medium; set(linePath, next);
    }, { choices: [['', '视觉小说'], ['chat', '聊天'], ['call', '通话']] });
    if (project.type === 'script') renderCue(card, [...linePath, 'cue']);
    else if (line.id) renderCue(card, ['stage', 'lines', line.id]);
    card.append(action('上移', () => { if (!i) return; const lines = structuredClone(valueAt([...path, 'lines'])); [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]]; set([...path, 'lines'], lines, true); }));
    card.append(action('删除台词', () => { const lines = structuredClone(valueAt([...path, 'lines'])); lines.splice(i, 1); set([...path, 'lines'], lines, true); }, 'small-button danger'));
  }
  root.append(action('添加台词', () => {
    const lines = structuredClone(valueAt([...path, 'lines'])); const ids = new Set(model.graph().nodes.flatMap(n => (valueAt([...n.path, 'lines']) ?? []).map(l => l.id)));
    let id = node.id + '-line-1'; for (let i = 2; ids.has(id); i++) id = node.id + '-line-' + i;
    lines.push({ id, speaker: '旁白', text: '新的台词。' }); set([...path, 'lines'], lines, true);
  }));
  root.append(element('h3', '分支与出口'));
  const exit = project.type === 'script' ? data.exit : data.choices ? { type: 'choice', choices: data.choices } : data.next ? { type: 'jump', next: data.next } : { type: 'end', ending: data.ending ?? '' };
  field(root, '出口类型', exit.type, value => {
    const target = model.graph().nodes.find(n => n.key !== node.key)?.id ?? node.id;
    const nextExit = value === 'choice' ? { type: 'choice', choices: [{ id: 'choice-1', text: '新的选择', next: target }] } : value === 'jump' ? { type: 'jump', next: target } : value === 'branch' ? { type: 'branch', routes: [{ next: target }] } : { type: 'end', ending: '完成' };
    if (project.type === 'script') set([...path, 'exit'], nextExit, true);
    else { const next = structuredClone(valueAt(path)); delete next.choices; delete next.next; delete next.ending; if (value === 'choice') next.choices = nextExit.choices; if (value === 'jump') next.next = nextExit.next; if (value === 'end') next.ending = nextExit.ending; set(path, next, true); }
  }, { choices: project.type === 'script' ? [['choice', '玩家选择'], ['jump', '直接连接'], ['branch', '条件分支'], ['end', '结局']] : [['choice', '玩家选择'], ['jump', '直接连接'], ['end', '结局']] });
  const exitPath = project.type === 'script' ? [...path, 'exit'] : path;
  const targets = model.graph().nodes.filter(n => n.chapter === node.chapter).map(n => [n.id, `${n.title} · ${n.id}`]);
  if (exit.type === 'jump') nodeField(root, '继续到', [...exitPath, 'next'], { choices: targets });
  if (exit.type === 'end') nodeField(root, '结局名称', [...exitPath, 'ending']);
  if (exit.type === 'branch') {
    renderBranchEditor(root, [...exitPath, 'routes'], { element, field, action, valueAt, set, project });
    jsonField(inspectorSection(root, `${node.key}:branch-json`, '高级条件 JSON'), '条件路由（末项为兜底）', [...exitPath, 'routes'], []);
  }
  if (exit.type === 'choice') {
    for (let i = 0; i < exit.choices.length; i++) {
      const choicePath = [...exitPath, 'choices', i], card = element('div', undefined, { class: 'line-card' }); root.append(card);
      nodeField(card, `选择 ${i + 1} ID`, [...choicePath, 'id']); nodeField(card, `选择 ${i + 1} 文本`, [...choicePath, 'text']);
      const current = exit.choices[i].next, choices = targets.some(t => t[0] === current) ? targets : [[current, current + '（缺失）'], ...targets];
      nodeField(card, `选择 ${i + 1} 目标`, [...choicePath, 'next'], { choices });
      if (project.type === 'script') {
        renderEffectsEditor(card, node.id, exit.choices[i], `选择 ${i + 1}`, { element, field, action, model, mutate, project });
        jsonField(inspectorSection(card, `${node.key}:${i}:effects-json`, '高级效果 JSON'), `选择 ${i + 1} 数值变化`, [...choicePath, 'effects'], []);
      } else jsonField(card, `选择 ${i + 1} 数值变化`, [...choicePath, 'effect'], {});
      card.append(action('删除选择', () => { const choices = structuredClone(valueAt([...exitPath, 'choices'])); choices.splice(i, 1); set([...exitPath, 'choices'], choices, true); }, 'small-button danger'));
    }
    root.append(action('添加选择', () => {
      const choices = structuredClone(valueAt([...exitPath, 'choices'])), ids = new Set(choices.map(c => c.id)); let id = 'choice-1'; for (let i = 2; ids.has(id); i++) id = 'choice-' + i;
      choices.push({ id, text: '新的选择', next: targets[0]?.[0] ?? node.id }); set([...exitPath, 'choices'], choices, true);
    }));
  }
  renderCue(root, project.type === 'script' ? [...path, 'cue'] : ['stage', 'scenes', node.id]);
  if (project.type === 'script') {
    root.append(action('管理变量目录', () => switchTab('structure')));
    jsonField(inspectorSection(root, 'variables-json', '高级变量 JSON'), '变量声明', ['program', 'variables'], {});
  }
  if (project.type === 'narrative') jsonField(root, '初始数值', ['stats'], {});
}
function renderAssets() {
  const root = $('asset-list'); root.replaceChildren();
  model.getView().project.assets.forEach((asset, index) => {
    const card = element('article', undefined, { class: 'asset-card' }), path = ['assets', index]; root.append(card);
    card.append(element('h3', asset.id || '未命名资源'));
    for (const [name, label] of [['id', '资源 ID'], ['src', '相对路径'], ['alt', '资源说明']]) nodeField(card, label, [...path, name]);
    nodeField(card, '资源类型', [...path, 'kind'], { choices: [['background', '背景'], ['portrait', '立绘'], ['cg', 'CG'], ['ui', 'UI 视觉'], ['audio', '音频'], ['font', '字体'], ['video', '视频']] });
    field(card, '许可名称', asset.license?.name ?? '', value => set([...path, 'license'], { name: value, src: valueAt([...path, 'license'])?.src ?? '' }));
    field(card, '许可文件路径', asset.license?.src ?? '', value => set([...path, 'license'], { name: valueAt([...path, 'license'])?.name ?? '', src: value }));
    card.append(action('移除资源条目', () => { const assets = structuredClone(model.getView().project.assets); assets.splice(index, 1); set(['assets'], assets, true); }, 'small-button danger'));
  });
}
function switchTab(next) {
  if (tab === 'source' && next !== 'source' && $('source').value !== savedSource && !confirm('JSON 面板有尚未应用的文本，仍要切换吗？')) return;
  tab = next; for (const name of ['story', 'structure', 'assets', 'collections', 'routes', 'source']) { $(name + '-panel').hidden = name !== tab; document.querySelector(`[data-tab=${name}]`).setAttribute('aria-pressed', String(name === tab)); }
  if (tab === 'assets') renderAssets(); if (tab === 'source') { $('source').value = model.serialize(true); savedSource = $('source').value; }
  if (tab === 'collections') renderCollections();
  if (tab === 'structure') renderStructure();
  if (tab === 'routes') routes.render();
}
function renderStructure() {
  renderStructureEditor($('structure-list'), { element, field, action, model, project: model.getView().project, mutate, set,
    navigate: key => { selected = key; switchTab('story'); renderGraph(model.graph()); renderInspector(); },
    renameChapter: (oldId, id) => { const node = graphNode(); const result = model.renameChapter(oldId, id); if (result && node?.chapter === oldId) selected = JSON.stringify([id, node.id]); }
  });
}
function renderCollections() {
  renderCollectionsEditor($('collection-list'), { project: model.getView().project, element, field, action, set, captureReplay: () => {
    if (!previewReady || Number(document.body.dataset.previewRevision) !== revision) throw new Error('预览尚未就绪');
    if (replayRequest) throw new Error('正在获取回看起点');
    const source = model.serialize(true), current = revision;
    return new Promise((resolve, reject) => {
      replayRequest = { revision: current, resolve: value => { if (source !== model.serialize(true)) reject(new Error('工程已改变，请重新选择回看起点')); else resolve(value); }, reject,
        timer: setTimeout(() => { replayRequest = undefined; reject(new Error('预览未响应，请重新试玩')); }, 5000) };
      $('preview').contentWindow.postMessage({ source: 'vn-engine-studio', type: 'capture-replay', revision: current }, location.origin);
    });
  } });
}
function preview(options={}) {
  clearTimeout(previewTimer); if (!previewReady) return;
  const errors = model.diagnostics(resourceFiles).filter(d => d.severity === 'error');
  if (errors.length) { $('preview-state').textContent = '先修复工程错误；当前保留上次有效预览'; return; }
  const current = ++revision; $('preview-state').textContent = '正在刷新…';
  routes.recording(false);if(routeRequest){clearTimeout(routeRequest.timer);routeRequest.reject(Error('预览已刷新，请重新录制'));routeRequest=undefined;}
  $('preview').contentWindow.postMessage({ source: 'vn-engine-studio', type: 'render', project: JSON.parse(model.serialize(true)), baseURL, urls: resourceURLs.size ? Object.fromEntries(resourceURLs) : undefined, revision: current, recordRoute:options.recordRoute===true }, location.origin);
}
window.addEventListener('message', event => {
  if (event.source !== $('preview').contentWindow || event.origin !== location.origin || event.data?.source !== 'vn-engine-preview') return;
  if (event.data.type === 'resize' && Number.isFinite(event.data.height)) { $('preview').style.height = Math.max(400, Math.min(1200, event.data.height)) + 'px'; return; }
  if (event.data.type === 'ready') { previewReady = true; preview(); }
  if (event.data.type === 'captured-replay' && replayRequest?.revision === event.data.revision) {
    const request = replayRequest; replayRequest = undefined; clearTimeout(request.timer);
    if (event.data.error) request.reject(new Error(event.data.error)); else request.resolve(event.data.saved); return;
  }
  if (event.data.revision !== revision) return;
  if(event.data.type==='recording-invalidated'){routes.recording(false);status(event.data.message,true);}
  if(event.data.type==='captured-route'&&routeRequest?.revision===revision){const request=routeRequest;routeRequest=undefined;clearTimeout(request.timer);routes.recording(false);if(event.data.error)request.reject(Error(event.data.error));else request.resolve(event.data.test);return;}
  if (event.data.type === 'rendered') { routes.recording(event.data.recording===true);$('preview-state').textContent = event.data.recording?'路线录制中 · 请手动推进':'当前工程 · 从头试玩'; document.body.dataset.previewRevision = String(revision); $('preview').contentWindow.postMessage({ source: 'vn-engine-studio', type: 'visibility', hidden: nativeHidden }, location.origin); }
  if (event.data.type === 'failed') $('preview-state').textContent = '预览失败：' + event.data.message;
});
function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })), anchor = element('a', undefined, { href: url, download: filename });
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function save(projectOnly) {
  if (projectOnly && model.diagnostics(resourceFiles).some(d => d.severity === 'error')) throw new Error('请先修复工程诊断中的错误');
  const content = model.serialize(projectOnly), name = /^[a-zA-Z0-9_-]+$/.test(model.getView().project.game) ? model.getView().project.game : 'project';
  const suggestedName = name + (projectOnly ? '.json' : '.vnproj');
  if (unappliedSource()) throw new Error('JSON 面板有未应用的更改，请先点击“应用 JSON”');
  if (nativeHost) { const result = await nativeRequest(projectOnly ? 'export-project' : 'save-workspace', { content, suggestedName, baseURL }); if (result.cancelled) { status('已取消保存，当前工程仍保留'); return; } }
  else download(content, suggestedName);
  if (!projectOnly) { model.markSaved(); document.body.dataset.dirty = 'false'; $('save-state').textContent = '已保存'; }
  saveDraft(); status(projectOnly ? '运行数据已导出；请随数据保留相对路径对应的资源目录' : '工程已保存；资源路径相对于工程文件，请随工程保留资源');
}
const commands = {
  new: () => { if (canReplace()) replace(newProject($('template').value)); },
  sample: async () => { if (!canReplace()) return; const response = await fetch(`../samples/${$('sample').value}.json`); if (!response.ok) throw new Error('样例读取失败'); replace(await response.json(), { baseURL: new URL('../samples/', location.href).href }); },
  open: async () => {
    if (!canReplace()) return;
    if (nativeHost) { const result = await nativeRequest('open-project'); if (!result.cancelled) replace(result.content, { baseURL: result.baseURL, files: result.files }); }
    else { $('open-file').value = ''; $('open-file').click(); }
  },
  save: () => save(false), export: () => save(true),
  undo: () => { if (model.undo()) { renderProject(); update(true); saveDraft(); } },
  redo: () => { if (model.redo()) { renderProject(); update(true); saveDraft(); } },
  'add-node': () => mutate(() => { selected = model.addNode(graphNode()?.chapter); }, true),
  layout: () => mutate(() => model.transact((_p, positions) => { for (const key of Object.keys(positions)) delete positions[key]; }), true),
  preview,
  'apply-source': () => { mutate(() => model.replaceProject($('source').value), true); renderProject(); savedSource = $('source').value; },
  'add-asset': () => { const assets = structuredClone(model.getView().project.assets), ids = new Set(assets.map(a => a.id)); let id = 'asset-1'; for (let i = 2; ids.has(id); i++) id = 'asset-' + i; assets.push({ id, kind: 'background', src: 'assets/image.png' }); set(['assets'], assets, true); },
  'bind-assets': async () => {
    if (nativeHost) { const result = await nativeRequest('bind-assets', { content: model.serialize(true) }); if (!result.cancelled) { clearResources(result.baseURL); resourceFiles = new Set(result.files); $('asset-state').textContent = `已绑定目录，允许读取 ${resourceFiles.size} 个清单文件`; update(false); } }
    else { $('asset-directory').value = ''; $('asset-directory').click(); }
  },
  'restore-draft': () => { if (draft && canReplace()) { replace(draft.document, { baseURL: draft.baseURL ?? new URL('./', location.href).href, draft: true }); if (typeof draft.source === 'string') { switchTab('source'); $('source').value = draft.source; document.body.dataset.dirty = 'true'; } $('draft-banner').hidden = true; } },
  'discard-draft': () => { draft = undefined; $('draft-banner').hidden = true; try { localStorage.removeItem(DRAFT_KEY); } catch {} }
};
for (const button of document.querySelectorAll('[data-command]')) button.addEventListener('click', () => run(commands[button.dataset.command]));
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => switchTab(button.dataset.tab));
$('auto-preview').addEventListener('change', () => { if ($('auto-preview').checked) preview(); });
$('source').addEventListener('input', () => { document.body.dataset.dirty = String(model.dirty || unappliedSource()); $('save-state').textContent = model.dirty || unappliedSource() ? '● 未保存' : '已保存'; scheduleDraft(); });
$('open-file').addEventListener('change', () => run(async () => { const file = $('open-file').files[0]; if (!file) return; if (file.size > 8_000_000) throw new Error('工程超过 8 MB'); replace(await file.text()); }));
$('asset-directory').addEventListener('change', () => run(() => {
  const files = [...$('asset-directory').files]; if (!files.length) return;
  if (files.length > 10000 || files.some(f => f.size > 128_000_000)) throw new Error('目录过大：最多 10000 文件，单文件 128 MB');
  const mapped = new Map(); for (const file of files) { const name = file.webkitRelativePath.split('/').slice(1).join('/'); if (name) mapped.set(name, URL.createObjectURL(file)); }
  clearResources(); resourceURLs = mapped; resourceFiles = new Set(mapped.keys()); $('asset-state').textContent = `已绑定 ${mapped.size} 个文件（仅当前预览）`; update(false); status('资源目录已绑定');
}));
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const typing = event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable);
  if (event.key.toLowerCase() === 's') { event.preventDefault(); run(commands.save); }
  if (event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); run(event.shiftKey ? commands.redo : commands.undo); }
});
window.addEventListener('beforeunload', event => { if (model.dirty || (tab === 'source' && $('source').value !== savedSource)) { saveDraft(); event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { clearTimeout(draftTimer); clearTimeout(previewTimer); for (const url of resourceURLs.values()) URL.revokeObjectURL(url); });
window.addEventListener('vn-engine-host-visibility', event => { if (typeof event.detail?.hidden !== 'boolean') return; nativeHidden = event.detail.hidden; $('preview').contentWindow.postMessage({ source: 'vn-engine-studio', type: 'visibility', hidden: nativeHidden }, location.origin); });
$('version').textContent = ENGINE_VERSION; $('host-label').textContent = nativeHost ? 'Windows 原生宿主' : '浏览器工作区';
try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) { const value = JSON.parse(raw); if (value.schema === 1 && value.document) { new EditorModel(value.document); draft = value; $('draft-banner').hidden = false; } } } catch { status('旧草稿无法读取，可继续新建或打开工程', true); }
selected = model.graph().nodes[0]?.key; renderProject(); update(true); status('编辑器已就绪'); document.body.dataset.editorReady = 'true';
const connectPreview = () => $('preview').contentWindow.postMessage({ source: 'vn-engine-studio', type: 'connect' }, location.origin);
$('preview').addEventListener('load', connectPreview); connectPreview();
window.addEventListener('pagehide',()=>routes.dispose());
