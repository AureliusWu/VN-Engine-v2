#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runAgentFileRequest } from './agent-node.mjs';
import { AGENT_PROTOCOL, AGENT_LIMITS, AgentError, agentResponse, failAgent, exitCodeFor } from '../dist/agent/index.js';
export async function agentCLI(argv = process.argv.slice(2), stdin = process.stdin) {
  try {
    if (argv[0] === '--help' || argv[0] === 'help') return { ...agentResponse('help'), data: { usage: 'npm run --silent agent -- <command> --project=FILE --params=JSON [--request-id=ID] | --request=FILE | --request=-', commands: ['capabilities','init','inspect','refs','apply','validate','test','preview','build','review','probe'], params: 'Command params are JSON; capabilities --params=\'{"schema":"request"}\' returns the executable schema. All stdout is one JSON response.' } };
    const args = new Map(); let command;
    for (const arg of argv) {
      if (!arg.startsWith('--')) { if (command) throw new AgentError('INVALID_ARGUMENT', 'Unexpected argument ' + arg); command = arg; continue; }
      const at = arg.indexOf('='); if (at < 0) throw new AgentError('INVALID_ARGUMENT', 'Flags use --name=value');
      const key = arg.slice(2, at); if (!['request','project','params','request-id'].includes(key) || args.has(key)) throw new AgentError('INVALID_ARGUMENT', 'Unknown or duplicate flag ' + key); args.set(key, arg.slice(at + 1));
    }
    let input;
    if (args.has('request')) {
      if (command || args.size !== 1) throw new AgentError('INVALID_ARGUMENT', '--request cannot be combined with other flags');
      if (args.get('request') === '-') { const chunks = []; let bytes = 0; for await (const chunk of stdin) { bytes += Buffer.byteLength(chunk); if (bytes > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Stdin exceeds input budget', {}, 'UNVERIFIED'); chunks.push(Buffer.from(chunk)); } input = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
      else { const file = args.get('request'); if ((await fs.stat(file)).size > AGENT_LIMITS.inputBytes) throw new AgentError('BUDGET_EXCEEDED', 'Request file too large', {}, 'UNVERIFIED'); input = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file)); }
    } else {
      let params; try { params = JSON.parse(args.get('params') ?? '{}'); } catch { throw new AgentError('MALFORMED_JSON', '--params must be JSON'); }
      input = { protocol: AGENT_PROTOCOL, requestId: args.get('request-id') ?? randomUUID(), command: command ?? 'capabilities', ...(args.has('project') ? { project: args.get('project') } : {}), params };
    }
    return await runAgentFileRequest(input, { onLog: text => process.stderr.write(text) });
  } catch (error) { return failAgent(agentResponse(), error instanceof AgentError ? error : new AgentError(error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ? 'INVALID_ENCODING' : 'INVALID_ARGUMENT', error.message)); }
}
const response = await agentCLI();
process.stdout.write(JSON.stringify(response) + '\n'); process.exitCode = exitCodeFor(response.status);
