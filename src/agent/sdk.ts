import { AI_ACCEPTANCE_SCHEMA, readAiAcceptance, assessAiAcceptance, captureAcceptanceContext } from '../compliance/acceptance.js';
import { CREATIVE_EXTENSION, PRODUCTION_SCHEMA, UI_SCHEMA } from '../creative/schema.js';
import { reviewCreativeProject } from '../creative/project.js';
import { FEEDBACK_DOCUMENT_SCHEMA,FeedbackError,readAuthorReview,captureReviewBinding,assessAuthorReview,editAuthorReview } from '../creative/feedback.js';
import { analyseContentImpact } from '../creative/impact.js';
import { EditorModel, newProject, readDocument } from '../editor/model.js';
import type { EngineProject } from '../runtime/project.js';
import { runRouteSuite } from '../regression/suite.js';
import { validateProjectCompliance } from '../compliance/project.js';
import { localAssetPath } from '../assets/catalog.js';
import { AGENT_PROTOCOL, AGENT_LIMITS, AgentError, agentResponse, failAgent, sourceHash, utf8Bytes, type AgentContext, type AgentResult, type AgentResponse, type AgentRequest, type AgentDiagnostic } from './protocol.js';
import { AGENT_REQUEST_SCHEMA, AGENT_RESPONSE_SCHEMA, AGENT_OPERATION_SCHEMA, COMMAND_SCHEMAS, OPERATION_DEFINITIONS, validateAgentRequest, assertAgentJSON } from './schema.js';
import { applyAgentOperation } from './operations.js';
import { inspectItems, referenceItems, agentProjectDiagnostics } from './project.js';

export function agentCapabilities() {
  return { protocol: AGENT_PROTOCOL, extensions:[CREATIVE_EXTENSION,'vn-author-review-v1','vn-content-impact-v1','vn-ai-acceptance-v1'], limits: AGENT_LIMITS, commands: Object.keys(COMMAND_SCHEMAS), operations: OPERATION_DEFINITIONS.map(schema => schema.properties.op.const),
    templates: ['vn', 'chat', 'script', 'investigation'], templateTypes: { vn: 'narrative', chat: 'narrative', script: 'script', investigation: 'investigation' }, projectTypes: ['narrative', 'script', 'investigation', 'rain'],
    compatibility: { projectSchema: 1, editorSchema: 1, saveSchema: 1, rain: 'native-format-read-validate-test-preview-build' },
    operationScopes: { variable: ['script'], chapter: ['investigation'], evidence: ['investigation'], action: ['investigation'], line: ['narrative','script'], choice: ['narrative','script'], exit: ['script'], rainNodes: 'native-read-only' },
    hostPorts: ['readAsset', 'preview', 'build', 'probe', 'importsPrepared','readEvidence','acceptanceBundle'],
    schemas: {
      ...Object.fromEntries(['request','response','operation'].map(name=>[name,{id:`urn:vn-agent-v1:${name}`,file:`schemas/vn-agent-v1.${name}.schema.json`}])),
      ...Object.fromEntries(['production','ui'].map(name=>[name,{id:`urn:vn-creative-v1:${name}`,file:`schemas/vn-creative-v1.${name}.schema.json`}])),acceptance:{id:'urn:vn-ai-acceptance-v1:document',file:'schemas/vn-ai-acceptance-v1.document.schema.json'},feedback:{id:'urn:vn-author-review-v1:document',file:'schemas/vn-author-review-v1.document.schema.json'}
    },
    exitCodes: { PASS: 0, FAIL: 1, BLOCKED: 2, UNVERIFIED: 3 }, batch: { stableIds: true, finalValidation: true, expectedSourceSha256: true, dryRun: true, playerStorageWrites: false } };
}
function page(response: AgentResponse, items: any[], request: AgentRequest, sha: string) {
  const p = request.params, limit = p.limit ?? 20, maxBytes = p.maxBytes ?? AGENT_LIMITS.defaultOutputBytes;
  const query = JSON.stringify([request.command, p.kind ?? 'overview', p.id ?? null, p.chapterId ?? null,p.query??null,p.characterId??null,p.taskKind??null]);
  let index = 0, offset = 0;
  if (p.cursor) {
    let cursor: any; try { cursor = JSON.parse(decodeURIComponent(p.cursor)); } catch { throw new AgentError('INVALID_CURSOR', 'Cursor is not valid'); }
    if (cursor.sha !== sha) throw new AgentError('STALE_CURSOR', 'Source changed since the previous page', { expected: cursor.sha ?? null, actual: sha });
    if (cursor.query !== query || !Number.isSafeInteger(cursor.index) || cursor.index < 0 || cursor.index > items.length || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new AgentError('INVALID_CURSOR', 'Cursor does not belong to this query');
    index = cursor.index; offset = cursor.offset;
  }
  const token = (i: number, o: number) => encodeURIComponent(JSON.stringify({ sha, query, index: i, offset: o }));
  const data: any = { kind: p.kind ?? 'overview', total: items.length, items: [], truncated: false, nextCursor: null };
  const fits = () => utf8Bytes(JSON.stringify({ ...response, data })) <= maxBytes;
  while (index < items.length && data.items.length < limit) {
    const text = JSON.stringify(items[index]); if (offset > text.length) throw new AgentError('INVALID_CURSOR', 'Cursor offset exceeds the item');
    if (!offset) {
      data.items.push(items[index]); data.truncated = index + 1 < items.length; data.nextCursor = data.truncated ? token(index + 1, 0) : null;
      if (fits()) { index++; continue; } data.items.pop();
      if (data.items.length) break;
    }
    let low = offset + 1, high = text.length, best = offset;
    while (low <= high) {
      const end = Math.floor((low + high) / 2), more = end < text.length || index + 1 < items.length;
      data.fragment = { id: items[index].id ?? null, encoding: 'json-text', offset, text: text.slice(offset, end), complete: end === text.length };
      data.truncated = more; data.nextCursor = more ? token(end === text.length ? index + 1 : index, end === text.length ? 0 : end) : null;
      if (fits()) { best = end; low = end + 1; } else high = end - 1;
    }
    if (best === offset) throw new AgentError('BUDGET_EXCEEDED', 'Output budget cannot hold one fragment', {}, 'UNVERIFIED');
    data.fragment = { id: items[index].id ?? null, encoding: 'json-text', offset, text: text.slice(offset, best), complete: best === text.length };
    const more = best < text.length || index + 1 < items.length;
    data.truncated = more; data.nextCursor = more ? token(best === text.length ? index + 1 : index, best === text.length ? 0 : best) : null;
    response.data = data; return;
  }
  data.truncated = index < items.length; data.nextCursor = data.truncated ? token(index, 0) : null; response.data = data;
}
function differences(before: any, after: any) {
  const changes: { path: (string | number)[]; change: string; before?: unknown; after?: unknown }[] = []; let truncated = false;
  const preview = (value: any) => { if (value === undefined) return undefined; const text = JSON.stringify(value); return text.length > 256 ? { preview: text.slice(0,256), truncated: true } : value; };
  const walk = (a: any, b: any, path: (string | number)[]) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (changes.length >= 128) { truncated = true; return; }
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], [...path, Array.isArray(a) ? Number(key) : key]);
    else { const item = { path, change: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', before: preview(a), after: preview(b) }; if (utf8Bytes(JSON.stringify([...changes, item])) <= 8192) changes.push(item); else truncated = true; }
  }; walk(before, after, []); return { changes, truncated };
}
async function resources(project: EngineProject, context: AgentContext, check: () => void): Promise<AgentDiagnostic[]> {
  const diagnostics: AgentDiagnostic[] = [];
  if (!project.assets.length) return diagnostics;
  if (!context.readAsset) return [{ code: 'ASSETS_UNVERIFIED', severity: 'warning', message: 'Inject readAsset or use the Node SDK to validate actual local bytes' }];
  for (let i = 0; i < project.assets.length; i++) {
    check(); const asset = project.assets[i];
    try {
      if (!localAssetPath(asset.src)) throw new AgentError('ASSET_PATH_UNSAFE', 'Asset needs a local relative path');
      const bytes = await context.readAsset(asset.src); check();
      if (bytes.byteLength > AGENT_LIMITS.assetBytes) throw new AgentError('BUDGET_EXCEEDED', 'Asset exceeds byte budget', {}, 'UNVERIFIED');
      if (asset.sha256 && await sourceHash(bytes) !== asset.sha256) throw new AgentError('ASSET_HASH_MISMATCH', 'Asset SHA256 differs');
      if (asset.license) { if (!localAssetPath(asset.license.src)) throw new AgentError('ASSET_PATH_UNSAFE', 'License path is unsafe'); await context.readAsset(asset.license.src); }
    } catch (error) {
      if (error instanceof AgentError && ['TIMEOUT', 'ABORTED', 'BUDGET_EXCEEDED'].includes(error.code)) throw error;
      diagnostics.push({ code: error instanceof AgentError ? error.code : 'ASSET_UNREADABLE', severity: 'error', message: error instanceof Error ? error.message : String(error), assetId: asset.id, path: ['assets', i, 'src'] });
    }
  } return diagnostics;
}

/** Pure preparation SDK: candidates are explicit; disk writes belong to the Node adapter. */
export async function executeAgentRequest(input: unknown, context: AgentContext = {}): Promise<AgentResult> {
  const response = agentResponse(), result: AgentResult = { response };
  const started = (context.now ?? Date.now)(); let request: AgentRequest | undefined;
  const check = () => {
    if (context.signal?.aborted) throw new AgentError('ABORTED', 'Request was cancelled', {}, 'UNVERIFIED');
    if ((context.now ?? Date.now)() - started >= (request?.params.timeoutMs ?? AGENT_LIMITS.requestMs)) throw new AgentError('TIMEOUT', 'Request deadline exceeded', {}, 'UNVERIFIED');
  };
  try {
    check();
    if (typeof input === 'string') {
      if (utf8Bytes(input) > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Request exceeds input byte budget', {}, 'UNVERIFIED');
      try { input = JSON.parse(input); } catch { throw new AgentError('MALFORMED_JSON', 'Request is not valid JSON'); }
    }
    if (input && typeof input === 'object') { const value = input as any; if (typeof value.command === 'string') response.command = value.command.slice(0, 500); if (typeof value.requestId === 'string' && value.requestId.trim()) response.requestId = value.requestId.slice(0, 128); }
    request = validateAgentRequest(input); response.command = request.command; response.requestId = request.requestId;
    if (utf8Bytes(JSON.stringify(request)) > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Request exceeds byte budget', {}, 'UNVERIFIED');
    const params = request.params; check();
    if (request.command === 'capabilities') { response.data = params.schema ? { schema: ({ request: AGENT_REQUEST_SCHEMA, response: AGENT_RESPONSE_SCHEMA, operation: AGENT_OPERATION_SCHEMA, production:PRODUCTION_SCHEMA, ui:UI_SCHEMA,feedback:FEEDBACK_DOCUMENT_SCHEMA,acceptance:AI_ACCEPTANCE_SCHEMA } as any)[params.schema] } : agentCapabilities(); return result; }
    if(request.command==='probe'){if(!context.probe)throw new AgentError('HOST_PORT_REQUIRED','Probe requires the Node host or an injected decoder',{},'UNVERIFIED');const output=await context.probe(request);response.data=output.data;response.artifacts=output.artifacts;response.status=output.status;response.ok=output.status==='PASS';response.diagnostics=output.diagnostics;result.report=output.data;check();return result;}
    if (request.command === 'init') {
      const project = newProject(params.type); project.game = params.game; project.version = params.storyVersion; project.title = params.title;
      if (project.type === 'script') { project.program.game = project.game; project.program.version = project.version; }
      const model = new EditorModel(project, 1), text = model.serialize(params.format !== 'editor'), sha = await sourceHash(text);
      response.project = { game: project.game, storyVersion: project.version, sourceSha256: sha }; response.data = { type: project.type, format: params.format ?? 'project' };
      result.candidate = { document: readDocument(project), sourceText: text, beforeSha256: null, afterSha256: sha }; check(); return result;
    }
    if (context.source === undefined) throw new AgentError('PROJECT_REQUIRED', 'Supply project source or a project file');
    if (typeof context.source !== 'string') assertAgentJSON(context.source);
    const sourceText = typeof context.source === 'string' ? context.source : JSON.stringify(context.source, null, 2) + '\n';
    if (utf8Bytes(sourceText) > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Project exceeds input byte budget', {}, 'UNVERIFIED');
    let model: EditorModel; try { model = new EditorModel(sourceText, 1); } catch (error) { throw new AgentError('INVALID_PROJECT', error instanceof Error ? error.message : String(error)); }
    const before = readDocument(sourceText), project = before.project, sha = await sourceHash(sourceText), wrapped = JSON.parse(sourceText).format === 'vn-engine-editor';
    response.project = { game: project.game, storyVersion: project.version, sourceSha256: sha }; check();
    if(request.command==='acceptance.bundle'){
      if(!context.acceptanceBundle)throw new AgentError('HOST_PORT_REQUIRED','Acceptance bundle needs the file host',{},'UNVERIFIED');
      response.data=await context.acceptanceBundle(request);if(response.data.binding.sourceSha256!==sha)throw new AgentError('SOURCE_CONFLICT','Project changed before bundle');response.artifacts.push({kind:'acceptance-draft',path:response.data.draftFile});check();return result;
    }
    if(request.command.startsWith('acceptance.')){
      const raw=context.reviewSource??null,reviewText=raw===null?null:typeof raw==='string'?raw:JSON.stringify(raw,null,2)+'\n';
      const reviewSha=reviewText===null?null:await sourceHash(reviewText);
      const doc=request.command==='acceptance.import'?readAiAcceptance(params.document):raw===null?undefined:readAiAcceptance(raw);
      const acceptanceContext=await captureAcceptanceContext(project,sourceText,doc,context.readAsset,context.readEvidence);check();
      const report=assessAiAcceptance(project,{acceptance:doc,acceptanceContext});
      if(request.command==='acceptance.inspect'){
        page(response,[{id:'acceptance-summary',reviewSha256:reviewSha,status:report.status,scope:report.scope},...report.checks],request,sha+':'+reviewSha+':'+await sourceHash(JSON.stringify(acceptanceContext)));return result;
      }
      if(params.expectedSourceSha256!==sha)throw new AgentError('SOURCE_CONFLICT','Project changed before acceptance import');
      if(params.expectedReviewSha256!==reviewSha)throw new AgentError('REVIEW_CONFLICT','Acceptance file changed before import');
      if(!report.scope.sourceBound||!report.scope.actualFiles||!report.scope.evidenceBound)throw new AgentError('REVIEW_STALE','Acceptance source, media or evidence is stale or unverified',{actual:report.issues});
      if(reviewSha&&doc?.supersedesSha256!==reviewSha)throw new AgentError('REVIEW_CONFLICT','Re-review must identify the previous acceptance SHA');
      const text=JSON.stringify(doc,null,2)+'\n',after=await sourceHash(text);
      result.reviewCandidate={document:doc!,sourceText:text,beforeSha256:reviewSha,afterSha256:after};
      response.data={applied:false,reviewSha256:reviewSha,candidateReviewSha256:after,status:report.status,checksTotal:report.checks.length};return result;
    }
    if(request.command.startsWith('feedback.')){
      const raw=context.reviewSource??null;
      const reviewText=raw===null?null:typeof raw==='string'?raw:JSON.stringify(raw,null,2)+'\n';
      if(reviewText&&utf8Bytes(reviewText)>AGENT_LIMITS.inputBytes)throw new AgentError('BUDGET_EXCEEDED','Review exceeds input budget',{},'UNVERIFIED');
      if(reviewText){let parsed;try{parsed=JSON.parse(reviewText);}catch{throw new AgentError('INVALID_REVIEW','Review document is not valid JSON');}assertAgentJSON(parsed);}
      const reviewSha=reviewText===null?null:await sourceHash(reviewText);
      const doc=readAuthorReview(raw,project),binding=await captureReviewBinding(project,sourceText,context.readAsset);check();
      if(request.command==='feedback.inspect'){
        const report=assessAuthorReview(doc,project,binding);page(response,[{id:'feedback-summary',status:report.status,reviewSha256:reviewSha,scope:report.scope,filesVerified:binding.filesVerified},...report.items.filter(i=>!params.id||i.id===params.id)],request,sha+':'+reviewSha+':'+await sourceHash(JSON.stringify(binding)));return result;
      }
      if(params.expectedSourceSha256!==sha)throw new AgentError('SOURCE_CONFLICT','Project changed before feedback edit',{expected:params.expectedSourceSha256,actual:sha});
      if(params.expectedReviewSha256!==reviewSha)throw new AgentError('REVIEW_CONFLICT','Review changed before edit',{expected:params.expectedReviewSha256,actual:reviewSha});
      const next=editAuthorReview(doc,project,binding,{...params,op:request.command==='feedback.put'?'put':'transition',id:params.id,actor:params.actor});
      const text=JSON.stringify(next,null,2)+'\n',after=await sourceHash(text);check();
      if(utf8Bytes(text)>AGENT_LIMITS.inputBytes)throw new AgentError('BUDGET_EXCEEDED','Review candidate exceeds byte budget',{},'UNVERIFIED');
      result.reviewCandidate={document:next,sourceText:text,beforeSha256:reviewSha,afterSha256:after};
      response.data={applied:false,dryRun:!!params.dryRun,reviewSha256:reviewSha,candidateReviewSha256:after,item:next.items.find(i=>i.id===params.id),filesVerified:binding.filesVerified,scope:{releaseApproval:false,humanIdentityAuthenticated:false}};return result;
    }
    if (request.command === 'inspect' || request.command === 'refs') {
      let items = request.command === 'inspect' ? inspectItems(project, params.kind ?? 'overview', params.id, params.chapterId) : referenceItems(before, params.kind, params.id, params.chapterId);
      if(request.command==='inspect') {
        if(params.characterId){const character=project.production?.characters?.find(c=>c.id===params.characterId);if(!character)throw new AgentError('NOT_FOUND','Character does not exist');items=items.filter(item=>params.kind==='characters'?item.id===character.id:['text','content'].includes(params.kind)?item.speaker===character.name:item.value?.characters?.includes(character.id));}
        if(params.taskKind)items=items.filter(item=>item.value?.kind===params.taskKind);
        if(params.query)items=items.filter(item=>JSON.stringify(item).toLocaleLowerCase().includes(params.query.toLocaleLowerCase()));
      }
      if (params.id && !items.length && request.command === 'inspect') throw new AgentError('NOT_FOUND', 'No matching item');
      page(response, items, request, sha); check(); return result;
    }
    if(request.command==='review'){const report=reviewCreativeProject(project);response.status=report.status as AgentResponse['status'];response.ok=report.status==='PASS';const items=[{id:'review-summary',summary:report.summary,scope:report.scope},...report.issues];page(response,items,request,sha);check();return result;}
    if (request.command === 'apply'||request.command==='impact') {
      if (params.expectedSourceSha256 !== sha) throw new AgentError('SOURCE_CONFLICT', 'Project changed; inspect and rebase the request', { expected: params.expectedSourceSha256, actual: sha });
      if(params.imports?.length&&!context.importsPrepared)throw new AgentError('HOST_PORT_REQUIRED','Imports need a prepared immutable file host',{},'UNVERIFIED');
      for (const [index, operation] of params.operations.entries()) {
        check(); try { applyAgentOperation(model, operation); } catch (error) {
          if (error instanceof AgentError) throw new AgentError(error.code, error.message, { ...error.details, operation: index, path: ['params', 'operations', index] }, error.status);
          throw new AgentError('OPERATION_FAILED', error instanceof Error ? error.message : String(error), { operation: index, path: ['params', 'operations', index] });
        }
      }
    }
    response.diagnostics = agentProjectDiagnostics(model); check();
    response.diagnostics.push(...await resources(model.getView().project as EngineProject, context, check));
    if (response.diagnostics.some(d => d.severity === 'error')) { response.ok = false; response.status = 'FAIL'; response.data = { validated: false }; return result; }
    if (request.command === 'apply'||request.command==='impact') {
      if (response.diagnostics.some(d => d.code === 'ASSETS_UNVERIFIED')) throw new AgentError('ASSETS_UNVERIFIED', 'Asset bytes must be validated before preparing a write', {}, 'UNVERIFIED');
      const serialized = model.serialize(!wrapped), text = wrapped ? JSON.stringify({ ...JSON.parse(sourceText), ...JSON.parse(serialized) }, null, 2) + '\n' : serialized, after = await sourceHash(text);
      const impact=analyseContentImpact(project,readDocument(text).project,sha,after,params.limit??20);
      if(request.command==='apply')result.candidate = { document: readDocument(text), sourceText: text, beforeSha256: sha, afterSha256: after };
      else result.report=impact;
      response.data = { dryRun: request.command==='impact'||!!params.dryRun, applied: false, beforeSha256: sha, afterSha256: after, ...differences(JSON.parse(sourceText), JSON.parse(text)),impact }; check(); return result;
    }
    if (request.command === 'validate') {
      try { response.data = { structure: validateProjectCompliance(project, { mode: params.mode ?? 'development', acceptance:context.acceptance,acceptanceContext:context.acceptanceContext }), files: context.readAsset || !project.assets.length ? 'PASS' : 'UNVERIFIED' }; }
      catch (error) { response.data = { report: (error as any).report ?? null }; throw new AgentError((error as Error).name.startsWith('Release') ? 'RELEASE_GATE_BLOCKED' : 'VALIDATION_FAILED', (error as Error).message, {}, (error as Error).name.startsWith('Release') ? 'BLOCKED' : 'FAIL'); }
      if (response.diagnostics.some(d => d.code === 'ASSETS_UNVERIFIED')) { response.ok = false; response.status = 'UNVERIFIED'; }
    } else if (request.command === 'test') {
      const suite = params.caseId ? { schema: 1 as const, cases: project.routeTests?.cases.filter(test => test.id === params.caseId) ?? [] } : project.routeTests;
      if (params.caseId && !suite?.cases.length) throw new AgentError('NOT_FOUND', 'Route case does not exist');
      const report = runRouteSuite(project, suite, { maxOperations: params.maxOperations ?? AGENT_LIMITS.routeOperations }); result.report = report;
      response.status = report.status as AgentResponse['status']; response.ok = report.status === 'PASS';
      response.data = { coverage: report.coverage, restoreChecks: report.restoreChecks, operationsUsed: report.operationsUsed,
        cases: report.cases.map(test => ({ id: test.id, status: test.status, stepsExecuted: test.stepsExecuted, ...(test.failure ? { failure: test.failure } : {}), ...(test.final ? { final: { sceneId: test.final.sceneId, lineId: test.final.lineId, ending: test.final.ending } } : {}) })) };
      for (const test of report.cases) if (test.status !== 'PASS') response.diagnostics.push({ code: test.status === 'UNVERIFIED' ? 'BUDGET_EXCEEDED' : 'ROUTE_FAILED', severity: 'error', message: test.failure?.message ?? 'Route is unverified', nodeId: test.final?.sceneId, path: ['routeTests', 'cases', report.cases.indexOf(test), 'steps', Math.max(0, (test.failure?.step ?? 1) - 1)] });
    } else if (request.command === 'preview' || request.command === 'build') {
      const port = context[request.command]; if (!port) throw new AgentError('HOST_PORT_REQUIRED', 'Inject ' + request.command + ' or use the Node SDK', {}, 'UNVERIFIED');
      const output = await port(before, request, response.project); response.data = output.data; response.artifacts = output.artifacts;
    }
    check();
    if (utf8Bytes(JSON.stringify(response)) > AGENT_LIMITS.outputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Response exceeds byte budget; narrow the request', {}, 'UNVERIFIED');
    return result;
  } catch (error) { delete result.candidate;delete result.reviewCandidate; failAgent(response, error instanceof FeedbackError?new AgentError(error.code,error.message,{},error.code==='BUDGET_EXCEEDED'?'UNVERIFIED':'FAIL'):error); return result; }
  finally {
    // Early validation failures and host errors are subject to the same wire budget as successes.
    if (utf8Bytes(JSON.stringify(response)) > AGENT_LIMITS.outputBytes) {
      delete result.candidate;
      delete result.reviewCandidate;
      const count = response.diagnostics.length;
      response.ok = false; response.status = 'UNVERIFIED'; response.data = { truncated: true, diagnosticsTotal: count };
      response.diagnostics = [{ code: 'BUDGET_EXCEEDED', severity: 'error', message: 'Response exceeds 65536 UTF-8 bytes; narrow the request. No write candidate was retained.', path: [] }];
      response.artifacts = response.artifacts.slice(0, 4);
      if (utf8Bytes(JSON.stringify(response)) > AGENT_LIMITS.outputBytes) { response.artifacts = []; response.project = null; }
    }
  }
}
