import type { AssetKind } from '../assets/catalog.js';
import type { EngineProject } from './project.js';
import { freezeData, type DeepReadonly } from './readonly.js';

/** Descriptions of built-ins, never executable project instructions or a plugin registry. */
export const RUNTIME_SEMANTICS_VERSION = 'vn-runtime-semantics-v1' as const;
export type RuntimeSemanticNamespace = 'script-exit' | 'player-action' | 'stage-cue';
export type RuntimeStateScope = 'story' | 'session' | 'presentation' | 'meta' | 'preferences' | 'author';
export type RuntimeSemantic = {
  id: string; version: 1; namespace: RuntimeSemanticNamespace; title: string;
  appliesTo: readonly EngineProject['type'][];
  input: { reference: string; owner: string; schema: Record<string, unknown>; notes: readonly string[] };
  stateScopes: readonly RuntimeStateScope[];
  resources: readonly { path: string; kind: AssetKind | 'visual'; optional: boolean }[];
  blocking: { next: string; auto: string };
  skip: string; cancel: string; restore: string;
  host: readonly string[]; diagnostics: readonly string[];
};

const allTypes: readonly EngineProject['type'][] = ['narrative', 'script', 'investigation', 'rain'];
const id = { type: 'string', minLength: 1 };
const object = { type: 'object' };
const nullableAsset = { anyOf: [id, { type: 'null' }] };
const fields = (properties: Record<string, unknown>, required: readonly string[] = []) => ({ type: 'object', properties, required });
const resources = (path: string, kind: AssetKind | 'visual', optional = false) => [{ path, kind, optional }];

function exit(kind: string, title: string, schema: Record<string, unknown>, notes: string[]): RuntimeSemantic {
  return { id: `script.${kind}`, version: 1, namespace: 'script-exit', title, appliesTo: ['script', 'rain'],
    input: { reference: 'ScriptExit', owner: 'ScriptEngine', schema, notes }, stateScopes: ['story'], resources: [],
    blocking: { next: kind === 'choice' ? 'player-choice-required' : kind === 'end' ? 'terminal' : 'none',
      auto: kind === 'choice' ? 'player-choice-required' : kind === 'end' ? 'terminal' : 'none' },
    skip: kind === 'choice' || kind === 'end' ? 'stop-at-interaction' : 'follow-normal-routing',
    cancel: 'no-asynchronous-work', restore: 'canonical-replay', host: ['RuntimeDriver'], diagnostics: ['runtime', 'target'] };
}

function player(kind: string, title: string, options: Partial<RuntimeSemantic> = {}): RuntimeSemantic {
  return { id: `player.${kind}`, version: 1, namespace: 'player-action', title, appliesTo: allTypes,
    input: { reference: 'RuntimeAction', owner: 'RuntimeSession', schema: fields({ id }, ['id']),
      notes: ['The current frame and session readiness remain authoritative; this is not an author operation.'] },
    stateScopes: ['story', 'session'], resources: [], blocking: { next: 'session-readiness', auto: 'manual-input' },
    skip: 'never-select-automatically', cancel: 'no-asynchronous-work', restore: 'canonical-replay',
    host: ['RuntimeSession'], diagnostics: [], ...options };
}

function cue(kind: string, title: string, schema: Record<string, unknown>, options: Partial<RuntimeSemantic> = {}): RuntimeSemantic {
  return { id: `stage.${kind}`, version: 1, namespace: 'stage-cue', title, appliesTo: allTypes,
    input: { reference: `StageCue.${kind}`, owner: 'createProject / DOMRenderer', schema,
      notes: ['The referenced existing validator and host enforce cross-field and asset-reference constraints.'] },
    stateScopes: ['presentation'], resources: [], blocking: { next: 'none', auto: 'none' },
    skip: 'render-current-value', cancel: 'superseded-binding-or-dispose', restore: 'reconstruct-current-frame',
    host: ['DOMRenderer'], diagnostics: ['runtime', 'asset-binding'], ...options };
}

const entries: RuntimeSemantic[] = [
  exit('jump', 'Jump', fields({ type: { const: 'jump' }, next: id }, ['type', 'next']), ['The target block must exist; routing is bounded.']),
  exit('choice', 'Choice', fields({ type: { const: 'choice' }, choices: { type: 'array', minItems: 1, items: fields({ id, text: id, next: id, effects: { type: 'array' } }, ['id', 'text', 'next']) } }, ['type', 'choices']),
    ['Choices are available only on the block’s last line.', 'add/set effects belong to the selected choice; declared variable types and bounds are checked by ScriptEngine.']),
  exit('branch', 'Branch', fields({ type: { const: 'branch' }, routes: { type: 'array', minItems: 1, items: fields({ when: object, next: id }, ['next']) } }, ['type', 'routes']),
    ['The final route is the fallback; earlier unconditional routes are rejected.', 'Only declared-variable eq/gte conditions are supported.']),
  exit('end', 'Ending', fields({ type: { const: 'end' }, ending: id }, ['type', 'ending']), ['Ends progression without performing external IO.']),
  player('next', 'Next / reveal text', { input: { reference: 'RuntimeSession.next', owner: 'RuntimeSession', schema: fields({}),
    notes: ['A successful call may only complete typing. Record a route step only when the visit changes.', 'Authored hold, pauses, hidden state and mini-game gates still apply.'] },
    blocking: { next: 'reveal-before-advance', auto: 'session-readiness' }, skip: 'read-only-normal-advance' }),
  player('choice', 'Choose an available option', { appliesTo: ['narrative', 'script', 'rain'] }),
  player('continue', 'Continue a narrative chapter', { appliesTo: ['narrative'] }),
  player('action', 'Apply an available investigation action', { appliesTo: ['investigation'] }),
  player('chapter', 'Enter an unlocked investigation chapter', { appliesTo: ['investigation'] }),
  player('mini-start', 'Start the current mini-game', { input: { reference: 'RuntimeSession.startMiniGame', owner: 'MiniGameSession', schema: fields({}),
    notes: ['A current idle mini-game and session readiness are required.'] }, restore: 'checkpoint-and-input-replay' }),
  player('mini-input', 'Play the current mini-game', { input: { reference: 'RuntimeSession.playMiniGame', owner: 'MiniGameSession',
    schema: fields({ index: { type: 'integer', minimum: 0, maximum: 8 } }, ['index']), notes: ['The index must exist on the active board; readiness and move limits apply.'] }, restore: 'checkpoint-and-input-replay' }),
  player('mini-skip', 'Skip the current mini-game', { input: { reference: 'RuntimeSession.skipMiniGame', owner: 'MiniGameSession', schema: fields({}),
    notes: ['An active mini-game with a declared skip result is required.'] }, restore: 'checkpoint-and-input-replay' }),
  player('mini-abort', 'Abort the current mini-game', { input: { reference: 'RuntimeSession.abortMiniGame', owner: 'MiniGameSession', schema: fields({}),
    notes: ['An active mini-game and session readiness are required.'] }, restore: 'checkpoint-and-input-replay' }),
  player('mini-finish', 'Apply the mini-game result action', { input: { reference: 'RuntimeSession.finishMiniGame', owner: 'RuntimeSession / RuntimeDriver', schema: fields({}),
    notes: ['A completed result must map to a currently available story action.'] } }),
  player('rollback', 'Restore an in-session checkpoint', { input: { reference: 'RuntimeSession.rollback', owner: 'RollbackHistory',
    schema: fields({ steps: { type: 'integer', minimum: 1, maximum: 200 } }), notes: ['The requested depth must exist in private bounded history; imported rollback logs are never accepted.'] },
    restore: 'canonical-checkpoint-replay', skip: 'disable-auto-and-skip' }),
  player('reread', 'Revisit a known history entry', { appliesTo: ['narrative', 'script', 'rain'],
    input: { reference: 'RuntimeSession.reread', owner: 'RuntimeDriver', schema: fields({ id }, ['id']), notes: ['The ID must belong to known history; investigation does not support reread.'] },
    restore: 'canonical-route-prefix', skip: 'disable-auto-and-skip' }),
  player('restore', 'Load a validated driver payload', { input: { reference: 'RuntimeSession.restore', owner: 'RuntimeDriver codec', schema: object,
    notes: ['Payload schemas differ by driver; player envelope schema2 is a separate storage contract.', 'Imported derived variables and history are not trusted.'] }, restore: 'canonical-replay', skip: 'disable-auto-and-skip' }),
  player('restart', 'Restart this session', { input: { reference: 'RuntimeSession.restart', owner: 'RuntimeDriver', schema: fields({}), notes: ['Resets only this session; persistent preferences and meta collections are separate.'] }, restore: 'initial-driver-state', skip: 'disable-auto-and-skip' }),
  cue('background', 'Background', nullableAsset, { resources: resources('$', 'background', true) }),
  cue('portrait', 'Portrait', nullableAsset, { resources: resources('$', 'portrait', true) }),
  cue('cg', 'CG layer', nullableAsset, { resources: resources('$', 'cg', true) }),
  cue('layers', 'Explicit visual layers', object, { resources: resources('*.asset', 'visual'),
    input: { reference: 'StageCue.layers', owner: 'createProject / DOMRenderer', schema: object,
      notes: ['Visual layers are background, character-back, character, character-front and cg.', 'Each binding declares background/portrait/cg kind and an existing matching asset; null clears the layer.'] } }),
  cue('presentationState', 'Reconstructed presentation state', object, { input: { reference: 'StagePresentationState', owner: 'persistentCue / DOMRenderer', schema: object,
    notes: ['The driver reconstructs durable layer transforms and camera state from preceding cues.', 'This is presentation data, not a writable substitute for driver state.'] }, cancel: 'no-asynchronous-work' }),
  cue('music', 'Background music', nullableAsset, { resources: resources('$', 'audio', true), host: ['MediaDirector', 'AudioContext'],
    input: { reference: 'StageCue.music', owner: 'MediaDirector / SceneLoop', schema: nullableAsset, notes: ['null clears the desired track. Decoded cache is bounded to two tracks and 32 MiB per SceneLoop.'] },
    stateScopes: ['presentation', 'session'], restore: 'reconcile-current-loop', skip: 'reconcile-current-loop', cancel: 'desired-track-change-or-dispose' }),
  cue('ambience', 'Ambient loop', nullableAsset, { resources: resources('$', 'audio', true), host: ['MediaDirector', 'AudioContext'],
    stateScopes: ['presentation', 'session'], restore: 'reconcile-current-loop', skip: 'reconcile-current-loop', cancel: 'desired-track-change-or-dispose' }),
  cue('sound', 'One-shot sound effect', id, { resources: resources('$', 'audio'), host: ['MediaDirector', 'HTMLAudioElement'],
    stateScopes: ['session'], restore: 'suppress-on-restore-reread-rollback', skip: 'once-per-eligible-visit', cancel: 'new-visit-disable-or-dispose',
    input: { reference: 'StageCue.sound', owner: 'MediaDirector', schema: id,
      notes: ['Only start/advance/action visits schedule a one-shot. Typing ticks do not repeat it.', 'A paused first visit may wait until readable; pause/resume continues the same instance.'] } }),
  cue('voice', 'Recorded dialogue voice', id, { resources: resources('$', 'audio'), host: ['MediaDirector', 'HTMLAudioElement'],
    stateScopes: ['session'], blocking: { next: 'none', auto: 'voice-loading-playing-paused-or-blocked' },
    restore: 'enter-current-line-with-new-visit', skip: 'replace-with-current-visit-voice', cancel: 'new-visit-disable-or-dispose' }),
  cue('effect', 'Scene effect', fields({ type: { enum: ['fade', 'flash', 'shake'] }, durationMs: { type: 'number' } }, ['type']),
    { stateScopes: ['session'], restore: 'suppress-on-restore-reread-rollback', skip: 'eligible-visit-unless-reduced-motion', cancel: 'new-visit-reduced-motion-or-dispose',
      input: { reference: 'StageCue.effect', owner: 'DOMRenderer', schema: fields({ type: { enum: ['fade', 'flash', 'shake'] }, durationMs: { type: 'number' } }, ['type']),
        notes: ['Only start/advance/action visits play the effect unless reduced motion is requested.', 'Duration defaults to 450 ms and is clamped to 0–2000 ms by the host.'] } }),
  cue('timeline', 'Presentation timeline', fields({ durationMs: { type: 'number', minimum: 0, maximum: 300000 }, animations: { type: 'array' }, camera: { type: 'array' } }, ['durationMs']),
    { input: { reference: 'PresentationTimeline', owner: 'validatePresentationTimeline / DOMRenderer',
      schema: fields({ durationMs: { type: 'number', minimum: 0, maximum: 300000 }, animations: { type: 'array' }, camera: { type: 'array' } }, ['durationMs']),
      notes: ['Track timing, unique IDs, positive scale, opacity bounds and ordered camera keyframes are checked by validatePresentationTimeline.', 'Final transforms are reconstructed independently of animation playback.'] },
    stateScopes: ['presentation', 'session'], resources: resources('animations.*.target', 'visual', true), cancel: 'new-visit-or-dispose', diagnostics: ['timeline', 'timeline-target'],
    restore: 'settle-to-authored-terminal-transform', skip: 'settle-to-authored-terminal-transform' }),
  cue('video', 'Video presentation', fields({ asset: id, fallback: object, loop: { type: 'boolean' }, muted: { type: 'boolean' } }, ['asset']),
    { resources: [...resources('asset', 'video'), ...resources('fallback.asset', 'visual', true)], host: ['DOMRenderer', 'HTMLVideoElement'], stateScopes: ['session'],
      cancel: 'new-visit-fallback-or-dispose',
      restore: 'use-fallback-without-replaying-video', skip: 'use-fallback' }),
  cue('keyVisual', 'Visit-scoped key visual', fields({ asset: id, scope: { enum: ['banner', 'fullscreen'] },
    sceneType: { enum: ['story', 'title', 'cg', 'transition', 'interstitial', 'special_presentation'] }, durationMs: { type: 'number', minimum: 100, maximum: 30000 } }, ['asset', 'scope', 'sceneType', 'durationMs']),
    { resources: resources('asset', 'ui'), stateScopes: ['session'], restore: 'suppress-on-restore-reread-rollback', skip: 'suppress-when-skipping-or-reduced-motion',
      cancel: 'new-visit-skip-reduced-motion-or-dispose',
      diagnostics: ['key-visual'] }),
  cue('miniGame', 'Bounded switch puzzle', fields({ id, kind: { const: 'switches' }, initial: { type: 'array', minItems: 1, maxItems: 9 },
    target: { type: 'array', minItems: 1, maxItems: 9 }, maxMoves: { type: 'integer', minimum: 1, maximum: 100 }, results: object }, ['id', 'kind', 'initial', 'target', 'maxMoves', 'results']),
    { stateScopes: ['story', 'session'], host: ['RuntimeSession', 'MiniGameSession', 'DOMRenderer'],
      blocking: { next: 'mini-game-present', auto: 'until-result-action' }, restore: 'validate-and-replay-input-journal', skip: 'explicit-optional-skip-action-only', diagnostics: ['runtime'] }),
  cue('pauseMs', 'Authored reading hold', { type: 'number', minimum: 0, maximum: 30000 },
    { stateScopes: ['session'], host: ['RuntimeSession', 'Clock'], blocking: { next: 'until-hold-completes', auto: 'until-hold-completes' },
      input: { reference: 'StageCue.pauseMs', owner: 'RuntimeSession', schema: { type: 'number' }, notes: ['Finite runtime values are clamped to 0–30000 ms; non-finite or absent values produce no hold.', 'Pause scopes preserve the remaining hold duration.'] },
      restore: 'restart-current-visit-hold', skip: 'respect-authored-hold' }),
  cue('document', 'Document presentation', fields({ title: { type: 'string' }, lines: { type: 'array', items: { type: 'string' } } }, ['title', 'lines']), { cancel: 'no-asynchronous-work' })
];

export const RUNTIME_SEMANTICS = freezeData({
  version: RUNTIME_SEMANTICS_VERSION,
  namespaces: ['script-exit', 'player-action', 'stage-cue'] as RuntimeSemanticNamespace[],
  validation: { descriptive: true, executionRegistry: false, inputSchemaScope: 'shape-and-local-constraints',
    authority: 'Existing driver, session, project and host validators enforce availability, cross-field rules and resource references.' },
  scopes: [
    { id: 'story', owner: 'RuntimeDriver', restore: 'canonical-replay', persisted: 'driver-payload' },
    { id: 'session', owner: 'RuntimeSession / media hosts', restore: 'new-visit', persisted: 'only-declared-mini-game-journal' },
    { id: 'presentation', owner: 'RuntimeDriver frame / DOMRenderer', restore: 'reconstructed-from-route', persisted: 'not-an-independent-authority' },
    { id: 'meta', owner: 'MetaStateStore', restore: 'separate-collection-policy', persisted: 'separate-storage' },
    { id: 'preferences', owner: 'PreferencesStore / RuntimeSession', restore: 'preserve-user-settings', persisted: 'separate-storage' },
    { id: 'author', owner: 'EditorModel / Agent SDK', restore: 'editor-history-and-author-transactions', persisted: 'project-and-author-documents-only' }
  ],
  entries
});

/** Immutable snapshot of the sealed built-in catalogue. No registrations or handlers are accepted. */
export function runtimeSemantics(): typeof RUNTIME_SEMANTICS { return RUNTIME_SEMANTICS; }
export function runtimeSemantic(semanticId: string): DeepReadonly<RuntimeSemantic> | undefined {
  return RUNTIME_SEMANTICS.entries.find(entry => entry.id === semanticId);
}
