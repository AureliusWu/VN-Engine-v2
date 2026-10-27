import { isRecord } from '../storage/save.js';
import { MAX_ROUTE_CASES, MAX_ROUTE_STEPS, type RouteSuite } from './types.js';

const id = (v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= 256;
const only = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).every(key => fields.includes(key));
export function validateRouteSuite(value: unknown): asserts value is RouteSuite {
  if (!isRecord(value) || !only(value, ['schema', 'cases']) || value.schema !== 1 || !Array.isArray(value.cases)
    || value.cases.length > MAX_ROUTE_CASES || JSON.stringify(value).length > 2_000_000) throw Error('Invalid route suite or size limit');
  const ids = new Set<string>();
  for (const test of value.cases) {
    if (!isRecord(test) || !only(test, ['id','label','steps','expect']) || !id(test.id) || ids.has(test.id as string)
      || (test.label !== undefined && !id(test.label)) || !Array.isArray(test.steps) || test.steps.length > MAX_ROUTE_STEPS
      || !isRecord(test.expect) || !Object.keys(test.expect).length || !only(test.expect,['sceneId','lineId','ending','text','variables','evidence','miniGame'])) throw Error('Invalid or duplicate route case');
    ids.add(test.id as string);
    const expected = test.expect;
    for (const key of ['sceneId','lineId','ending'] as const) if (expected[key] !== undefined && !id(expected[key])) throw Error(`Invalid route expectation: ${key}`);
    if (expected.text !== undefined && (typeof expected.text !== 'string' || expected.text.length > 100_000)) throw Error('Invalid expected text');
    if (expected.variables !== undefined && (!isRecord(expected.variables) || !Object.keys(expected.variables).length
      || Object.entries(expected.variables).some(([key,v]) => !id(key) || !(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))))) throw Error('Invalid expected variables');
    if (expected.evidence !== undefined && (!Array.isArray(expected.evidence) || expected.evidence.length > 1000
      || !expected.evidence.every(id) || new Set(expected.evidence).size !== expected.evidence.length)) throw Error('Invalid expected evidence');
    if (expected.miniGame !== undefined && expected.miniGame !== null) {
      const mini=expected.miniGame;
      if(!isRecord(mini)||!only(mini,['phase','board','result'])||!['idle','active','complete'].includes(String(mini.phase))||!Array.isArray(mini.board)
        ||mini.board.length<1||mini.board.length>9||mini.board.some(v=>typeof v!=='boolean')||(mini.result!==undefined&&!['success','failure','skip','abort'].includes(String(mini.result)))) throw Error('Invalid expected mini-game state');
    }
    for (const step of test.steps) {
      if (!isRecord(step)) throw Error('Invalid route step');
      if (['next','mini-start','mini-skip','mini-abort','mini-finish'].includes(String(step.type))) {
        if (!only(step,['type'])) throw Error('Unexpected route step fields');
      } else if (['action','checkpoint','restore'].includes(String(step.type))) {
        if (!only(step,['type','id']) || !id(step.id)) throw Error('Invalid action or checkpoint');
      } else if (step.type === 'mini-input') {
        if (!only(step,['type','index']) || !Number.isInteger(step.index) || Number(step.index) < 0 || Number(step.index) > 8) throw Error('Invalid mini-game input');
      } else throw Error('Unknown route step');
    }
  }
}
