/** Reproducible R1 development flows; project content is written exclusively through SDK/CLI. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAgentFileRequest } from './agent-node.mjs';
const cli=fileURLToPath(new URL('./agent.mjs',import.meta.url));
async function exampleFont(dir){await fs.mkdir(path.join(dir,'assets'),{recursive:true});for(const file of ['agent.woff2','OFL.txt'])await fs.copyFile(new URL('../examples/agent/assets/'+file,import.meta.url),path.join(dir,'assets',file));return [{op:'asset.put',id:'agent-font',value:{kind:'font',src:'assets/agent.woff2',license:{name:'SIL OFL 1.1',src:'assets/OFL.txt'}}},{op:'project.patch',value:{font:'agent-font'}}];}
export async function runAgentExamples(output,{transport='sdk',preview=true}={}) {
 const root=path.resolve(output);await fs.mkdir(root,{recursive:true});const evidence=[];let serial=0;
 async function call(command,project,params={}) {
  const request={protocol:'vn-agent-v1',requestId:`r1-${transport}-${++serial}`,command,...(project?{project}:{}),params};let response;
  if(transport==='cli')response=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'--request=-'],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',()=>{try{resolve(JSON.parse(out))}catch{reject(Error(err||out))}});child.stdin.end(JSON.stringify(request));});
  else response=await runAgentFileRequest(request);
  evidence.push({request,response});await fs.writeFile(path.join(root,'TRANSCRIPT.json'),JSON.stringify({transport,evidence},null,2)+'\n');
  if(response.status!=='PASS')throw Error(`${command}: ${JSON.stringify(response)}`);return response;
 }
 const cap=await call('capabilities');
 for(const type of ['vn','chat']){const dir=path.join(root,type);await fs.mkdir(dir);const project=path.join(dir,'project.json');const init=await call('init',project,{type,game:'r1-'+type,storyVersion:'sample-v1',title:'R1 '+type});await call('apply',project,{expectedSourceSha256:init.project.sourceSha256,operations:[...await exampleFont(dir),{op:'route.put',id:'complete',value:{steps:[{type:'action',id:'continue'}],expect:{ending:'完成'}}}]});await call('validate',project);await call('test',project);}
 for(const type of ['script','investigation']) {
  const dir=path.join(root,type);await fs.mkdir(dir);await fs.mkdir(path.join(dir,'assets'));
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#193940"/><circle cx="940" cy="240" r="115" fill="#e8cd91"/><path d="M0 550 Q350 280 720 560 T1280 500 V720 H0Z" fill="#32666b"/></svg>';
  await fs.writeFile(path.join(dir,'assets/room.svg'),svg);const asset={op:'asset.put',id:'room',value:{kind:'background',src:'assets/room.svg',sha256:createHash('sha256').update(svg).digest('hex')}};
  const project=path.join(dir,'project.json');const init=await call('init',project,{type,game:'r1-'+type,storyVersion:'sample-v1',title:type==='script'?'R1 雨后约定':'R1 两章调查'});
  const font=await exampleFont(dir);
  const operations=type==='script'?[...font,
   {op:'line.put',nodeId:'start',id:'start-1',value:{speaker:'林',text:'雨停了，要一起回去吗？'}},
   {op:'variable.put',id:'affinity',value:{initial:0,min:0,max:2}},
   {op:'exit.set',nodeId:'start',value:{type:'choice',choices:[{id:'together',text:'一起走',next:'check',effects:[{op:'add',key:'affinity',value:1}]},{id:'alone',text:'稍后再走',next:'end'}]}},
   {op:'node.put',id:'check',value:{lines:[],exit:{type:'branch',routes:[{when:{affinity:{gte:1}},next:'promise'},{next:'end'}]}}},
   {op:'node.put',id:'promise',value:{lines:[{id:'promise-1',speaker:'林',text:'明天也在这里见。'}],exit:{type:'end',ending:'约定'}}},
   asset,{op:'stage.set',scope:'defaults',value:{background:'room'}},
   {op:'route.put',id:'together',value:{steps:[{type:'checkpoint',id:'opening'},{type:'action',id:'together'},{type:'restore',id:'opening'},{type:'action',id:'together'}],expect:{ending:'约定',variables:{affinity:1}}}},
   {op:'route.put',id:'alone',value:{steps:[{type:'action',id:'alone'}],expect:{ending:'完成',variables:{affinity:0}}}}
  ]:[...font,
   {op:'chapter.add',id:'two',title:'第二章：核对'},
   {op:'evidence.put',chapterId:'two',id:'clue',value:{title:'时刻表',detail:'末班车提前了五分钟。'}},
   {op:'action.put',chapterId:'two',nodeId:'start',id:'finish',value:{label:'收集时刻表并完成',next:'end',collect:'clue'}},
   {op:'node.patch',chapterId:'two',id:'end',value:{requiresEvidence:['clue']}},
   {op:'chapter.patch',id:'two',value:{requiredEvidence:['clue']}},
   {op:'chapter.rename',id:'two',newId:'final'},
   {op:'evidence.rename',chapterId:'final',id:'clue',newId:'timetable'},
   asset,{op:'stage.set',scope:'defaults',value:{background:'room'}},
   {op:'route.put',id:'first',value:{steps:['read','back','reason'].map(id=>({type:'action',id})),expect:{ending:'chapter-1:complete'}}},
   {op:'route.put',id:'cross-chapter',value:{steps:['read','back','reason','@chapter:final','finish'].map(id=>({type:'action',id})),expect:{ending:'final:complete',evidence:['timetable']}}}
  ];
  const dry=await call('apply',project,{expectedSourceSha256:init.project.sourceSha256,operations,dryRun:true});if(dry.data.applied)throw Error('Dry-run wrote data');
  await call('apply',project,{expectedSourceSha256:init.project.sourceSha256,operations});
  await call('inspect',project,{kind:'nodes',limit:1,maxBytes:4096});
  await call('refs',project,type==='script'?{kind:'variable',id:'affinity'}:{kind:'chapter',id:'final'});
  if(type==='investigation')await call('refs',project,{kind:'evidence',chapterId:'final',id:'timetable'});
  await call('validate',project);await call('test',project,{output:path.join(dir,'ROUTE_REPORT.json')});
  if(preview)await call('preview',project,{caseId:type==='script'?'together':'cross-chapter',output:path.join(dir,'preview')});
  await call('build',project,{mode:'development',output:path.join(dir,'game')});
 }
 return {status:'PASS',transport,root,commands:cap.data.commands,calls:evidence.length,sourceHashes:evidence.filter(e=>e.request.command==='build').map(e=>e.response.project),evidence};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const result=await runAgentExamples(process.argv[2]??'build/r1-example',{transport:process.argv.includes('--cli')?'cli':'sdk',preview:!process.argv.includes('--no-preview')});console.log(JSON.stringify({...result,evidence:undefined}));}catch(e){console.error(e);process.exitCode=1;}}
