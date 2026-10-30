import type { EngineProject } from '../runtime/project.js';
import { runtimeSemantics } from '../runtime/semantics.js';
import { resolveSourceOrigin } from '../source/origin.js';
import { assessRuntimeEvidenceReport, readRuntimeEvidenceReport } from '../runtime/evidence-report.js';
import { AgentError, type AgentDiagnostic } from './protocol.js';

/** Read-only adapters: evidence never authorises writes or proves an acceptance PASS. */
export function runtimeInspectionItems(project: EngineProject, params: Record<string, any>, sha: string) {
  if (params.kind === 'semantics') {
    const catalogue = runtimeSemantics();
    return {items: catalogue.entries.filter(item => !params.id || item.id === params.id), diagnostics: [] as AgentDiagnostic[], unverified: false};
  }
  if (params.kind === 'source') {
    const origin = resolveSourceOrigin(project, params.selector ?? (params.id ? {nodeId:params.id,chapterId:params.chapterId} : {}), sha);
    return {items:[{id:params.id ?? 'source',origin,located:!!origin.path}],diagnostics:[] as AgentDiagnostic[],unverified:false};
  }
  if (params.document === undefined) throw new AgentError('EVIDENCE_REQUIRED', 'Supply a runtime evidence report in params.document');
  let assessment;
  try { assessment = assessRuntimeEvidenceReport(project,sha,readRuntimeEvidenceReport(params.document)); }
  catch (error) { throw new AgentError('INVALID_EVIDENCE',error instanceof Error ? error.message : String(error)); }
  const report = assessment.report;
  const diagnostics:AgentDiagnostic[]=[];
  if (!assessment.current) diagnostics.push({code:assessment.binding === 'stale'?'EVIDENCE_STALE':'EVIDENCE_UNBOUND',severity:'warning',message:'Runtime evidence is not bound to the current source; no acceptance result is inferred'});
  if (report.truncated) diagnostics.push({code:'EVIDENCE_TRUNCATED',severity:'warning',message:'Runtime events were dropped; this report is partial'});
  const items:any[]=[{id:'evidence-summary',binding:assessment.binding,externalClaim:true,sessionId:report.sessionId,sourceSha256:report.sourceSha256??null,
    dropped:report.dropped,truncated:report.truncated,scope:assessment.scope,acceptance:'UNVERIFIED'},
    ...report.events.map(event=>({id:`event-${event.sequence}`,...event}))];
  return {items:params.id?items.filter(item=>item.id===params.id):items,diagnostics,unverified:true};
}
