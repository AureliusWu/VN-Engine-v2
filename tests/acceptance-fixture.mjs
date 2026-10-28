/** Synthetic reviewer observations for validator tests, never actual AI quality or device acceptance. */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {captureReviewBinding} from '../dist/editor/index.js';
import { captureAcceptanceContext, requiredAcceptanceKeys, ENGINE_VERSION, runRouteSuite } from '../dist/index.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
export function fixturePng(width,height=720) {
  const chunk=(name,bytes)=>{const kind=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,bytes])));return Buffer.concat([size,kind,bytes,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((1+width*3)*height))),chunk('IEND',Buffer.alloc(0))]);
}
export async function syntheticAcceptance(project, picture, sourceText=JSON.stringify(project), reader=async()=>picture) {
  const binding=await captureReviewBinding(project,sourceText,reader),bytes=new Map();
  const inputs=[{id:'project',kind:'project',src:'$source',sha256:binding.sourceSha256}];
  for(const asset of project.assets) {
    const data=await reader(asset.src);bytes.set(asset.src,data);
    if(['background','portrait','cg','ui','audio','video'].includes(asset.kind))inputs.push({id:'asset:'+asset.id,kind:['audio','video'].includes(asset.kind)?'audio':'image',src:asset.src,assetId:asset.id,sha256:sha(data)});
  }
  for(const width of [1280,390]){const data=fixturePng(width),src='review-inputs/synthetic-'+width+'.png';bytes.set(src,data);inputs.push({id:'viewport-'+width,kind:'screenshot',src,sha256:sha(data),width,height:720});}
  for(const [id,kind,report] of [['routes','routes',runRouteSuite(project)],['technical','test-report',{status:'PASS',fixture:true}]]) {
    const data=Buffer.from(JSON.stringify({...report,sourceSha256:binding.sourceSha256})),src='review-inputs/'+id+'.json';bytes.set(src,data);inputs.push({id,kind,src,sha256:sha(data)});
  }
  const doc={contract:'vn-ai-acceptance-v1',schema:1,game:project.game,storyVersion:project.version,engineVersion:ENGINE_VERSION,rubricVersion:'r4-1',binding,inputs,fixture:true,
    reviews:requiredAcceptanceKeys(project,true).map(key=>{
      const split=key.indexOf(':'),category=split<0?key:key.slice(0,split),target=split<0?undefined:key.slice(split+1);
      return{id:key,category,...(target?{target}:{}),status:'PASS',mode:['accessibility','web','pwa','windows'].includes(category)?'automated':'ai-simulated',
        model:'synthetic test fixture',modalities:['text','image','audio'],reviewedAt:'2026-10-28T00:00:00Z',coverage:'full',
        rationale:'Synthetic observations for regression assertions only; no real AI literary, art or listening acceptance.',
        evidenceIds:inputs.map(i=>i.id),findings:[]};
    })};
  const acceptanceContext=await captureAcceptanceContext(project,sourceText,doc,reader,async input=>bytes.get(input.src));
  return{acceptance:doc,acceptanceContext,bytes};
}
export async function writeSyntheticAcceptance(root,project,picture) {
  const source=await fs.readFile(path.join(root,'project.json'),'utf8');
  const fixture=await syntheticAcceptance(project,picture,source,src=>fs.readFile(path.resolve(root,src)));
  for(const [name,data]of fixture.bytes)if(name.startsWith('review-inputs/')){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),data);}
  await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify(fixture.acceptance,null,2)+'\n');
  return fixture;
}
