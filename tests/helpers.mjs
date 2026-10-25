import { readFileSync } from 'node:fs';
import { createHealingEngine, createNetLoveEngine, createCircuitEngine } from '../dist/index.js';
export const readJSON = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
export const healing = () => createHealingEngine(readJSON('examples/healing/story.json').scenes);
export const netlove = () => createNetLoveEngine(readJSON('examples/netlove/story.json').scenes);
export const circuit = () => createCircuitEngine(readJSON('examples/circuit/chapters.json').chapters);
export const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
export function toChoice(engine) { return engine.advance(engine.newGame()); }
export function collectAll(engine, state = engine.initial()) {
  for (const action of ['inspect-a', 'return', 'inspect-b', 'return', 'reason']) {
    state = engine.transition(state, action);
    if (!state) throw new Error('Fixture route failed: ' + action);
  }
  return state;
}
export function memoryStorage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, raw) => data.set(key, raw), removeItem: key => data.delete(key) };
}
