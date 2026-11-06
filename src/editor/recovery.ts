import { readAuthorReview } from '../creative/feedback.js';
import { isRecord } from '../storage/save.js';
import { readDocument, TEXT_SCRIPT_SOURCE_LIMIT, type EditorDocument } from './model.js';

export const RECOVERY_FORMAT = 'vn-engine-recovery';
export const RECOVERY_MAX_BYTES = 16_000_000;
const sourceMaxBytes = 8_000_000;
const encoder = new TextEncoder();
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const tabs = new Set(['story', 'structure', 'assets', 'collections', 'routes', 'production', 'evidence', 'text-script', 'resources', 'source']);
const productionViews = new Set(['context', 'tasks', 'assets', 'theme', 'feedback', 'validation']);

type PendingField = { key: string; baseline: string; value: string };
export type RecoveryState = {
  document: EditorDocument;
  sourceText?: string;
  authorReview?: unknown;
  productionDraft?: unknown;
  textScriptDraft?: string;
  source?: string;
  pendingFields?: PendingField[];
  editorTab?: string;
  selectedNode?: string;
  productionView?: string;
  baseURL?: string;
  at?: string;
};
type RecoveryOptions = { portable?: boolean };
const fields = new Set(['format', 'schema', 'document', 'sourceText', 'positions', 'textScriptSource', 'authorReview', 'productionDraft', 'textScriptDraft',
  'source', 'pendingFields', 'editorTab', 'selectedNode', 'productionView', 'baseURL', 'at']);

function checkBytes(text: string, max: number, label: string) {
  if (text.length > max || encoder.encode(text).length > max) throw new Error(`${label}超过 ${max / 1_000_000} MB`);
}

function checkPortableFieldCount(text: string, parsedFieldCount: number) {
  // JSON.parse has already checked the syntax and collapsed duplicate decoded names.
  // Each outer object field contributes one unquoted colon, even when its name uses escapes.
  let depth = 0, insideString = false, fieldCount = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (insideString) {
      if (char === '\\') index++;
      else if (char === '"') insideString = false;
    } else if (char === '"') insideString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
    else if (char === ':' && depth === 1) fieldCount++;
  }
  if (fieldCount !== parsedFieldCount) throw new Error('恢复文件包含重复字段');
}

function optionalText(value: unknown, max: number, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new Error(`无效的${label}`);
  return value;
}

function optionalSource(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`无效的${label}`);
  checkBytes(value, sourceMaxBytes, label);
  return value;
}

function checkJSON(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('恢复数据嵌套过深');
  if (Array.isArray(value)) { for (const child of value) checkJSON(child, depth + 1); return; }
  if (isRecord(value)) for (const [key, child] of Object.entries(value)) {
    if (unsafeKeys.has(key)) throw new Error('恢复数据包含不安全的字段名');
    checkJSON(child, depth + 1);
  }
  else if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('恢复数据包含无效的数字');
}

function checkPositions(value: unknown) {
  if (!isRecord(value)) throw new Error('无效的节点布局');
  if (Object.values(value).some(point => !isRecord(point)
    || [point.x, point.y].some(coordinate => typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 100000))) {
    throw new Error('无效的节点布局');
  }
}

function optionalFields(input: Record<string, unknown>, options: RecoveryOptions): Omit<RecoveryState, 'document' | 'sourceText'> {
  const { authorReview, productionDraft } = input;
  if (authorReview !== undefined && !isRecord(authorReview)) throw new Error('无效的作者审阅');
  if (productionDraft !== undefined && (!isRecord(productionDraft) || productionDraft.schema !== 1)) throw new Error('无效的制作草稿');
  const textScriptDraft = optionalText(input.textScriptDraft, TEXT_SCRIPT_SOURCE_LIMIT, '文本 DSL 草稿');
  const source = optionalSource(input.source, '未应用 JSON');
  const editorTab = optionalText(input.editorTab, 32, '编辑页签');
  if (editorTab !== undefined && !tabs.has(editorTab)) throw new Error('无效的编辑页签');
  const selectedNode = optionalText(input.selectedNode, RECOVERY_MAX_BYTES, '选中节点');
  const productionView = optionalText(input.productionView, 32, '制作页签');
  if (productionView !== undefined && !productionViews.has(productionView)) throw new Error('无效的制作页签');
  const baseURL = options.portable ? undefined : optionalText(input.baseURL, 8192, '资源基址');
  const at = optionalText(input.at, 128, '恢复时间');
  if (at !== undefined && !Number.isFinite(Date.parse(at))) throw new Error('无效的恢复时间');
  const edits = input.pendingFields;
  let pendingFields: PendingField[] | undefined;
  if (edits !== undefined) {
    if (!Array.isArray(edits) || edits.length > 10_000) throw new Error('无效的未提交字段列表');
    const keys = new Set<string>();
    pendingFields = edits.map(edit => {
      if (!isRecord(edit) || typeof edit.key !== 'string' || !edit.key || edit.key.length > 8192 || keys.has(edit.key)
        || typeof edit.baseline !== 'string' || edit.baseline.length > sourceMaxBytes
        || typeof edit.value !== 'string' || edit.value.length > sourceMaxBytes) throw new Error('无效的未提交字段');
      keys.add(edit.key);
      return { key: edit.key, baseline: edit.baseline, value: edit.value };
    });
  }
  return Object.fromEntries(Object.entries({ authorReview, productionDraft, textScriptDraft, source, pendingFields, editorTab, selectedNode,
    productionView, baseURL, at }).filter(([, value]) => value !== undefined));
}

export function readRecovery(text: string, options: RecoveryOptions = {}): RecoveryState {
  if (typeof text !== 'string') throw new Error('恢复数据必须是 JSON 文本');
  checkBytes(text, RECOVERY_MAX_BYTES, '恢复数据');
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.schema !== 1) throw new Error('不支持的恢复数据版本');
  const tagged = value.format === RECOVERY_FORMAT;
  if (!tagged && (options.portable || Object.hasOwn(value, 'format') || !Object.hasOwn(value, 'document')
    || Object.hasOwn(value, 'sourceText') || Object.hasOwn(value, 'positions'))) throw new Error('不支持的恢复数据格式');
  const keys = Object.keys(value);
  if (options.portable) checkPortableFieldCount(text, keys.length);
  if (options.portable && Object.hasOwn(value, 'baseURL')) throw new Error('恢复文件不能包含资源基址');
  checkJSON(value);
  if (keys.some(key => !fields.has(key))) throw new Error('恢复数据包含未知字段');

  const hasSource = Object.hasOwn(value, 'sourceText'), hasDocument = Object.hasOwn(value, 'document');
  if (hasSource === hasDocument || (hasDocument && (Object.hasOwn(value, 'positions') || Object.hasOwn(value, 'textScriptSource')))) {
    throw new Error('恢复数据必须包含唯一的工程表示');
  }
  const sourceText = optionalSource(value.sourceText, '原始工程 JSON');
  let document: EditorDocument;
  if (sourceText !== undefined) {
    const project: unknown = JSON.parse(sourceText);
    if (!isRecord(project) || project.format) throw new Error('原始工程 JSON 必须是无包装的运行工程');
    checkPositions(value.positions);
    const textScriptSource = optionalText(value.textScriptSource, TEXT_SCRIPT_SOURCE_LIMIT, ' DSL 源稿');
    document = readDocument({ format: 'vn-engine-editor', schema: 1, project, positions: value.positions,
      ...(textScriptSource === undefined ? {} : { textScriptSource }) });
  } else {
    if (!isRecord(value.document) || value.document.format !== 'vn-engine-editor') throw new Error('无效的恢复工程');
    if (tagged) checkPositions(value.document.positions);
    document = readDocument(value.document);
  }
  const rest = optionalFields(value, options);
  if (isRecord(rest.authorReview)) {
    const { game, storyVersion } = rest.authorReview;
    if (typeof game !== 'string' || typeof storyVersion !== 'string') throw new Error('无效的作者审阅');
    rest.authorReview = readAuthorReview(rest.authorReview, { ...document.project, game, version: storyVersion });
  }
  return { ...rest, document, ...(sourceText === undefined ? {} : { sourceText }) };
}

/** The caller supplies owned project data and a raw source only when it represents the current project. */
export function writeRecovery(state: RecoveryState, options: RecoveryOptions = {}): string {
  const { document } = state;
  const sourceText = optionalSource(state.sourceText, '原始工程 JSON');
  if (sourceText === '') throw new Error('无效的原始工程 JSON');
  checkPositions(document.positions);
  const textScriptSource = optionalText(document.textScriptSource, TEXT_SCRIPT_SOURCE_LIMIT, ' DSL 源稿');
  const project = sourceText === undefined ? { document } : { sourceText, positions: document.positions, textScriptSource };
  const wire = { format: RECOVERY_FORMAT, schema: 1, ...project, ...optionalFields(state, options) };
  const text = JSON.stringify(wire, (key, value: unknown) => {
    if (unsafeKeys.has(key)) throw new Error('恢复数据包含不安全的字段名');
    return value;
  }) + '\n';
  checkBytes(text, RECOVERY_MAX_BYTES, '恢复数据');
  return text;
}
