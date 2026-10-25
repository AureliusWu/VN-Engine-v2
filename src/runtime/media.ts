import { SceneLoop } from '../audio/scene-loop.js';
import { RecordedVoice, voiceBlocksAuto, type VoiceClip } from '../audio/recorded-voice.js';
import type { AssetCatalog } from '../assets/catalog.js';
import type { RuntimeSession, RuntimeSnapshot } from './session.js';

export type MediaOptions = { context: AudioContext; createAudio?: (src: string) => HTMLAudioElement; onError?: (message: string) => void };

/** Scene media consumes session visits; text ticks never replay an effect. */
export class MediaDirector {
  private voice: RecordedVoice;
  private music: SceneLoop;
  private ambience: SceneLoop;
  private bus: GainNode;
  private effect?: HTMLAudioElement;
  private visit = -1;
  private handling = false;
  private disposed = false;
  private playable = false;
  private unlocked = false;
  private resuming?: Promise<void>;
  private disconnect: () => void;
  private unvoice: () => void;
  private createAudio: (src: string) => HTMLAudioElement;
  constructor(readonly session: RuntimeSession, readonly assets: AssetCatalog, readonly options: MediaOptions) {
    this.createAudio = options.createAudio ?? (src => new Audio(src));
    this.voice = new RecordedVoice(this.createAudio);
    this.bus = options.context.createGain(); this.bus.connect(options.context.destination);
    this.music = new SceneLoop(options.context, this.bus); this.ambience = new SceneLoop(options.context, this.bus);
    this.unvoice = this.voice.subscribe(() => session.setVoiceBlocked(voiceBlocksAuto(this.voice.getState())));
    this.disconnect = session.subscribe(() => this.update(session.getSnapshot()));
    this.update(session.getSnapshot());
  }
  private audioURL(id?: string | null): string | undefined {
    if (!id) return undefined;
    try { return this.assets.url(id, 'audio'); } catch { this.options.onError?.(`声音资源不可用：${id}`); return undefined; }
  }
  private update(snapshot: RuntimeSnapshot) {
    if (this.disposed || this.handling) return;
    this.handling = true;
    try {
      const { settings, frame } = snapshot;
      this.playable = !snapshot.paused;
      this.bus.gain.value = settings.music ? settings.volume : 0;
      this.music.select(settings.music ? this.audioURL(frame.stage.music) : undefined); this.ambience.select(settings.music ? this.audioURL(frame.stage.ambience) : undefined);
      if (!this.playable && this.options.context.state === 'running') void this.options.context.suspend().catch(() => {});
      if (this.playable && this.unlocked && this.options.context.state === 'suspended') void this.resumeGraph();
      this.voice.configure(settings.voiceEnabled, settings.voiceVolume, this.playable, !snapshot.pauseReasons.includes('background'), false);
      const source = this.audioURL(frame.stage.voice);
      const clip: VoiceClip | undefined = source ? { id: frame.stage.voice!, lineId: frame.lineId, speaker: frame.speaker, text: frame.text, src: source } : undefined;
      this.voice.enter(clip, String(snapshot.visit));
      if (snapshot.visit !== this.visit) {
        this.visit = snapshot.visit; this.stopEffect();
        const effect = this.audioURL(frame.stage.sound);
        if (effect && settings.soundEffects && ['start', 'advance', 'action'].includes(snapshot.reason) && this.playable) {
          const player = this.createAudio(effect); this.effect = player; player.volume = settings.volume;
          void player.play().catch(() => { if (this.effect === player) this.options.onError?.('动作音效暂时无法播放'); });
        }
      }
      if (!this.playable) this.effect?.pause();
    } finally { this.handling = false; }
  }
  async unlock() {
    if (this.disposed) return;
    this.unlocked = true;
    try {
      if (this.playable && this.options.context.state !== 'running') await this.resumeGraph();
      if (this.disposed || !this.playable) { if (this.options.context.state === 'running') await this.options.context.suspend(); return; }
      await Promise.all([this.music.ensure(), this.ambience.ensure()]); this.voice.unlock();
    } catch { this.options.onError?.('声音尚未启用，可再次点击声音按钮'); }
  }
  private resumeGraph(): Promise<void> {
    if (this.resuming) return this.resuming;
    this.resuming = this.options.context.resume().then(async () => {
      if (this.disposed || !this.playable) { if (this.options.context.state === 'running') await this.options.context.suspend(); return; }
      await Promise.all([this.music.ensure(), this.ambience.ensure()]);
    }).catch(() => { this.options.onError?.('声音暂时无法恢复，可以继续阅读'); }).finally(() => { this.resuming = undefined; });
    return this.resuming;
  }
  private stopEffect() { if (this.effect) { this.effect.pause(); this.effect.removeAttribute('src'); this.effect.load(); this.effect = undefined; } }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.disconnect(); this.unvoice();
    this.voice.stop(); this.music.dispose(); this.ambience.dispose(); this.stopEffect(); this.bus.disconnect(); this.session.setVoiceBlocked(false);
  }
}
