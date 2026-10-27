import type { RuntimeView } from '../runtime/session.js';
import { validateKeyVisual } from '../stage/key-visual.js';

/** A visit-scoped decorative layer, kept behind interactive content with an explicit deadline. */
export class KeyVisualLayer {
  private readonly wrapper: HTMLElement;
  private readonly image: HTMLImageElement;
  private active?: { remaining: number; due?: number; timer?: number };
  constructor(private readonly host: HTMLElement, private readonly stage: HTMLElement,
    private readonly paint: (image: HTMLImageElement, id: string | null) => void, private readonly notify: (message: string) => void) {
    this.wrapper = host.ownerDocument.createElement('div'); this.wrapper.className = 'vn-key-visual'; this.wrapper.hidden = true;
    this.wrapper.setAttribute('aria-hidden', 'true'); this.image = host.ownerDocument.createElement('img'); this.image.alt = ''; this.image.draggable = false;
    this.wrapper.append(this.image); host.insertBefore(this.wrapper, stage);
  }
  private stop() {
    const active = this.active, view = this.host.ownerDocument.defaultView;
    if (active?.timer !== undefined && view) { view.clearTimeout(active.timer); active.remaining = Math.max(0, (active.due ?? view.performance.now()) - view.performance.now()); active.timer = undefined; }
  }
  clear() { this.stop(); this.active = undefined; this.wrapper.hidden = true; this.paint(this.image, null); }
  update(snapshot: RuntimeView, entered: boolean) {
    if (entered) {
      this.clear(); const cue = snapshot.frame.stage.keyVisual; if (!cue) return;
      try { validateKeyVisual(cue); } catch { this.notify('装饰视觉配置无效，已跳过，可以继续阅读'); return; }
      if (!['start', 'advance', 'action'].includes(snapshot.reason)) return;
      this.active = { remaining: cue.durationMs }; this.wrapper.dataset.scope = cue.scope;
      if (cue.scope === 'banner') this.host.insertBefore(this.wrapper, this.stage);
      else this.stage.insertBefore(this.wrapper, this.stage.children[1] ?? null);
      this.paint(this.image, cue.asset);
    }
    const active = this.active, view = this.host.ownerDocument.defaultView; if (!active || !view) return;
    if (snapshot.skipping || snapshot.settings.reducedMotion || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { this.clear(); return; }
    this.wrapper.hidden = snapshot.hidden;
    if (snapshot.paused) { this.stop(); return; }
    if (active.timer !== undefined) return;
    active.due = view.performance.now() + active.remaining;
    active.timer = view.setTimeout(() => { if (this.active === active) this.clear(); }, active.remaining);
  }
  dispose() { this.clear(); this.wrapper.remove(); }
}
