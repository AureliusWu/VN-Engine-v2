import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { newProject } from '../dist/editor/index.js';
import { assessRuntimeEvidenceReport, readRuntimeEvidenceReport } from '../dist/index.js';
import { runAgentFileRequest } from '../tools/agent-node.mjs';

const root = path.resolve('test-results/p0-preview'); await mkdir(root, { recursive: true });
const run = await mkdtemp(path.join(root, 'run-')), file = path.join(run, 'project.json');
const project = newProject('script');
project.routeTests = { schema: 1, cases: [{ id: 'yes-route', steps: [{ type: 'action', id: 'yes' }], expect: { ending: '完成' } }] };
const source = JSON.stringify(project, null, 2) + '\n'; await writeFile(file, source);
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const result = await runAgentFileRequest({ protocol: 'vn-agent-v1', requestId: 'p0-capture-preview', command: 'preview', project: file,
  params: { caseId: 'yes-route', output: path.join(run, 'preview'), captureEvidence: true } });
assert.equal(result.status, 'PASS', JSON.stringify(result));
const artifact = result.artifacts.find(value => value.kind === 'runtime-evidence'); assert.ok(artifact);
const bytes = await readFile(artifact.path); assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
const report = readRuntimeEvidenceReport(JSON.parse(bytes));
assert.equal(assessRuntimeEvidenceReport(project, sourceSha256, report).binding, 'current');
assert.equal(report.scope.media, false); assert.equal(report.scope.audioDevice, false);
assert.ok(report.events.some(event => event.outcome === 'action-applied'));
assert.ok(report.events.some(event => event.type === 'lifecycle' && event.reason === 'dispose'));
assert.ok(report.events.filter(event => event.type === 'navigation').every(event => Array.isArray(event.origin.path)));
assert.equal(await readFile(file, 'utf8'), source);
await writeFile(path.join(root, 'P0_PREVIEW_REPORT.json'), JSON.stringify({ status: 'PASS', sourceSha256, artifacts: result.artifacts,
  scope: { actualRenderer: true, audioHost: false, importedEvidenceAcceptance: 'UNVERIFIED' } }, null, 2) + '\n');
console.log('PASS P0 Node SDK preview captures source-bound runtime evidence as a hashed artifact without player storage or audio claims');
