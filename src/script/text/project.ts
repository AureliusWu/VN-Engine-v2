import type { AssetKind } from '../../assets/catalog.js';
import type { StageCue } from '../../stage/types.js';
import type { TextScriptCompilation, TextScriptDiagnostic, TextScriptSourceMapEntry, TextScriptSpan } from '../text.js';

/** Optional author context. Only catalog identity/kind is inspected; no asset bytes or host IO. */
export type TextScriptProjectContext = {
  type: string; game: string; version: string;
  assets: readonly { id: string; kind: AssetKind }[];
};

const kinds = new Set<AssetKind>(['background', 'portrait', 'cg', 'ui', 'audio', 'font', 'video']);
const references = [
  ['background', 'background'], ['portrait', 'portrait'], ['cg', 'cg'],
  ['music', 'audio'], ['ambience', 'audio'], ['sound', 'audio'], ['voice', 'audio']
] as const;
const own = (value: unknown, key: string): unknown => value !== null && typeof value === 'object'
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const record = (value: unknown): value is object => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const emptySpan = (): TextScriptSpan => ({ start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } });

/** Check an already compiled candidate against a catalog, without creating a runtime or changing inputs. */
export function checkTextScriptProject(compilation: TextScriptCompilation, context: TextScriptProjectContext,
  options: { maxDiagnostics?: number } = {}): TextScriptCompilation {
  const result = structuredClone(compilation);
  result.projectContext = { checked: false };
  const optionDescriptor = record(options) ? Object.getOwnPropertyDescriptor(options, 'maxDiagnostics') : undefined;
  const configured = own(options, 'maxDiagnostics');
  const validOptions = record(options) && (!optionDescriptor || Object.hasOwn(optionDescriptor, 'value'))
    && (configured === undefined || Number.isSafeInteger(configured) && (configured as number) >= 1 && (configured as number) <= 100);
  const maximum = validOptions && configured !== undefined ? configured as number : 100;
  let exhausted = false;
  const location = (path: readonly (string | number)[] = []): TextScriptSourceMapEntry | undefined =>
    result.sourceMap.find(item => item.kind === 'program' && JSON.stringify(item.path) === JSON.stringify(path));
  const fallback = location();
  const diagnostic = (code: string, message: string, at: TextScriptSourceMapEntry | undefined = fallback): TextScriptDiagnostic => ({
    code, severity: 'error', message, span: structuredClone(at?.span ?? emptySpan()),
    ...(at?.path ? { path: [...at.path] } : {}), ...(at?.fileName !== undefined ? { fileName: at.fileName } : {})
  });
  const add = (item: TextScriptDiagnostic): boolean => {
    if (exhausted) return false;
    if (result.diagnostics.length < maximum) { result.diagnostics.push(item); return true; }
    result.diagnostics[maximum - 1] = diagnostic('DSL_DIAGNOSTIC_BUDGET', 'Project diagnostic budget reached; further diagnostics were omitted.');
    exhausted = true; return false;
  };
  const finish = (): TextScriptCompilation => {
    result.ok = compilation.ok && !result.diagnostics.some(item => item.severity === 'error');
    if (!result.ok) delete result.program;
    return result;
  };
  if (result.diagnostics.length > maximum) {
    result.diagnostics = result.diagnostics.slice(0, maximum);
    result.diagnostics[maximum - 1] = diagnostic('DSL_DIAGNOSTIC_BUDGET', 'Project diagnostic budget reached; further diagnostics were omitted.');
    exhausted = true;
  }
  if (!validOptions) { add(diagnostic('DSL_OPTIONS', 'Project maxDiagnostics must be an integer from 1 to 100.')); return finish(); }
  // Syntax failures have no candidate IR to inspect, even if a caller supplies a context.
  if (!compilation.ok || exhausted) return finish();
  const program = result.program;
  if (!program) { add(diagnostic('DSL_PROJECT_CONTEXT', 'Project checking requires a successfully compiled program.')); return finish(); }
  const type = own(context, 'type'), game = own(context, 'game'), version = own(context, 'version'), assets = own(context, 'assets');
  if (!record(context) || !text(type) || !text(game) || !text(version) || !Array.isArray(assets) || assets.length > 10_000) {
    add(diagnostic('DSL_PROJECT_CONTEXT', 'Project context requires type, game, version and at most 10000 catalog entries.')); return finish();
  }
  const catalog = new Map<string, AssetKind>();
  for (let index = 0; index < assets.length; index++) {
    const asset = own(assets, String(index)), id = own(asset, 'id'), kind = own(asset, 'kind');
    if (!record(asset) || !text(id) || id.length > 4096 || typeof kind !== 'string' || !kinds.has(kind as AssetKind) || catalog.has(id)) {
      add(diagnostic('DSL_PROJECT_CONTEXT', `Invalid or duplicate catalog entry at index ${index}.`)); return finish();
    }
    catalog.set(id, kind as AssetKind);
  }
  if (type !== 'script' || game !== program.game || version !== program.version) {
    const field = game !== program.game ? 'game' : version !== program.version ? 'version' : undefined;
    add(diagnostic('DSL_PROJECT_IDENTITY', 'Project type/game/version must match the compiled script candidate.', field ? location([field]) : fallback));
    return finish();
  }
  result.projectContext = { checked: true, game, version, assetCount: catalog.size };
  const cueLocations = new Map(result.sourceMap.filter(item => item.kind === 'cue').map(item => [JSON.stringify(item.path), item]));
  const check = (cue: StageCue | undefined, path: (string | number)[], blockId: string, lineId?: string) => {
    for (const [field, expected] of references) {
      if (exhausted) return;
      const assetId = cue?.[field]; if (assetId === undefined || assetId === null) continue;
      const actual = catalog.get(assetId); if (actual === expected) continue;
      const target = [...path, field], at = cueLocations.get(JSON.stringify(target));
      add({ ...diagnostic(actual === undefined ? 'DSL_ASSET_MISSING' : 'DSL_ASSET_KIND', actual === undefined
        ? `Asset is not declared in the project catalog: ${assetId}` : `Asset ${assetId} requires kind ${expected}; catalog kind is ${actual}.`, at),
        assetId, blockId, ...(lineId !== undefined ? { lineId } : {}), path: target,
        origin: { game: program.game, storyVersion: program.version, nodeId: blockId, ...(lineId !== undefined ? { lineId } : {}), assetId, path: ['program', ...target] } });
    }
  };
  for (const [index, block] of program.blocks.entries()) {
    check(block.cue, ['blocks', index, 'cue'], block.id);
    for (const [lineIndex, line] of block.lines.entries()) {
      if (exhausted) break;
      check(line.cue, ['blocks', index, 'lines', lineIndex, 'cue'], block.id, line.id);
    }
    if (exhausted) break;
  }
  return finish();
}
