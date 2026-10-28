import { UI_SCHEMA, PRODUCTION_SCHEMA, CHARACTER_SCHEMA, BEAT_SCHEMA, TASK_SCHEMA } from '../creative/schema.js';
import { schemaErrors } from '../schema/validate.js';
import { AGENT_LIMITS, AGENT_PROTOCOL, AgentError, type AgentRequest } from './protocol.js';
import { isRecord } from '../storage/save.js';

type Schema = Record<string, any>;
const text = { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' };
const object = { type: 'object' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bool = { type: 'boolean' };
const integer = (min: number, max: number) => ({ type: 'integer', minimum: min, maximum: max });
const enumOf = (...values: string[]) => ({ type: 'string', enum: values });
const shape = (properties: Schema, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const op = (name: string, properties: Schema, required: string[]) => shape({ op: { const: name }, ...properties }, ['op', ...required]);
const selector = { id: text, chapterId: text };
const creativeOperations = [op('ui.set',{value:UI_SCHEMA},['value']),op('production.patch',{value:{...PRODUCTION_SCHEMA,required:[]}},['value']),...Object.entries({character:CHARACTER_SCHEMA,beat:BEAT_SCHEMA,task:TASK_SCHEMA}).flatMap(([kind,schema])=>[op(kind+'.put',{id:text,value:{...schema,required:[]}},['id','value']),op(kind+'.rename',{id:text,newId:text},['id','newId']),op(kind+'.remove',{id:text},['id'])])];
export const OPERATION_DEFINITIONS: Schema[] = [...creativeOperations,
  op('project.patch', { value: shape({ title: text, titleScreen: bool, font: text, settings: object, rollback: object, collections: object, stats: object, releaseEvidence: object }) }, ['value']),
  op('entry.set', selector, ['id']),
  op('node.put', { ...selector, value: object }, ['id', 'value']), op('node.patch', { ...selector, value: object }, ['id', 'value']),
  op('node.rename', { ...selector, newId: text }, ['id', 'newId']), op('node.remove', selector, ['id']),
  op('line.put', { nodeId: text, id: text, value: object, afterId: text }, ['nodeId', 'id', 'value']), op('line.remove', { nodeId: text, id: text }, ['nodeId', 'id']), op('line.rename', { nodeId: text, id: text, newId: text }, ['nodeId', 'id', 'newId']),
  op('choice.put', { nodeId: text, id: text, value: object }, ['nodeId', 'id', 'value']), op('choice.remove', { nodeId: text, id: text }, ['nodeId', 'id']),
  op('exit.set', { nodeId: text, value: object }, ['nodeId', 'value']),
  op('variable.put', { id: text, value: object }, ['id', 'value']), op('variable.rename', { id: text, newId: text }, ['id', 'newId']), op('variable.remove', { id: text }, ['id']),
  op('chapter.add', { id: text, title: text }, ['id']), op('chapter.patch', { id: text, value: shape({ title: text, entryNode: text, requiredEvidence: { type: 'array', items: text } }) }, ['id', 'value']),
  op('chapter.rename', { id: text, newId: text }, ['id', 'newId']), op('chapter.move', { id: text, direction: { type: 'integer', enum: [-1, 1] } }, ['id', 'direction']), op('chapter.remove', { id: text }, ['id']),
  op('evidence.put', { ...selector, value: object }, ['chapterId', 'id', 'value']), op('evidence.rename', { ...selector, newId: text }, ['chapterId', 'id', 'newId']), op('evidence.remove', selector, ['chapterId', 'id']),
  op('action.put', { chapterId: text, nodeId: text, id: text, value: object }, ['chapterId', 'nodeId', 'id', 'value']), op('action.remove', { chapterId: text, nodeId: text, id: text }, ['chapterId', 'nodeId', 'id']),
  op('asset.put', { id: text, value: object }, ['id', 'value']), op('asset.remove', { id: text }, ['id']),
  op('stage.set', { scope: enumOf('defaults', 'node', 'line'), nodeId: text, chapterId: text, id: text, value: object }, ['scope', 'value']),
  op('stage.remove', { scope: enumOf('defaults', 'node', 'line'), nodeId: text, chapterId: text, id: text }, ['scope']),
  op('route.put', { id: text, value: object }, ['id', 'value']), op('route.remove', { id: text }, ['id'])
];
export const AGENT_OPERATION_SCHEMA: Schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:vn-agent-v1:operation', oneOf: OPERATION_DEFINITIONS };
const common = { timeoutMs: integer(1, AGENT_LIMITS.requestMs) };
const paging = { kind: text, id: text, chapterId: text, limit: integer(1, 100), maxBytes: integer(4096, AGENT_LIMITS.outputBytes), cursor: { type: 'string', maxLength: 4096 } };
export const COMMAND_SCHEMAS: Record<string, Schema> = {
  capabilities: shape({ ...common, schema: enumOf('request', 'response', 'operation', 'production', 'ui') }),
  init: shape({ ...common, type: enumOf('vn', 'chat', 'script', 'investigation'), game: { ...text, pattern: '^[a-zA-Z0-9_-]+$' }, storyVersion: text, title: text, format: enumOf('project', 'editor'), output: text, recover: bool }, ['type', 'game', 'storyVersion', 'title']),
  inspect: shape({ ...common, ...paging, query:text,characterId:text,taskKind:enumOf('art','music','ui','sfx','text','story'),kind: enumOf('overview', 'nodes', 'chapters', 'variables', 'assets', 'presentation', 'routes', 'text', 'production', 'characters', 'beats', 'tasks', 'ui') }),
  refs: shape({ ...common, ...paging, kind: enumOf('node', 'variable', 'chapter', 'asset', 'evidence', 'character', 'task', 'line') }, ['kind', 'id']),
  apply: shape({ ...common, expectedSourceSha256: hash, operations: { type: 'array', minItems: 1, maxItems: AGENT_LIMITS.operations, items: { oneOf: OPERATION_DEFINITIONS } }, dryRun: bool, recover: bool, imports:{type:'array',maxItems:32,items:shape({source:{type:'string',minLength:1,maxLength:4096},sha256:hash,extension:enumOf('png','jpg','jpeg','webp','svg','wav','mp3','ogg','woff2','txt','webm','mp4')},['source','sha256','extension'])} }, ['expectedSourceSha256', 'operations']),
  validate: shape({ ...common, mode: enumOf('development', 'release') }),
  probe: shape({...common,probeMs:integer(1,30000),files:{type:'array',minItems:1,maxItems:16,items:shape({id:text,file:{type:'string',minLength:1,maxLength:4096},kind:enumOf('background','portrait','cg','ui','audio','font','video','license')},['id','file','kind'])},output:text},['files']),
  review: shape({ ...common, limit:paging.limit,maxBytes:paging.maxBytes,cursor:paging.cursor }),
  test: shape({ ...common, maxOperations: integer(1, AGENT_LIMITS.routeOperations), caseId: text, output: text }),
  preview: shape({ ...common, caseId: text, output: text, maxOperations: integer(1, AGENT_LIMITS.routeOperations), previewMs: integer(1, AGENT_LIMITS.previewMs), width: integer(320, 3840), height: integer(240, 2160) }, ['caseId', 'output']),
  build: shape({ ...common, output: text, mode: enumOf('development', 'release') }, ['output'])
};
export const AGENT_REQUEST_SCHEMA: Schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:vn-agent-v1:request', oneOf: Object.entries(COMMAND_SCHEMAS).map(([command, params]) =>
  shape({ protocol: { const: AGENT_PROTOCOL }, requestId: { ...text, maxLength: 128 }, command: { const: command }, project: text, params }, ['protocol', 'requestId', 'command', 'params'])) };
export const AGENT_RESPONSE_SCHEMA: Schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:vn-agent-v1:response',
  ...shape({ protocol: { const: AGENT_PROTOCOL }, engineVersion: text, requestId: text, command: text, ok: bool, status: enumOf('PASS', 'FAIL', 'BLOCKED', 'UNVERIFIED'),
    project: { anyOf: [{ type: 'null' }, shape({ game: text, storyVersion: text, sourceSha256: hash }, ['game', 'storyVersion', 'sourceSha256'])] }, data: {},
    diagnostics: { type: 'array', items: shape({ code: text, severity: enumOf('error', 'warning', 'info'), message: { type: 'string' }, path: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } }, nodeId: text, chapterId: text, assetId: text, operation: integer(0, 127), expected: {}, actual: {} }, ['code', 'severity', 'message']) },
    artifacts: { type: 'array', items: shape({ kind: text, path: { type: 'string', minLength: 1, maxLength: 4096 }, sha256: hash }, ['kind', 'path']) }
  }, ['protocol', 'engineVersion', 'requestId', 'command', 'ok', 'status', 'project', 'data', 'diagnostics', 'artifacts']) };

export { schemaErrors } from '../schema/validate.js';

export function assertAgentJSON(value: unknown, depth = 0): void {
  if (depth > 60) throw new AgentError('INVALID_REQUEST', 'JSON nesting exceeds 60 levels');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) assertAgentJSON(item, depth + 1); return; }
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new AgentError('INVALID_REQUEST', 'Only JSON values are accepted');
  for (const [key, item] of Object.entries(value)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new AgentError('INVALID_REQUEST', 'Unsafe object field', { path: [key] }); assertAgentJSON(item, depth + 1); }
}
export function validateAgentRequest(value: unknown): AgentRequest {
  assertAgentJSON(value);
  if (!isRecord(value)) throw new AgentError('INVALID_REQUEST', 'Request must be an object');
  if (value.protocol !== AGENT_PROTOCOL) throw new AgentError('PROTOCOL_UNSUPPORTED', 'Expected ' + AGENT_PROTOCOL, { path: ['protocol'], expected: AGENT_PROTOCOL, actual: value.protocol ?? null });
  if (typeof value.command !== 'string' || !Object.hasOwn(COMMAND_SCHEMAS, value.command)) throw new AgentError('UNKNOWN_COMMAND', 'Unknown command', { path: ['command'] });
  const errors = schemaErrors(shape({ protocol: { const: AGENT_PROTOCOL }, requestId: { ...text, maxLength: 128 }, command: text, project: text, params: COMMAND_SCHEMAS[value.command] }, ['protocol', 'requestId', 'command', 'params']), value);
  if (errors.length) throw new AgentError('INVALID_REQUEST', errors[0].message, { path: errors[0].path });
  return structuredClone(value) as AgentRequest;
}
