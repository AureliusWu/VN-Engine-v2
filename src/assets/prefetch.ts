import type { ResourcePlan, ResourcePlanAsset } from './plan.js';
import { freezeData } from '../runtime/readonly.js';

export type ResourceLoadRequest = { assetId: string; url: string; signal: AbortSignal; maxBytes: number };
export type ResourcePrefetchOptions = {
  maxConcurrent?: number; maxQueued?: number; maxTransferBytes?: number; maxBytes?: number;
  loader?: (request: ResourceLoadRequest) => Promise<Uint8Array>;
  createObjectURL?: (bytes: Uint8Array, asset: ResourcePlanAsset) => string;
  revokeObjectURL?: (url: string) => void;
};
type Ready = { asset: ResourcePlanAsset; bytes: Uint8Array; used: number; url?: string };
type Task = { asset: ResourcePlanAsset; controller: AbortController; reservation: number; cancelled: boolean };

const bounded = (value: number | undefined, fallback: number, maximum: number, minimum = 1): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw Error('Invalid prefetch budget');
  return value;
};
const abortError = () => new DOMException('Resource prefetch aborted', 'AbortError');

/** Fetch encoded bytes only, enforcing the cap even for absent or misleading Content-Length. */
export async function fetchResourceBytes({ url, signal, maxBytes }: ResourceLoadRequest): Promise<Uint8Array> {
  if (signal.aborted) throw abortError();
  const response = await fetch(url, { signal });
  if (!response.ok) { await response.body?.cancel(); throw Error(`Resource request failed: ${response.status}`); }
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel(); throw Error('Resource exceeds transfer budget');
  }
  if (!response.body) throw Error('Streaming resource body unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw abortError();
      const part = await reader.read();
      if (signal.aborted) throw abortError();
      if (part.done) break;
      if (part.value.byteLength > maxBytes - size) throw Error('Resource exceeds transfer budget');
      size += part.value.byteLength; chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
const contentType = (asset: ResourcePlanAsset) => {
  const extension = asset.src.split('.').at(-1)?.toLowerCase();
  return ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    avif: 'image/avif', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
};
const defaultObjectURL = (bytes: Uint8Array, asset: ResourcePlanAsset) => URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType(asset) }));

/**
 * Optional encoded-byte cache, separate from decoded audio and the service worker cache.
 * An aborted physical loader retains its slot and reservation until it settles.
 * No network, media, Blob URL or browser device is touched by importing this module.
 */
export class ResourcePrefetcher {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly maxTransferBytes: number;
  private readonly maxBytes: number;
  private readonly loader: NonNullable<ResourcePrefetchOptions['loader']>;
  private readonly createURL: NonNullable<ResourcePrefetchOptions['createObjectURL']>;
  private readonly revokeURL: NonNullable<ResourcePrefetchOptions['revokeObjectURL']>;
  private readonly resolveURL: (assetId: string) => string;
  private ready = new Map<string, Ready>();
  private tasks = new Map<string, Task>();
  private desired = new Map<string, ResourcePlanAsset>();
  private queue = new Map<string, ResourcePlanAsset>();
  private owners = new Map<string, Set<string>>();
  private active = new Set<string>();
  private failures = new Set<string>();
  private paused = false;
  private disposed = false;
  private cancelled = 0;
  private truncated = false;
  private serial = 0;
  private identity?: string;
  constructor(options: ResourcePrefetchOptions & { resolveURL: (assetId: string) => string }) {
    this.maxConcurrent = bounded(options.maxConcurrent, 2, 16);
    this.maxQueued = bounded(options.maxQueued, 32, 1024, 0);
    this.maxTransferBytes = bounded(options.maxTransferBytes, 2 * 1024 * 1024, 128 * 1024 * 1024);
    this.maxBytes = bounded(options.maxBytes, 8 * 1024 * 1024, 512 * 1024 * 1024);
    this.loader = options.loader ?? fetchResourceBytes;
    this.createURL = options.createObjectURL ?? defaultObjectURL;
    this.revokeURL = options.revokeObjectURL ?? (url => URL.revokeObjectURL(url));
    this.resolveURL = options.resolveURL;
  }
  private pinned(id: string): boolean { return this.active.has(id) || [...this.owners.values()].some(ids => ids.has(id)); }
  private resident(): number { return [...this.ready.values()].reduce((sum, entry) => sum + entry.bytes.byteLength, 0); }
  private reserved(): number { return [...this.tasks.values()].reduce((sum, task) => sum + task.reservation, 0); }
  private evict(id: string) {
    const entry = this.ready.get(id); if (!entry) return;
    if (entry.url) this.revokeURL(entry.url);
    this.ready.delete(id);
  }
  private revokeReleased() {
    for (const [id, entry] of this.ready) if (entry.url && !this.pinned(id)) {
      this.revokeURL(entry.url); delete entry.url;
    }
  }
  private cancel(task: Task) {
    if (!task.cancelled) { task.cancelled = true; this.cancelled++; task.controller.abort(); }
  }
  private enqueue() {
    this.queue.clear();
    if (this.paused || this.disposed) return;
    for (const [id, asset] of this.desired) {
      if (this.active.has(id) || this.ready.has(id) || this.tasks.has(id) || this.failures.has(id)) continue;
      if (this.queue.size >= this.maxQueued) { this.truncated = true; break; }
      this.queue.set(id, asset);
    }
  }
  /** Replace speculative intent. Current resources are retained, never scheduled ahead of their renderer. */
  update(plan: ResourcePlan): void {
    if (this.disposed) return;
    const identity = JSON.stringify([plan.game, plan.storyVersion]);
    if (this.identity !== undefined && this.identity !== identity) {
      for (const task of this.tasks.values()) this.cancel(task);
      for (const id of this.ready.keys()) this.evict(id);
    }
    this.identity = identity;
    this.active = new Set(plan.active.map(asset => asset.assetId));
    const next = new Map(plan.candidates.map(asset => [asset.assetId, structuredClone(asset) as ResourcePlanAsset]));
    const manifest = new Map([...plan.active, ...plan.candidates].map(asset => [asset.assetId, asset]));
    const same = (a: ResourcePlanAsset, b: { kind: string; src: string } | undefined) => !!b && a.kind === b.kind && a.src === b.src;
    for (const [id, task] of this.tasks) if (!same(task.asset, next.get(id)) || this.active.has(id)) this.cancel(task);
    for (const [id, entry] of this.ready) if (manifest.has(id) && !same(entry.asset, manifest.get(id))) this.evict(id);
    this.desired = next; this.failures.clear(); this.truncated = plan.truncated;
    this.revokeReleased(); this.enqueue(); this.pump();
  }
  /** Host owners must release only after their renderer/media consumer has stopped using the URL. */
  retain(owner: string, assetIds: readonly string[]): void {
    if (this.disposed) return;
    if (!owner) throw Error('Resource owner must not be empty');
    this.owners.set(owner, new Set(assetIds)); this.revokeReleased();
  }
  release(owner: string): void {
    this.owners.delete(owner); this.revokeReleased(); this.pump();
  }
  /** Returns cached URLs only for retained active bytes; creation is lazy and explicit. */
  url(assetId: string): string | undefined {
    if (this.disposed || !this.pinned(assetId)) return undefined;
    const entry = this.ready.get(assetId); if (!entry) return undefined;
    entry.used = ++this.serial;
    return entry.url ??= this.createURL(entry.bytes, entry.asset);
  }
  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (paused) { this.queue.clear(); for (const task of this.tasks.values()) this.cancel(task); }
    else { this.enqueue(); this.pump(); }
  }
  private pump() {
    if (this.paused || this.disposed) return;
    for (const [id, asset] of this.queue) {
      if (this.tasks.size >= this.maxConcurrent) break;
      const reservation = Math.min(this.maxTransferBytes, this.maxBytes);
      if (asset.estimatedBytes !== null && asset.estimatedBytes > reservation) {
        this.queue.delete(id); this.failures.add(id); this.truncated = true; continue;
      }
      while (this.resident() + this.reserved() + reservation > this.maxBytes) {
        const victim = [...this.ready].filter(([key]) => !this.pinned(key)).sort((a, b) => a[1].used - b[1].used)[0];
        if (!victim) break;
        this.evict(victim[0]);
      }
      if (this.resident() + this.reserved() + reservation > this.maxBytes) { this.truncated = true; break; }
      this.queue.delete(id);
      const task: Task = { asset, controller: new AbortController(), reservation, cancelled: false };
      this.tasks.set(id, task);
      // Resolve and load in a promise so synchronous host failures follow the same bounded cleanup path.
      void Promise.resolve().then(() => {
        if (task.cancelled) throw abortError();
        return this.loader({ assetId: id, url: this.resolveURL(id), signal: task.controller.signal, maxBytes: reservation });
      }).then(bytes => {
        // The physical loader has settled; transfer ownership of this reservation to ready bytes atomically.
        task.reservation = 0;
        if (task.cancelled || task.controller.signal.aborted || this.disposed || this.paused || !this.desired.has(id)) return;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > reservation) throw Error('Resource exceeds transfer budget');
        // Own the bytes: the injected loader cannot mutate cached data after resolving.
        this.ready.set(id, { asset, bytes: bytes.slice(), used: ++this.serial });
      }).catch(() => { if (!task.cancelled && !this.disposed && this.desired.has(id)) this.failures.add(id); })
        .finally(() => {
          this.tasks.delete(id);
          // A cancelled task may have become desired again, but cannot publish its stale response.
          if (!this.disposed && !this.paused && this.desired.has(id) && !this.active.has(id) && !this.ready.has(id) && !this.failures.has(id) && this.queue.size < this.maxQueued) this.queue.set(id, this.desired.get(id)!);
          this.pump();
        });
    }
  }
  snapshot() {
    return freezeData({ queued: this.queue.size, loading: this.tasks.size, ready: this.ready.size, failed: this.failures.size,
      cancelled: this.cancelled, bytes: this.resident(), reservedBytes: this.reserved(),
      pinned: [...this.ready.keys()].filter(id => this.pinned(id)).length, truncated: this.truncated, paused: this.paused, disposed: this.disposed,
      resources: [...this.ready].map(([assetId, entry]) => ({ assetId, bytes: entry.bytes.byteLength, pinned: this.pinned(assetId), hasURL: !!entry.url })) });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.queue.clear(); this.desired.clear(); this.active.clear(); this.owners.clear();
    for (const task of this.tasks.values()) this.cancel(task);
    for (const id of this.ready.keys()) this.evict(id);
    this.failures.clear();
  }
}

export type ResourcePrefetchSnapshot = ReturnType<ResourcePrefetcher['snapshot']>;
