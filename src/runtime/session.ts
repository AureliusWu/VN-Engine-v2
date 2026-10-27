import type { ReadRecord, RuntimeDriver, RuntimeFrame } from '../stage/types.js';
import { freezeData, type DeepReadonly } from './readonly.js';
import { RollbackHistory, type RollbackOptions } from './rollback.js';
import { MiniGameSession, validateMiniGame, type MiniGameSnapshot } from '../minigame/session.js';
import { isRecord } from '../storage/save.js';

export type RuntimeSettings = {
  textDelayMs: number; autoDelayMs: number; skipDelayMs: number; reducedMotion: boolean;
  music: boolean; volume: number; voiceEnabled: boolean; voiceVolume: number; soundEffects: boolean; opacity: number;
};
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = { textDelayMs: 28, autoDelayMs: 1800, skipDelayMs: 80,
  reducedMotion: false, music: true, volume: .25, voiceEnabled: true, voiceVolume: .8, soundEffects: true, opacity: .85 };
export interface Clock { now(): number; set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }
const systemClock: Clock = { now: () => Date.now(), set: (callback, delay) => globalThis.setTimeout(callback, delay), clear: handle => globalThis.clearTimeout(handle as number) };
export type VisitReason = 'start' | 'advance' | 'action' | 'restore' | 'reread' | 'rollback';
export type RuntimeSnapshot = {
  frame: RuntimeFrame; visit: number; reason: VisitReason; text: string; complete: boolean; ready: boolean;
  paused: boolean; pauseReasons: readonly string[]; hidden: boolean; auto: boolean; skipping: boolean; voiceBlocked: boolean;
  settings: RuntimeSettings; supportsSkip: boolean; supportsReread: boolean;
  supportsRollback: boolean; canRollback: boolean; rollbackDepth: number;
  miniGame?: MiniGameSnapshot; miniGameError?: string;
};
export type RuntimeView = DeepReadonly<RuntimeSnapshot>;

export function runtimeSettings(value: Partial<RuntimeSettings>): RuntimeSettings {
  const result = { ...DEFAULT_RUNTIME_SETTINGS };
  for (const [key, min, max] of [['textDelayMs', 0, 200], ['autoDelayMs', 20, 60000], ['skipDelayMs', 10, 1000], ['volume', 0, 1], ['voiceVolume', 0, 1], ['opacity', .25, 1]] as const) {
    const number = value[key]; if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.max(min, Math.min(max, number));
  }
  for (const key of ['reducedMotion', 'music', 'voiceEnabled', 'soundEffects'] as const) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}

/** Owns text timing, pause scopes, auto/read-skip and every interactive visit. */
export class RuntimeSession {
  private listeners = new Set<() => void>();
  private current!: DeepReadonly<RuntimeFrame>;
  private view?: RuntimeView;
  private displayed = '';
  private readonly segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  private glyphs: string[] = [];
  private count = 0;
  private hold = 0;
  private autoRemaining?: number;
  private visit = 0;
  private reason: VisitReason = 'start';
  private pauses = new Set<string>();
  private hidden = false;
  private automatic = false;
  private skipping = false;
  private eligibleSkip = false;
  private voiceBlocked = false;
  private read = new Set<string>();
  private settings: RuntimeSettings;
  private timer?: { handle: unknown; kind: 'typing' | 'hold' | 'auto' | 'skip'; due: number; generation: number };
  private generation = 0;
  private disposed = false;
  private readonly rollbackHistory: RollbackHistory;
  private miniGame?: MiniGameSession;
  private miniGameError?: string;
  constructor(readonly driver: RuntimeDriver, options: { settings?: Partial<RuntimeSettings>; clock?: Clock; rollback?: RollbackOptions } = {}) {
    this.clock = options.clock ?? systemClock; this.settings = Object.freeze(runtimeSettings(options.settings ?? {}));
    this.rollbackHistory = new RollbackHistory(options.rollback);
    this.enter('start');
  }
  private readonly clock: Clock;
  subscribe(listener: () => void): () => void { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  getSnapshot(): RuntimeSnapshot {
    return structuredClone(this.getView()) as RuntimeSnapshot;
  }
  /** Stable immutable view for renderers; getSnapshot retains its mutable-copy contract. */
  getView(): RuntimeView {
    if (this.view) return this.view;
    this.view = Object.freeze({ frame: this.current, visit: this.visit, reason: this.reason,
      text: this.displayed, complete: this.count >= this.glyphs.length,
      ready: this.count >= this.glyphs.length && this.hold <= 0, paused: this.pauses.size > 0 || this.hidden,
      pauseReasons: Object.freeze([...this.pauses]), hidden: this.hidden, auto: this.automatic, skipping: this.skipping, voiceBlocked: this.voiceBlocked,
      settings: this.settings, supportsSkip: this.driver.supportsSkip, supportsReread: this.driver.supportsReread,
      supportsRollback: this.rollbackHistory.enabled, canRollback: this.rollbackHistory.depth > 0, rollbackDepth: this.rollbackHistory.depth,
      miniGame: this.miniGame?.getView(), miniGameError: this.miniGameError });
    return this.view;
  }
  private emit() { this.view = undefined; if (!this.disposed) for (const listener of [...this.listeners]) listener(); }
  private readKey(frame = this.current) { return `${frame.lineId}\u0000${frame.text}`; }
  private cancel() {
    if (this.timer) {
      if (this.timer.kind === 'hold') this.hold = Math.max(0, this.timer.due - this.clock.now());
      if (this.timer.kind === 'auto') this.autoRemaining = Math.max(0, this.timer.due - this.clock.now());
      this.clock.clear(this.timer.handle); this.timer = undefined;
    }
    this.generation++;
  }
  private enter(reason: VisitReason, restoredMiniGame?: MiniGameSession) {
    this.cancel(); this.current = freezeData(structuredClone(this.driver.frame())); this.visit++; this.reason = reason;
    this.miniGame = restoredMiniGame; this.miniGameError = undefined;
    if (!this.miniGame && this.current.stage.miniGame) try {
      validateMiniGame(this.current.stage.miniGame, this.current.actions.map(action => action.id)); this.miniGame = new MiniGameSession(this.current.stage.miniGame);
    } catch { this.miniGameError = '小游戏配置与当前剧情操作不匹配，已保留普通操作'; }
    if (['start', 'restore', 'reread', 'rollback'].includes(reason)) { this.automatic = false; this.skipping = false; }
    if (['start', 'restore', 'reread'].includes(reason)) this.rollbackHistory.clear();
    if (reason !== 'rollback') this.checkpoint();
    this.voiceBlocked = false; this.autoRemaining = undefined;
    this.eligibleSkip = this.read.has(this.readKey());
    this.glyphs = [...this.segmenter.segment(this.current.text)].map(segment => segment.segment);
    this.count = this.settings.textDelayMs === 0 || this.settings.reducedMotion ? this.glyphs.length : 0;
    this.displayed = this.count === this.glyphs.length ? this.current.text : '';
    const pause = this.current.stage.pauseMs;
    this.hold = typeof pause === 'number' && Number.isFinite(pause) ? Math.max(0, Math.min(30000, pause)) : 0;
    if (!this.eligibleSkip || this.current.actions.length || !this.current.canAdvance) this.skipping = false;
    if (this.count === this.glyphs.length) this.read.add(this.readKey());
    this.emit(); this.schedule();
  }
  private schedule() {
    if (this.disposed || this.timer || this.pauses.size || this.hidden) return;
    let kind: 'typing' | 'hold' | 'auto' | 'skip', delay: number;
    if (this.count < this.glyphs.length) { kind = 'typing'; delay = this.skipping ? 0 : this.settings.textDelayMs; }
    else if (this.hold > 0) { kind = 'hold'; delay = this.hold; }
    else if (this.current.canAdvance && !this.current.actions.length && !this.voiceBlocked && (this.skipping || this.automatic)) {
      kind = this.skipping ? 'skip' : 'auto'; delay = this.skipping ? this.settings.skipDelayMs : this.autoRemaining ?? this.settings.autoDelayMs;
    } else return;
    const generation = this.generation, due = this.clock.now() + delay;
    const handle = this.clock.set(() => {
      if (this.disposed || generation !== this.generation || this.pauses.size || this.hidden) return;
      this.timer = undefined;
      if (kind === 'typing') {
        if (this.skipping) { this.count = this.glyphs.length; this.displayed = this.current.text; }
        else { this.displayed += this.glyphs[this.count]; this.count++; }
        if (this.count === this.glyphs.length) this.read.add(this.readKey());
      } else if (kind === 'hold') this.hold = 0;
      else {
        this.autoRemaining = undefined;
        if (this.driver.advance()) { this.enter('advance'); return; }
        this.automatic = false; this.skipping = false;
      }
      this.emit(); this.schedule();
    }, delay);
    this.timer = { handle, kind, due, generation };
  }
  next(): boolean {
    if (this.disposed || this.pauses.size || this.hidden) return false;
    if (this.count < this.glyphs.length) { this.cancel(); this.count = this.glyphs.length; this.displayed = this.current.text; this.read.add(this.readKey()); this.emit(); this.schedule(); return true; }
    if (this.miniGame) return false;
    if (this.hold > 0 || !this.current.canAdvance || !this.driver.advance()) return false;
    this.enter('advance'); return true;
  }
  act(id: string): boolean {
    if (this.disposed || this.miniGame || this.pauses.size || this.hidden || this.count < this.glyphs.length || this.hold > 0
      || !this.current.actions.some(action => action.id === id) || !this.driver.act(id)) return false;
    this.enter('action'); return true;
  }
  pause(reason: string, paused: boolean) {
    if (this.disposed || !reason || this.pauses.has(reason) === paused) return;
    this.cancel(); if (paused) this.pauses.add(reason); else this.pauses.delete(reason); this.emit(); this.schedule();
  }
  hide(hidden: boolean) {
    if (this.disposed || this.hidden === hidden) return;
    this.cancel(); this.hidden = hidden; this.emit(); this.schedule();
  }
  setAuto(enabled: boolean) { if (this.disposed) return; this.cancel(); this.automatic = enabled; this.autoRemaining = undefined; this.skipping = false; this.emit(); this.schedule(); }
  setSkip(enabled: boolean): boolean {
    if (this.disposed || (enabled && (!this.driver.supportsSkip || !this.eligibleSkip || this.current.actions.length || !this.current.canAdvance))) return false;
    this.cancel(); this.skipping = enabled; this.automatic = false; this.emit(); this.schedule(); return true;
  }
  setVoiceBlocked(blocked: boolean) {
    if (this.disposed || blocked === this.voiceBlocked) return;
    this.cancel(); this.voiceBlocked = blocked; this.emit(); this.schedule();
  }
  configure(value: Partial<RuntimeSettings>) {
    if (this.disposed) return;
    const next = runtimeSettings({ ...this.settings, ...value });
    if ((Object.keys(next) as (keyof RuntimeSettings)[]).every(key => next[key] === this.settings[key])) return;
    this.cancel(); this.settings = Object.freeze(next);
    if (this.settings.textDelayMs === 0 || this.settings.reducedMotion) { this.count = this.glyphs.length; this.displayed = this.current.text; this.read.add(this.readKey()); }
    this.emit(); this.schedule();
  }
  history(): readonly ReadRecord[] { return structuredClone(this.driver.history(this.count >= this.glyphs.length)); }
  private withMiniGame(value: unknown): unknown {
    if (!this.miniGame) return value;
    if (!isRecord(value)) throw new Error('Mini-game persistence requires an object driver save');
    return { ...value, vnMiniGame: { frameId: this.current.id, state: this.miniGame.save() } };
  }
  private checkpoint(replace = false) {
    if (!this.rollbackHistory.enabled) return;
    try { const value = this.withMiniGame(this.driver.checkpoint ? this.driver.checkpoint() : this.driver.save());
      if (replace) this.rollbackHistory.replaceCurrent(value); else this.rollbackHistory.capture(value);
    } catch { this.rollbackHistory.clear(); }
  }
  private miniGameReady() { return !this.disposed && !this.hidden && !this.pauses.size && this.count >= this.glyphs.length && this.hold <= 0; }
  private changeMiniGame(change: (game: MiniGameSession) => boolean) {
    if (!this.miniGameReady() || !this.miniGame || !change(this.miniGame)) return false;
    this.cancel(); this.automatic = false; this.skipping = false; this.checkpoint(true); this.emit(); this.schedule(); return true;
  }
  startMiniGame() { return this.changeMiniGame(game => game.start()); }
  playMiniGame(index: number) { return this.changeMiniGame(game => game.play(index)); }
  skipMiniGame() { return this.changeMiniGame(game => game.skip()); }
  abortMiniGame() { return this.changeMiniGame(game => game.abort()); }
  finishMiniGame() {
    const action = this.miniGame?.resultAction();
    if (!this.miniGameReady() || !action || !this.current.actions.some(item => item.id === action) || !this.driver.act(action)) return false;
    this.enter('action'); return true;
  }
  private restoreDriver(value: unknown): MiniGameSession | undefined {
    if (!isRecord(value) || value.vnMiniGame === undefined) { this.driver.restore(value); return undefined; }
    const before = this.driver.checkpoint ? this.driver.checkpoint() : this.driver.save(); this.driver.restore(value);
    try {
      const frame = this.driver.frame(), extra = value.vnMiniGame;
      if (!isRecord(extra) || extra.frameId !== frame.id || !frame.stage.miniGame) throw new Error('Mini-game save belongs to another story visit');
      validateMiniGame(frame.stage.miniGame, frame.actions.map(action => action.id));
      const game = new MiniGameSession(frame.stage.miniGame); game.restore(extra.state); return game;
    } catch (error) { this.driver.restore(before); throw error; }
  }
  rollback(steps = 1): boolean {
    if (this.disposed || this.hidden || this.pauses.size) return false;
    const target = this.rollbackHistory.target(steps); if (target === undefined) return false;
    const miniGame = this.restoreDriver(target); this.rollbackHistory.rewind(steps); this.enter('rollback', miniGame); return true;
  }
  reread(id: string): boolean {
    if (this.disposed || this.hidden || !this.driver.supportsReread || !this.driver.reread(id)) return false;
    this.enter('reread'); return true;
  }
  save(): unknown { if (this.disposed) throw new Error('Session is disposed'); return structuredClone(this.withMiniGame(this.driver.save())); }
  restore(value: unknown) {
    if (this.disposed) throw new Error('Session is disposed');
    const miniGame = this.restoreDriver(value);
    for (const entry of this.driver.history(false)) this.read.add(`${entry.lineId}\u0000${entry.text}`);
    this.enter('restore', miniGame);
  }
  restart() { if (!this.disposed) { this.driver.reset(); this.enter('start'); } }
  dispose() { if (this.disposed) return; this.cancel(); this.rollbackHistory.clear(); this.miniGame = undefined; this.disposed = true; this.listeners.clear(); }
}
