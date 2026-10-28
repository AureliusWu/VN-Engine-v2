import { UI_SCHEMA } from '../creative/schema.js';
import { schemaErrors } from '../schema/validate.js';
export type UIColors = {surface:string;panel:string;text:string;muted:string;accent:string;border:string};
export type ProjectUI = {schema:1;preset?:'night'|'paper'|'dusk';colors?:Partial<UIColors>;density?:'comfortable'|'compact';dialogue?:'solid'|'glass'};
export const UI_PRESETS:Readonly<Record<'night'|'paper'|'dusk',Readonly<UIColors>>> = Object.freeze({
  night:Object.freeze({surface:'#111820',panel:'#172a36',text:'#edf1f4',muted:'#b5d2cf',accent:'#a5e9d6',border:'#55747f'}),
  paper:Object.freeze({surface:'#f4ecdd',panel:'#fff8ec',text:'#302c27',muted:'#635b50',accent:'#78533b',border:'#9d8d77'}),
  dusk:Object.freeze({surface:'#172c36',panel:'#1f3943',text:'#fff2df',muted:'#d8c4aa',accent:'#edc98f',border:'#8b806e'})
});
export function validateProjectUI(value:unknown):asserts value is ProjectUI {
  if(value===undefined)return;const errors=schemaErrors(UI_SCHEMA,value);if(errors.length)throw Error('Invalid project UI: '+JSON.stringify(errors[0]));
}
export function resolveProjectUI(value:ProjectUI) {validateProjectUI(value);return {colors:{...UI_PRESETS[value.preset??'night'],...value.colors},density:value.density??'comfortable',dialogue:value.dialogue??'glass',preset:value.preset??'night'};}
export function uiDeclarations(value:ProjectUI) {
  const ui=resolveProjectUI(value),rgb=(hex:string)=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)).join(' ');
  return {...Object.fromEntries(Object.entries(ui.colors).map(([k,v])=>['--vn-ui-'+k,v])), '--vn-ui-panel-rgb':rgb(ui.colors.panel)};
}
export function uiContrast(value:ProjectUI) {
  const {colors}=resolveProjectUI(value),luma=(hex:string)=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[0.2126,0.7152,0.0722][i],0);
  const a=luma(colors.text),b=luma(colors.panel);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
