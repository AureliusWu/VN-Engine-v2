import { ScriptEngine } from './engine.js';
import type { Condition, Effect, Scalar, ScriptBlock, ScriptChoice, ScriptLine, ScriptProgram, Variable } from './types.js';

export const TEXT_SCRIPT_FORMAT = 'vn-script-text-v1' as const;
export type TextScriptPosition = { offset: number; line: number; column: number };
/** UTF-16 offsets, one-based line/column, exclusive end; CRLF is one line break. */
export type TextScriptSpan = { start: TextScriptPosition; end: TextScriptPosition };
type Identity = { blockId?: string; lineId?: string; choiceId?: string };
export type TextScriptDiagnostic = Identity & {
  code: string; severity: 'error' | 'warning'; message: string; span: TextScriptSpan;
  fileName?: string; path?: (string | number)[];
};
/** Paths are relative to ScriptProgram, not an enclosing EngineProject. */
export type TextScriptSourceMapEntry = Identity & {
  kind: 'program' | 'variable' | 'block' | 'line' | 'choice' | 'exit' | 'route' | 'effect';
  id: string; path: (string | number)[]; span: TextScriptSpan; fileName?: string;
};
export type TextScriptOptions = {
  fileName?: string; maxSourceLength?: number; maxTokens?: number; maxStringLength?: number;
  maxBlocks?: number; maxLines?: number; maxChoices?: number; maxVariables?: number; maxDiagnostics?: number;
};
export type TextScriptCompilation = {
  ok: boolean; program?: ScriptProgram; diagnostics: TextScriptDiagnostic[]; sourceMap: TextScriptSourceMapEntry[];
};
type Token = { kind: 'atom' | 'string' | 'symbol' | 'newline'; value: string; span: TextScriptSpan };
type DraftExit = { type: 'jump'; next: string } | { type: 'choice'; choices: ScriptChoice[] }
  | { type: 'branch'; routes: { when?: Condition; next: string }[] } | { type: 'end'; ending: string };
type DraftBlock = { id: string; title?: string; lines: ScriptLine[]; exit?: DraftExit;
  path: (string | number)[]; span: TextScriptSpan; map: TextScriptSourceMapEntry; choices: Set<string> };
type Reference = Identity & { target: string; path: (string | number)[]; span: TextScriptSpan; from?: string };
const limits = { maxSourceLength: 1_000_000, maxTokens: 100_000, maxStringLength: 200_000,
  maxBlocks: 10_000, maxLines: 30_000, maxChoices: 30_000, maxVariables: 1_000, maxDiagnostics: 100 };
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const identifierPattern = /^[\p{L}_][\p{L}\p{N}_.:/-]*$/u;
const zero = (): TextScriptPosition => ({ offset: 0, line: 1, column: 1 });

/**
 * Optional, data-only author frontend. Commands end at newlines; indentation has no meaning.
 * JSON strings support escapes; triple double quotes contain literal multiline text.
 * # and // introduce comments outside strings. IDs are explicit bare identifiers or strings.
 * IDs are limited to 256 UTF-16 units; fileName metadata is limited to 4096 units.
 *
 * vn-script 1 / game "id" / version "1" / entry start
 * var trust number 0 min 0 max 10 / var consent boolean false
 * block start "Optional title" / line hello "Speaker" "Text" [medium chat|call]
 * choice yes "Continue" -> route with add trust 2, set consent true
 * block route / branch / when trust >= 2 && consent == true -> good / else -> other
 * block good / line done "Speaker" "Done" / end good
 *
 * Only choice-owned effects are accepted. No IO, host code, expressions or new VM instructions.
 * The output is ordinary schema-1 ScriptProgram; text/maps never enter runtime saves.
 */
export function compileTextScript(source: string, options: TextScriptOptions = {}): TextScriptCompilation {
  const diagnostics: TextScriptDiagnostic[] = [], sourceMap: TextScriptSourceMapEntry[] = [];
  const configured = { ...limits };
  let halted = false, diagnosticsFull = false;
  const file = typeof options?.fileName === 'string' && options.fileName.length <= 4096 ? { fileName: options.fileName } : {};
  const report = (code: string, message: string, span: TextScriptSpan, extra: Identity & {
    path?: (string | number)[]; severity?: 'error' | 'warning'
  } = {}) => {
    if (diagnosticsFull) return;
    if (diagnostics.length >= configured.maxDiagnostics - 1) {
      diagnostics.push({ code: 'DSL_DIAGNOSTIC_BUDGET', severity: 'error', message: 'Diagnostic budget reached; repair errors and compile again.', span, ...file });
      diagnosticsFull = true; halted = true; return;
    }
    diagnostics.push({ code, severity: 'error', message, span, ...file, ...extra });
  };
  const emptySpan = { start: zero(), end: zero() };
  if (options === null || typeof options !== 'object' || (options.fileName !== undefined && (typeof options.fileName !== 'string' || options.fileName.length > 4096))) {
    report('DSL_OPTIONS', 'Compiler options must be data with an optional fileName string of at most 4096 UTF-16 units.', emptySpan);
    return { ok: false, diagnostics, sourceMap };
  }
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = options[key];
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 1 || value > limits[key]) {
        report('DSL_OPTIONS', `${key} must be an integer from 1 to ${limits[key]}.`, emptySpan);
        return { ok: false, diagnostics, sourceMap };
      }
      configured[key] = value;
    }
  }
  if (typeof source !== 'string' || source.length > configured.maxSourceLength) {
    report('DSL_SOURCE_BUDGET', `Source must be text within ${configured.maxSourceLength} UTF-16 code units.`, emptySpan);
    return { ok: false, diagnostics, sourceMap };
  }

  // Scan once. The scanner never backtracks and retains at most maxTokens bounded tokens.
  const tokens: Token[] = [];
  let offset = 0, line = 1, column = 1;
  const position = (): TextScriptPosition => ({ offset, line, column });
  const step = () => {
    if (source[offset] === '\r') { offset++; if (source[offset] === '\n') offset++; line++; column = 1; }
    else if (source[offset] === '\n') { offset++; line++; column = 1; }
    else { offset++; column++; }
  };
  const push = (kind: Token['kind'], value: string, start: TextScriptPosition) => {
    const span = { start, end: position() };
    if (tokens.length >= configured.maxTokens) { report('DSL_TOKEN_BUDGET', 'Token budget exceeded.', span); halted = true; }
    else tokens.push({ kind, value, span });
  };
  while (offset < source.length && !halted) {
    const ch = source[offset], start = position();
    if (ch === '\n' || ch === '\r') { step(); push('newline', '\n', start); continue; }
    if (/\s/.test(ch) || (offset === 0 && ch === '\uFEFF')) { step(); continue; }
    if (ch === '#' || source.startsWith('//', offset)) {
      while (offset < source.length && source[offset] !== '\n' && source[offset] !== '\r') step();
      continue;
    }
    if (ch === '"') {
      const triple = source.startsWith('"""', offset);
      if (triple) { step(); step(); step(); } else step();
      const contentStart = offset;
      let closed = false;
      while (offset < source.length) {
        if (triple ? source.startsWith('"""', offset) : source[offset] === '"') { closed = true; break; }
        if (!triple && (source[offset] === '\n' || source[offset] === '\r')) break;
        if (!triple && source[offset] === '\\') { step(); if (offset < source.length && source[offset] !== '\n' && source[offset] !== '\r') step(); }
        else step();
        if (offset - contentStart > configured.maxStringLength) {
          report('DSL_STRING_BUDGET', 'String length budget exceeded.', { start, end: position() }); halted = true; break;
        }
      }
      if (halted) break;
      const contentEnd = offset;
      if (!closed) { report('DSL_STRING_UNTERMINATED', 'Unterminated string.', { start, end: position() }); continue; }
      if (triple) { step(); step(); step(); push('string', source.slice(contentStart, contentEnd), start); }
      else {
        step();
        try { push('string', JSON.parse(source.slice(start.offset, offset)) as string, start); }
        catch { report('DSL_STRING_ESCAPE', 'String must use valid JSON escapes.', { start, end: position() }); }
      }
      continue;
    }
    const symbol = ['->', '>=', '==', '&&', ','].find(item => source.startsWith(item, offset));
    if (symbol) { for (let count = 0; count < symbol.length; count++) step(); push('symbol', symbol, start); continue; }
    while (offset < source.length && !/[\s",#]/.test(source[offset]) && !source.startsWith('//', offset)
      && !['->', '>=', '==', '&&'].some(item => source.startsWith(item, offset))) step();
    if (offset === start.offset) step();
    push('atom', source.slice(start.offset, offset), start);
  }
  if (halted) return { ok: false, diagnostics, sourceMap };

  const program: ScriptProgram = { schema: 1, game: '', version: '', entry: '', variables: {}, blocks: [] };
  const blocks: DraftBlock[] = [], blockIds = new Set<string>(), lineIds = new Set<string>(), references: Reference[] = [];
  const semanticChecks: (() => void)[] = [];
  const declarations = new Set<string>();
  let current: DraftBlock | undefined, lineCount = 0, choiceCount = 0, variableCount = 0;
  let header = false;
  const map = (kind: TextScriptSourceMapEntry['kind'], id: string, path: (string | number)[], span: TextScriptSpan, identity: Identity = {}) => {
    const entry: TextScriptSourceMapEntry = { kind, id, path, span, ...file, ...identity };
    sourceMap.push(entry); return entry;
  };
  const identity = (): Identity => current ? { blockId: current.id } : {};
  const budget = (ok: boolean, code: string, span: TextScriptSpan) => {
    if (!ok) { report(code, 'Compiler structure budget exceeded.', span, identity()); halted = true; }
  };
  const checkScalar = (key: string, value: Scalar, span: TextScriptSpan, path: (string | number)[], numericOnly = false, bounds = false) => {
    const variable = program.variables[key];
    if (!Object.hasOwn(program.variables, key)) report('DSL_UNKNOWN_VARIABLE', `Unknown variable: ${key}`, span, { path });
    else if (typeof value !== typeof variable.initial || (numericOnly && typeof variable.initial !== 'number')) {
      report('DSL_VARIABLE_TYPE', `Value does not match declared variable: ${key}`, span, { path });
    } else if (bounds && typeof value === 'number' && ((variable.min !== undefined && value < variable.min) || (variable.max !== undefined && value > variable.max))) {
      report('DSL_VARIABLE_BOUNDS', `Value is outside declared bounds: ${key}`, span, { path });
    }
  };
  const parse = (command: Token[]) => {
    const first = command[0], span = { start: first.span.start, end: command.at(-1)!.span.end };
    let cursor = 1, failed = false;
    let context: Identity & { path?: (string | number)[] } = { ...identity(), ...(current ? { path: current.path } : {}) };
    const syntax = (message: string, code = 'DSL_SYNTAX', at = command[cursor]?.span ?? span) => {
      report(code, message, at, context); failed = true;
    };
    const take = (value: string) => command[cursor]?.value === value && command[cursor]?.kind !== 'string' ? (cursor++, true) : false;
    const expect = (value: string) => { if (!take(value)) syntax(`Expected ${value}.`); };
    const id = (label = 'ID'): string => {
      const token = command[cursor++];
      if (!token || (token.kind !== 'string' && (token.kind !== 'atom' || !identifierPattern.test(token.value))) || !token.value.trim()) {
        syntax(`Explicit ${label} is required.`, 'DSL_ID_REQUIRED', token?.span ?? span); return '';
      }
      if (token.value.length > 256) { syntax(`${label} exceeds 256 UTF-16 units.`, 'DSL_ID_BUDGET', token.span); return ''; }
      return token.value;
    };
    const text = (label: string): string => {
      const token = command[cursor++];
      if (token?.kind !== 'string') { syntax(`${label} must be a quoted string.`, 'DSL_STRING_REQUIRED', token?.span ?? span); return ''; }
      return token.value;
    };
    const scalar = (): Scalar => {
      const token = command[cursor++];
      if (token?.kind === 'atom') {
        if (token.value === 'true' || token.value === 'false') return token.value === 'true';
        if (numberPattern.test(token.value) && Number.isFinite(Number(token.value))) return Number(token.value);
      }
      syntax('Expected a finite JSON number or true/false.', 'DSL_SCALAR', token?.span ?? span); return false;
    };
    const numeric = (): number => {
      const value = scalar();
      if (typeof value !== 'number') { syntax('Expected a finite number.', 'DSL_NUMBER'); return 0; }
      return value;
    };
    const done = () => { if (cursor < command.length) syntax('Unexpected trailing tokens.'); return !failed; };
    const block = () => { if (!current) syntax('Command requires a block.', 'DSL_BLOCK_REQUIRED'); return current; };
    const beginExit = (type: DraftExit['type'], repeat = false): DraftBlock | undefined => {
      const owner = block();
      if (owner?.exit && (!repeat || owner.exit.type !== type)) syntax('Block has more than one exit.', 'DSL_DUPLICATE_EXIT');
      return owner;
    };
    if (first.kind !== 'atom') { syntax('Expected a command.', 'DSL_UNKNOWN_COMMAND', first.span); return; }
    if (!header && first.value !== 'vn-script') syntax('First command must be vn-script 1.', 'DSL_HEADER', first.span);
    switch (first.value) {
      case 'vn-script': {
        expect('1');
        if (header || blocks.length || declarations.size) syntax('Duplicate or misplaced vn-script header.', 'DSL_HEADER');
        if (done()) { header = true; map('program', TEXT_SCRIPT_FORMAT, [], span); } break;
      }
      case 'game': case 'version': case 'entry': {
        const key = first.value;
        context = { path: [key] };
        const value = key === 'entry' ? id('entry block ID') : text(key);
        if (!value.trim()) syntax(`${key} cannot be empty.`, 'DSL_METADATA');
        if (current || declarations.has(key)) syntax(`Duplicate or misplaced ${key}.`, 'DSL_METADATA');
        if (done()) {
          program[key] = value; declarations.add(key); map('program', key, [key], span);
          if (key === 'entry') references.push({ target: value, path: ['entry'], span });
        } break;
      }
      case 'var': {
        const key = id('variable name'), type = command[cursor++]?.value;
        context = { path: ['variables', key] };
        const initial = scalar(), definition: Variable = { initial };
        if (type !== 'number' && type !== 'boolean') syntax('Variable type must be number or boolean.', 'DSL_VARIABLE_TYPE');
        if (typeof initial !== type) syntax('Initial value must match the declared type.', 'DSL_VARIABLE_TYPE');
        while (cursor < command.length && !failed) {
          const bound = command[cursor++]?.value;
          if (bound !== 'min' && bound !== 'max') { syntax('Expected min or max bound.'); break; }
          if (Object.hasOwn(definition, bound) || type !== 'number') syntax('Bounds must be unique and numeric.', 'DSL_VARIABLE_BOUNDS');
          definition[bound] = numeric();
        }
        if (forbidden.has(key)) syntax('Reserved variable name.', 'DSL_RESERVED_VARIABLE');
        if (current) syntax('Variables must precede blocks.', 'DSL_DECLARATION_ORDER');
        if (Object.hasOwn(program.variables, key)) syntax('Duplicate variable.', 'DSL_DUPLICATE_VARIABLE');
        if (typeof initial === 'number' && ((definition.min !== undefined && initial < definition.min) || (definition.max !== undefined && initial > definition.max)
          || (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max))) syntax('Invalid variable bounds or initial value.', 'DSL_VARIABLE_BOUNDS');
        if (done()) {
          budget(++variableCount <= configured.maxVariables, 'DSL_VARIABLE_BUDGET', span);
          if (!halted) { program.variables[key] = definition; map('variable', key, ['variables', key], span); }
        } break;
      }
      case 'block': {
        const name = id('block ID'), title = cursor < command.length ? text('Block title') : undefined;
        context = { blockId: name, path: ['blocks', blocks.length] };
        if (blockIds.has(name)) syntax(`Duplicate block ID: ${name}`, 'DSL_DUPLICATE_BLOCK');
        if (done()) {
          if (current) current.map.span.end = first.span.start;
          budget(blocks.length < configured.maxBlocks, 'DSL_BLOCK_BUDGET', span);
          if (halted) break;
          const path = ['blocks', blocks.length], entry = map('block', name, path, { ...span }, { blockId: name });
          current = { id: name, ...(title !== undefined ? { title } : {}), lines: [], path, span, map: entry, choices: new Set() };
          blocks.push(current); blockIds.add(name);
        } break;
      }
      case 'line': {
        const owner = block(), name = id('line ID'), speaker = text('Speaker'), value = text('Dialogue');
        context = { ...(owner ? { blockId: owner.id, path: [...owner.path, 'lines', owner.lines.length] } : {}), lineId: name };
        let medium: 'chat' | 'call' | undefined;
        if (take('medium')) { const token = command[cursor++]; if (token?.value === 'chat' || token?.value === 'call') medium = token.value; else syntax('Medium must be chat or call.'); }
        if (lineIds.has(name)) syntax(`Duplicate line ID: ${name}`, 'DSL_DUPLICATE_LINE');
        if (!speaker.trim() || !value.trim()) syntax('Speaker and dialogue must be nonempty.', 'DSL_EMPTY_DIALOGUE');
        if (owner?.exit) syntax('Dialogue must precede the block exit.', 'DSL_LINE_AFTER_EXIT');
        if (done() && owner) {
          budget(++lineCount <= configured.maxLines, 'DSL_LINE_BUDGET', span);
          if (halted) break;
          const path = [...owner.path, 'lines', owner.lines.length];
          owner.lines.push({ id: name, speaker, text: value, ...(medium ? { medium } : {}) }); lineIds.add(name);
          map('line', name, path, span, { blockId: owner.id, lineId: name });
        } break;
      }
      case 'choice': {
        const owner = beginExit('choice', true), name = id('choice ID'), label = text('Choice text'); expect('->'); const target = id('target block ID');
        context = { ...(owner ? { blockId: owner.id, path: [...owner.path, 'exit', 'choices', owner.choices.size] } : {}), choiceId: name };
        const effects: { effect: Effect; span: TextScriptSpan }[] = [];
        if (take('with')) {
          do {
            const start = command[cursor]?.span.start ?? span.end, op = command[cursor++]?.value, key = id('effect variable'), value = scalar();
            if (op !== 'add' && op !== 'set') syntax('Choice effect must be add or set.', 'DSL_EFFECT');
            else if (op === 'add' && typeof value !== 'number') syntax('add requires a number.', 'DSL_EFFECT');
            else effects.push({ effect: op === 'add' ? { op, key, value: value as number } : { op, key, value }, span: { start, end: command[cursor - 1]?.span.end ?? span.end } });
          } while (!failed && take(','));
        }
        if (!label.trim()) syntax('Choice text must be nonempty.', 'DSL_EMPTY_CHOICE');
        if (owner?.choices.has(name)) syntax(`Duplicate choice ID in block: ${name}`, 'DSL_DUPLICATE_CHOICE');
        if (done() && owner) {
          budget(++choiceCount <= configured.maxChoices, 'DSL_CHOICE_BUDGET', span);
          if (halted) break;
          if (!owner.exit) { owner.exit = { type: 'choice', choices: [] }; map('exit', owner.id, [...owner.path, 'exit'], span, { blockId: owner.id }); }
          if (owner.exit.type !== 'choice') break;
          const path = [...owner.path, 'exit', 'choices', owner.exit.choices.length], ids = { blockId: owner.id, choiceId: name };
          owner.exit.choices.push({ id: name, text: label, next: target, ...(effects.length ? { effects: effects.map(item => item.effect) } : {}) }); owner.choices.add(name);
          map('choice', name, path, span, ids); references.push({ target, path: [...path, 'next'], span, from: owner.id, ...ids });
          effects.forEach(({ effect, span: effectSpan }, index) => {
            const effectPath = [...path, 'effects', index]; map('effect', `${name}/effect/${index}`, effectPath, effectSpan, ids);
            semanticChecks.push(() => checkScalar(effect.key, effect.value, effectSpan, effectPath, effect.op === 'add', effect.op === 'set'));
          });
        } break;
      }
      case 'jump': case 'end': {
        const owner = beginExit(first.value), value = id(first.value === 'jump' ? 'target block ID' : 'ending ID');
        if (done() && owner) {
          owner.exit = first.value === 'jump' ? { type: 'jump', next: value } : { type: 'end', ending: value };
          const path = [...owner.path, 'exit']; map('exit', owner.id, path, span, { blockId: owner.id });
          if (first.value === 'jump') references.push({ target: value, path: [...path, 'next'], span, from: owner.id, blockId: owner.id });
        } break;
      }
      case 'branch': {
        const owner = beginExit('branch');
        if (done() && owner) { owner.exit = { type: 'branch', routes: [] }; map('exit', owner.id, [...owner.path, 'exit'], span, { blockId: owner.id }); } break;
      }
      case 'when': case 'else': {
        const owner = block(), when: Condition = {}, checks: { key: string; value: Scalar; numeric: boolean }[] = [];
        if (owner?.exit?.type !== 'branch') syntax('Routes require a preceding branch command.', 'DSL_BRANCH_REQUIRED');
        if (first.value === 'when') {
          do {
            const key = id('condition variable'), op = command[cursor++]?.value, value = scalar();
            if (op !== '>=' && op !== '==') syntax('Condition operator must be >= or ==.', 'DSL_CONDITION');
            if (forbidden.has(key)) syntax('Reserved variable name.', 'DSL_RESERVED_VARIABLE');
            if (op === '>=' && typeof value !== 'number') syntax('>= requires a number.', 'DSL_CONDITION');
            const previous = when[key];
            if (previous && typeof previous !== 'object') syntax('Duplicate condition.', 'DSL_CONDITION');
            const rule = typeof previous === 'object' ? previous : {};
            const field = op === '>=' ? 'gte' : 'eq';
            if (Object.hasOwn(rule, field)) syntax('Duplicate condition operator.', 'DSL_CONDITION');
            if (!forbidden.has(key)) when[key] = { ...rule, [field]: value };
            checks.push({ key, value, numeric: op === '>=' });
          } while (!failed && take('&&'));
        }
        expect('->'); const target = id('target block ID');
        if (done() && owner?.exit?.type === 'branch') {
          const routes = owner.exit.routes;
          if (routes.length && !routes.at(-1)!.when) { syntax('Fallback must be the final route.', 'DSL_BRANCH_FALLBACK'); break; }
          const path = [...owner.path, 'exit', 'routes', routes.length];
          routes.push(first.value === 'when' ? { when, next: target } : { next: target });
          map('route', `${owner.id}/route/${routes.length - 1}`, path, span, { blockId: owner.id });
          references.push({ target, path: [...path, 'next'], span, from: owner.id, blockId: owner.id });
          checks.forEach(check => semanticChecks.push(() => checkScalar(check.key, check.value, span, [...path, 'when', check.key], check.numeric)));
        } break;
      }
      default: syntax(`Unknown command: ${first.value}`, 'DSL_UNKNOWN_COMMAND', first.span);
    }
  };
  let command: Token[] = [];
  for (const token of tokens) {
    if (halted) break;
    if (token.kind === 'newline') { if (command.length) parse(command); command = []; }
    else command.push(token);
  }
  if (!halted && command.length) parse(command);
  const eof = position(), eofSpan = { start: eof, end: eof };
  if (current) current.map.span.end = eof;
  if (!header) report('DSL_HEADER', 'Missing vn-script 1 header.', eofSpan);
  for (const key of ['game', 'version', 'entry']) if (!declarations.has(key)) report('DSL_METADATA', `Missing ${key}.`, eofSpan, { path: [key] });
  if (!blocks.length) report('DSL_BLOCK_REQUIRED', 'At least one block is required.', eofSpan, { path: ['blocks'] });
  for (const owner of blocks) {
    const extra = { path: [...owner.path, 'exit'], blockId: owner.id };
    if (!owner.exit) report('DSL_EXIT_REQUIRED', 'Every block requires an explicit exit.', owner.span, extra);
    else if (!owner.lines.length && !['jump', 'branch'].includes(owner.exit.type)) report('DSL_EMPTY_BLOCK', 'Only jump/branch routing blocks may omit dialogue.', owner.span, extra);
    else if (owner.exit.type === 'branch' && (!owner.exit.routes.length || owner.exit.routes.at(-1)!.when)) report('DSL_BRANCH_FALLBACK', 'Branch requires routes and a final else fallback.', owner.span, extra);
  }
  for (const reference of references) if (!blockIds.has(reference.target)) {
    report('DSL_UNKNOWN_TARGET', `Unknown block target: ${reference.target}`, reference.span, {
      path: reference.path, ...(reference.blockId ? { blockId: reference.blockId } : {}), ...(reference.choiceId ? { choiceId: reference.choiceId } : {})
    });
  }
  for (const check of semanticChecks) { if (halted) break; check(); }
  // Reachability is structural (all authored branch/choice edges), not a claim of playable coverage.
  if (!diagnostics.some(item => item.severity === 'error')) {
    const edges = new Map<string, string[]>();
    for (const reference of references) if (reference.from) {
      const bucket = edges.get(reference.from); if (bucket) bucket.push(reference.target); else edges.set(reference.from, [reference.target]);
    }
    const reachable = new Set<string>(), queue = [program.entry];
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]; if (reachable.has(node)) continue; reachable.add(node);
      for (const next of edges.get(node) ?? []) if (!reachable.has(next)) queue.push(next);
    }
    for (const owner of blocks) if (!reachable.has(owner.id)) report('DSL_UNREACHABLE_BLOCK', `Block is structurally unreachable from entry: ${owner.id}`, owner.span,
      { severity: 'warning', path: owner.path, blockId: owner.id });
  }
  if (halted || diagnostics.some(item => item.severity === 'error')) return { ok: false, diagnostics, sourceMap };
  program.blocks = blocks.map(owner => ({ id: owner.id, ...(owner.title !== undefined ? { title: owner.title } : {}), lines: owner.lines, exit: owner.exit! } as ScriptBlock));
  try { new ScriptEngine(program); }
  catch (error) {
    report('DSL_PROGRAM_INVALID', error instanceof Error ? error.message : 'Existing ScriptEngine rejected the lowered program.', eofSpan);
    return { ok: false, diagnostics, sourceMap };
  }
  return { ok: true, program, diagnostics, sourceMap };
}
