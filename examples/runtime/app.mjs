import { mountGame, ENGINE_VERSION } from './lib/index.js';

const root = document.getElementById('game'), error = document.getElementById('error');
document.getElementById('engine-version').textContent = 'v' + ENGINE_VERSION;
let current, generation = 0;
async function select(name) {
  const visit = ++generation;
  try {
    const response = await fetch(`./${name}.json`);
    if (!response.ok) throw new Error('样例项目未能载入');
    const project = await response.json(); if (visit !== generation) return;
    current?.dispose(); error.hidden = true;
    current = mountGame(root, project, { baseURL: new URL('./', location.href) });
    document.querySelectorAll('[data-project]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.project === name)));
    // A development sample exposes its instance for regression inspection.
    globalThis.vnDemo = current;
  } catch (failure) { if (visit !== generation) return; error.hidden = false; error.textContent = failure.message; }
}
document.querySelectorAll('[data-project]').forEach(button => button.addEventListener('click', () => { void select(button.dataset.project); }));
await select('campus');
window.addEventListener('pagehide', event => { if (!event.persisted) current?.dispose(); });
const offline = document.getElementById('offline-state');
if ('serviceWorker' in navigator) {
  try {
    const owner = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    const show = () => { offline.textContent = owner.active?.state === 'activated' ? '可离线游玩' : '正在准备离线资源'; };
    (owner.installing ?? owner.waiting ?? owner.active)?.addEventListener('statechange', show); show();
  } catch { offline.textContent = '离线下载未完成，联网后重试'; }
} else offline.textContent = '当前浏览器未启用离线缓存';
