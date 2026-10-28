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
export const OPERATION_DEFINITIONS: Schema[] = [
  op('project.patch', { value: shape({ title: text, titleScreen: bool, font: text, settings: object, rollback: object, collections: object, stats: object, releaseEvidence: object }) }, ['value']),
  op('entry.set', selector, ['id']),
  op('node.put', { ...selector, value: object }, ['id', 'value']), op('node.patch', { ...selector, value: object }, ['id', 'value']),
  op('node.rename', { ...selector, newId: text }, ['id', 'newId']), op('node.remove', selector, ['id']),
  op('line.put', { nodeId: text, id: text, value: object, afterId: text }, ['nodeId', 'id', 'value']), op('line.remove', { nodeId: text, id: text }, ['nodeId', 'id']),
  op('choice.put', { nodeId: text, id: text, value: object }, ['nodeId', 'id', 'value']), op('choice.remove', { nodeId: text, id: text }, ['nodeId', 'id']),
  op('exit.set', { nodeId: text, value: object }, ['nodeId', 'value']),
  op('variable.put', { id: text, value: object }, ['id', 'value']), op('variable.rename', { id: text, newId: text }, ['id', 'newId']), op('variable.remove', { id: text }, ['id']),
  op('chapter.add', { id: text, title: text }, ['id']), op('chapter.patch', { id: text, value: shape({ title: text, entryNode: text, requiredEvidence: { type: 'array', items: text } }) }, ['id', 'value']),
  op('chapter.rename', { id: text, newId: text }, ['id', 'newId']), op('chapter.move', { id: text, direction: { type: 'integer', enum: [-1, 1] } }, ['id', 'direction']), op('chapter.remove', { id: text }, ['id']),
  op('evidence.put', { ...selector, value: object }, ['chapterId', 'id', 'value']), op('evidence.rename', { ...selector, newId: text }, ['chapterId', 'id', 'newId']), op('evidence.remove', selector, ['chapterId', 'id']),
  op('action.put', { chapterId: text, nodeId: text, id: text, value: object }, ['chapterId', 'nodeId', 'id', 'value']), op('action.remove', { chapterId: text, nodeId: text, id: text }, ['chapterId', 'nodeId', 'id']),
  op('asset.put', { id: text, value: object }, ['id', 'value']), op('asset.remove', { id: text }, ['id']),
  op('stage.set', { scope: enumOf('defaults', 'node', 'line'), nodeId: text, chapterId: text, id: text, value: object }, ['scope', 'value']),
  op('route.put', { id: text, value: object }, ['id', 'value']), op('route.remove', { id: text }, ['id'])
];
export const AGENT_OPERATION_SCHEMA: Schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:vn-agent-v1:operation', oneOf: OPERATION_DEFINITIONS };
const common = { timeoutMs: integer(1, AGENT_LIMITS.requestMs) };
const paging = { kind: text, id: text, chapterId: text, limit: integer(1, 100), maxBytes: integer(4096, AGENT_LIMITS.outputBytes), cursor: { type: 'string', maxLength: 4096 } };
export const COMMAND_SCHEMAS: Record<string, Schema> = {
  capabilities: shape({ ...common, schema: enumOf('request', 'response', 'operation') }),
  init: shape({ ...common, type: enumOf('vn', 'chat', 'script', 'investigation'), game: { ...text, pattern: '^[a-zA-Z0-9_-]+$' }, storyVersion: text, title: text, format: enumOf('project', 'editor'), output: text }, ['type', 'game', 'storyVersion', 'title']),
  inspect: shape({ ...common, ...paging, kind: enumOf('overview', 'nodes', 'chapters', 'variables', 'assets', 'presentation', 'routes') }),
  refs: shape({ ...common, ...paging, kind: enumOf('node', 'variable', 'chapter', 'asset', 'evidence') }, ['kind', 'id']),
  apply: shape({ ...common, expectedSourceSha256: hash, operations: { type: 'array', minItems: 1, maxItems: AGENT_LIMITS.operations, items: { oneOf: OPERATION_DEFINITIONS } }, dryRun: bool, recover: bool }, ['expectedSourceSha256', 'operations']),
  validate: shape({ ...common, mode: enumOf('development', 'release') }),
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
    artifacts: { type: 'array', items: shape({ kind: text, path: text, sha256: hash }, ['kind', 'path']) }
  }, ['protocol', 'engineVersion', 'requestId', 'command', 'ok', 'status', 'project', 'data', 'diagnostics', 'artifacts']) };

/** Validator for the JSON Schema vocabulary emitted above; no executable author input. */
export function schemaErrors(schema: Schema, value: unknown, path: (string | number)[] = []): { path: (string | number)[]; message: string }[] {
  const error = (message: string) => [{ path, message }];
  if (schema.oneOf || schema.anyOf) {
    const matches = (schema.oneOf ?? schema.anyOf).filter((item: Schema) => !schemaErrors(item, value, path).length).length;
    return matches >= 1 && (!schema.oneOf || matches === 1) ? [] : error('Value does not match the declared alternatives');
  }
  if ('const' in schema && value !== schema.const) return error('Unexpected constant');
  if (schema.enum && !schema.enum.includes(value)) return error('Value is outside the declared enumeration');
  const type = schema.type;
  if (type && !(type === 'object' ? isRecord(value) : type === 'array' ? Array.isArray(value) : type === 'null' ? value === null
    : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === type)) return error('Expected ' + type);
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return error('Number is outside bounds');
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return error('String does not match constraints');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return error('Array size is outside bounds');
    return schema.items ? value.flatMap((item, i) => schemaErrors(schema.items, item, [...path, i])) : [];
  }
  if (isRecord(value)) {
    const errors = (schema.required ?? []).filter((key: string) => !Object.hasOwn(value, key)).flatMap((key: string) => [{ path: [...path, key], message: 'Required field is missing' }]);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(schema.properties[key], item, [...path, key]));
      else if (schema.additionalProperties === false) errors.push({ path: [...path, key], message: 'Unknown field' });
    } return errors;
  } return [];
}
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
