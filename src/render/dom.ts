import { filterHistory } from '../history/search.js';
import { isRecord } from '../storage/save.js';
import type { StoragePort } from '../storage/store.js';
import type { AssetCatalog, AssetKind } from '../assets/catalog.js';
import type { RuntimeSession, RuntimeSettings, RuntimeView } from '../runtime/session.js';
import type { bindSessionPersistence, SaveEnvelope } from '../storage/contract.js';
import type { LoadResult } from '../storage/store.js';
import type { CollectionCg, CollectionEnding, ProjectCollections, createMetaStateStore } from '../meta/state.js';
import type { PresentationTimeline, StageLayer, StageLayerAsset, StageVideo, StageVisualLayer } from '../stage/types.js';
import { resolvePresentationTimeline } from '../stage/timeline.js';
import { DOM_STYLE } from './dom-style.js';
import { KeyVisualLayer } from './key-visual.js';

export type DOMRendererOptions = { title?: string; font?: string; storage?: StoragePort | null; persistence?: ReturnType<typeof bindSessionPersistence>;
  meta?: ReturnType<typeof createMetaStateStore>; collections?: ProjectCollections; replayOnly?: boolean;
  beginReplay?: (root: HTMLElement, saved: unknown) => () => void; onUnlockAudio?: () => void; onCgPresented?: (id: string) => void };

/** Framework-free renderer and input host for VN, chat/call and investigations. */
export class DOMRenderer {
  readonly element: HTMLElement;
  private document: Document;
  private stage: HTMLElement;
  private camera: HTMLElement;
  private reading: HTMLElement;
  private speaker: HTMLElement;
  private text: HTMLElement;
  private actions: HTMLElement;
  private title: HTMLElement;
  private mode: HTMLElement;
  private background: HTMLImageElement;
  private portrait: HTMLImageElement;
  private characterBack: HTMLImageElement;
  private characterFront: HTMLImageElement;
  private cg: HTMLImageElement;
  private video: HTMLVideoElement;
  private videoFallback: HTMLImageElement;
  private videoState?: { cue: StageVideo; attempt: number; finished: boolean };
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
  private panelCleanup?: () => void;
  private replayReturn?: () => void;
  private saveKey: string;
  private settingsKey: string;
  private onVisibility: () => void;
  private onKey: (event: KeyboardEvent) => void;
  private onPointer: () => void;
  private onChatScroll: () => void;
  private motionQuery?: MediaQueryList;
  private onMotion: () => void;
  private chatPinned = true;
  private scrollFrame?: number;
  private layerNodes!: Record<StageLayer, HTMLElement>;
  private timeline?: { value: PresentationTimeline; elapsed: number; previousTime?: number; frame?: number; finished: boolean };
  private keyVisualLayer!: KeyVisualLayer;
  constructor(readonly root: HTMLElement, readonly session: RuntimeSession, readonly assets: AssetCatalog, readonly options: DOMRendererOptions = {}) {
    this.document = root.ownerDocument;
    this.saveKey = `vn-engine:${session.driver.game}:save:1`; this.settingsKey = `vn-engine:${session.driver.game}:settings`;
    try { const value = JSON.parse(options.storage?.getItem(this.settingsKey) ?? 'null'); if (isRecord(value)) session.configure(value); } catch { /* Keep playable defaults. */ }
    const host = this.el('section', undefined, 'vn-engine'); this.element = host; host.tabIndex = 0; host.setAttribute('aria-label', options.title ?? '自研叙事引擎');
    const style = this.el('style'); style.textContent = DOM_STYLE;
    if (options.font) style.textContent += `\n@font-face{font-family:VNRuntime;src:url(${JSON.stringify(assets.url(options.font, 'font'))}) format('woff2');font-display:swap}.vn-engine{font-family:VNRuntime,system-ui,sans-serif}`;
    host.append(style); this.stage = this.el('div', undefined, 'vn-stage'); this.camera = this.el('div', undefined, 'vn-camera');
    this.background = this.image('vn-image vn-background'); this.characterBack = this.image('vn-image vn-character-layer vn-character-back');
    this.portrait = this.image('vn-image vn-portrait'); this.characterFront = this.image('vn-image vn-character-layer vn-character-front'); this.cg = this.image('vn-image vn-cg');
    this.video = this.el('video', undefined, 'vn-video'); this.video.hidden = true; this.video.playsInline = true; this.video.preload = 'auto';
    this.videoFallback = this.image('vn-image vn-video-fallback');
    this.effect = this.el('div', undefined, 'vn-effect'); this.title = this.el('div', undefined, 'vn-scene-title'); this.mode = this.el('div', undefined, 'vn-mode');
    this.chat = this.el('div', undefined, 'vn-chat'); this.currentBubble = this.el('div', undefined, 'vn-bubble vn-current'); this.bubbleText = this.el('span');
    this.call = this.el('div', undefined, 'vn-call'); this.call.append(this.el('span', '◌', 'vn-call-icon'), this.el('p', '语音通话'), this.el('p', '当前为远程交流'));
    this.documentView = this.el('div', undefined, 'vn-document'); this.hotspots = this.el('div', undefined, 'vn-hotspots');
    this.reading = this.el('div', undefined, 'vn-reading'); this.speaker = this.el('div', undefined, 'vn-speaker'); this.text = this.el('p', undefined, 'vn-text');
    this.actions = this.el('div', undefined, 'vn-actions'); this.reading.append(this.speaker, this.text, this.actions);
    this.layerNodes = { background: this.background, 'character-back': this.characterBack, character: this.portrait, 'character-front': this.characterFront, cg: this.cg, effect: this.effect, ui: this.reading };
    for (const [layer, node] of Object.entries(this.layerNodes)) node.dataset.layer = layer;
    this.camera.append(this.background, this.characterBack, this.portrait, this.characterFront, this.cg, this.videoFallback, this.video);
    this.restoreButton = this.button('恢复界面', () => session.hide(false)); this.restoreButton.className = 'vn-restore'; this.restoreButton.hidden = true;
    this.stage.append(this.camera, this.chat, this.call, this.documentView, this.hotspots, this.effect, this.title, this.mode, this.reading, this.restoreButton);
    this.toolbar = this.el('div', undefined, 'vn-toolbar');
    for (const [id, label, handler] of [
      ['auto', '自动', () => session.setAuto(!session.getView().auto)],
      ['rollback', '回退', () => { try { if (!session.rollback()) this.notify('当前没有可回退的位置'); } catch { this.notify('回退失败，当前进度已保留'); } }],
      ['skip', '已读快进', () => { if (!session.setSkip(!session.getView().skipping)) this.notify('只能快进已经读过的段落'); }],
      ['save', '存档', () => options.persistence ? this.saveManager('save') : this.saveLegacy()],
      ['load', '读档', () => options.persistence ? this.saveManager('load') : this.loadLegacy()],
      ['quick-save', '快速存档', () => this.quickSave()], ['quick-load', '快速读档', () => this.quickLoad()], ['history', '历史', () => this.history()],
      ['gallery', 'CG 图鉴', () => this.collection('cg')], ['endings', '结局收藏', () => this.collection('ending')],
      ['evidence', '证据簿', () => this.evidence()], ['settings', '设置', () => this.settings()],
      ['hide', '隐藏界面', () => session.hide(true)], ['fullscreen', '全屏', () => this.fullscreen()],
      ['sound', '启用声音', () => options.onUnlockAudio?.()], ['restart', '新游戏', () => { session.restart(); this.notify('已开始新游戏'); }]
    ] as const) {
      const button = this.button(label, handler); button.dataset.control = id;
      if ((!options.persistence && (id === 'quick-save' || id === 'quick-load'))
        || (id === 'gallery' && !options.collections?.cgs?.length) || (id === 'endings' && !options.collections?.endings?.length)
        || (options.replayOnly && ['save', 'load', 'quick-save', 'quick-load', 'restart'].includes(id))) button.hidden = true;
      this.buttons.set(id, button); this.toolbar.append(button);
    }
    this.status = this.el('span', '', 'vn-status'); this.status.setAttribute('role', 'status'); this.toolbar.append(this.status);
    this.modal = this.el('div', undefined, 'vn-modal'); this.modal.hidden = true; this.modal.setAttribute('role', 'dialog'); this.modal.setAttribute('aria-modal', 'true');
    host.append(this.stage, this.toolbar, this.modal); root.append(host);
    this.keyVisualLayer = new KeyVisualLayer(host, this.stage, (image, id) => this.paint(image, id, 'ui'), message => this.notify(message));
    this.onVisibility = () => session.pause('background', this.document.visibilityState === 'hidden');
    this.onKey = event => this.key(event); this.onPointer = () => options.onUnlockAudio?.();
    this.onChatScroll = () => { this.chatPinned = this.chat.scrollHeight - this.chat.scrollTop - this.chat.clientHeight < 24; };
    this.motionQuery = this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.onMotion = () => { if (this.motionQuery?.matches && !this.disposed) { const view = this.session.getView(); this.updateTimeline(view, false); this.updateVideo(view, this.lastView, false); this.keyVisualLayer.update(view, false); } };
    try {
      this.document.addEventListener('visibilitychange', this.onVisibility); host.addEventListener('keydown', this.onKey); host.addEventListener('pointerdown', this.onPointer);
      this.motionQuery?.addEventListener?.('change', this.onMotion);
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
      const layers = frame.stage.layers;
      const layer = (name: StageVisualLayer, fallback?: StageLayerAsset | null) => layers && Object.hasOwn(layers, name) ? layers[name] : fallback;
      for (const [name, value] of [
        ['background', layer('background', frame.stage.background ? { asset: frame.stage.background, kind: 'background' } : null)],
        ['character-back', layer('character-back')],
        ['character', layer('character', frame.stage.portrait ? { asset: frame.stage.portrait, kind: 'portrait' } : null)],
        ['character-front', layer('character-front')],
        ['cg', layer('cg', frame.stage.cg ? { asset: frame.stage.cg, kind: 'cg' } : null)]
      ] as const) this.paint(this.layerNodes[name] as HTMLImageElement, value?.asset, value?.kind ?? 'portrait');
      this.chat.hidden = frame.mode !== 'chat'; this.call.hidden = frame.mode !== 'call';
      if (frame.mode === 'chat') {
        this.chat.replaceChildren();
        for (const record of this.session.history().slice(-5)) { if (record.lineId === frame.lineId) continue; const bubble = this.el('div', undefined, 'vn-bubble'); bubble.append(this.el('small', record.speaker), this.el('span', record.text)); this.chat.append(bubble); }
        this.currentBubble = this.el('div', undefined, 'vn-bubble vn-current'); this.bubbleText = this.el('span');
        this.currentBubble.append(this.el('small', frame.speaker), this.bubbleText); this.chat.append(this.currentBubble); this.chatPinned = true;
      }
      const document = frame.stage.document ?? (frame.mode === 'document' ? { title: frame.speaker, lines: [frame.text] } : undefined);
      this.documentView.hidden = !document;
      if (document) this.documentView.replaceChildren(this.el('h3', document.title), ...document.lines.map(line => this.el('p', line)));
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
    this.updateTimeline(snapshot, entered);
    this.updateVideo(snapshot, previous, entered);
    this.keyVisualLayer.update(snapshot, entered);
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
      for (const id of ['auto', 'skip', 'save', 'load', 'quick-save', 'quick-load', 'gallery', 'endings', 'history', 'evidence', 'settings', 'hide', 'restart']) this.buttons.get(id)!.disabled = snapshot.paused;
      this.buttons.get('skip')!.disabled ||= !snapshot.supportsSkip;
    }
    if (entered) this.buttons.get('evidence')!.hidden = !frame.evidence;
    this.buttons.get('rollback')!.hidden = !snapshot.supportsRollback;
    this.buttons.get('rollback')!.disabled = snapshot.paused || !snapshot.canRollback;
    if (snapshot.auto !== previous?.auto) this.buttons.get('auto')!.setAttribute('aria-pressed', String(snapshot.auto));
    if (snapshot.skipping !== previous?.skipping) this.buttons.get('skip')!.setAttribute('aria-pressed', String(snapshot.skipping));
  }
  private animations(): Animation[] { return [...(this.effect.getAnimations?.() ?? []), ...(this.stage.getAnimations?.() ?? [])]; }
  private clearVideo() {
    if (this.videoState) this.videoState.attempt++;
    this.videoState = undefined; this.video.onended = null; this.video.onerror = null;
    this.video.pause(); this.video.hidden = true; this.video.removeAttribute('src'); this.video.load();
    this.paint(this.videoFallback, null, 'cg');
  }
  private fallbackVideo(active: NonNullable<DOMRenderer['videoState']>, failed: boolean) {
    if (this.videoState !== active || active.finished) return;
    active.finished = true; active.attempt++; this.video.onended = null; this.video.onerror = null;
    this.video.pause(); this.video.hidden = true; this.video.removeAttribute('src'); this.video.load();
    const fallback = active.cue.fallback;
    this.videoFallback.classList.toggle('vn-video-fallback-background', fallback?.kind === 'background');
    if (fallback) { this.paint(this.videoFallback, fallback.asset, fallback.kind); if (fallback.kind === 'cg') this.options.onCgPresented?.(fallback.asset); }
    if (failed) this.notify('视频暂时无法播放，剧情可以继续');
  }
  private playVideo(active: NonNullable<DOMRenderer['videoState']>) {
    const attempt = ++active.attempt;
    try {
      const result = this.video.play();
      void result?.catch(() => { if (this.videoState === active && active.attempt === attempt && !this.session.getView().paused) this.fallbackVideo(active, true); });
    } catch { if (!this.session.getView().paused) this.fallbackVideo(active, true); }
  }
  private updateVideo(snapshot: RuntimeView, previous: RuntimeView | undefined, entered: boolean) {
    if (entered) {
      this.clearVideo();
      const cue = snapshot.frame.stage.video; if (!cue) return;
      const active: NonNullable<DOMRenderer['videoState']> = { cue, attempt: 0, finished: false }; this.videoState = active;
      const reduce = snapshot.settings.reducedMotion || !!this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduce || snapshot.skipping || ['restore', 'reread', 'rollback'].includes(snapshot.reason)) { this.fallbackVideo(active, false); return; }
      try {
        this.video.src = this.assets.url(cue.asset, 'video'); this.video.muted = cue.muted !== false; this.video.volume = snapshot.settings.volume;
        this.video.loop = cue.loop === true; this.video.hidden = false;
        this.video.onerror = () => this.fallbackVideo(active, true);
        this.video.onended = () => {
          if (this.videoState !== active || active.finished) return;
          active.finished = true; this.video.hidden = true; this.video.onended = null; this.video.onerror = null;
          this.video.removeAttribute('src'); this.video.load();
        };
        if (!snapshot.paused) this.playVideo(active);
      } catch { this.fallbackVideo(active, true); }
      return;
    }
    const active = this.videoState; if (!active || active.finished) return;
    if (snapshot.settings.reducedMotion || snapshot.skipping || this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { this.fallbackVideo(active, false); return; }
    if (snapshot.settings.volume !== previous?.settings.volume) this.video.volume = snapshot.settings.volume;
    if (snapshot.paused !== previous?.paused) {
      if (snapshot.paused) { active.attempt++; this.video.pause(); }
      else this.playVideo(active);
    }
  }
  private stopTimeline() {
    if (this.timeline?.frame !== undefined) this.document.defaultView?.cancelAnimationFrame(this.timeline.frame);
    if (this.timeline) { this.timeline.frame = undefined; this.timeline.previousTime = undefined; }
  }
  private paintTimeline(time: number) {
    const active = this.timeline; if (!active) return;
    const resolved = resolvePresentationTimeline(active.value, time), tracks = active.value.animations ?? [];
    if (active.value.camera?.length) this.camera.style.transform = `translate(${resolved.camera.x}px, ${resolved.camera.y}px) scale(${resolved.camera.scale})`;
    const selected = new Map<StageLayer, { index: number; start: number }>();
    resolved.animations.forEach((item, index) => {
      const node = this.layerNodes[item.layer], track = tracks[index], start = track.startMs ?? 0;
      if (item.target && node.dataset.asset !== item.target) return;
      const previous = selected.get(item.layer);
      if (!previous || (start <= time && (previous.start > time || start >= previous.start)) || (previous.start > time && start < previous.start)) selected.set(item.layer, { index, start });
    });
    for (const [name, choice] of selected) {
      const value = resolved.animations[choice.index].transform, node = this.layerNodes[name];
      node.style.transform = `translate(${value.x}px, ${value.y}px) scale(${value.scale})`; node.style.opacity = String(value.opacity);
    }
  }
  private updateTimeline(snapshot: RuntimeView, entered: boolean) {
    if (entered) {
      this.stopTimeline(); this.timeline = undefined; this.camera.style.removeProperty('transform');
      for (const node of Object.values(this.layerNodes)) { node.style.removeProperty('transform'); node.style.removeProperty('opacity'); }
      const state = snapshot.frame.stage.presentationState;
      if (state?.camera) this.camera.style.transform = `translate(${state.camera.x}px, ${state.camera.y}px) scale(${state.camera.scale})`;
      for (const [name, item] of Object.entries(state?.layers ?? {})) {
        const node = this.layerNodes[name as StageLayer]; if (!node || !item || (item.target && node.dataset.asset !== item.target)) continue;
        const value = item.transform; node.style.transform = `translate(${value.x}px, ${value.y}px) scale(${value.scale})`; node.style.opacity = String(value.opacity);
      }
      if (snapshot.frame.stage.timeline) this.timeline = { value: snapshot.frame.stage.timeline, elapsed: 0, finished: false };
    }
    const active = this.timeline; if (!active || active.finished) return;
    const view = this.document.defaultView, reduce = snapshot.settings.reducedMotion || !!view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || snapshot.skipping || ['restore', 'reread', 'rollback'].includes(snapshot.reason) || active.value.durationMs === 0) {
      this.stopTimeline(); active.elapsed = active.value.durationMs; this.paintTimeline(active.elapsed); active.finished = true; return;
    }
    if (snapshot.paused || !view) { this.stopTimeline(); return; }
    if (active.frame !== undefined) return;
    this.paintTimeline(active.elapsed);
    const tick = (time: number) => {
      if (this.disposed || this.timeline !== active) return;
      active.frame = undefined;
      if (this.session.getView().paused) { active.previousTime = undefined; return; }
      if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { active.elapsed = active.value.durationMs; this.paintTimeline(active.elapsed); active.finished = true; return; }
      if (active.previousTime !== undefined) active.elapsed = Math.min(active.value.durationMs, active.elapsed + Math.max(0, time - active.previousTime));
      active.previousTime = time; this.paintTimeline(active.elapsed);
      if (active.elapsed >= active.value.durationMs) { active.finished = true; active.previousTime = undefined; }
      else active.frame = view.requestAnimationFrame(tick);
    };
    active.frame = view.requestAnimationFrame(tick);
  }
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
  private saveManager(mode: 'save' | 'load') {
    const persistence = this.options.persistence;
    if (!persistence) { this.notify('存档功能暂不可用'); return; }
    const panel = this.panel(mode === 'save' ? '选择存档槽' : '选择读档槽');
    const list = this.el('div', undefined, 'vn-save-list'); panel.append(list);
    const show = () => {
      list.replaceChildren();
      for (let index = 1; index <= persistence.contract.manualSlots; index++) {
        const result = persistence.contract.loadManual(index), row = this.el('div', undefined, 'vn-save-slot');
        row.dataset.slot = String(index);
        const heading = this.el('strong', `手动存档 ${index}`), detail = this.el('span', this.saveDescription(result));
        row.append(heading, detail);
        const button = this.button(mode === 'save' ? `保存到槽位 ${index}` : `读取槽位 ${index}`, () => {
          if (mode === 'load') {
            try { const loaded = persistence.loadManual(index); if (loaded.status === 'valid') { this.closePanel(); this.notify(`已读取存档 ${index}`); } else this.notify('存档无法读取，原数据已保留'); }
            catch { this.notify('存档无法使用，原数据已保留'); }
            return;
          }
          const write = () => {
            try { const saved = persistence.saveManual(index); if (saved.status === 'saved') { this.closePanel(); this.notify(`已保存到槽位 ${index}`); } else this.notify('存储暂不可用，可以继续游玩或导出存档'); }
            catch { this.notify('存储暂不可用，可以继续游玩或导出存档'); }
          };
          // The slot can change in another tab while this panel is open.
          const current = persistence.contract.loadManual(index);
          if (current.status === 'unavailable') { this.notify('存储暂不可用，未覆盖存档'); return; }
          if (current.status === 'empty') { write(); return; }
          const confirmation = this.el('div', undefined, 'vn-save-confirm');
          confirmation.append(this.el('span', `确定覆盖槽位 ${index}？`), this.button(`确认覆盖槽位 ${index}`, write), this.button('取消覆盖', show));
          button.disabled = true; row.append(confirmation);
        });
        button.disabled = result.status === 'unavailable' || (mode === 'load' && result.status !== 'valid');
        row.append(button); list.append(row);
      }
    };
    show();
    if (mode === 'load') {
      const auto = persistence.contract.loadAuto();
      const autoButton = this.button('读取自动存档', () => {
        try { if (persistence.autoLoad().status === 'valid') { this.closePanel(); this.notify('已读取自动存档'); } else this.notify('自动存档无法读取，原数据已保留'); }
        catch { this.notify('自动存档无法使用，原数据已保留'); }
      });
      autoButton.disabled = auto.status !== 'valid';
      panel.append(this.el('p', `自动存档：${this.saveDescription(auto)}`), autoButton);
      try { if (this.options.storage?.getItem(this.saveKey) !== null && this.options.storage) panel.append(this.button('读取旧单槽存档', () => this.loadLegacy())); } catch { /* Storage unavailable. */ }
    }
  }
  private saveDescription(result: LoadResult<SaveEnvelope>): string {
    if (result.status === 'empty') return '空槽';
    if (result.status === 'invalid') return '存档损坏或版本不兼容，原数据已保留';
    if (result.status === 'unavailable') return '存储不可用';
    const save = result.value, summary = save.summary;
    return [save.savedAt, `游戏版本 ${save.game_version}`, `存档版本 ${save.save_version}`,
      summary?.title, summary?.sceneId && `场景 ${summary.sceneId}`, summary?.lineId && `段落 ${summary.lineId}`].filter(Boolean).join(' · ');
  }
  private quickSave() {
    try { const result = this.options.persistence?.quickSave(); this.notify(result?.status === 'saved' ? '已快速存档' : '快速存档失败，存储暂不可用'); }
    catch { this.notify('快速存档失败，存储暂不可用'); }
  }
  private quickLoad() {
    try {
      const result = this.options.persistence?.quickLoad();
      this.notify(result?.status === 'valid' ? '已快速读档' : result?.status === 'empty' ? '还没有快速存档' : '快速存档无法读取，原数据已保留');
    } catch { this.notify('快速存档无法使用，原数据已保留'); }
  }
  private saveLegacy() {
    try { if (!this.options.storage) throw new Error(); this.options.storage.setItem(this.saveKey, JSON.stringify(this.session.save())); this.notify('已保存当前段落'); }
    catch { this.notify('存储暂不可用，可以继续游玩或导出存档'); }
  }
  private loadLegacy() {
    let raw: string | null;
    try { if (!this.options.storage) throw new Error(); raw = this.options.storage.getItem(this.saveKey); } catch { this.notify('存储暂不可用'); return; }
    if (raw === null) { this.notify('还没有存档'); return; }
    try { if (raw.length > 2_000_000) throw new Error(); this.session.restore(JSON.parse(raw)); if (!this.modal.hidden) this.closePanel(); this.notify('已恢复旧单槽存档'); }
    catch { this.notify('存档无法使用，原文件已保留'); }
  }
  private panel(title: string, onClose: () => void = () => this.closePanel()): HTMLElement {
    if (!this.modal.hidden) this.closePanel();
    this.lastFocus = this.document.activeElement instanceof this.document.defaultView!.HTMLElement ? this.document.activeElement as HTMLElement : undefined;
    this.session.pause('panel', true); this.modal.hidden = false; this.modal.replaceChildren(); this.modal.setAttribute('aria-label', title);
    const panel = this.el('div', undefined, 'vn-panel'), head = this.el('div', undefined, 'vn-panel-head');
    const close = this.button('关闭', onClose); head.append(this.el('h2', title), close); panel.append(head); this.modal.append(panel); close.focus(); return panel;
  }
  private closePanel() {
    this.panelCleanup?.(); this.panelCleanup = undefined; this.replayReturn = undefined;
    this.modal.hidden = true; this.modal.replaceChildren(); this.session.pause('panel', false); if (this.lastFocus?.isConnected) this.lastFocus.focus(); else this.element.focus();
  }
  private collection(kind: 'cg' | 'ending') {
    const meta = this.options.meta, entries = kind === 'cg' ? this.options.collections?.cgs : this.options.collections?.endings;
    if (!meta || !entries) return;
    const panel = this.panel(kind === 'cg' ? 'CG 图鉴' : '结局收藏'), loaded = meta.read();
    if (loaded.status === 'invalid' || loaded.status === 'unavailable') { panel.append(this.el('p', '收藏进度暂不可读取，原数据已保留')); return; }
    const unlocked = new Set(loaded.status === 'valid' ? (kind === 'cg' ? loaded.value.cg_unlocked : loaded.value.ending_seen) : []);
    panel.append(this.el('p', `已解锁 ${entries.filter(item => unlocked.has(item.id)).length} / ${entries.length}`));
    const list = this.el('div', undefined, 'vn-collection-list');
    entries.forEach((item, index) => {
      const available = unlocked.has(item.id), row = this.el('div', undefined, 'vn-collection-entry');
      if (!available) { row.append(this.el('span', `未解锁 ${kind === 'cg' ? 'CG' : '结局'} ${index + 1}`)); }
      else if (kind === 'cg') {
        const cg = item as CollectionCg;
        row.append(this.el('strong', cg.title ?? cg.id), this.button('查看 CG', () => this.showCg(cg)));
      } else {
        const ending = item as CollectionEnding;
        row.append(this.el('strong', ending.title ?? ending.id));
        if (ending.trueEnding) row.append(this.el('span', 'True Ending'));
        if (ending.replay !== undefined && this.options.beginReplay) row.append(this.button('回看结局', () => this.startReplay('ending', ending)));
      }
      list.append(row);
    });
    panel.append(list);
  }
  private showCg(cg: CollectionCg) {
    const panel = this.panel(cg.title ?? 'CG 查看', () => this.collection('cg'));
    const image = this.el('img', undefined, 'vn-gallery-image'); image.alt = cg.title ?? '已解锁 CG'; image.src = this.assets.url(cg.id, 'cg');
    image.onerror = () => { image.hidden = true; panel.append(this.el('p', '图片暂时无法载入')); };
    panel.append(image, this.button('返回图鉴', () => this.collection('cg')));
    if (cg.replay !== undefined && this.options.beginReplay) panel.append(this.button('回看剧情', () => this.startReplay('cg', cg)));
  }
  private startReplay(kind: 'cg' | 'ending', entry: CollectionCg | CollectionEnding) {
    if (!this.options.meta || !this.options.beginReplay || entry.replay === undefined) return;
    try { this.options.meta.replay(kind, entry.id); } catch { this.modal.querySelector('.vn-panel')?.append(this.el('p', '收藏进度不可用，无法回看')); return; }
    const back = () => this.collection(kind), panel = this.panel('剧情回看', back), container = this.el('div', undefined, 'vn-replay');
    panel.append(this.button(kind === 'cg' ? '返回图鉴' : '返回结局收藏', back), container);
    try { this.panelCleanup = this.options.beginReplay(container, entry.replay); this.replayReturn = back; }
    catch { panel.append(this.el('p', '回看数据无效，当前进度未改变')); }
  }
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
      if (event.key === 'Escape') { event.preventDefault(); if (this.replayReturn) this.replayReturn(); else this.closePanel(); }
      if (event.key === 'Tab') {
        const items = [...this.modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]),select')]; const index = items.indexOf(this.document.activeElement as HTMLElement);
        if (items.length && ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1))) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus(); }
      }
      return;
    }
    const target = event.target as HTMLElement;
    if (this.options.persistence && !target.closest('input,textarea,select,[contenteditable=true]') && !this.session.getView().paused && (event.key === 'F5' || event.key === 'F9')) {
      event.preventDefault(); if (event.key === 'F5') this.quickSave(); else this.quickLoad(); return;
    }
    if (target.closest('button,input,textarea,select,[contenteditable=true]')) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.options.onUnlockAudio?.(); this.session.next(); }
    else if (event.key === 'Backspace' && !this.session.getView().paused) { event.preventDefault(); try { this.session.rollback(); } catch { this.notify('回退失败，当前进度已保留'); } }
    else if (/^[1-9]$/.test(event.key)) { const action = this.session.getView().frame.actions[Number(event.key) - 1]; if (action) { event.preventDefault(); this.session.act(action.id); } }
    else if (event.key.toLowerCase() === 'h') { event.preventDefault(); this.session.hide(!this.session.getView().hidden); }
    else if (event.key.toLowerCase() === 'a') { event.preventDefault(); this.session.setAuto(!this.session.getView().auto); }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.panelCleanup?.(); this.panelCleanup = undefined; this.replayReturn = undefined; this.disconnect(); this.session.pause('panel', false);
    this.document.removeEventListener('visibilitychange', this.onVisibility); this.element.removeEventListener('keydown', this.onKey); this.element.removeEventListener('pointerdown', this.onPointer);
    this.motionQuery?.removeEventListener?.('change', this.onMotion);
    this.chat.removeEventListener('scroll', this.onChatScroll); this.cancelScroll(); this.stopTimeline(); this.timeline = undefined; this.clearVideo();
    this.keyVisualLayer?.dispose();
    for (const { probe } of this.probes.values()) { probe.onload = null; probe.onerror = null; probe.removeAttribute('src'); } this.probes.clear();
    for (const animation of this.animations()) animation.cancel(); this.element.remove();
  }
}
