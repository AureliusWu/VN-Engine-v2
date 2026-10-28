import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AGENT_LIMITS,AgentError} from '../dist/agent/index.js';
import {probeAssets} from './probe-assets.mjs';
import {importAssetPath,IMPORT_EXTENSIONS} from './agent-imports.mjs';
import {commitIdentity} from './agent-ports.mjs';
const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',woff2:'font/woff2',webm:'video/webm',mp4:'video/mp4',txt:'text/plain'};
// Container rate is separate from Web Audio's explicitly resampled analysis rate.
function waveFacts(bytes){
 if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')return;
 for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4);if(offset+8+size>bytes.length)return;
  if(bytes.toString('ascii',offset,offset+4)==='fmt '&&size>=16)return{format:'WAVE',encoding:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),sampleRate:bytes.readUInt32LE(offset+12),bitsPerSample:bytes.readUInt16LE(offset+22)};
  offset+=8+size+(size%2);
 }
}
export async function probeAgentFiles(request){
 const files=[],inputs=[],diagnostics=[],ids=new Set();let total=0;
 for(const [index,spec]of request.params.files.entries()){
  if(ids.has(spec.id))throw new AgentError('INVALID_REQUEST','Probe file IDs must be unique',{path:['params','files',index,'id']});ids.add(spec.id);
  try{
   const file=await fs.realpath(path.resolve(spec.file)),stat=await fs.stat(file);if(!stat.isFile())throw new AgentError('MEDIA_UNREADABLE','Probe input must be a file');
   if(stat.size>AGENT_LIMITS.assetBytes||total+stat.size>AGENT_LIMITS.assetTotalBytes)throw new AgentError('BUDGET_EXCEEDED','Probe byte budget exceeded',{},'UNVERIFIED');
   const bytes=await fs.readFile(file);total+=bytes.length;const sha256=createHash('sha256').update(bytes).digest('hex'),extension=path.extname(file).slice(1).toLowerCase();
   const entry={id:spec.id,file,kind:spec.kind,bytes:bytes.length,sha256,extension,assetPath:IMPORT_EXTENSIONS.includes(extension)?importAssetPath(sha256,extension):null,...(spec.kind==='audio'&&waveFacts(bytes)?{container:waveFacts(bytes)}:{})};files.push(entry);
   if(spec.kind==='license'){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);entry.decode={status:'PASS',format:'text',characters:text.length};}catch{entry.decode={status:'FAIL',reason:'License must be valid UTF-8 text'};}}
   else inputs.push({id:spec.id,kind:spec.kind,bytes,mime:mime[extension]??'application/octet-stream'});
  }catch(error){if(error instanceof AgentError&&error.code==='BUDGET_EXCEEDED')throw error;files.push({id:spec.id,kind:spec.kind,file:path.resolve(spec.file),decode:{status:'FAIL',reason:error.message}});diagnostics.push({code:'MEDIA_UNREADABLE',severity:'error',message:error.message,path:['params','files',index,'file']});}
 }
 const budget=Math.min(request.params.probeMs??AGENT_LIMITS.probeMs,Math.max(1,(request.params.timeoutMs??AGENT_LIMITS.requestMs)-1000));
 const decoded=inputs.length?await probeAssets(inputs,{timeoutMs:budget}):{status:'PASS',checks:[]};
 for(const file of files)if(!file.decode)file.decode=decoded.checks.find(c=>c.id===file.id)??{status:'UNVERIFIED',reason:decoded.reason??'Decoder did not return a result'};
 const status=files.some(f=>f.decode.status==='FAIL')?'FAIL':files.some(f=>f.decode.status==='UNVERIFIED')?'UNVERIFIED':'PASS';
 for(const [i,file]of files.entries())if(file.decode.status!=='PASS')diagnostics.push({code:file.decode.status==='FAIL'?'MEDIA_DECODE_FAILED':'MEDIA_UNVERIFIED',severity:'error',message:file.decode.reason??'Media is unverified',path:['params','files',i],assetId:file.id});
 return {status,diagnostics,artifacts:[],data:{files,bytes:total,browser:decoded.browser??null,engineCommit:commitIdentity(),scope:{actualBytes:true,decoding:true,listening:'UNVERIFIED',humanAcceptance:'UNVERIFIED'}}};
}
