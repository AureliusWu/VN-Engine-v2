/** Full R2 workflow. Authored project writes use only the public SDK or JSON CLI. */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runAgentFileRequest} from './agent-node.mjs';
import {importAssetPath} from './agent-imports.mjs';
const repository=fileURLToPath(new URL('..',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function runCreativeExample(output,{transport='sdk',preview=true,game='vn-creative-bookshop',storyVersion='creative-draft-1'}={}) {
 const root=path.resolve(output);await fs.mkdir(root,{recursive:true});
 const project=path.join(root,'project.json'),evidence=[];let serial=0;
 async function call(command,params={},allowed=['PASS']) {
  const request={protocol:'vn-agent-v1',requestId:`r2-${transport}-${++serial}`,command,...(['capabilities','probe'].includes(command)?{}:{project}),params};
  let response;
  if(transport==='cli')response=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[path.join(repository,'tools/agent.mjs'),'--request=-'],{stdio:['pipe','pipe','pipe']});let out='',err='';
   child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
   child.on('close',code=>{try{const r=JSON.parse(out);if(code!==({PASS:0,FAIL:1,BLOCKED:2,UNVERIFIED:3}[r.status]))throw Error('CLI exit/status mismatch');resolve(r);}catch(e){reject(Error(err||e.message));}});child.stdin.end(JSON.stringify(request));
  });else response=await runAgentFileRequest(request);
  evidence.push({request,response});await fs.writeFile(path.join(root,'TRANSCRIPT.json'),JSON.stringify({transport,evidence},null,2)+'\n');
  if(!allowed.includes(response.status))throw Error(command+': '+JSON.stringify(response));return response;
 }
 await call('capabilities');
 const prompts=JSON.parse(await fs.readFile(path.join(repository,'examples/creative/prompts.json'),'utf8')).prompts;
 const definitions=[['room','background','examples/creative/assets/bookshop-r2.png','generated',prompts.bookshop],['an','portrait','examples/creative/assets/an-r2.png','generated',prompts.an],
  ['memory','audio','examples/creative/assets/memory.wav','composed'],['rain','audio','examples/creative/assets/rain.wav','procedural'],['bell','audio','examples/creative/assets/bell.wav','procedural'],
  ['font','font','examples/agent/assets/agent.woff2','licensed'],['license','license','examples/agent/assets/OFL.txt','licensed']];
 const files=await Promise.all(definitions.map(async([id,kind,file,method,prompt])=>{const source=path.join(repository,file),bytes=await fs.readFile(source),sha256=sha(bytes),extension=path.extname(file).slice(1);return{id,kind,source,sha256,extension,method,prompt,relative:importAssetPath(sha256,extension)};}));
 const probe=await call('probe',{files:files.map(f=>({id:f.id,kind:f.kind,file:f.source})),output:path.join(root,'MEDIA_REPORT.json')});
 const initialized=await call('init',{type:'script',game,storyVersion,title:'The Last Returned Book'});
 // Production context first; the default stable opening ID is retained for this first batch.
 const production=await call('apply',{expectedSourceSha256:initialized.project.sourceSha256,operations:[
  {op:'production.patch',value:{schema:1,brief:{premise:'At closing time, a visitor returns a book with a note still inside.',tone:'Quiet warmth, unresolved curiosity',visualStyle:'Painterly amber bookshop and blue rainy evening',musicDirection:'96 BPM soft additive plucks in A minor',soundDirection:'Low rain and one door bell',writingStyle:'Brief concrete lines; leave one small question open'},
   characters:[{id:'an',name:'An',description:'An adult bookseller who remembers the marks readers leave behind.',visualPrompt:prompts.an}],
   beats:[{id:'arrival',summary:'A returned book delays closing time.',targets:[{nodeId:'start',lineId:'start-1'}],characters:['an'],tasks:['plot','words']}],
   tasks:['art','music','ui','sfx','text','story'].map((kind,i)=>({id:['illustration','score','theme','foley','words','plot'][i],kind,brief:['Draw the rainy shop and An','Compose the four-bar memory loop','Apply the dusk reading theme','Synthesize rain and the door bell','Write the stable dialogue lines','Author two endings and the decision gate'][i],prompt:[prompts.bookshop+'\n'+prompts.an,'96 BPM, A minor, four bars of original additive plucks; see the score in generate-creative-audio.py','Dusk preset, comfortable density, glass dialogue and #edc98f accent','Seeded soft rain loop plus one 1.2-second decaying door bell','Four short concrete lines, An and You, stable line IDs; leave one question open','A two-way stay/leave choice sets a boolean, then a hidden conditional gate chooses an ending'][i],state:'planned',characters:['an'],targets:[{nodeId:'start',lineId:'start-1'}],...(kind==='story'?{}:{dependsOn:['plot']})}))}}
 ]});
 const assets=files.filter(f=>f.kind!=='license').map(f=>({op:'asset.put',id:f.id,value:{kind:f.kind,src:f.relative,sha256:f.sha256,status:'DRAFT',alt:f.id==='room'?'An amber-lit bookshop after rain':f.id==='an'?'An, holding the returned book':f.id,
  ...(f.kind==='font'?{license:{name:'SIL OFL 1.1 — VN Agent Sans',src:files.find(x=>x.id==='license').relative}}:{}),
  provenance:{method:f.method,tool:f.method==='generated'?'built-in image_gen.imagegen':f.method==='licensed'?'Rain SourceHanSansLite, renamed OFL subset':'tools/generate-creative-audio.py',sourceSha256:f.sha256,...(f.prompt?{prompt:f.prompt}:{}),notes:'Independent technical sample; DRAFT. Human production acceptance is not recorded.'}}}));
 const targets=[{nodeId:'start',lineId:'arrival-1'},{nodeId:'start',lineId:'arrival-2'},{nodeId:'return',lineId:'return-1'},{nodeId:'end',lineId:'end-1'}];
 const operations=[...assets,
  {op:'ui.set',value:{schema:1,preset:'dusk',density:'comfortable',dialogue:'glass',colors:{accent:'#edc98f'}}},
  {op:'project.patch',value:{font:'font',settings:{textDelayMs:0},titleScreen:false}},
  {op:'line.rename',nodeId:'start',id:'start-1',newId:'arrival-1'},
  {op:'line.put',nodeId:'start',id:'arrival-1',value:{speaker:'An',text:'I was about to close. Is that the book you borrowed?'}},
  {op:'line.put',nodeId:'start',id:'arrival-2',value:{speaker:'You',text:'There was a note inside. I thought you might want it back.'}},
  {op:'variable.put',id:'stay',value:{initial:false}},
  {op:'exit.set',nodeId:'start',value:{type:'choice',choices:[{id:'stay',text:'Stay and read the note',next:'gate',effects:[{op:'set',key:'stay',value:true}]},{id:'leave',text:'Come back tomorrow',next:'gate'}]}},
  {op:'node.put',id:'gate',value:{lines:[],exit:{type:'branch',routes:[{when:{stay:true},next:'return'},{next:'end'}]}}},
  {op:'node.put',id:'return',value:{lines:[{id:'return-1',speaker:'An',text:'Then let the rain finish its sentence. We have time for one more page.'}],exit:{type:'end',ending:'One more page'}}},
  {op:'node.put',id:'end',value:{lines:[{id:'end-1',speaker:'An',text:'Tomorrow, then. I will keep the light on a little longer.'}],exit:{type:'end',ending:'Tomorrow'}}},
  {op:'stage.set',scope:'defaults',value:{background:'room',portrait:'an',music:'memory',ambience:'rain'}},
  {op:'stage.set',scope:'line',id:'arrival-2',value:{sound:'bell'}},
  {op:'beat.put',id:'decision',value:{summary:'Choose whether to stay; both responses leave a future invitation.',characters:['an'],tasks:['plot','words'],targets:[{nodeId:'gate'},...targets.slice(2)]}},
  ...['illustration','score','theme','foley','words','plot'].map((id,i)=>({op:'task.put',id,value:{state:'review',targets:i>=4?targets:[{nodeId:'start'}],assets:[['room','an'],['memory'],[],['rain','bell'],[],[]][i],source:{method:['generated','composed','authored','procedural','authored','authored'][i],tool:i===0?'built-in image_gen.imagegen':i===1||i===3?'tools/generate-creative-audio.py':'tools/creative-example.mjs',notes:'Mechanical completion; human approval remains UNVERIFIED.'}}})),
  {op:'route.put',id:'stay',value:{steps:[{type:'checkpoint',id:'opening'},{type:'next'},{type:'action',id:'stay'},{type:'restore',id:'opening'},{type:'next'},{type:'action',id:'stay'}],expect:{ending:'One more page',variables:{stay:true}}}},
  {op:'route.put',id:'leave',value:{steps:[{type:'next'},{type:'action',id:'leave'}],expect:{ending:'Tomorrow',variables:{stay:false}}}}
 ];
 const imports=files.map(f=>({source:f.source,sha256:f.sha256,extension:f.extension}));
 const params={expectedSourceSha256:production.project.sourceSha256,operations,imports};
 const before=await fs.readFile(project);await call('apply',{...params,dryRun:true});if(!before.equals(await fs.readFile(project)))throw Error('Dry-run changed source');
 const applied=await call('apply',params);const source=JSON.parse(await fs.readFile(project,'utf8'));
 if(source.assets.some(a=>a.status!=='DRAFT'))throw Error('Import promoted draft approval');
 await call('inspect',{kind:'text',characterId:'an',limit:2,maxBytes:4096});await call('refs',{kind:'character',id:'an'});
 await call('review');await call('validate');const routes=await call('test',{output:path.join(root,'ROUTE_REPORT.json')});
 if(preview)for(const [name,width]of [['desktop',1280],['mobile',390]])await call('preview',{caseId:'stay',width,height:900,output:path.join(root,'preview-'+name)});
 const built=await call('build',{output:path.join(root,'game'),mode:'development'});
 const blocked=await call('build',{output:path.join(root,'release-blocked'),mode:'release'},['BLOCKED']);
 const report={status:'PASS',transport,engineVersion:applied.engineVersion,engineCommit:probe.data.engineCommit,project:applied.project,calls:evidence.length,disciplines:source.production.tasks.map(t=>t.kind),media:probe.data,restoreChecks:routes.data.restoreChecks,build:built.data.buildIdentity,releaseStatus:blocked.status,humanAcceptance:'UNVERIFIED',assetStatus:'DRAFT'};
 await fs.writeFile(path.join(root,'CREATIVE_REPORT.json'),JSON.stringify(report,null,2)+'\n');return{...report,root};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await runCreativeExample(process.argv[2]??'build/r2-example',{transport:process.argv.includes('--cli')?'cli':'sdk',preview:!process.argv.includes('--no-preview')})));}catch(e){console.error(e);process.exitCode=1;}}
