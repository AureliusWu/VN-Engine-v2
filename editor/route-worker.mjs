import {runRouteSuite,ENGINE_VERSION} from '../lib/index.js';
self.onmessage=async event=>{
  const {requestId,source}=event.data??{};
  try{
    if(typeof source!=='string'||source.length>20_000_000)throw Error('工程过大或无效');
    const report=runRouteSuite(JSON.parse(source));
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
    self.postMessage({requestId,report:{...report,engine:ENGINE_VERSION,sourceSha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}});
  }catch(error){self.postMessage({requestId,report:{status:'FAIL',error:error.message,cases:[],coverage:{missing:[]}}});}
};
