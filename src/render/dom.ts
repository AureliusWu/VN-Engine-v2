import { filterHistory } from '../history/search.js';
import { isRecord } from '../storage/save.js';
import type { StoragePort } from '../storage/store.js';
import type { AssetCatalog, AssetKind } from '../assets/catalog.js';
import type { RuntimeSession, RuntimeSettings, RuntimeView } from '../runtime/session.js';
import { DOM_STYLE } from './dom-style.js';

export type DOMRendererOptions = { title?: string; font?: string; storage?: StoragePort | null; onUnlockAudio?: () => void };

/** Framework-free renderer and input host for VN, chat/call and investigations. */
export class DOMRenderer {
  readonly element: HTMLElement;
  private document: Document;
  private stage: HTMLElement;
  private reading: HTMLElement;
  private speaker: HTMLElement;
  private text: HTMLElement;
  private actions: HTMLElement;
  private title: HTMLElement;
  private mode: HTMLElement;
  private background: HTMLImageElement;
  private portrait: HTMLImageElement;
  private cg: HTMLImageElement;
  private effect: HTMLElement;
  private chat: HTMLElement;
  private currentBubble: HTMLElement;
  private bubbleText: HTMLElement;
  private call: HTMLElement;
  private documentView: HTMLElement;
  private hotspots: HTMLElement;
  private toolbar: HTMLElement;
  private status: HTMLElement;
  private modal: HTMLElement;
  private restoreButton: HTMLButtonElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private disconnect: () => void = () => {};
  private lastView?: RuntimeView;
  private visit = -1;
  private actionsKey = '';
  private disposed = false;
  private probes = new Map<HTMLImageElement, { id: string; probe: HTMLImageElement }>();
  private lastFocus?: HTMLElement;
  private saveKey: string;
  private settingsKey: string;
  private onVisibility: () => void;
  private onKey: (event: KeyboardEvent) => void;
  private onPointer: () => void;
  private onChatScroll: () => void;
  private chatPinned = true;
  private scrollFrame?: number;
  constructor(readonly root: HTMLElement, readonly session: RuntimeSession, readonly assets: AssetCatalog, readonly options: DOMRendererOptions = {}) {
    this.document = root.ownerDocument;
    this.saveKey = `vn-engine:${session.driver.game}:save:1`; this.settingsKey = `vn-engine:${session.driver.game}:settings`;
    try { const value = JSON.parse(options.storage?.getItem(this.settingsKey) ?? 'null'); if (isRecord(value)) session.configure(value); } catch { /* Keep playable defaults. */ }
    const host = this.el('section', undefined, 'vn-engine'); this.element = host; host.tabIndex = 0; host.setAttribute('aria-label', options.title ?? '自研叙事引擎');
    const style = this.el('style'); style.textContent = DOM_STYLE;
    if (options.font) style.textContent += `\n@font-face{font-family:VNRuntime;src:url(${JSON.stringify(assets.url(options.font, 'font'))}) format('woff2');font-display:swap}.vn-engine{font-family:VNRuntime,system-ui,sans-serif}`;
    host.append(style); this.stage = this.el('div', undefined, 'vn-stage');
    this.background = this.image('vn-image vn-background'); this.portrait = this.image('vn-image vn-portrait'); this.cg = this.image('vn-image vn-cg');
    this.effect = this.el('div', undefined, 'vn-effect'); this.title = this.el('div', undefined, 'vn-scene-title'); this.mode = this.el('div', undefined, 'vn-mode');
    this.chat = this.el('div', undefined, 'vn-chat'); this.currentBubble = this.el('div', undefined, 'vn-bubble vn-current'); this.bubbleText = this.el('span');
    this.call = this.el('div', undefined, 'vn-call'); this.call.append(this.el('span', '◌', 'vn-call-icon'), this.el('p', '语音通话'), this.el('p', '当前为远程交流'));
    this.documentView = this.el('div', undefined, 'vn-document'); this.hotspots = this.el('div', undefined, 'vn-hotspots');
    this.reading = this.el('div', undefined, 'vn-reading'); this.speaker = this.el('div', undefined, 'vn-speaker'); this.text = this.el('p', undefined, 'vn-text');
    this.actions = this.el('div', undefined, 'vn-actions'); this.reading.append(this.speaker, this.text, this.actions);
    this.restoreButton = this.button('恢复界面', () => session.hide(false)); this.restoreButton.className = 'vn-restore'; this.restoreButton.hidden = true;
    this.stage.append(this.background, this.portrait, this.cg, this.chat, this.call, this.documentView, this.hotspots, this.effect, this.title, this.mode, this.reading, this.restoreButton);
    this.toolbar = this.el('div', undefined, 'vn-toolbar');
    for (const [id, label, handler] of [
      ['auto', '自动', () => session.setAuto(!session.getView().auto)],
      ['skip', '已读快进', () => { if (!session.setSkip(!session.getView().skipping)) this.notify('只能快进已经读过的段落'); }],
      ['save', '存档', () => this.save()], ['load', '读档', () => this.load()], ['history', '历史', () => this.history()],
      ['evidence', '证据簿', () => this.evidence()], ['settings', '设置', () => this.settings()],
      ['hide', '隐藏界面', () => session.hide(true)], ['fullscreen', '全屏', () => this.fullscreen()],
      ['sound', '启用声音', () => options.onUnlockAudio?.()], ['restart', '新游戏', () => { session.restart(); this.notify('已开始新游戏'); }]
    ] as const) { const button = this.button(label, handler); button.dataset.control = id; this.buttons.set(id, button); this.toolbar.append(button); }
    this.status = this.el('span', '', 'vn-status'); this.status.setAttribute('role', 'status'); this.toolbar.append(this.status);
    this.modal = this.el('div', undefined, 'vn-modal'); this.modal.hidden = true; this.modal.setAttribute('role', 'dialog'); this.modal.setAttribute('aria-modal', 'true');
    host.append(this.stage, this.toolbar, this.modal); root.append(host);
    this.onVisibility = () => session.pause('background', this.document.visibilityState === 'hidden');
    this.onKey = event => this.key(event); this.onPointer = () => options.onUnlockAudio?.();
    this.onChatScroll = () => { this.chatPinned = this.chat.scrollHeight - this.chat.scrollTop - this.chat.clientHeight < 24; };
    try {
      this.document.addEventListener('visibilitychange', this.onVisibility); host.addEventListener('keydown', this.onKey); host.addEventListener('pointerdown', this.onPointer);
      this.chat.addEventListener('scroll', this.onChatScroll);
      this.disconnect = session.subscribe(() => this.render()); this.onVisibility(); this.render();
    } catch (error) { this.dispose(); throw error; }
  }
  private el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const node = this.document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
  }
  private button(label: string, action: () => void): HTMLButtonElement {
    const button = this.el('button', label); button.type = 'button'; button.addEventListener('click', action); return button;
  }
  private image(className: string) { const image = this.el('img', undefined, className); image.hidden = true; image.alt = ''; image.draggable = false; return image; }
  private paint(image: HTMLImageElement, id: string | null | undefined, kind: AssetKind) {
    const previous = this.probes.get(image);
    if ((previous?.id ?? '') === (id ?? '')) return;
    if (previous) { previous.probe.onload = null; previous.probe.onerror = null; previous.probe.removeAttribute('src'); this.probes.delete(image); }
    image.hidden = true; image.removeAttribute('src'); image.dataset.asset = id ?? '';
    if (!id) return;
    try {
      const asset = this.assets.get(id, kind), source = this.assets.url(id, kind), probe = this.document.createElement('img');
      const request = { id, probe }; this.probes.set(image, request);
      probe.onload = () => { if (!this.disposed && this.probes.get(image) === request) { image.src = source; image.alt = asset.alt ?? ''; image.hidden = false; } };
      probe.onerror = () => { if (!this.disposed && this.probes.get(image) === request) this.notify(`画面资源未能载入：${asset.alt ?? id}，可以继续阅读`); };
      probe.src = source;
    } catch { this.notify(`未配置画面资源：${id}，可以继续阅读`); }
  }
  private render() {
    if (this.disposed) return;
    const snapshot = this.session.getView(), frame = snapshot.frame, previous = this.lastView;
    if (snapshot === previous) return;
    this.lastView = snapshot;
    if (snapshot.settings.opacity !== previous?.settings.opacity) this.element.style.setProperty('--vn-opacity', String(snapshot.settings.opacity));
    if (snapshot.ready !== previous?.ready) this.element.dataset.ready = String(snapshot.ready);
    if (snapshot.paused !== previous?.paused) this.element.dataset.paused = String(snapshot.paused);
    const entered = snapshot.visit !== this.visit;
    if (entered) {
      this.cancelScroll();
      this.element.dataset.mode = frame.mode; this.element.dataset.scene = frame.sceneId; this.element.dataset.line = frame.lineId; this.element.dataset.visit = String(snapshot.visit);
      this.visit = snapshot.visit; this.title.textContent = frame.title; this.mode.textContent = { vn: 'STORY', chat: 'CHAT', call: 'CALL', investigation: 'INVESTIGATION', document: 'EVIDENCE' }[frame.mode];
      this.paint(this.background, frame.stage.background, 'background'); this.paint(this.portrait, frame.stage.portrait, 'portrait'); this.paint(this.cg, frame.stage.cg, 'cg');
      this.chat.hidden = frame.mode !== 'chat'; this.call.hidden = frame.mode !== 'call';
      if (frame.mode === 'chat') {
        this.chat.replaceChildren();
        for (const record of this.session.history().slice(-5)) { if (record.lineId === frame.lineId) continue; const bubble = this.el('div', undefined, 'vn-bubble'); bubble.append(this.el('small', record.speaker), this.el('span', record.text)); this.chat.append(bubble); }
        this.currentBubble = this.el('div', undefined, 'vn-bubble vn-current'); this.bubbleText = this.el('span');
        this.currentBubble.append(this.el('small', frame.speaker), this.bubbleText); this.chat.append(this.currentBubble); this.chatPinned = true;
      }
      this.documentView.hidden = !frame.stage.document;
      if (frame.stage.document) this.documentView.replaceChildren(this.el('h3', frame.stage.document.title), ...frame.stage.document.lines.map(line => this.el('p', line)));
      this.hotspots.replaceChildren();
      for (const hotspot of frame.hotspots ?? []) {
        if (!frame.actions.some(action => action.id === hotspot.actionId)) continue;
        const button = this.button(hotspot.label, () => this.session.act(hotspot.actionId)); button.style.left = `${hotspot.x}%`; button.style.top = `${hotspot.y}%`; button.dataset.action = hotspot.actionId; this.hotspots.append(button);
      }
      for (const animation of this.animations()) animation.cancel();
      this.effect.style.background = 'transparent';
      if (!snapshot.settings.reducedMotion && ['start', 'advance', 'action'].includes(snapshot.reason) && frame.stage.effect) {
        const effect = frame.stage.effect, duration = Math.max(0, Math.min(2000, effect.durationMs ?? 450));
        if (effect.type === 'flash') { this.effect.style.background = '#fff'; this.effect.animate([{ opacity: .8 }, { opacity: 0 }], { duration, fill: 'forwards' }); }
        else if (effect.type === 'fade') { this.effect.style.background = '#10212a'; this.effect.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: 'forwards' }); }
        else if (effect.type === 'shake') this.stage.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration });
      }
    }
    if (snapshot.settings.reducedMotion && (!previous?.settings.reducedMotion || entered)) {
      for (const animation of this.animations()) animation.cancel(); this.effect.style.background = 'transparent';
    } else if (entered || snapshot.paused !== previous?.paused) {
      for (const animation of this.animations()) {
        if (snapshot.paused && animation.playState === 'running') animation.pause();
        else if (!snapshot.paused && animation.playState === 'paused') animation.play();
      }
    }
    if (entered) this.speaker.textContent = frame.speaker;
    if (entered || snapshot.text !== previous?.text) {
      if (frame.mode === 'chat') { this.text.textContent = '聊天消息会按阅读节奏逐步显示。'; this.bubbleText.textContent = snapshot.text; if (this.chatPinned) this.queueScroll(); }
      else this.text.textContent = snapshot.text;
    }
    if (snapshot.hidden !== previous?.hidden) {
      this.reading.hidden = snapshot.hidden; this.toolbar.hidden = snapshot.hidden; this.restoreButton.hidden = !snapshot.hidden; this.hotspots.hidden = snapshot.hidden;
    }
    if (entered || snapshot.ready !== previous?.ready || snapshot.paused !== previous?.paused) for (const button of this.hotspots.querySelectorAll('button')) button.disabled = !snapshot.ready || snapshot.paused;
    const actionsKey = `${snapshot.visit}:${snapshot.complete}:${snapshot.ready}:${snapshot.paused}`;
    if (actionsKey !== this.actionsKey) {
      this.actionsKey = actionsKey; this.actions.replaceChildren();
      if (!snapshot.complete || frame.canAdvance) { const next = this.button(snapshot.complete ? '下一段' : '显示全文', () => this.session.next()); next.dataset.control = 'next'; next.disabled = snapshot.paused || (snapshot.complete && !snapshot.ready); this.actions.append(next); }
      if (snapshot.ready) for (const action of frame.actions) { const button = this.button(action.label, () => this.session.act(action.id)); button.dataset.action = action.id; if (action.tone) button.dataset.tone = action.tone; button.disabled = snapshot.paused; this.actions.append(button); }
      if (snapshot.ready && frame.ending) this.actions.append(this.el('span', frame.ending === 'failure' ? '调查需要重新核对' : '已到达结局'));
    }
    if (entered || snapshot.paused !== previous?.paused) {
      for (const id of ['auto', 'skip', 'save', 'load', 'history', 'evidence', 'settings', 'hide', 'restart']) this.buttons.get(id)!.disabled = snapshot.paused;
      this.buttons.get('skip')!.disabled ||= !snapshot.supportsSkip;
    }
    if (entered) this.buttons.get('evidence')!.hidden = !frame.evidence;
    if (snapshot.auto !== previous?.auto) this.buttons.get('auto')!.setAttribute('aria-pressed', String(snapshot.auto));
    if (snapshot.skipping !== previous?.skipping) this.buttons.get('skip')!.setAttribute('aria-pressed', String(snapshot.skipping));
  }
  private animations(): Animation[] { return [...(this.effect.getAnimations?.() ?? []), ...(this.stage.getAnimations?.() ?? [])]; }
  private queueScroll() {
    const view = this.document.defaultView;
    if (!view || this.scrollFrame !== undefined) return;
    const visit = this.visit;
    this.scrollFrame = view.requestAnimationFrame(() => {
      this.scrollFrame = undefined;
      if (!this.disposed && this.visit === visit && this.chatPinned) this.chat.scrollTop = this.chat.scrollHeight;
    });
  }
  private cancelScroll() { if (this.scrollFrame !== undefined) { this.document.defaultView?.cancelAnimationFrame(this.scrollFrame); this.scrollFrame = undefined; } }
  notify(message: string) { if (!this.disposed) this.status.textContent = message; }
  private save() {
    try { if (!this.options.storage) throw new Error(); this.options.storage.setItem(this.saveKey, JSON.stringify(this.session.save())); this.notify('已保存当前段落'); }
    catch { this.notify('存储暂不可用，可以继续游玩或导出存档'); }
  }
  private load() {
    let raw: string | null;
    try { if (!this.options.storage) throw new Error(); raw = this.options.storage.getItem(this.saveKey); } catch { this.notify('存储暂不可用'); return; }
    if (raw === null) { this.notify('还没有存档'); return; }
    try { if (raw.length > 2_000_000) throw new Error(); this.session.restore(JSON.parse(raw)); this.notify('已恢复存档'); }
    catch { this.notify('存档无法使用，原文件已保留'); }
  }
  private panel(title: string): HTMLElement {
    if (!this.modal.hidden) this.closePanel();
    this.lastFocus = this.document.activeElement instanceof this.document.defaultView!.HTMLElement ? this.document.activeElement as HTMLElement : undefined;
    this.session.pause('panel', true); this.modal.hidden = false; this.modal.replaceChildren(); this.modal.setAttribute('aria-label', title);
    const panel = this.el('div', undefined, 'vn-panel'), head = this.el('div', undefined, 'vn-panel-head');
    const close = this.button('关闭', () => this.closePanel()); head.append(this.el('h2', title), close); panel.append(head); this.modal.append(panel); close.focus(); return panel;
  }
  private closePanel() { this.modal.hidden = true; this.modal.replaceChildren(); this.session.pause('panel', false); if (this.lastFocus?.isConnected) this.lastFocus.focus(); else this.element.focus(); }
  private history() {
    const records = this.session.history(), panel = this.panel('历史记录'), input = this.el('input'); input.type = 'search'; input.placeholder = '搜索已读内容'; input.setAttribute('aria-label', '搜索已读记录');
    const list = this.el('div');
    const show = () => {
      list.replaceChildren();
      for (const record of filterHistory(records, input.value)) {
        const row = this.button(record.text, () => { if (this.session.reread(record.id)) { this.closePanel(); this.notify('已返回已读段落'); } }); row.className = 'vn-record';
        row.prepend(this.el('small', record.speaker)); row.disabled = !this.session.driver.supportsReread; list.append(row);
      }
      if (!list.childElementCount) list.append(this.el('p', '没有匹配的已读记录'));
    };
    input.addEventListener('input', show); panel.append(input, list); show(); input.focus();
  }
  private evidence() { const panel = this.panel('证据簿'); const evidence = this.session.getView().frame.evidence ?? []; if (!evidence.length) panel.append(this.el('p', '尚未取得证据')); for (const item of evidence) panel.append(this.el('h3', item.title), this.el('p', item.detail)); }
  private settings() {
    const panel = this.panel('阅读设置'), snapshot = this.session.getView();
    const configure = (value: Partial<RuntimeSettings>) => {
      this.session.configure(value); try { this.options.storage?.setItem(this.settingsKey, JSON.stringify(this.session.getView().settings)); } catch { this.notify('设置已生效，本次无法保存设置'); }
    };
    for (const [key, label, min, max, step] of [['textDelayMs', '文字间隔', 0, 100, 1], ['autoDelayMs', '自动阅读间隔', 200, 5000, 100], ['opacity', '阅读区透明度', .25, 1, .05], ['volume', '音乐与音效音量', 0, 1, .05], ['voiceVolume', '语音音量', 0, 1, .05]] as const) {
      const row = this.el('label', undefined, 'vn-setting'), input = this.el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(snapshot.settings[key]); input.setAttribute('aria-label', label);
      input.addEventListener('input', () => configure({ [key]: Number(input.value) })); row.append(this.el('span', label), input); panel.append(row);
    }
    for (const [key, label] of [['music', '背景音乐'], ['voiceEnabled', '语音播放'], ['soundEffects', '动作音效'], ['reducedMotion', '减少动态效果']] as const) {
      const row = this.el('label', undefined, 'vn-setting'), input = this.el('input'); input.type = 'checkbox'; input.checked = snapshot.settings[key]; input.addEventListener('change', () => configure({ [key]: input.checked })); row.append(this.el('span', label), input); panel.append(row);
    }
    const backup = this.el('div', undefined, 'vn-backup'); backup.append(this.button('导出存档', () => this.exportSave()));
    const input = this.el('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    input.addEventListener('change', () => { const file = input.files?.[0]; if (!file) return; if (file.size > 2_000_000) { this.notify('存档文件过大'); return; }
      void file.text().then(raw => { if (this.disposed) return; try { this.session.restore(JSON.parse(raw)); this.closePanel(); this.notify('已导入存档'); } catch { this.notify('导入失败，当前进度保留'); } }).catch(() => this.notify('无法读取文件')); });
    backup.append(this.button('导入存档', () => input.click()), input); panel.append(backup);
  }
  private exportSave() {
    const view = this.document.defaultView!; const url = view.URL.createObjectURL(new Blob([JSON.stringify(this.session.save(), null, 2)], { type: 'application/json' }));
    const link = this.el('a'); link.href = url; link.download = this.session.driver.game.replace(/[^a-z0-9_-]/gi, '_') + '-save.json'; link.click(); view.setTimeout(() => view.URL.revokeObjectURL(url), 0); this.notify('存档已导出');
  }
  private fullscreen() { try { const promise = this.document.fullscreenElement ? this.document.exitFullscreen() : this.element.requestFullscreen?.(); void promise?.catch(() => this.notify('当前浏览器未能进入全屏')); } catch { this.notify('当前浏览器未能进入全屏'); } }
  private key(event: KeyboardEvent) {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!this.modal.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); this.closePanel(); }
      if (event.key === 'Tab') {
        const items = [...this.modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]),select')]; const index = items.indexOf(this.document.activeElement as HTMLElement);
        if (items.length && ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1))) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus(); }
      }
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button,input,textarea,select,[contenteditable=true]')) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.options.onUnlockAudio?.(); this.session.next(); }
    else if (/^[1-9]$/.test(event.key)) { const action = this.session.getView().frame.actions[Number(event.key) - 1]; if (action) { event.preventDefault(); this.session.act(action.id); } }
    else if (event.key.toLowerCase() === 'h') { event.preventDefault(); this.session.hide(!this.session.getView().hidden); }
    else if (event.key.toLowerCase() === 'a') { event.preventDefault(); this.session.setAuto(!this.session.getView().auto); }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.disconnect(); this.session.pause('panel', false);
    this.document.removeEventListener('visibilitychange', this.onVisibility); this.element.removeEventListener('keydown', this.onKey); this.element.removeEventListener('pointerdown', this.onPointer);
    this.chat.removeEventListener('scroll', this.onChatScroll); this.cancelScroll();
    for (const { probe } of this.probes.values()) { probe.onload = null; probe.onerror = null; probe.removeAttribute('src'); } this.probes.clear();
    for (const animation of this.animations()) animation.cancel(); this.element.remove();
  }
}
