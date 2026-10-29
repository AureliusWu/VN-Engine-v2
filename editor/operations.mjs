/** Pending form text belongs to the workspace until it is committed or explicitly discarded. */
export function createFieldEdits({ scope, changed, error }) {
  const pending = new Map(), bindings = new Map(), committing = new Map();
  function notify() { changed(); }
  function bind(input, label, parent, callback) {
    const root = parent.closest('#project-fields,#inspector,#asset-list,#structure-list,#collection-list,#route-list,#production-list') ?? parent;
    const context = scope(root.id), index = [...root.querySelectorAll('[data-field-key]')].filter(node => node.getAttribute('aria-label') === label).length;
    const key = JSON.stringify([context, label, index]);
    const binding = { input, callback, baseline: input.value };
    bindings.set(key, binding); input.dataset.fieldKey = key;
    const previous = pending.get(key);
    if (previous) { binding.baseline = previous.baseline; input.value = previous.value; }
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      if (input.value === binding.baseline) pending.delete(key);
      else pending.set(key, { key, baseline: binding.baseline, value: input.value });
      notify();
    });
    input.addEventListener('change', () => {
      if (!input.isConnected) return;
      if (!pending.has(key) && input.value !== binding.baseline)
        pending.set(key, { key, baseline: binding.baseline, value: input.value });
      // Earlier invalid text must be repaired before an identity edit can rebuild its controls.
      try { flush()?.catch(error); } catch (failure) { error(failure); }
    });
  }
  function commit(key) {
    if (committing.has(key)) return committing.get(key);
    const edit = pending.get(key), binding = bindings.get(key);
    // Select controls can emit change without input in some hosts.
    if (!edit && binding?.input.isConnected && binding.input.value !== binding.baseline)
      pending.set(key, { key, baseline: binding.baseline, value: binding.input.value });
    const current = pending.get(key);
    if (!current) return;
    if (!binding?.input.isConnected) throw Error('尚有未提交的字段，请返回原编辑面板修正后保存');
    // A synchronous edit can replace the focused DOM node and emit change again.
    committing.set(key, null);
    const complete = () => {
      if (pending.get(key) === current) pending.delete(key);
      const latest = bindings.get(key);
      if (latest) { latest.baseline = latest.input.value; latest.input.removeAttribute('aria-invalid'); }
    };
    const reject = failure => {
      if (!pending.has(key)) pending.set(key, current);
      const latest = bindings.get(key);
      if (latest) { latest.input.value = pending.get(key).value; latest.input.setAttribute('aria-invalid', 'true'); }
      throw failure;
    };
    try {
      const result = binding.callback(current.value);
      if (result?.then) {
        const job = Promise.resolve(result).then(complete, reject).finally(() => { committing.delete(key); notify(); });
        committing.set(key, job); return job;
      }
      complete();
    } catch (failure) { reject(failure); }
    finally { if (committing.get(key) === null) { committing.delete(key); notify(); } }
  }
  function flush() {
    if (committing.size) {
      const jobs = [...committing.values()].filter(Boolean);
      return jobs.length ? Promise.all(jobs).then(flush) : undefined;
    }
    for (const key of [...pending.keys()]) {
      const job = commit(key);
      if (job) return job.then(flush);
    }
  }
  return {
    bind, flush,
    get dirty() { return pending.size > 0; },
    snapshot() { return [...pending.values()].map(item => ({ ...item })); },
    restore(items) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item.key !== 'string' || typeof item.value !== 'string' || typeof item.baseline !== 'string') continue;
        pending.set(item.key, { key: item.key, value: item.value, baseline: item.baseline });
        const binding = bindings.get(item.key);
        if (binding) { binding.baseline = item.baseline; binding.input.value = item.value; }
      }
      notify();
    },
    reset() { pending.clear(); bindings.clear(); committing.clear(); }
  };
}

/** Later opens and edits invalidate an in-flight replacement; current data always wins. */
export function createOpenGate({ version, cancelled }) {
  let sequence = 0;
  return {
    invalidate() { sequence++; },
    begin() {
      const request = ++sequence, initial = version();
      return {
        commit(replace) {
          if (request !== sequence) return false;
          if (initial !== version()) { cancelled(); return false; }
          replace(); return true;
        }
      };
    }
  };
}
