import type { EngineProject } from '../runtime/project.js';
import { createProject } from '../runtime/project.js';
import { MediaDirector } from '../runtime/media.js';
import { bindSessionPersistence, createSaveContract } from '../storage/contract.js';
import { createSaveBackup } from '../storage/backup.js';
import { createContinuation } from '../storage/continue.js';
import { createReadProgress } from '../storage/read-progress.js';
import type { RuntimeSettings } from '../runtime/session.js';
import { createMetaStateStore } from '../meta/state.js';
import type { StoragePort } from '../storage/store.js';
import { DOMRenderer } from './dom.js';

export type MountOptions = { baseURL?: string | URL; storage?: StoragePort | null; audio?: boolean; assetURL?: (path: string) => string };

/** Replay is a separate driver/session with no persistence or meta subscriptions. */
function mountReplay(root: HTMLElement, project: EngineProject, saved: unknown, baseURL: string | URL, options: MountOptions, settings: Partial<RuntimeSettings>) {
  const { session, assets } = createProject(project, baseURL, { assetURL: options.assetURL, settings });
  let renderer: DOMRenderer | undefined, media: MediaDirector | undefined, context: AudioContext | undefined, disposed = false;
  const view = root.ownerDocument.defaultView;
  const hostVisibility = (event: Event) => { const hidden = (event as CustomEvent<unknown>).detail; if (hidden && typeof hidden === 'object' && 'hidden' in hidden && typeof hidden.hidden === 'boolean') session.pause('native-host', hidden.hidden); };
  const unlockAudio = () => {
    if (disposed || options.audio === false) return;
    if (!media) {
      const AudioContextClass = root.ownerDocument.defaultView?.AudioContext;
      if (!AudioContextClass) { renderer?.notify('当前浏览器未启用声音，可以继续阅读'); return; }
      try {
        context = new AudioContextClass();
        media = new MediaDirector(session, assets, { context, createAudio: src => {
          const player = root.ownerDocument.createElement('audio'); player.src = src; return player;
        }, onError: message => renderer?.notify(message) });
      } catch {
        if (context) void context.close().catch(() => {}); context = undefined;
        renderer?.notify('声音暂时不可用，可以继续阅读'); return;
      }
    }
    void media.unlock();
  };
  try {
    session.restore(saved);
    renderer = new DOMRenderer(root, session, assets, { title: project.title, font: project.font, storage: null, replayOnly: true, onUnlockAudio: unlockAudio });
    view?.addEventListener('vn-engine-host-visibility', hostVisibility);
  } catch (error) { session.dispose(); throw error; }
  return () => {
    if (disposed) return; disposed = true; view?.removeEventListener('vn-engine-host-visibility', hostVisibility); media?.dispose(); renderer?.dispose(); session.dispose(); if (context) void context.close().catch(() => {});
  };
}

/** One entry point: own interpreter/state machine + scheduler + DOM + media. */
export function mountGame(root: HTMLElement, project: EngineProject, options: MountOptions = {}) {
  // Backup validation and replay must use the same mounted data, even if an author later edits the input object.
  const presentation = project.type === 'narrative' ? project.stage?.presentation : undefined;
  project = structuredClone(project.type === 'narrative' && presentation ? { ...project, stage: { ...project.stage, presentation: undefined } } : project);
  if (project.type === 'narrative' && presentation) project.stage = { ...project.stage, presentation };
  const baseURL = options.baseURL ?? new URL('./', root.ownerDocument.baseURI);
  let storage = options.storage;
  if (storage === undefined) try { storage = root.ownerDocument.defaultView?.localStorage; } catch { storage = null; }
  let renderer: DOMRenderer | undefined, readTimer: ReturnType<typeof globalThis.setTimeout> | undefined, readWarning = false;
  const readProgress = createReadProgress(project.game, project.version, storage);
  const flushRead = () => {
    if (readTimer !== undefined) globalThis.clearTimeout(readTimer); readTimer = undefined;
    if (!storage) return;
    const result = readProgress.flush();
    if (!['saved', 'clean'].includes(result.status) && !readWarning) { renderer?.notify('已读记录暂未保存，可以继续阅读'); readWarning = true; }
  };
  const { session, assets } = createProject(project, baseURL, { assetURL: options.assetURL, initialPause: project.titleScreen ? 'title' : 'mount', readProgress: {
    has: signature => readProgress.has(signature),
    mark: signature => { readProgress.mark(signature); if (storage && readProgress.dirty && readTimer === undefined) readTimer = globalThis.setTimeout(flushRead, 250); }
  } });
  let started = !project.titleScreen;
  const persistence = bindSessionPersistence(session, createSaveContract({ game: project.game, gameVersion: project.version, storage }));
  const validatePayload = (value: unknown) => {
    const isolated = createProject(project, baseURL, { assetURL: options.assetURL, settings: { textDelayMs: 0 } });
    try { isolated.session.restore(value); return isolated.session.save(); }
    finally { isolated.session.dispose(); }
  };
  const backup = createSaveBackup(persistence.contract, storage, validatePayload);
  const continuation = createContinuation(session, persistence.contract, validatePayload);
  const collections = project.collections ? structuredClone(project.collections) : undefined;
  const meta = createMetaStateStore(project.game, storage, { cgs: collections?.cgs?.map(item => item.id), endings: collections?.endings?.map(item => item.id), trueRoute: collections?.trueRoute });
  if (collections?.trueRoute) meta.evaluateTrueRoute();
  let progressVisit = -1, progressMiniGame = -1, countedEnding = false;
  const persistProgress = () => {
    const snapshot = session.getView();
    if (!started || snapshot.pauseReasons.includes('title')) return;
    if (snapshot.visit === progressVisit) {
      const revision = snapshot.miniGame?.revision ?? -1;
      if (revision !== progressMiniGame && snapshot.reason !== 'rollback') { progressMiniGame = revision; persistence.autoSave(); }
      return;
    }
    progressVisit = snapshot.visit;
    progressMiniGame = snapshot.miniGame?.revision ?? -1;
    if (snapshot.reason === 'rollback') return;
    if (snapshot.reason === 'start') countedEnding = false;
    // A remount must preserve even corrupt or temporarily unreadable Auto bytes until a real visit begins.
    const saved = progressVisit === 1 && snapshot.reason === 'start' && persistence.contract.loadAuto().status !== 'empty'
      ? undefined : persistence.autoSave();
    if (renderer && saved?.status === 'saved' && snapshot.reason !== 'start') renderer.notify('已自动存档');
    const stage = snapshot.frame.stage, cgIds = new Set<string>();
    if ((!stage.layers || !Object.hasOwn(stage.layers, 'cg')) && stage.cg) cgIds.add(stage.cg);
    for (const asset of Object.values(stage.layers ?? {})) if (asset?.kind === 'cg') cgIds.add(asset.asset);
    for (const id of cgIds) meta.unlockCg(id);
    if (snapshot.frame.ending) {
      const frame = snapshot.frame, chapter = project.type === 'investigation' ? frame.lineId.slice(0, -frame.sceneId.length - 1) : undefined;
      meta.markEndingSeen(chapter ? `${chapter}:${frame.ending}` : frame.ending!);
      const completed = project.type !== 'investigation' || (frame.ending === 'complete' && chapter === [...project.chapters].sort((a, b) => a.order - b.order).at(-1)?.id);
      if (completed && !countedEnding && snapshot.reason !== 'restore' && snapshot.reason !== 'reread') { meta.recordPlaythrough(); countedEnding = true; }
    }
  };
  persistProgress();
  const disconnectProgress = session.subscribe(persistProgress);
  const disconnectRead = session.subscribe(() => { if (session.getView().paused && readProgress.dirty) flushRead(); });
  let media: MediaDirector | undefined, context: AudioContext | undefined, disposed = false;
  const unlockAudio = () => {
    if (disposed || options.audio === false) return;
    if (!media) {
      const AudioContextClass = root.ownerDocument.defaultView?.AudioContext;
      if (!AudioContextClass) { renderer?.notify('当前浏览器未启用声音，可以继续阅读'); return; }
      try {
        context = new AudioContextClass();
        media = new MediaDirector(session, assets, { context, createAudio: src => {
          const player = root.ownerDocument.createElement('audio'); player.src = src; return player;
        }, onError: message => renderer?.notify(message) });
      } catch {
        if (context) void context.close().catch(() => {}); context = undefined;
        renderer?.notify('声音暂时不可用，可以继续阅读'); return;
      }
    }
    void media.unlock();
  };
  try { renderer = new DOMRenderer(root, session, assets, { title: project.title, font: project.font, storage, persistence, backup, continuation, meta, collections,
    startAtTitle: project.titleScreen, onBegin: () => { started = true; },
    beginReplay: (target, saved) => mountReplay(target, project, saved, baseURL, options, session.getView().settings), onUnlockAudio: unlockAudio,
    onCgPresented: id => { if (started && !session.getView().pauseReasons.includes('title') && session.getView().reason !== 'rollback') meta.unlockCg(id); } }); }
  catch (error) { disconnectProgress(); disconnectRead(); if (readTimer !== undefined) globalThis.clearTimeout(readTimer); session.dispose(); throw error; }
  const view = root.ownerDocument.defaultView;
  const hostVisibility = (event: Event) => { const hidden = (event as CustomEvent<unknown>).detail; if (hidden && typeof hidden === 'object' && 'hidden' in hidden && typeof hidden.hidden === 'boolean') session.pause('native-host', hidden.hidden); };
  view?.addEventListener('vn-engine-host-visibility', hostVisibility);
  view?.addEventListener('pagehide', flushRead); session.pause('mount', false);
  return { session, renderer, assets, persistence, backup, continuation, readProgress, meta, unlockAudio, dispose() {
    if (disposed) return; disposed = true; disconnectProgress(); disconnectRead(); flushRead(); view?.removeEventListener('pagehide', flushRead); view?.removeEventListener('vn-engine-host-visibility', hostVisibility); media?.dispose(); session.dispose(); renderer?.dispose(); if (context) void context.close().catch(() => {});
  } };
}
