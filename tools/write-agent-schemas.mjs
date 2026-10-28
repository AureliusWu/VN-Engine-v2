import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AGENT_REQUEST_SCHEMA, AGENT_RESPONSE_SCHEMA, AGENT_OPERATION_SCHEMA } from '../dist/agent/index.js';

import {PRODUCTION_SCHEMA,UI_SCHEMA} from '../dist/creative/schema.js';
import { FEEDBACK_DOCUMENT_SCHEMA } from '../dist/creative/feedback.js';

const root = fileURLToPath(new URL('..', import.meta.url)), check = process.argv.includes('--check');
for (const [name, schema] of Object.entries({ request: AGENT_REQUEST_SCHEMA, response: AGENT_RESPONSE_SCHEMA, operation: AGENT_OPERATION_SCHEMA })) {
  const path = resolve(root, `schemas/vn-agent-v1.${name}.schema.json`), text = JSON.stringify(schema, null, 2) + '\n';
  if (check) { if (await readFile(path, 'utf8') !== text) throw Error('Agent schema drift: ' + name); }
  else { await mkdir(resolve(root, 'schemas'), { recursive: true }); await writeFile(path, text); }
}
for(const [name,schema]of Object.entries({production:PRODUCTION_SCHEMA,ui:UI_SCHEMA})){const file=resolve(root,`schemas/vn-creative-v1.${name}.schema.json`),text=JSON.stringify(schema,null,2)+'\n';if(check){if(await readFile(file,'utf8')!==text)throw Error('Creative schema drift: '+name);}else await writeFile(file,text);}
{const file=resolve(root,'schemas/vn-author-review-v1.document.schema.json'),text=JSON.stringify(FEEDBACK_DOCUMENT_SCHEMA,null,2)+'\n';if(check){if(await readFile(file,'utf8')!==text)throw Error('Feedback schema drift');}else await writeFile(file,text);}
console.log(check ? 'Agent schemas match executable contracts' : 'Agent schemas generated');
