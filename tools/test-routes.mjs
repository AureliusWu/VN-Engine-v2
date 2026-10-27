import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {runRouteSuite,ENGINE_VERSION} from '../dist/index.js';

const args=process.argv.slice(2), source=args.find(arg=>!arg.startsWith('--'));
if(!source||args.filter(arg=>!arg.startsWith('--')).length!==1||args.some(arg=>arg.startsWith('--')&&!arg.startsWith('--output='))) throw Error('Usage: node tools/test-routes.mjs project.json [--output=report.json]');
let report;try {const bytes=await readFile(resolve(source));report={...runRouteSuite(JSON.parse(bytes)),sourceSha256:createHash('sha256').update(bytes).digest('hex'),engine:ENGINE_VERSION};}catch(error){report={status:'FAIL',error:error.message};}
const output=args.find(arg=>arg.startsWith('--output='))?.slice(9);
if(output){await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n');console.log('ROUTE_REPORT_WRITTEN',JSON.stringify({file:output,status:report.status}));}else console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS')process.exitCode=1;
