export type RouteStep = { type: 'next' | 'mini-start' | 'mini-skip' | 'mini-abort' | 'mini-finish' }
  | { type: 'action'; id: string } | { type: 'mini-input'; index: number }
  | { type: 'checkpoint' | 'restore'; id: string };
export type RouteExpectation = { sceneId?: string; lineId?: string; ending?: string; text?: string;
  variables?: Record<string, number | boolean>; evidence?: readonly string[];
  miniGame?: null | {phase:'idle'|'active'|'complete';board:readonly boolean[];result?:'success'|'failure'|'skip'|'abort'} };
export type RouteCase = { id: string; label?: string; steps: readonly RouteStep[]; expect: RouteExpectation };
export type RouteSuite = { schema: 1; cases: readonly RouteCase[] };
export const MAX_ROUTE_CASES = 64;
export const MAX_ROUTE_STEPS = 4096;
