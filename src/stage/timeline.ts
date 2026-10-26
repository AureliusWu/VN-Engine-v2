import { STAGE_LAYERS, type CameraKeyframe, type PresentationTimeline, type StageAnimation, type StageLayer, type StageTransform } from './types.js';

export type ResolvedAnimation = { id: string; layer: StageLayer; target?: string; transform: Required<StageTransform>; progress: number };
export type ResolvedTimeline = { timeMs: number; durationMs: number; settled: boolean; camera: { x: number; y: number; scale: number }; animations: readonly ResolvedAnimation[] };

const defaults: Required<StageTransform> = { x: 0, y: 0, scale: 1, opacity: 1 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function ease(value: number, easing: StageAnimation['easing']): number {
  const t = clamp(value, 0, 1);
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (easing === 'ease-in-out') return t < .5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return t;
}
function transform(value: StageTransform | undefined, fallback = defaults): Required<StageTransform> {
  return {
    x: finite(value?.x, fallback.x), y: finite(value?.y, fallback.y),
    scale: finite(value?.scale, fallback.scale), opacity: clamp(finite(value?.opacity, fallback.opacity), 0, 1)
  };
}
function interpolate(from: Required<StageTransform>, to: Required<StageTransform>, t: number): Required<StageTransform> {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    scale: from.scale + (to.scale - from.scale) * t, opacity: from.opacity + (to.opacity - from.opacity) * t };
}
function cameraAt(frames: readonly CameraKeyframe[] | undefined, timeMs: number) {
  if (!frames?.length) return { x: 0, y: 0, scale: 1 };
  const ordered = [...frames].sort((a, b) => a.atMs - b.atMs);
  const first = ordered[0], last = ordered[ordered.length - 1];
  const normalize = (frame: CameraKeyframe, fallback: { x: number; y: number; scale: number }) => ({
    x: finite(frame.x, fallback.x), y: finite(frame.y, fallback.y), scale: finite(frame.scale, fallback.scale)
  });
  if (timeMs <= first.atMs) return normalize(first, { x: 0, y: 0, scale: 1 });
  let previous = normalize(first, { x: 0, y: 0, scale: 1 });
  for (let index = 1; index < ordered.length; index++) {
    const nextFrame = ordered[index], next = normalize(nextFrame, previous);
    if (timeMs <= nextFrame.atMs) {
      const start = ordered[index - 1].atMs, span = Math.max(1, nextFrame.atMs - start), t = clamp((timeMs - start) / span, 0, 1);
      return { x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t, scale: previous.scale + (next.scale - previous.scale) * t };
    }
    previous = next;
  }
  return normalize(last, previous);
}

export function validatePresentationTimeline(timeline: PresentationTimeline): void {
  if (!Number.isFinite(timeline.durationMs) || timeline.durationMs < 0 || timeline.durationMs > 300_000) throw new Error('Invalid timeline duration');
  const ids = new Set<string>();
  for (const animation of timeline.animations ?? []) {
    if (!animation.id.trim() || ids.has(animation.id) || !STAGE_LAYERS.includes(animation.layer)) throw new Error('Invalid or duplicate timeline animation');
    ids.add(animation.id);
    const start = animation.startMs ?? 0;
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(animation.durationMs) || animation.durationMs < 0 || start + animation.durationMs > timeline.durationMs)
      throw new Error(`Animation outside timeline: ${animation.id}`);
    const to = transform(animation.to), from = transform(animation.from);
    if (to.scale <= 0 || from.scale <= 0) throw new Error(`Animation scale must be positive: ${animation.id}`);
  }
  let previous = -1;
  for (const frame of timeline.camera ?? []) {
    if (!Number.isFinite(frame.atMs) || frame.atMs < 0 || frame.atMs > timeline.durationMs || frame.atMs < previous) throw new Error('Camera keyframes must be ordered within timeline');
    if (frame.scale !== undefined && (!Number.isFinite(frame.scale) || frame.scale <= 0)) throw new Error('Camera scale must be positive');
    previous = frame.atMs;
  }
}

export function resolvePresentationTimeline(timeline: PresentationTimeline, timeMs: number, options: { settle?: boolean; reducedMotion?: boolean } = {}): ResolvedTimeline {
  validatePresentationTimeline(timeline);
  const settled = options.settle === true || options.reducedMotion === true;
  const time = settled ? timeline.durationMs : clamp(finite(timeMs, 0), 0, timeline.durationMs);
  const animations = (timeline.animations ?? []).map(animation => {
    const start = animation.startMs ?? 0, duration = animation.durationMs;
    const raw = duration === 0 ? (time >= start ? 1 : 0) : (time - start) / duration;
    const progress = ease(raw, animation.easing);
    const from = transform(animation.from), to = transform(animation.to, from);
    return Object.freeze({ id: animation.id, layer: animation.layer, target: animation.target, transform: Object.freeze(interpolate(from, to, progress)), progress });
  });
  return Object.freeze({ timeMs: time, durationMs: timeline.durationMs, settled, camera: Object.freeze(cameraAt(timeline.camera, time)), animations: Object.freeze(animations) });
}

export function settlePresentationTimeline(timeline: PresentationTimeline): ResolvedTimeline {
  return resolvePresentationTimeline(timeline, timeline.durationMs, { settle: true });
}
