import type { EngineProject } from '../runtime/project.js';
import { createProject } from '../runtime/project.js';
import { MediaDirector } from '../runtime/media.js';
import { bindSessionPersistence, createSaveContract } from '../storage/contract.js';
import { createMetaStateStore } from '../meta/state.js';
import type { StoragePort } from '../storage/store.js';
import { DOMRenderer } from './dom.js';

export type MountOptions = { baseURL?: string | URL; storage?: StoragePort | null; audio?: boolean; assetURL?: (path: string) => string };

/** Replay is a separate driver/session with no persistence or meta subscriptions. */
function mountReplay(root: HTMLElement, project: EngineProject, saved: unknown, baseURL: string | URL, options: MountOptions) {
  const { session, assets } = createProject(project, baseURL, { assetURL: options.assetURL });
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
  const baseURL = options.baseURL ?? new URL('./', root.ownerDocument.baseURI);
  const { session, assets } = createProject(project, baseURL, { assetURL: options.assetURL });
  let storage = options.storage;
  if (storage === undefined) try { storage = root.ownerDocument.defaultView?.localStorage; } catch { storage = null; }
  const persistence = bindSessionPersistence(session, createSaveContract({ game: project.game, gameVersion: project.version, storage }));
  const collections = project.collections ? structuredClone(project.collections) : undefined;
  const meta = createMetaStateStore(project.game, storage, { cgs: collections?.cgs?.map(item => item.id), endings: collections?.endings?.map(item => item.id) });
  let renderer: DOMRenderer | undefined;
  let progressVisit = -1, countedEnding = false;
  const persistProgress = () => {
    const snapshot = session.getView();
    if (snapshot.visit === progressVisit) return;
    progressVisit = snapshot.visit;
    if (snapshot.reason === 'start') countedEnding = false;
    const saved = persistence.autoSave();
    if (renderer && saved.status === 'saved' && snapshot.reason !== 'start') renderer.notify('已自动存档');
    if (snapshot.frame.stage.cg) meta.unlockCg(snapshot.frame.stage.cg);
    if (snapshot.frame.ending) {
      meta.markEndingSeen(snapshot.frame.ending);
      if (!countedEnding && snapshot.reason !== 'restore' && snapshot.reason !== 'reread') { meta.recordPlaythrough(); countedEnding = true; }
    }
  };
  persistProgress();
  const disconnectProgress = session.subscribe(persistProgress);
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
  try { renderer = new DOMRenderer(root, session, assets, { title: project.title, font: project.font, storage, persistence, meta, collections,
    beginReplay: (target, saved) => mountReplay(target, project, saved, baseURL, options), onUnlockAudio: unlockAudio }); }
  catch (error) { disconnectProgress(); session.dispose(); throw error; }
  const view = root.ownerDocument.defaultView;
  const hostVisibility = (event: Event) => { const hidden = (event as CustomEvent<unknown>).detail; if (hidden && typeof hidden === 'object' && 'hidden' in hidden && typeof hidden.hidden === 'boolean') session.pause('native-host', hidden.hidden); };
  view?.addEventListener('vn-engine-host-visibility', hostVisibility);
  return { session, renderer, assets, persistence, meta, unlockAudio, dispose() {
    if (disposed) return; disposed = true; disconnectProgress(); view?.removeEventListener('vn-engine-host-visibility', hostVisibility); media?.dispose(); session.dispose(); renderer?.dispose(); if (context) void context.close().catch(() => {});
  } };
}
