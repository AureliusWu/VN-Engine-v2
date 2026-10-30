/** One author compile at a time. Importing this module touches no browser device. */
export function createTextCompileTask({
  createWorker = () => new Worker(new URL('./text-compile-worker.mjs', import.meta.url), { type: 'module' }),
  timeoutMs = 10000, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
  onResult = () => {}, onFailure = () => {}, onBusy = () => {}
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Compile timeout must be a positive integer');
  let sequence = 0, active, disposed = false, busy = false;
  const changeBusy = value => { if (busy !== value) { busy = value; onBusy(value); } };
  const cleanup = job => {
    if (!job) return;
    const timer = job.timer; job.timer = undefined;
    if (timer !== undefined) try { clearTimer(timer); } catch { /* Continue releasing the worker. */ }
    const worker = job.worker; job.worker = undefined;
    if (worker) {
      try { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; } catch { /* Still terminate it. */ }
      try { worker.terminate(); } catch { /* It may already have exited. */ }
    }
  };
  const current = job => !disposed && active === job && sequence === job.requestId;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const position = value => object(value) && Number.isSafeInteger(value.offset) && value.offset >= 0
    && Number.isSafeInteger(value.line) && value.line >= 1 && Number.isSafeInteger(value.column) && value.column >= 1;
  const span = value => object(value) && position(value.start) && position(value.end) && value.end.offset >= value.start.offset;
  const validResponse = message => {
    const result = message.result;
    return object(result) && typeof result.ok === 'boolean' && typeof message.syntaxOk === 'boolean'
      && Array.isArray(result.diagnostics) && Array.isArray(result.sourceMap)
      && typeof message.output === 'string' && message.output.length <= 100000
      && (!result.ok || (message.syntaxOk && object(result.program)))
      && (!message.syntaxOk || (object(message.identity) && typeof message.identity.game === 'string' && message.identity.game.length > 0
        && typeof message.identity.version === 'string' && message.identity.version.length > 0))
      // Validate the metadata the panel will display, without revalidating the IR.
      && result.diagnostics.every(item => object(item) && typeof item.code === 'string' && typeof item.message === 'string' && span(item.span))
      && result.sourceMap.slice(0, 200).every(item => object(item) && typeof item.kind === 'string' && typeof item.id === 'string' && span(item.span));
  };
  const finish = (job, result, failure) => {
    if (!current(job)) return;
    active = undefined; cleanup(job); changeBusy(false);
    // A busy-state consumer may synchronously start another request or close the panel.
    if (disposed || sequence !== job.requestId) return;
    if (failure) onFailure(failure instanceof Error ? failure : new Error(String(failure)));
    else onResult(result);
  };
  const cancel = () => {
    sequence++; const job = active; active = undefined; cleanup(job); changeBusy(false);
  };
  return {
    run({ source, fileName, projectContext }) {
      if (disposed) throw new Error('Compile task has been disposed');
      const requestId = ++sequence, previous = active; active = undefined; cleanup(previous);
      const job = { requestId, worker: undefined, timer: undefined }; active = job;
      try {
        changeBusy(true);
        if (!current(job)) return requestId;
        const worker = createWorker(); job.worker = worker;
        if (!current(job)) { cleanup(job); return requestId; }
        if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function') throw new Error('Compiler worker is unavailable');
        worker.onmessage = event => {
          if (!current(job) || job.worker !== worker || event.data?.requestId !== requestId) return;
          const message = event.data;
          if (typeof message.error === 'string') finish(job, undefined, new Error(message.error || 'Compiler worker failed'));
          else if (!validResponse(message)) finish(job, undefined, new Error('Invalid compiler worker response'));
          else finish(job, message);
        };
        worker.onerror = event => {
          if (!current(job) || job.worker !== worker) return;
          event.preventDefault?.();
          finish(job, undefined, event.error instanceof Error ? event.error : new Error(event.message || 'Compiler worker failed'));
        };
        worker.onmessageerror = () => {
          if (current(job) && job.worker === worker) finish(job, undefined, new Error('Compiler worker response could not be decoded'));
        };
        const timer = setTimer(() => finish(job, undefined, new Error('Compiler worker timed out')), timeoutMs);
        if (!current(job)) { try { clearTimer(timer); } catch {} return requestId; }
        job.timer = timer;
        worker.postMessage({ requestId, source, fileName, projectContext });
      } catch (error) { finish(job, undefined, error instanceof Error ? error : new Error(String(error))); }
      return requestId;
    },
    cancel,
    dispose() { if (!disposed) { disposed = true; cancel(); } },
    get busy() { return busy; }
  };
}
