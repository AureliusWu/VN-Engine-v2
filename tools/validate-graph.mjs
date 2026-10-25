import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const CONTRACT_VERSION = '1.1.0';

// Engine-neutral structural checks. State-dependent route execution remains the
// native engine's responsibility; a graph path count is not a playable route count.
export function validateGraph(data, options = {}) {
  const nodes = data.scenes ?? data.nodes;
  if (!Array.isArray(nodes) || !nodes.length) throw new Error('Missing story nodes');
  const entry = data.entry ?? nodes[0].id;
  const map = new Map(), lineIds = new Set();
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !node.id || map.has(node.id)) throw new Error('Duplicate or invalid scene ID');
    map.set(node.id, node);
    if (!Array.isArray(node.lines)) throw new Error('Missing lines: ' + node.id);
    for (const line of [...node.lines, ...(node.choices ?? []).flatMap(choice => choice.response ?? [])]) {
      if (typeof line.text !== 'string' || !line.text.trim()) throw new Error('Empty dialogue: ' + node.id);
      if (options.requireLineIds !== false) {
        if (typeof line.id !== 'string' || !line.id || lineIds.has(line.id)) throw new Error('Duplicate or missing line ID');
        lineIds.add(line.id);
      }
    }
    const choices = node.choices ?? [];
    if (new Set(choices.map(choice => choice.id)).size !== choices.length) throw new Error('Duplicate choice ID: ' + node.id);
    if (choices.length && (node.next || node.continuation || node.ending)) throw new Error('Ambiguous choice transition: ' + node.id);
    if (node.ending && node.next) throw new Error('Ending has an automatic successor: ' + node.id);
  }
  if (!map.has(entry)) throw new Error('Missing entry scene');
  const edges = node => options.targets ? options.targets(node) : [
    ...[node.next, node.continuation].filter(Boolean),
    ...(node.choices ?? []).map(choice => choice.next),
    ...(node.routes ?? []).map(route => route.next),
  ];
  for (const node of nodes) {
    const targets=edges(node);
    for (const target of targets) if (typeof target !== 'string' || !map.has(target)) throw new Error('Missing successor: ' + node.id + ' -> ' + target);
    if (!targets.length && !node.ending && !node.chapterEnd) throw new Error('Unfinished terminal scene: ' + node.id);
  }
  const visited=new Set(), stack=new Set();
  function walk(id) {
    if (stack.has(id)) throw new Error('Story cycle requires an explicit native-engine policy: ' + id);
    if (visited.has(id)) return;
    stack.add(id);
    for (const target of edges(map.get(id))) walk(target);
    stack.delete(id);visited.add(id);
  }
  walk(entry);
  const unreachable=nodes.filter(node=>!visited.has(node.id)).map(node=>node.id);
  if (unreachable.length) throw new Error('Unreachable scenes: ' + unreachable.join(', '));
  return {contract:CONTRACT_VERSION,scenes:nodes.length,lines:nodes.reduce((n,node)=>n+node.lines.length,0),choices:nodes.filter(node=>node.choices?.length).length,endings:nodes.filter(node=>node.ending).length};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {const filename=process.argv[2];if(!filename)throw new Error('Usage: node scripts/vn-contract.mjs path/to/story.json');
    console.log('VN_CONTRACT_OK',JSON.stringify(validateGraph(JSON.parse(readFileSync(filename,'utf8')))));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
