const pending = new Map(); let sequence = 0;
export const nativeHost = !!globalThis.chrome?.webview;
if (nativeHost) chrome.webview.addEventListener('message', event => {
  const message = event.data, job = pending.get(message?.id); if (!job) return;
  clearTimeout(job.timer); pending.delete(message.id);
  if (message.ok) job.resolve(message.result); else job.reject(new Error(message.error ?? '桌面操作未完成'));
});
export function nativeRequest(command, args = {}) {
  if (!nativeHost) return Promise.reject(new Error('当前不在 Windows 宿主中'));
  const id = 'studio-' + (++sequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('桌面操作等待超时，工程仍保留')); }, 300000);
    pending.set(id, { resolve, reject, timer }); chrome.webview.postMessage({ id, command, ...args });
  });
}
