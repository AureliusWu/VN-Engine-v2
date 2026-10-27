import type { RuntimeSession } from '../runtime/session.js';
import type { EngineProject } from '../runtime/project.js';
import { observeRoute } from './suite.js';
import { MAX_ROUTE_STEPS, type RouteStep, type RouteCase, type RouteExpectation } from './types.js';
import { validateRouteSuite } from './schema.js';

export function routeExpectation(session: RuntimeSession, type: EngineProject['type']): RouteExpectation {
  const state=observeRoute(session,type);
  return {sceneId:state.sceneId,lineId:state.lineId,text:state.text,...(state.ending?{ending:state.ending}:{}),
    ...(Object.keys(state.variables).length?{variables:structuredClone(state.variables)}:{}),evidence:[...state.evidence],
    miniGame:state.mini?{phase:state.mini.phase,board:[...state.mini.board],...(state.mini.result?{result:state.mini.result}:{})}:null};
}

/** Manual commands from a fresh session; unsupported navigation invalidates rather than fabricates a route. */
export function createRouteRecorder(session: RuntimeSession, type: EngineProject['type'], onInvalidated?: (reason:string)=>void) {
  if(session.getView().reason!=='start'||session.getView().visit!==1)throw Error('Recording must start from a fresh session');
  session.setAuto(false);session.setSkip(false);
  const target=session as unknown as Record<string, (...args:any[])=>any>, originals=new Map<string,(...args:any[])=>any>(), steps:RouteStep[]=[];
  let active=true,reason:string|undefined;
  const dispose=()=>{for(const [key,fn] of originals)target[key]=fn;active=false;};
  const invalidate=(message:string)=>{if(!active)return;reason=message;dispose();onInvalidated?.(message);};
  const wrap=(name:string,fn:(original:(...args:any[])=>any,args:any[])=>any)=>{
    const original=target[name];originals.set(name,original);target[name]=(...args:any[])=>fn(original.bind(session),args);
  };
  for(const [name,kind] of [['next','next'],['act','action'],['startMiniGame','mini-start'],['playMiniGame','mini-input'],['skipMiniGame','mini-skip'],['abortMiniGame','mini-abort'],['finishMiniGame','mini-finish']] as const){
    wrap(name,(original,args)=>{
      const before=session.getView(),accepted=original(...args),after=session.getView();
      if(active&&accepted&&(before.visit!==after.visit||before.miniGame?.revision!==after.miniGame?.revision)){
        if(steps.length>=MAX_ROUTE_STEPS)invalidate('录制步数已到上限，请拆分或缩短用例');
        else steps.push(kind==='action'?{type:kind,id:args[0]}:kind==='mini-input'?{type:kind,index:args[0]}:{type:kind});
      }
      return accepted;
    });
  }
  wrap('setAuto',(original,args)=>args[0]?undefined:original(false));
  wrap('setSkip',(original,args)=>args[0]?false:original(false));
  for(const key of ['restart','restore','rollback','reread'])wrap(key,(original,args)=>{invalidate('读档、回退或重开会中断录制，请从头重新录制');return original(...args);});
  return {get active(){return active;},get count(){return steps.length;},dispose,
    finish(id:string,label?:string):RouteCase{
      if(!active)throw Error(reason??'录制已经结束');
      const result:RouteCase={id,...(label?{label}:{}),steps:structuredClone(steps),expect:routeExpectation(session,type)};
      validateRouteSuite({schema:1,cases:[result]});dispose();return result;
    }};
}
