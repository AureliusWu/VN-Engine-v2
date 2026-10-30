import { appendRuntimeEffect, type RuntimeEffectContext, type RuntimeEffectPhase } from '../runtime/evidence.js';

const MAX_CACHED_TRACKS = 2;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;

/** Bounded local music cache; scene changes cancel obsolete downloads. */
export class SceneLoop {
  private wanted?: string;
  private source?: AudioBufferSourceNode;
  private level?: GainNode;
  private generation = 0;
  private disposed = false;
  private buffers = new Map<string, { buffer: AudioBuffer; bytes: number }>();
  private pending?: { url: string; controller: AbortController; promise: Promise<AudioBuffer> };
  private evidence?: RuntimeEffectContext;
  private evidencePhase?: RuntimeEffectPhase;
  private evidenceAttempt = 1;

  constructor(private context: AudioContext, private bus: GainNode) {}

  private record(phase: RuntimeEffectPhase, code?: string) {
    this.evidencePhase = phase;
    if (this.evidence) appendRuntimeEffect({ ...this.evidence, attempt: this.evidenceAttempt }, phase, code);
  }

  select(url?: string, evidence?: RuntimeEffectContext) {
    if (this.disposed) return;
    if (url !== this.wanted) {
      if (this.wanted && !['cancelled', 'settled', 'failed'].includes(this.evidencePhase ?? '')) this.record('cancelled', 'MEDIA_SELECTION_CHANGED');
      this.generation++;
      this.cancelDownload();
      this.release();
      this.wanted = url;
      this.evidence = evidence; this.evidenceAttempt = 1; this.evidencePhase = undefined;
      if (url) this.record('scheduled');
    } else if (evidence && evidence.visit !== this.evidence?.visit) {
      this.evidence = evidence;
      if (url && this.source) this.record('retained');
      else if (url) {
        if (this.evidencePhase === 'failed') this.evidenceAttempt++;
        this.record('scheduled');
      }
    }
    void this.ensure();
  }

  async ensure() {
    const url = this.wanted, generation = this.generation;
    if (!url || this.source || this.disposed || this.context.state !== 'running') return;
    if (this.evidencePhase === 'failed' && !this.pending) { this.evidenceAttempt++; this.record('scheduled'); }
    try {
      const buffer = await this.load(url);
      if (generation !== this.generation || url !== this.wanted || this.source || this.disposed || this.context.state !== 'running') return;
      const source = this.context.createBufferSource(), level = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      level.gain.setValueAtTime(0, this.context.currentTime);
      level.gain.linearRampToValueAtTime(1, this.context.currentTime + .5);
      source.connect(level).connect(this.bus);
      source.onended = () => { source.disconnect(); level.disconnect(); };
      this.source = source;
      this.level = level;
      source.start();
      this.record('started');
    } catch {
      // A missing file does not block dialogue, saves or later playback retries.
      if (generation === this.generation && url === this.wanted && !this.disposed && this.evidencePhase !== 'failed') this.record('failed', 'AUDIO_LOAD_OR_START_FAILED');
    }
  }

  private load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) {
      this.buffers.delete(url);
      this.buffers.set(url, cached);
      return Promise.resolve(cached.buffer);
    }
    if (this.pending?.url === url) return this.pending.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Scene music unavailable');
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted || this.disposed) throw new Error('Scene music cancelled');
      const buffer = await this.context.decodeAudioData(bytes);
      if (!controller.signal.aborted && !this.disposed) {
        const size = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
        if (Number.isFinite(size) && size > 0 && size <= MAX_CACHED_BYTES) {
          this.buffers.set(url, { buffer, bytes: size });
          let total = [...this.buffers.values()].reduce((sum, item) => sum + item.bytes, 0);
          while (this.buffers.size > MAX_CACHED_TRACKS || total > MAX_CACHED_BYTES) {
            const oldest = this.buffers.keys().next().value!;
            total -= this.buffers.get(oldest)!.bytes;
            this.buffers.delete(oldest);
          }
        }
      }
      return buffer;
    })();
    const request = { url, controller, promise };
    this.pending = request;
    request.promise = promise.finally(() => { if (this.pending === request) this.pending = undefined; });
    return request.promise;
  }

  private cancelDownload() {
    this.pending?.controller.abort();
    this.pending = undefined;
  }

  private release() {
    if (!this.source) return;
    const now = this.context.currentTime;
    this.level?.gain.cancelScheduledValues(now);
    this.level?.gain.setTargetAtTime(0, now, .08);
    try { this.source.stop(now + .4); } catch { /* Already ended. */ }
    this.source = undefined;
    this.level = undefined;
  }

  dispose() {
    if (!this.disposed && this.wanted && !['cancelled', 'settled', 'failed'].includes(this.evidencePhase ?? '')) this.record('cancelled', 'MEDIA_DISPOSED');
    this.disposed = true;
    this.generation++;
    this.cancelDownload();
    this.wanted = undefined;
    this.release();
    this.buffers.clear();
  }
}
