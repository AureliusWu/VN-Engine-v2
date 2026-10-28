import type { EngineProject } from '../runtime/project.js';
import { contentCatalogue,contentKey } from './content.js';
import { creativeNodes } from './project.js';
import { schemaErrors } from '../schema/validate.js';

const text={type:'string',minLength:1,maxLength:8000},id={type:'string',minLength:1,maxLength:500},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const shape=(properties:Record<string,unknown>,required:string[]=[],additionalProperties=true)=>({type:'object',properties,required,additionalProperties});
export const FEEDBACK_TARGET_SCHEMA=shape({kind:{enum:['project','node','line','variant','choice','action','asset','task','character','beat']},id,nodeId:id,chapterId:id},['kind','id'],false);
export const REVIEW_BINDING_SCHEMA=shape({sourceSha256:hash,filesVerified:{type:'boolean'},assets:{type:'array',maxItems:10000,items:shape({id,sha256:{anyOf:[hash,{type:'null'}]}},['id','sha256'],false)}},['sourceSha256','filesVerified','assets'],false);
const event=shape({state:{enum:['open','addressed','verified','reopened']},actor:id,at:id,note:text,evidence:text,binding:REVIEW_BINDING_SCHEMA},['state','actor','at','note','binding']);
export const FEEDBACK_DOCUMENT_SCHEMA={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:vn-author-review-v1:document',...shape({contract:{const:'vn-author-review-v1'},schema:{const:1},game:id,storyVersion:id,
 items:{type:'array',maxItems:500,items:shape({id,category:{enum:['story','text','art','music','sfx','ui','other']},target:FEEDBACK_TARGET_SCHEMA,comment:text,state:{enum:['open','addressed','verified','reopened']},binding:REVIEW_BINDING_SCHEMA,
 events:{type:'array',minItems:1,maxItems:64,items:event}},['id','category','target','comment','state','binding','events'])}},['contract','schema','game','storyVersion','items'])};
export type FeedbackTarget={kind:'project'|'node'|'line'|'variant'|'choice'|'action'|'asset'|'task'|'character'|'beat';id:string;nodeId?:string;chapterId?:string};
export type ReviewBinding={sourceSha256:string;filesVerified:boolean;assets:{id:string;sha256:string|null}[]};
export type FeedbackState='open'|'addressed'|'verified'|'reopened';
export type FeedbackEvent={state:FeedbackState;actor:string;at:string;note:string;evidence?:string;binding:ReviewBinding};
export type FeedbackItem={id:string;category:string;target:FeedbackTarget;comment:string;state:FeedbackState;binding:ReviewBinding;events:FeedbackEvent[];[key:string]:unknown};
export type AuthorReviewDocument={contract:'vn-author-review-v1';schema:1;game:string;storyVersion:string;items:FeedbackItem[];[key:string]:unknown};
export class FeedbackError extends Error { constructor(readonly code:string,message:string){super(message);} }
export async function reviewSourceHash(value:string|Uint8Array){const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function readAuthorReview(input:unknown,p:EngineProject):AuthorReviewDocument {
  if(input===undefined||input===null)return {contract:'vn-author-review-v1',schema:1,game:p.game,storyVersion:p.version,items:[]};
  let value:any;try{value=typeof input==='string'?JSON.parse(input):structuredClone(input);}catch{throw new FeedbackError('INVALID_REVIEW','Review document is not JSON');}
  const errors=schemaErrors(FEEDBACK_DOCUMENT_SCHEMA,value);if(errors.length)throw new FeedbackError('INVALID_REVIEW',JSON.stringify(errors[0]));
  if(value.game!==p.game||value.storyVersion!==p.version)throw new FeedbackError('REVIEW_IDENTITY_MISMATCH','Review belongs to another game or storyVersion');
  const ids=new Set();for(const item of value.items){if(ids.has(item.id))throw new FeedbackError('INVALID_REVIEW','Duplicate feedback ID');ids.add(item.id);
    for(const [i,e]of item.events.entries()){if(!Number.isFinite(Date.parse(e.at)))throw new FeedbackError('INVALID_REVIEW','Invalid review event date');if(e.state==='verified'&&(!e.evidence?.trim()||item.events[i-1]?.state!=='addressed'))throw new FeedbackError('INVALID_REVIEW','Verified event needs addressed history and evidence');}
    const last=item.events.at(-1);if(last.state!==item.state||JSON.stringify(last.binding)!==JSON.stringify(item.binding))throw new FeedbackError('INVALID_REVIEW','Current state/binding differs from last event');
  }
  return value;
}
export function feedbackTargetExists(p:EngineProject,t:FeedbackTarget):boolean {
  if(t.kind==='project')return t.id===p.game;
  if(t.kind==='asset')return p.assets.some(a=>a.id===t.id);
  if(t.kind==='node')return creativeNodes(p).filter(n=>n.nodeId===t.id&&n.chapterId===t.chapterId).length===1;
  if(['line','variant','choice','action'].includes(t.kind))return contentCatalogue(p).some(c=>c.key===contentKey(t.kind,t.id,t.nodeId,t.chapterId));
  const group=t.kind==='task'?p.production?.tasks:t.kind==='character'?p.production?.characters:p.production?.beats;return !!group?.some(item=>item.id===t.id);
}
export async function captureReviewBinding(p:EngineProject,source:string,readAsset?: (src:string)=>Promise<Uint8Array>):Promise<ReviewBinding> {
  const assets:{id:string;sha256:string|null}[]=[];let filesVerified=!!readAsset||p.assets.length===0,total=0;const cache=new Map<string,string|null>();
  for(const asset of p.assets)for(const [id,src]of [[asset.id,asset.src],...(asset.license?[['license:'+asset.id,asset.license.src]]:[])]){
    if(assets.length>=10000)throw new FeedbackError('BUDGET_EXCEEDED','Review asset identity budget exceeded');
    if(!cache.has(src)){let value:string|null=null;if(readAsset)try{const bytes=await readAsset(src);total+=bytes.byteLength;if(bytes.byteLength>67_108_864||total>268_435_456)throw new FeedbackError('BUDGET_EXCEEDED','Review byte budget exceeded');value=await reviewSourceHash(bytes);}catch(error){if(error instanceof FeedbackError||(error&&typeof error==='object'&&'code'in error&&['BUDGET_EXCEEDED','TIMEOUT','ABORTED'].includes(String(error.code))))throw error;filesVerified=false;}else filesVerified=false;cache.set(src,value);}
    const sha256=cache.get(src)!;if(id===asset.id&&asset.sha256&&sha256!==asset.sha256)filesVerified=false;assets.push({id,sha256});
  }
  assets.sort((a,b)=>a.id.localeCompare(b.id));return {sourceSha256:await reviewSourceHash(source),filesVerified,assets};
}
export function feedbackFreshness(item:FeedbackItem,p:EngineProject,binding:ReviewBinding) {
  if(!feedbackTargetExists(p,item.target)||item.binding.sourceSha256!==binding.sourceSha256)return 'stale' as const;
  const previous=new Map(item.binding.assets.map(a=>[a.id,a.sha256]));
  if(binding.assets.length!==previous.size||binding.assets.some(a=>!previous.has(a.id)||(a.sha256!==null&&previous.get(a.id)!==null&&a.sha256!==previous.get(a.id))))return 'stale' as const;
  if(!binding.filesVerified||!item.binding.filesVerified)return 'unverified' as const;
  return JSON.stringify(item.binding.assets)===JSON.stringify(binding.assets)?'fresh' as const:'stale' as const;
}
export function assessAuthorReview(doc:AuthorReviewDocument,p:EngineProject,binding:ReviewBinding) {
  const items=doc.items.map(item=>({...structuredClone(item),freshness:feedbackFreshness(item,p,binding)}));
  return {status:items.every(i=>i.state==='verified'&&i.freshness==='fresh')?'PASS':'UNVERIFIED',items,
    scope:{authorFeedback:true,humanIdentityAuthenticated:false,releaseApproval:false},binding};
}
export function editAuthorReview(doc:AuthorReviewDocument,p:EngineProject,binding:ReviewBinding,operation:{op:'put'|'transition';id:string;actor:string;at?:string;note?:string;evidence?:string;state?:FeedbackState;value?:Record<string,any>}):AuthorReviewDocument {
  const o=operation;if(!o.id.trim()||!o.actor.trim())throw new FeedbackError('INVALID_FEEDBACK','ID and actor are required');
  const next=structuredClone(doc),index=next.items.findIndex(i=>i.id===o.id),prior=next.items[index],at=o.at??new Date().toISOString();
  if(!Number.isFinite(Date.parse(at)))throw new FeedbackError('INVALID_FEEDBACK','Invalid event date');
  let item:FeedbackItem;
  if(o.op==='put'){
    const value=o.value??{};for(const key of ['id','state','binding','events'])if(Object.hasOwn(value,key))throw new FeedbackError('INVALID_FEEDBACK','Managed feedback field: '+key);
    item={...prior,...structuredClone(value),id:o.id,state:prior?'reopened':'open',binding:structuredClone(binding),events:prior?.events??[]} as FeedbackItem;
    if(!item.target||!feedbackTargetExists(p,item.target))throw new FeedbackError('REVIEW_TARGET_MISSING','Feedback target is missing or ambiguous');
  }else{
    if(!prior)throw new FeedbackError('NOT_FOUND','Feedback does not exist');item=prior;
    if(!['addressed','verified','reopened'].includes(o.state??''))throw new FeedbackError('INVALID_FEEDBACK','Invalid feedback transition');
    if(o.state==='verified'&&(prior.state!=='addressed'||feedbackFreshness(prior,p,binding)!=='fresh'||!o.evidence?.trim()))throw new FeedbackError('REVIEW_STALE','Verify requires fresh addressed feedback and an explicit evidence declaration');
    if(!feedbackTargetExists(p,item.target)&&o.state!=='reopened')throw new FeedbackError('REVIEW_TARGET_MISSING','Retarget this feedback before resolving it');
    item.state=o.state!;item.binding=structuredClone(binding);
  }
  if(item.events.length>=64)throw new FeedbackError('REVIEW_EVENT_LIMIT','Archive feedback before adding more than 64 events');
  item.events.push({state:item.state,actor:o.actor,at,note:o.note??(o.op==='put'?item.comment:'Updated feedback'),...(o.evidence?{evidence:o.evidence}:{}),binding:structuredClone(binding)});
  if(index<0)next.items.push(item);else next.items[index]=item;
  return readAuthorReview(next,p);
}
