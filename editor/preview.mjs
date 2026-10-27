import { mountGame } from '../lib/index.js';
let mounted, hidden = false, currentRevision;
const reply = (type, detail = {}) => parent.postMessage({ source: 'vn-engine-preview', type, ...detail }, location.origin);
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.source !== 'vn-engine-studio') return;
  if (event.data.type === 'connect') { reply('ready'); return; }
  if (event.data.type === 'visibility' && typeof event.data.hidden === 'boolean') { hidden = event.data.hidden; mounted?.session.pause('native-host', hidden); return; }
  if (event.data.type === 'capture-replay') {
    try { if (!mounted || event.data.revision !== currentRevision) throw new Error('预览已更新，请重试'); reply('captured-replay', { revision: event.data.revision, saved: mounted.session.save() }); }
    catch (error) { reply('captured-replay', { revision: event.data.revision, error: error.message }); } return;
  }
  if (event.data.type !== 'render') return;
  const { project, baseURL, urls, revision } = event.data;
  mounted?.dispose(); mounted = undefined; document.getElementById('error').textContent = '';
  try {
    mounted = mountGame(document.getElementById('game'), project, { baseURL, storage: null, ...(urls ? { assetURL: path => urls[path] ?? new URL(path, baseURL).href } : {}) });
    mounted.session.pause('native-host', hidden);
    currentRevision = revision;
    reply('rendered', { revision });
  } catch (error) { document.getElementById('error').textContent = '预览未启动：' + error.message; reply('failed', { revision, message: error.message }); }
});
window.addEventListener('pagehide', () => mounted?.dispose());
new ResizeObserver(() => { const height = document.getElementById('game').getBoundingClientRect().height; if (height > 100) reply('resize', { height: Math.ceil(height + 16) }); }).observe(document.getElementById('game'));
reply('ready');
