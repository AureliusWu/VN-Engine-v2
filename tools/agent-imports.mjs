/** Immutable content-addressed imports. No filesystem activity occurs at module load. */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AgentError,AGENT_LIMITS} from '../dist/agent/index.js';
export const IMPORT_EXTENSIONS=['png','jpg','jpeg','webp','svg','wav','mp3','ogg','woff2','txt','webm','mp4'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function importAssetPath(sha256,extension){if(!/^[a-f0-9]{64}$/.test(sha256)||!IMPORT_EXTENSIONS.includes(extension))throw new AgentError('INVALID_IMPORT','Unsupported import hash or extension');return `assets/imported/${sha256}.${extension}`;}
async function destination(root,relative,create=false){
 if(!/^assets\/imported\/[a-f0-9]{64}\.(png|jpe?g|webp|svg|wav|mp3|ogg|woff2|txt|webm|mp4)$/.test(relative))throw new AgentError('IMPORT_PATH_UNSAFE','Import destination must be content-addressed');
 let current=root;for(const part of ['assets','imported']){current=path.join(current,part);try{const st=await fs.lstat(current);if(st.isSymbolicLink()||!st.isDirectory())throw new AgentError('IMPORT_PATH_UNSAFE','Import parent is not an owned directory');}catch(e){if(e.code!=='ENOENT')throw e;if(create){try{await fs.mkdir(current);}catch(err){if(err.code!=='EEXIST')throw err;}const st=await fs.lstat(current);if(st.isSymbolicLink()||!st.isDirectory())throw new AgentError('IMPORT_PATH_UNSAFE','Import parent changed');}}}
 return path.join(root,relative);
}
async function existing(root,entry){const file=await destination(root,entry.relative);try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw new AgentError('IMPORT_PATH_UNSAFE','Import destination is not a regular immutable file');if(st.size>AGENT_LIMITS.assetBytes)throw new AgentError('IMPORT_CONFLICT','Existing blob exceeds budget');const bytes=await fs.readFile(file);if(digest(bytes)!==entry.sha256)throw new AgentError('IMPORT_CONFLICT','Existing content-addressed file has different bytes',{actual:file,expected:entry.sha256});return bytes;}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
export async function importsPresent(root,entries=[]){for(const entry of entries)if(!await existing(root,entry))return false;return true;}
export async function prepareImports(root,specifications=[],budget={bytes:0}){
 const entries=[],seen=new Set();
 for(const [index,spec]of specifications.entries()){
  const relative=importAssetPath(spec.sha256,spec.extension);if(seen.has(relative))throw new AgentError('IMPORT_DUPLICATE','Duplicate import destination',{path:['params','imports',index]});seen.add(relative);
  const entry={relative,sha256:spec.sha256,source:path.resolve(spec.source)};let bytes=await existing(root,entry);
  if(!bytes){try{const st=await fs.stat(entry.source);if(!st.isFile())throw new AgentError('IMPORT_SOURCE_UNREADABLE','Import source is not a file');if(st.size>AGENT_LIMITS.assetBytes)throw new AgentError('BUDGET_EXCEEDED','Import exceeds asset budget',{},'UNVERIFIED');bytes=await fs.readFile(entry.source);}catch(error){if(error instanceof AgentError)throw error;throw new AgentError('IMPORT_SOURCE_UNREADABLE',error.message,{path:['params','imports',index,'source']});}if(bytes.length>AGENT_LIMITS.assetBytes)throw new AgentError('BUDGET_EXCEEDED','Import exceeds actual byte budget',{},'UNVERIFIED');if(digest(bytes)!==spec.sha256)throw new AgentError('IMPORT_SOURCE_CONFLICT','Import source changed',{path:['params','imports',index,'sha256'],expected:spec.sha256,actual:digest(bytes)});}
  if(budget.bytes+bytes.length>AGENT_LIMITS.assetTotalBytes)throw new AgentError('BUDGET_EXCEEDED','Import request exceeds total asset budget',{},'UNVERIFIED');budget.bytes+=bytes.length;entries.push({...entry,bytes,size:bytes.length});
 }
 return entries;
}
export function assertImportsUsed(entries,project){for(const entry of entries)if(!project.assets.some(a=>a.src===entry.relative||a.license?.src===entry.relative))throw new AgentError('IMPORT_UNUSED','Imported file is not referenced by the final asset manifest',{actual:entry.relative});}
export const importReceipt=entries=>entries.map(({relative,sha256,source,size})=>({relative,sha256,source,size}));
export async function publishImports(root,entries,onPhase){
 const artifacts=[];
 for(const entry of entries){const file=await destination(root,entry.relative,true);if(!await existing(root,entry)){
   const temporary=path.join(path.dirname(file),'.agent-import-'+randomUUID());let handle;
   try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(entry.bytes);await handle.sync();await handle.close();handle=null;try{await fs.link(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;await existing(root,entry);}}finally{await handle?.close();await fs.rm(temporary,{force:true});}
  }
  const artifact={kind:'imported-asset',path:file,sha256:entry.sha256};artifacts.push(artifact);await onPhase?.('imported',{artifact,relative:entry.relative});
 }
 return artifacts;
}
