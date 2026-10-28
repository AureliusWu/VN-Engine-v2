import { createProject, type EngineProject } from '../runtime/project.js';
import type { RuntimeSession, Clock } from '../runtime/session.js';
import { NarrativeDriver, ScriptDriver } from '../runtime/drivers.js';
import { projectEndings } from '../meta/project.js';
import { validateRouteSuite } from './schema.js';
import type { RouteExpectation, RouteSuite } from './types.js';

export function observeRoute(session: RuntimeSession, type: EngineProject['type']) {
  const view = session.getView(), frame = structuredClone(view.frame), driver = session.driver;
  let variables: Record<string, number | boolean> = {};
  if (driver instanceof NarrativeDriver) variables = driver.engine.replay((driver.save() as any).state.decisions, frame.sceneId, frame.line).stats;
  else if (driver instanceof ScriptDriver) variables = driver.engine.decode(JSON.stringify(driver.save())).variables;
  const ending = frame.ending && type === 'investigation' ? `${frame.lineId.slice(0, -frame.sceneId.length - 1)}:${frame.ending}` : frame.ending;
  const mini = view.miniGame ? { ...structuredClone(view.miniGame), revision: undefined } : undefined;
  return { sceneId: frame.sceneId, lineId: frame.lineId, ending, text: frame.text, variables,
    evidence: (frame.evidence ?? []).map(item => item.id).sort(), frame, mini, history: session.history() };
}
type Observation = ReturnType<typeof observeRoute>;
export type RouteCaseResult = { id: string; label?: string; status: 'PASS' | 'FAIL' | 'UNVERIFIED'; stepsExecuted: number; restoreChecks: number;
  failure?: { step: number; message: string }; final?: Observation; trace: { step: number; sceneId: string; lineId: string; ending?: string }[]; endings: string[] };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);

export class RouteClock implements Clock {
  time = 0; serial = 0; tasks = new Map<number, {callback: () => void; due: number}>();
  now = () => this.time;
  set = (callback: () => void, delay: number) => { const id = ++this.serial; this.tasks.set(id, {callback,due:this.time + delay}); return id; };
  clear = (id: unknown) => { this.tasks.delete(id as number); };
  tick() {
    const next = [...this.tasks.entries()].sort((a,b) => a[1].due-b[1].due)[0];
    if (!next) throw Error('Runtime did not become ready'); this.tasks.delete(next[0]); this.time=next[1].due; next[1].callback();
  }
}
class BudgetLimit extends Error {}
function assertions(actual: Observation, expected: RouteExpectation) {
  for (const key of ['sceneId','lineId','ending','text'] as const) if (expected[key] !== undefined && actual[key] !== expected[key]) throw Error(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
  for (const [key,value] of Object.entries(expected.variables ?? {})) if (!Object.hasOwn(actual.variables,key) || actual.variables[key] !== value) throw Error(`variable ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual.variables[key])}`);
  if (expected.evidence !== undefined && canonical([...expected.evidence].sort()) !== canonical(actual.evidence)) throw Error(`evidence: expected ${JSON.stringify(expected.evidence)}, got ${JSON.stringify(actual.evidence)}`);
  if (expected.miniGame !== undefined) {
    const value=actual.mini?{phase:actual.mini.phase,board:actual.mini.board,...(actual.mini.result?{result:actual.mini.result}:{})}:null;
    if(canonical(value)!==canonical(expected.miniGame))throw Error(`miniGame: expected ${JSON.stringify(expected.miniGame)}, got ${JSON.stringify(value)}`);
  }
}

/** Actual sessions, virtual hold time, no DOM/media/persistence. Cases start independently at the real entry. */
export function runRouteSuite(project: EngineProject, suite: RouteSuite | undefined = project.routeTests, options: {maxOperations?: number} = {}) {
  let remaining = options.maxOperations ?? 20_000;
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 200_000) throw Error('Invalid route operation budget');
  const required = [...new Set(projectEndings(project))].sort(), results: RouteCaseResult[] = [];
  const consume = () => { if (--remaining < 0) throw new BudgetLimit('Route operation budget exhausted'); };
  let inputError: string | undefined;
  try { if (suite !== undefined) validateRouteSuite(suite); } catch (error) { inputError = (error as Error).message; }
  if (!inputError) for (const test of suite?.cases ?? []) {
    const result: RouteCaseResult = {id:test.id,label:test.label,status:'PASS',stepsExecuted:0,restoreChecks:0,trace:[],endings:[]};
    let session: RuntimeSession | undefined, step = 0;
    try {
      consume(); const clock = new RouteClock(); session = createProject(project,'https://route.invalid/',{clock,settings:{textDelayMs:0},}).session;
      const settle = () => { while (!session!.getView().ready) { consume(); clock.tick(); } };
      const observe = () => { const state = observeRoute(session!, project.type); if (state.ending && !result.endings.includes(state.ending)) result.endings.push(state.ending);
        result.trace.push({step,sceneId:state.sceneId,lineId:state.lineId,ending:state.ending}); return state; };
      const checkpoint = () => {
        consume(); settle(); const before = observeRoute(session!,project.type), saved = session!.save(); session!.restore(saved); settle();
        if (canonical(before) !== canonical(observeRoute(session!,project.type))) throw Error('Save/restore changed the route state, presentation, mini-game or history');
        result.restoreChecks++;
      };
      const saves = new Map<string,unknown>(); settle(); observe(); checkpoint();
      for (const command of test.steps) {
        step++; consume(); settle(); let accepted = true;
        switch (command.type) {
          case 'next': accepted = session.next(); break;
          case 'action': accepted = session.act(command.id); break;
          case 'mini-start': accepted = session.startMiniGame(); break;
          case 'mini-input': accepted = session.playMiniGame(command.index); break;
          case 'mini-skip': accepted = session.skipMiniGame(); break;
          case 'mini-abort': accepted = session.abortMiniGame(); break;
          case 'mini-finish': accepted = session.finishMiniGame(); break;
          case 'checkpoint': saves.set(command.id,session.save()); break;
          case 'restore': if (!saves.has(command.id)) throw Error(`Unknown checkpoint: ${command.id}`); session.restore(saves.get(command.id)); break;
        }
        if (!accepted) throw Error(`Rejected ${command.type}${'id' in command ? ': '+command.id : ''} at ${session.getView().frame.lineId}`);
        result.stepsExecuted++; settle(); observe(); checkpoint();
      }
      result.final = observeRoute(session,project.type); assertions(result.final,test.expect);
    } catch (error) {
      result.status = error instanceof BudgetLimit ? 'UNVERIFIED' : 'FAIL'; result.failure = {step,message:error instanceof Error?error.message:String(error)};
      if (session) try { result.final = observeRoute(session,project.type); } catch { /* Preserve the original failure. */ }
    } finally { session?.dispose(); }
    results.push(result);
  }
  const covered = [...new Set(results.filter(r=>r.status==='PASS').flatMap(r=>r.endings))].sort(), missing = required.filter(id=>!covered.includes(id));
  const status = inputError || results.some(r=>r.status==='FAIL') ? 'FAIL' : !results.length || missing.length || results.some(r=>r.status==='UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
  return {schema:1,contract:'VN_ENGINE_ROUTE_REPORT-v1',status,game:project.game,version:project.version,
    ...(inputError?{error:inputError}:{}),cases:results,coverage:{required,covered,missing},restoreChecks:results.reduce((sum,r)=>sum+r.restoreChecks,0),
    scope:{authoredCases:true,declaredEndings:true,exhaustiveBranches:false,rendering:false,persistenceWrites:false},operationsUsed:(options.maxOperations??20_000)-Math.max(0,remaining)};
}

export type RouteReport = ReturnType<typeof runRouteSuite>;
export class ReleaseRouteGateError extends Error {
  constructor(readonly report: RouteReport) {
    super(`Release route checks blocked: ${report.status}; missing endings: ${report.coverage.missing.join(', ') || 'none'}`);
    this.name = 'ReleaseRouteGateError';
  }
}
