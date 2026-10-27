import { mountGame, createRouteRecorder } from '../lib/index.js';
let mounted, hidden = false, currentRevision, recorder;
const reply = (type, detail = {}) => parent.postMessage({ source: 'vn-engine-preview', type, ...detail }, location.origin);
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.source !== 'vn-engine-studio') return;
  if (event.data.type === 'connect') { reply('ready'); return; }
  if (event.data.type === 'visibility' && typeof event.data.hidden === 'boolean') { hidden = event.data.hidden; mounted?.session.pause('native-host', hidden); return; }
  if (event.data.type === 'capture-replay') {
    try { if (!mounted || event.data.revision !== currentRevision) throw new Error('预览已更新，请重试'); reply('captured-replay', { revision: event.data.revision, saved: mounted.session.save() }); }
    catch (error) { reply('captured-replay', { revision: event.data.revision, error: error.message }); } return;
  }
  if(event.data.type==='capture-route'){
    try{if(!mounted||event.data.revision!==currentRevision||!recorder?.active)throw Error('当前没有有效录制，请从头录制');const test=recorder.finish(event.data.id);recorder=undefined;reply('captured-route',{revision:currentRevision,test});}
    catch(error){reply('captured-route',{revision:event.data.revision,error:error.message});}return;
  }
  if (event.data.type !== 'render') return;
  const { project, baseURL, urls, revision } = event.data;
  recorder?.dispose();recorder=undefined;mounted?.dispose(); mounted = undefined; document.getElementById('error').textContent = '';
  try {
    const recording=event.data.recordRoute===true;
    mounted = mountGame(document.getElementById('game'), recording?{...project,titleScreen:false,settings:{...project.settings,textDelayMs:0}}:project, { baseURL, storage: null, ...(recording?{audio:false}:{}), ...(urls ? { assetURL: path => urls[path] ?? new URL(path, baseURL).href } : {}) });
    if(recording)recorder=createRouteRecorder(mounted.session,project.type,message=>reply('recording-invalidated',{revision,message}));
    mounted.session.pause('native-host', hidden);
    currentRevision = revision;
    reply('rendered', { revision, recording });
  } catch (error) { document.getElementById('error').textContent = '预览未启动：' + error.message; reply('failed', { revision, message: error.message }); }
});
window.addEventListener('pagehide', () => {recorder?.dispose();mounted?.dispose();});
new ResizeObserver(() => { const height = document.getElementById('game').getBoundingClientRect().height; if (height > 100) reply('resize', { height: Math.ceil(height + 16) }); }).observe(document.getElementById('game'));
reply('ready');
