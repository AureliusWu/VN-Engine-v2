import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2), modulePath = args.find(arg => arg.startsWith('--module='))?.slice(9) ?? '../dist/index.js';
const moduleURL = modulePath.startsWith('.') && !args.some(arg => arg.startsWith('--module=')) ? new URL(modulePath, import.meta.url) : pathToFileURL(resolve(modulePath));
const { RuntimeSession } = await import(moduleURL.href);
const clone = globalThis.structuredClone;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cases = [];
for (const [name, documentLines, reads] of [['paragraph', 0, 5000], ['document', 100, 1000]]) {
  const frame = { id: 'one', lineId: 'one', sceneId: 'one', line: 0, title: 'benchmark', speaker: '旁白', text: '可复现的引擎视图读取测试。'.repeat(8), mode: 'vn',
    stage: documentLines ? { document: { title: '文书', lines: Array.from({ length: documentLines }, (_, index) => `${index}：` + '文书内容'.repeat(20)) } } : {},
    actions: [{ id: 'choice', label: '继续', kind: 'choice' }], canAdvance: false };
  const driver = { game: 'benchmark', supportsSkip: false, supportsReread: false, frame: () => frame, reset() {}, advance: () => false, act: () => false,
    history: () => [], reread: () => false, save: () => ({}), restore() {} };
  const session = new RuntimeSession(driver, { settings: { textDelayMs: 0 } });
  const method = typeof session.getView === 'function' ? 'getView' : 'getSnapshot';
  const read = () => session[method]();
  for (let count = 0; count < 500; count++) read();
  const samples = []; let checksum = 0, clones = 0;
  globalThis.structuredClone = value => { clones++; return clone(value); };
  try {
    for (let repeat = 0; repeat < 7; repeat++) {
      const start = performance.now();
      for (let count = 0; count < reads; count++) checksum += read().text.length;
      samples.push(performance.now() - start);
    }
  } finally { globalThis.structuredClone = clone; session.dispose(); }
  cases.push({ name, method, readsPerSample: reads, samples: samples.length, medianMs: Number(median(samples).toFixed(3)), structuredCloneCalls: clones, checksum });
}
const result = { schema: 1, node: process.version, platform: process.platform, cases,
  scope: 'Same frame fixtures, one process per variant on the same host. Warmed read-only host-view vs defensive-snapshot microbenchmark, not end-to-end FPS.' };
const output = args.find(arg => arg.startsWith('--out='))?.slice(6);
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
