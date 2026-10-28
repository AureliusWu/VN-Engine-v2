import { parentPort, workerData } from 'node:worker_threads';
import { runAgentFileRequestInProcess } from './agent-node.mjs';
const response = await runAgentFileRequestInProcess(workerData, { onPhase: (phase, data) => parentPort.postMessage({ phase, data }) });
parentPort.postMessage({ response });
