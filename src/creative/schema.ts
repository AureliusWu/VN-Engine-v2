/** Additive authoring extension. These schemas do not execute provider code. */
export const CREATIVE_EXTENSION = 'vn-creative-v1';
const text = { type: 'string', minLength: 1, maxLength: 8000 };
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' };
const list = (items: object, maxItems = 256) => ({ type: 'array', items, maxItems });
const shape = (properties: Record<string,unknown>, required: string[] = [], additionalProperties = true) => ({ type: 'object', properties, required, additionalProperties });
export const CREATIVE_TARGET_SCHEMA = shape({ nodeId: id, chapterId: id, lineId: { type:'string',minLength:1,maxLength:500 } }, ['nodeId']);
export const CHARACTER_SCHEMA = shape({ id, name: text, description: text, visualPrompt: text, voiceNotes: text }, ['id','name','description']);
export const BEAT_SCHEMA = shape({ id, summary: text, targets: list(CREATIVE_TARGET_SCHEMA,64), characters: list(id,64), tasks: list(id,128) }, ['id','summary','targets']);
export const TASK_SCHEMA = shape({ id, kind: { enum: ['art','music','ui','sfx','text','story'] }, brief: text, prompt: text,
  state: { enum: ['planned','draft','review'] }, dependsOn: list(id,128), characters: list(id,64), targets: list(CREATIVE_TARGET_SCHEMA,64), assets: list(id,64),
  source: shape({ method: { enum:['generated','composed','procedural','licensed','recorded','authored'] }, tool: text, prompt: text,
    text, speaker:text, sourceSha256: { type:'string',pattern:'^[a-f0-9]{64}$' }, notes: text }, ['method','tool'])
}, ['id','kind','brief','state']);
export const PRODUCTION_SCHEMA = { $schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:vn-creative-v1:production',
  ...shape({ schema:{const:1}, brief:shape({ premise:text,tone:text,visualStyle:text,musicDirection:text,soundDirection:text,writingStyle:text,audience:text }),
    characters:list(CHARACTER_SCHEMA,64),beats:list(BEAT_SCHEMA),tasks:list(TASK_SCHEMA,128) }, ['schema']) };
const color={type:'string',pattern:'^#[a-fA-F0-9]{6}$'};
export const UI_SCHEMA = {$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:vn-creative-v1:ui',...shape({schema:{const:1},preset:{enum:['night','paper','dusk']},
  colors:shape({surface:color,panel:color,text:color,muted:color,accent:color,border:color},[],false),density:{enum:['comfortable','compact']},dialogue:{enum:['solid','glass']}},['schema'],false)};
export const ASSET_PROVENANCE_SCHEMA = shape({method:{enum:['generated','composed','procedural','licensed','recorded','authored']},tool:text,prompt:text,
  sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},notes:text},['method','tool','sourceSha256']);
