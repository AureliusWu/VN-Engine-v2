import type { ReadRecord, RuntimeDriver, RuntimeFrame } from '../stage/types.js';

export type RuntimeSettings = {
  textDelayMs: number; autoDelayMs: number; skipDelayMs: number; reducedMotion: boolean;
  music: boolean; volume: number; voiceEnabled: boolean; voiceVolume: number; soundEffects: boolean; opacity: number;
};
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = { textDelayMs: 28, autoDelayMs: 1800, skipDelayMs: 80,
  reducedMotion: false, music: true, volume: .25, voiceEnabled: true, voiceVolume: .8, soundEffects: true, opacity: .85 };
export interface Clock { now(): number; set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }
const systemClock: Clock = { now: () => Date.now(), set: (callback, delay) => globalThis.setTimeout(callback, delay), clear: handle => globalThis.clearTimeout(handle as number) };
export type VisitReason = 'start' | 'advance' | 'action' | 'restore' | 'reread';
export type RuntimeSnapshot = {
  frame: RuntimeFrame; visit: number; reason: VisitReason; text: string; complete: boolean; ready: boolean;
  paused: boolean; pauseReasons: readonly string[]; hidden: boolean; auto: boolean; skipping: boolean; voiceBlocked: boolean;
  settings: RuntimeSettings; supportsSkip: boolean; supportsReread: boolean;
};

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
  private current: RuntimeFrame;
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
  constructor(readonly driver: RuntimeDriver, options: { settings?: Partial<RuntimeSettings>; clock?: Clock } = {}) {
    this.clock = options.clock ?? systemClock; this.settings = runtimeSettings(options.settings ?? {});
    this.current = driver.frame(); this.enter('start');
  }
  private readonly clock: Clock;
  subscribe(listener: () => void): () => void { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  getSnapshot(): RuntimeSnapshot {
    return { frame: structuredClone(this.current), visit: this.visit, reason: this.reason,
      text: this.glyphs.slice(0, this.count).join(''), complete: this.count >= this.glyphs.length,
      ready: this.count >= this.glyphs.length && this.hold <= 0, paused: this.pauses.size > 0 || this.hidden,
      pauseReasons: [...this.pauses], hidden: this.hidden, auto: this.automatic, skipping: this.skipping, voiceBlocked: this.voiceBlocked,
      settings: { ...this.settings }, supportsSkip: this.driver.supportsSkip, supportsReread: this.driver.supportsReread };
  }
  private emit() { if (!this.disposed) for (const listener of [...this.listeners]) listener(); }
  private readKey(frame = this.current) { return `${frame.lineId}\u0000${frame.text}`; }
  private cancel() {
    if (this.timer) {
      if (this.timer.kind === 'hold') this.hold = Math.max(0, this.timer.due - this.clock.now());
      if (this.timer.kind === 'auto') this.autoRemaining = Math.max(0, this.timer.due - this.clock.now());
      this.clock.clear(this.timer.handle); this.timer = undefined;
    }
    this.generation++;
  }
  private enter(reason: VisitReason) {
    this.cancel(); this.current = structuredClone(this.driver.frame()); this.visit++; this.reason = reason;
    if (['start', 'restore', 'reread'].includes(reason)) { this.automatic = false; this.skipping = false; }
    this.voiceBlocked = false; this.autoRemaining = undefined;
    this.eligibleSkip = this.read.has(this.readKey());
    this.glyphs = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(this.current.text)].map(segment => segment.segment);
    this.count = this.settings.textDelayMs === 0 || this.settings.reducedMotion ? this.glyphs.length : 0;
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
        this.count = this.skipping ? this.glyphs.length : Math.min(this.glyphs.length, this.count + 1);
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
    if (this.count < this.glyphs.length) { this.cancel(); this.count = this.glyphs.length; this.read.add(this.readKey()); this.emit(); this.schedule(); return true; }
    if (this.hold > 0 || !this.current.canAdvance || !this.driver.advance()) return false;
    this.enter('advance'); return true;
  }
  act(id: string): boolean {
    const snapshot = this.getSnapshot();
    if (this.disposed || snapshot.paused || !snapshot.ready || !snapshot.frame.actions.some(action => action.id === id) || !this.driver.act(id)) return false;
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
    if (this.disposed) return; this.cancel(); this.settings = runtimeSettings({ ...this.settings, ...value });
    if (this.settings.textDelayMs === 0 || this.settings.reducedMotion) { this.count = this.glyphs.length; this.read.add(this.readKey()); }
    this.emit(); this.schedule();
  }
  history(): readonly ReadRecord[] { return structuredClone(this.driver.history(this.getSnapshot().complete)); }
  reread(id: string): boolean {
    if (this.disposed || this.hidden || !this.driver.supportsReread || !this.driver.reread(id)) return false;
    this.enter('reread'); return true;
  }
  save(): unknown { if (this.disposed) throw new Error('Session is disposed'); return structuredClone(this.driver.save()); }
  restore(value: unknown) {
    if (this.disposed) throw new Error('Session is disposed');
    this.driver.restore(value);
    for (const entry of this.driver.history(false)) this.read.add(`${entry.lineId}\u0000${entry.text}`);
    this.enter('restore');
  }
  restart() { if (!this.disposed) { this.driver.reset(); this.enter('start'); } }
  dispose() { if (this.disposed) return; this.cancel(); this.disposed = true; this.listeners.clear(); }
}
