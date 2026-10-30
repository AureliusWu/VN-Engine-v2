import type { EngineProject } from '../runtime/project.js';
import type { RuntimeSession } from '../runtime/session.js';
import { createResourcePlan, type ResourcePlanOptions } from '../assets/plan.js';
import { ResourcePrefetcher, type ResourcePrefetchOptions } from '../assets/prefetch.js';
import type { AssetCatalog } from '../assets/catalog.js';

export type MountPrefetchOptions = ResourcePrefetchOptions & { plan?: ResourcePlanOptions };

/** A mount owns its speculative work. Plans never advance or restore a driver. */
export function bindResources(project: EngineProject, session: RuntimeSession, assets: AssetCatalog,
  options: MountPrefetchOptions | false | undefined) {
  const planOptions = options ? structuredClone(options.plan ?? {}) : {};
  const cache = options ? new ResourcePrefetcher({ ...options, resolveURL: id => assets.sourceURL(id) }) : undefined;
  let plan: ReturnType<typeof createResourcePlan> | undefined, visit = -1;
  const retiring = new Set<string>(); let releasePending = false;
  const update = () => {
    const view = session.getView();
    cache?.setPaused(view.paused || view.hidden);
    if (cache && visit !== view.visit) {
      // Subscribers switch the visual/media consumers synchronously. Retain their old URLs
      // until that notification has finished, rather than revoking ahead of those consumers.
      for (const asset of plan?.active ?? []) retiring.add(asset.assetId);
      cache.retain('mount-retiring', [...retiring]);
      plan = createResourcePlan(project, view.frame, planOptions);
      visit = view.visit; cache.update(plan);
      if (!releasePending) {
        releasePending = true;
        queueMicrotask(() => { releasePending = false; retiring.clear(); cache.release('mount-retiring'); });
      }
    }
  };
  try { update(); } catch (error) { cache?.dispose(); throw error; }
  const disconnect = cache ? session.subscribe(update) : () => {};
  return {
    url: (id: string) => cache?.url(id),
    snapshot: () => ({ enabled: !!cache, plan: plan ?? createResourcePlan(project, session.getView().frame, planOptions), cache: cache?.snapshot() ?? null }),
    dispose() { disconnect(); cache?.dispose(); }
  };
}
