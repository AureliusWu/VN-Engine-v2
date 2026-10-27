const visualLayers = ['background', 'character-back', 'character', 'character-front', 'cg'];
const layers = [...visualLayers, 'effect', 'ui'];
const dimensions = [['x', 'X'], ['y', 'Y'], ['scale', '缩放'], ['opacity', '透明度']];

/** Author the same data consumed by the runtime; mutations stay inside EditorModel transactions. */
export function renderPresentationEditor(parent, path, { element, field, action, valueAt, set, assets, section }) {
  const details = section(parent, JSON.stringify(path) + ':presentation', '正式图层与时间线');
  const cue = valueAt(path) ?? {};
  const changeCue = change => { const next = structuredClone(valueAt(path) ?? {}); change(next); set(path, next, true); };
  for (const layer of visualLayers) {
    const current = cue.layers?.[layer], choices = [['', '继承原有绑定'], ['@clear', '清除此层'],
      ...assets.filter(asset => ['background', 'portrait', 'cg'].includes(asset.kind)).map(asset => [JSON.stringify({ asset: asset.id, kind: asset.kind }), `${asset.kind}: ${asset.id}`])];
    const selected = current === null ? '@clear' : current ? JSON.stringify({ asset: current.asset, kind: current.kind }) : '';
    if (selected && !choices.some(([id]) => id === selected)) choices.push([selected, '当前绑定（缺失）']);
    field(details, `图层 ${layer}`, selected, value => changeCue(next => {
      next.layers = { ...(next.layers ?? {}) };
      if (!value) delete next.layers[layer]; else next.layers[layer] = value === '@clear' ? null : JSON.parse(value);
      if (!Object.keys(next.layers).length) delete next.layers;
    }), { choices });
  }
  const keyVisual = cue.keyVisual;
  field(details, '装饰视觉资源', keyVisual?.asset ?? '', value => changeCue(next => {
    if (!value) delete next.keyVisual; else next.keyVisual = { scope: 'banner', sceneType: 'story', durationMs: 1500, ...next.keyVisual, asset: value };
  }), { choices: [['', '未设置'], ...assets.filter(asset => asset.kind === 'ui').map(asset => [asset.id, asset.id])] });
  if (keyVisual) {
    const edit = change => changeCue(next => change(next.keyVisual));
    field(details, '装饰视觉范围', keyVisual.scope, value => edit(next => { next.scope = value; }), { choices: [['banner', '独立横幅'], ['fullscreen', '全屏演出']] });
    field(details, '装饰视觉场景类型', keyVisual.sceneType, value => edit(next => { next.sceneType = value; }), { choices: ['story', 'title', 'cg', 'transition', 'interstitial', 'special_presentation'] });
    field(details, '装饰视觉时长 ms', keyVisual.durationMs, value => edit(next => { next.durationMs = Number(value); }));
  }
  const editTimeline = change => changeCue(next => {
    const timeline = next.timeline && typeof next.timeline === 'object' ? next.timeline : { durationMs: 1000, animations: [], camera: [] };
    change(timeline); next.timeline = timeline;
  });
  if (!cue.timeline || typeof cue.timeline !== 'object') {
    details.append(action('启用时间线', () => editTimeline(() => {}))); return;
  }
  const timeline = cue.timeline;
  field(details, '时间线总时长 ms', timeline.durationMs, value => editTimeline(next => { next.durationMs = Number(value); }));
  details.append(element('p', '位移为 CSS 像素。目标资源留空时作用于整层；轨道不得超过总时长。', { class: 'help' }));
  for (const [index, track] of (Array.isArray(timeline.animations) ? timeline.animations : []).entries()) {
    const card = element('div', undefined, { class: 'line-card' }), prefix = `轨道 ${index + 1}`;
    const edit = change => editTimeline(next => change(next.animations[index])); details.append(card);
    field(card, `${prefix} ID`, track.id, value => edit(next => { next.id = value; }));
    field(card, `${prefix} 图层`, track.layer, value => edit(next => { next.layer = value; }), { choices: layers });
    field(card, `${prefix} 目标资源`, track.target ?? '', value => edit(next => { if (value) next.target = value; else delete next.target; }));
    field(card, `${prefix} 开始 ms`, track.startMs ?? 0, value => edit(next => { next.startMs = Number(value); }));
    field(card, `${prefix} 时长 ms`, track.durationMs, value => edit(next => { next.durationMs = Number(value); }));
    field(card, `${prefix} 缓动`, track.easing ?? 'linear', value => edit(next => { next.easing = value; }), { choices: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] });
    for (const [side, title] of [['from', '起点'], ['to', '终点']]) for (const [key, label] of dimensions) {
      field(card, `${prefix} ${title} ${label}`, track[side]?.[key] ?? '', value => edit(next => {
        next[side] = { ...(next[side] ?? {}) }; if (value.trim()) next[side][key] = Number(value); else delete next[side][key];
      }));
    }
    card.append(action(`删除轨道 ${index + 1}`, () => editTimeline(next => { next.animations.splice(index, 1); }), 'small-button danger'));
  }
  details.append(action('添加动画轨道', () => editTimeline(next => {
    next.animations ??= []; const ids = new Set(next.animations.map(track => track.id)); let count = next.animations.length + 1;
    while (ids.has(`track-${count}`)) count++;
    next.animations.push({ id: `track-${count}`, layer: 'character', from: { x: 0, y: 0, scale: 1, opacity: 1 }, to: { x: 0, y: 0, scale: 1, opacity: 1 }, startMs: 0, durationMs: Math.min(500, Math.max(0, next.durationMs)), easing: 'linear' });
  })));
  for (const [index, frame] of (Array.isArray(timeline.camera) ? timeline.camera : []).entries()) {
    const card = element('div', undefined, { class: 'line-card' }); card.append(element('strong', `镜头关键帧 ${index + 1}`)); details.append(card);
    for (const [key, label] of [['atMs', '时间 ms'], ['x', 'X'], ['y', 'Y'], ['scale', '缩放']]) {
      field(card, `镜头 ${index + 1} ${label}`, frame[key] ?? (key === 'scale' ? 1 : 0), value => editTimeline(next => { next.camera[index][key] = Number(value); }));
    }
    card.append(action(`删除镜头 ${index + 1}`, () => editTimeline(next => { next.camera.splice(index, 1); }), 'small-button danger'));
  }
  details.append(action('添加镜头关键帧', () => editTimeline(next => {
    next.camera ??= []; const last = next.camera.at(-1);
    next.camera.push({ atMs: last ? Math.min(next.durationMs, last.atMs + 500) : 0, x: last?.x ?? 0, y: last?.y ?? 0, scale: last?.scale ?? 1 });
  })), action('移除时间线', () => changeCue(next => { delete next.timeline; }), 'small-button danger'));
}
