import type { EngineProject } from '../runtime/project.js';
import { createProject } from '../runtime/project.js';
import { MediaDirector } from '../runtime/media.js';
import type { StoragePort } from '../storage/store.js';
import { DOMRenderer } from './dom.js';

export type MountOptions = { baseURL?: string | URL; storage?: StoragePort | null; audio?: boolean; assetURL?: (path: string) => string };

/** One entry point: own interpreter/state machine + scheduler + DOM + media. */
export function mountGame(root: HTMLElement, project: EngineProject, options: MountOptions = {}) {
  const baseURL = options.baseURL ?? new URL('./', root.ownerDocument.baseURI);
  const { session, assets } = createProject(project, baseURL, { assetURL: options.assetURL });
  let storage = options.storage;
  if (storage === undefined) try { storage = root.ownerDocument.defaultView?.localStorage; } catch { storage = null; }
  let media: MediaDirector | undefined, context: AudioContext | undefined, disposed = false;
  const unlockAudio = () => {
    if (disposed || options.audio === false) return;
    if (!media) {
      const AudioContextClass = root.ownerDocument.defaultView?.AudioContext;
      if (!AudioContextClass) { renderer.notify('当前浏览器未启用声音，可以继续阅读'); return; }
      try {
        context = new AudioContextClass();
        media = new MediaDirector(session, assets, { context, createAudio: src => {
          const player = root.ownerDocument.createElement('audio'); player.src = src; return player;
        }, onError: message => renderer.notify(message) });
      } catch {
        if (context) void context.close().catch(() => {}); context = undefined;
        renderer.notify('声音暂时不可用，可以继续阅读'); return;
      }
    }
    void media.unlock();
  };
  let renderer: DOMRenderer;
  try { renderer = new DOMRenderer(root, session, assets, { title: project.title, font: project.font, storage, onUnlockAudio: unlockAudio }); }
  catch (error) { session.dispose(); throw error; }
  const view = root.ownerDocument.defaultView;
  const hostVisibility = (event: Event) => { const hidden = (event as CustomEvent<unknown>).detail; if (hidden && typeof hidden === 'object' && 'hidden' in hidden && typeof hidden.hidden === 'boolean') session.pause('native-host', hidden.hidden); };
  view?.addEventListener('vn-engine-host-visibility', hostVisibility);
  return { session, renderer, assets, unlockAudio, dispose() {
    if (disposed) return; disposed = true; view?.removeEventListener('vn-engine-host-visibility', hostVisibility); media?.dispose(); session.dispose(); renderer.dispose(); if (context) void context.close().catch(() => {});
  } };
}
