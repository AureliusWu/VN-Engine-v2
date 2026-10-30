import { compileTextScript, checkTextScriptProject } from '../lib/script/text.js';

/** The worker owns parsing, context validation and full JSON formatting. No host IO. */
self.onmessage = event => {
  const { requestId, source, fileName, projectContext } = event.data ?? {};
  if (!Number.isSafeInteger(requestId) || requestId < 1) return;
  try {
    const syntax = compileTextScript(source, { fileName });
    const checked = projectContext === undefined ? syntax : checkTextScriptProject(syntax, projectContext);
    const identity = syntax.program ? { game: syntax.program.game, version: syntax.program.version } : undefined;
    const formatted = checked.ok && checked.program ? JSON.stringify(checked.program, null, 2) : '';
    const marker = '\n…预览已截断';
    const output = formatted.length > 100000 ? formatted.slice(0, 100000 - marker.length) + marker : formatted;
    self.postMessage({ requestId, result: checked, syntaxOk: syntax.ok, ...(identity ? { identity } : {}), output });
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
  }
};
