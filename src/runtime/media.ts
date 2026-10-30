import { SceneLoop } from '../audio/scene-loop.js';
import { RecordedVoice, voiceBlocksAuto, type VoiceClip } from '../audio/recorded-voice.js';
import type { AssetCatalog } from '../assets/catalog.js';
import type { RuntimeSession, RuntimeView } from './session.js';

export type MediaOptions = { context: AudioContext; createAudio?: (src: string) => HTMLAudioElement; onError?: (message: string) => void };

/** Visit-driven media; asynchronous graph operations reconcile the latest intent. */
export class MediaDirector {
  private voice: RecordedVoice;
  private music: SceneLoop;
  private ambience: SceneLoop;
  private bus: GainNode;
  private musicBus: GainNode;
  private ambienceBus: GainNode;
  private effect?: HTMLAudioElement;
  private pendingEffect?: string;
  private effectPaused = false;
  private effectAttempt = 0;
  private visit = -1;
  private handling = false;
  private pending?: RuntimeView;
  private last?: RuntimeView;
  private disposed = false;
  private playable = false;
  private unlocked = false;
  private graphTask?: Promise<void>;
  private graphDirty = false;
  private missing = new Set<string>();
  private disconnect: () => void;
  private unvoice: () => void;
  private createAudio: (src: string) => HTMLAudioElement;

  constructor(readonly session: RuntimeSession, readonly assets: AssetCatalog, readonly options: MediaOptions) {
    this.createAudio = options.createAudio ?? (src => new Audio(src));
    this.unlocked = options.context.state === 'running';
    this.voice = new RecordedVoice(this.createAudio);
    this.bus = options.context.createGain(); this.bus.connect(options.context.destination);
    this.musicBus = options.context.createGain(); this.musicBus.connect(this.bus);
    this.ambienceBus = options.context.createGain(); this.ambienceBus.connect(this.bus);
    this.music = new SceneLoop(options.context, this.musicBus); this.ambience = new SceneLoop(options.context, this.ambienceBus);
    this.unvoice = this.voice.subscribe(() => session.setVoiceBlocked(voiceBlocksAuto(this.voice.getState())));
    this.disconnect = session.subscribe(() => this.update(session.getView()));
    this.update(session.getView());
  }

  private audioURL(id?: string | null): string | undefined {
    if (!id) return undefined;
    try { return this.assets.url(id, 'audio'); }
    catch { if (!this.missing.has(id)) { this.missing.add(id); this.options.onError?.(`声音资源不可用：${id}`); } return undefined; }
  }
  private sameMedia(a: RuntimeView | undefined, b: RuntimeView): boolean {
    return !!a && a.visit === b.visit && a.paused === b.paused
      && a.settings.music === b.settings.music && a.settings.ambience === b.settings.ambience
      && a.settings.masterVolume === b.settings.masterVolume && a.settings.bgmVolume === b.settings.bgmVolume
      && a.settings.ambienceVolume === b.settings.ambienceVolume && a.settings.seVolume === b.settings.seVolume
      && a.settings.voiceEnabled === b.settings.voiceEnabled && a.settings.voiceVolume === b.settings.voiceVolume
      && a.settings.soundEffects === b.settings.soundEffects;
  }
  private update(snapshot: RuntimeView) {
    if (this.disposed) return;
    this.pending = snapshot;
    if (this.handling) return;
    this.handling = true;
    try {
      while (this.pending && !this.disposed) {
        const next = this.pending; this.pending = undefined;
        if (this.sameMedia(this.last, next)) continue;
        this.last = next; this.apply(next);
      }
    } finally { this.handling = false; }
  }
  private apply(snapshot: RuntimeView) {
    const { settings, frame } = snapshot;
    const changedPlayback = this.playable !== !snapshot.paused;
    this.playable = !snapshot.paused;
    this.bus.gain.value = settings.masterVolume;
    this.musicBus.gain.value = settings.music ? settings.bgmVolume : 0;
    this.ambienceBus.gain.value = settings.ambience ? settings.ambienceVolume : 0;
    this.music.select(settings.music ? this.audioURL(frame.stage.music) : undefined);
    this.ambience.select(settings.ambience ? this.audioURL(frame.stage.ambience) : undefined);
    if (changedPlayback) void this.reconcileGraph();
    try {
      this.voice.configure(settings.voiceEnabled, settings.masterVolume * settings.voiceVolume, this.playable, this.playable, false);
      if (settings.voiceEnabled) {
        const source = this.audioURL(frame.stage.voice);
        const clip: VoiceClip | undefined = source ? { id: frame.stage.voice!, lineId: frame.lineId, speaker: frame.speaker, text: frame.text, src: source } : undefined;
        this.voice.enter(clip, String(snapshot.visit));
      }
    } catch { this.voice.stop(); this.options.onError?.('语音暂时不可用，可以继续阅读'); }
    // A listener may have advanced during the voice notification above.
    if (this.disposed || this.session.getView().visit !== snapshot.visit) return;
    if (snapshot.visit !== this.visit) {
      this.visit = snapshot.visit; this.stopEffect();
      const source = settings.soundEffects ? this.audioURL(frame.stage.sound) : undefined;
      if (source && ['start', 'advance', 'action'].includes(snapshot.reason)) this.pendingEffect = source;
    } else if (!settings.soundEffects) this.stopEffect();
    if (this.pendingEffect && this.playable) {
      // A title/new-game panel may still pause the first visit. Consume its cue only once it becomes readable.
      // Clear before creating/playing so a failure or reentrant notification cannot schedule it again.
      const source = this.pendingEffect; this.pendingEffect = undefined;
      try {
        const player = this.createAudio(source); this.effect = player; player.volume = settings.masterVolume * settings.seVolume;
        player.onended = () => { if (this.effect === player) this.stopEffect(); };
        player.onerror = () => { if (this.effect === player) { this.stopEffect(); this.options.onError?.('动作音效暂时无法播放'); } };
        this.playEffect(player);
      } catch { this.stopEffect(); this.options.onError?.('动作音效暂时不可用，可以继续阅读'); }
    }
    if (this.effect) {
      const player = this.effect; player.volume = settings.masterVolume * settings.seVolume;
      if (player.ended) this.stopEffect();
      else if (!this.playable && !this.effectPaused) { this.effectPaused = true; this.effectAttempt++; player.pause(); }
      else if (this.playable && this.effectPaused) { this.effectPaused = false; this.playEffect(player); }
    }
  }

  private playEffect(player: HTMLAudioElement) {
    const attempt = ++this.effectAttempt;
    const failed = () => {
      if (!this.disposed && this.effect === player && attempt === this.effectAttempt && this.playable) {
        this.stopEffect(); this.options.onError?.('动作音效暂时无法播放');
      }
    };
    try {
      void player.play().then(() => {
        // A late play resolution may follow a panel, a new visit, or disposal.
        if (this.disposed || this.effect !== player || !this.playable) player.pause();
      }).catch(failed);
    } catch { failed(); }
  }

  private reconcileGraph(): Promise<void> {
    this.graphDirty = true;
    if (this.graphTask) return this.graphTask;
    const task = this.runGraph(); this.graphTask = task;
    void task.then(() => {
      if (this.graphTask === task) this.graphTask = undefined;
      if (this.graphDirty && !this.disposed) void this.reconcileGraph();
    });
    return task;
  }
  private async runGraph(): Promise<void> {
    try {
      while (this.graphDirty && !this.disposed) {
        this.graphDirty = false;
        const wanted = this.unlocked && this.playable;
        const before = this.options.context.state;
        const transitioning = (wanted && before === 'suspended') || (!wanted && before === 'running');
        if (wanted && this.options.context.state === 'suspended') await this.options.context.resume();
        else if (!wanted && this.options.context.state === 'running') await this.options.context.suspend();
        if (this.disposed) return;
        const latest = this.unlocked && this.playable;
        if (transitioning && latest === wanted && this.options.context.state === before) throw new Error('Audio graph did not transition');
        if ((latest && this.options.context.state === 'suspended') || (!latest && this.options.context.state === 'running')) this.graphDirty = true;
        if (latest && this.options.context.state === 'running') { void this.music.ensure(); void this.ambience.ensure(); }
      }
    } catch { this.graphDirty = false; this.options.onError?.('声音暂时无法恢复，可以继续阅读'); }
  }
  async unlock() {
    if (this.disposed) return;
    this.unlocked = true;
    try {
      await this.reconcileGraph();
      if (this.disposed || !this.playable) return;
      await Promise.all([this.music.ensure(), this.ambience.ensure()]);
      if (!this.disposed && this.playable) this.voice.unlock();
    } catch { this.options.onError?.('声音尚未启用，可再次点击声音按钮'); }
  }
  private stopEffect() {
    this.pendingEffect = undefined; this.effectAttempt++; this.effectPaused = false;
    const player = this.effect; if (!player) return; this.effect = undefined;
    player.onended = null; player.onerror = null; player.pause(); player.removeAttribute('src'); player.load();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.pending = undefined; this.disconnect(); this.unvoice();
    this.voice.stop(); this.music.dispose(); this.ambience.dispose(); this.stopEffect(); this.musicBus.disconnect(); this.ambienceBus.disconnect(); this.bus.disconnect(); this.session.setVoiceBlocked(false);
  }
}
